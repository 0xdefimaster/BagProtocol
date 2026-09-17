import { SupabaseClient } from '@supabase/supabase-js';
import { ChainId } from '@/types/basket-protocol';
import { BlockchainAdapter } from '@/lib/blockchain/adapter';
import { mockAdapter } from '@/lib/blockchain/mock-adapter';
import { createEvmAdapter } from '@/lib/blockchain/evm/adapter';
import { getEvmChainConfig, isEvmChainConfigured } from '@/lib/blockchain/evm/config';
import { computeOnChainBagId, computeOnChainCompositionHash } from '@/lib/domain/basket-protocol/onchain';
import { getBagById, getCurrentBagVersion, updateBagStatus, setProtocolDeployment } from '@/lib/server/bag-repo';
import { BagDeployment, confirmDeployment, failDeployment, startDeployment } from '@/lib/server/bag-deployment-repo';

// -----------------------------------------------------------------------------
// The one place ownership + deployment-state-machine + adapter-selection all
// come together (spec section 15). `deployBagToChain()` is what
// app/api/bags/[id]/deploy/route.ts calls AFTER requireSession() has already
// run — this function still re-checks ownership itself (never trust a
// caller's promise that it already checked), matching how bag-repo.ts's
// header documents the same "this file trusts whatever id it's given, but
// only server code that already authenticated should be able to reach it"
// contract. Nothing here sends a transaction directly; that's the adapter's
// job (MockAdapter or EvmAdapter, chosen below), kept swappable specifically
// so unit tests never need a real RPC endpoint (spec section 16/17).
// -----------------------------------------------------------------------------

export type DeployBagToChainResult =
  | { ok: true; deployment: BagDeployment }
  | { ok: false; error: 'BAG_NOT_FOUND' }
  | { ok: false; error: 'FORBIDDEN' }
  | { ok: false; error: 'NO_VERSION' }
  | { ok: false; error: 'ALREADY_IN_PROGRESS_OR_DEPLOYED'; deployment: BagDeployment | null }
  | { ok: false; error: 'DEPLOYMENT_FAILED'; message: string };

export class MockAdapterInProductionError extends Error {
  constructor(chain: ChainId) {
    super(
      `${chain} has no RPC_URL_${chain.toUpperCase()}/FACTORY_ADDRESS_${chain.toUpperCase()} configured, but NODE_ENV=production. ` +
        'Refusing to silently deploy a Bag through the mock adapter (which returns a fake tx hash and would let the DB record a ' +
        '"successful" deployment that never touched a real chain) — fix the chain configuration instead.'
    );
    this.name = 'MockAdapterInProductionError';
  }
}

function resolveAdapter(chain: ChainId): { adapter: BlockchainAdapter; factoryAddress: string } {
  if (isEvmChainConfigured(chain)) {
    return { adapter: createEvmAdapter(chain), factoryAddress: getEvmChainConfig(chain).factoryAddress };
  }
  // No RPC/factory configured for this chain (or it's not an EVM chain at
  // all yet, e.g. solana) — fall back to the mock adapter, but ONLY outside
  // production. Same fail-closed pattern as lib/server/price-provider.ts's
  // MockPriceProviderInProductionError: a missing chain config is a real
  // deploy-time misconfiguration, not something that should silently
  // degrade into fabricating a fake tx hash for a "successful" deployment
  // record. This is the intended default in dev/test, and is why unit
  // tests never need a real RPC endpoint (spec section 16/17): they run
  // against whatever `resolveAdapter` picks with no env vars set AND
  // NODE_ENV !== 'production', which is always this branch.
  if (process.env.NODE_ENV === 'production') {
    throw new MockAdapterInProductionError(chain);
  }
  return { adapter: mockAdapter, factoryAddress: 'mock-factory' };
}

// The Bag creator's on-chain identity is their wallet address
// (users.wallet_address, the same one wallet-signature auth already
// verified at login — see lib/auth/session.ts) — never the deployer/relayer
// wallet that actually sends the createBag transaction. Kept as a small
// isolated lookup rather than folding it into bag-repo.ts, since it's a
// users-table read, not a bags-table one.
async function getCreatorWalletAddress(admin: SupabaseClient, creatorId: string): Promise<string | null> {
  const { data, error } = await admin.from('users').select('wallet_address').eq('id', creatorId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { wallet_address: string } | null)?.wallet_address ?? null;
}

export async function deployBagToChain(
  admin: SupabaseClient,
  requestingUserId: string,
  bagId: string,
  chain?: ChainId
): Promise<DeployBagToChainResult> {
  const bag = await getBagById(admin, bagId);
  if (!bag) return { ok: false, error: 'BAG_NOT_FOUND' };

  // Ownership check lives HERE, not only in the API route — see module
  // header. `session.userId === bag.creatorId`, never a client-supplied id.
  if (bag.creatorId !== requestingUserId) return { ok: false, error: 'FORBIDDEN' };

  const targetChain = chain ?? bag.chain;

  const version = await getCurrentBagVersion(admin, bag.id);
  if (!version) return { ok: false, error: 'NO_VERSION' };

  let resolved: { adapter: BlockchainAdapter; factoryAddress: string };
  try {
    resolved = resolveAdapter(targetChain);
  } catch (err) {
    // Same DEPLOYMENT_FAILED shape as every other failure below — the
    // caller (app/api/bags/[id]/deploy/route.ts) doesn't need a special
    // case for "chain misconfigured in production" vs. any other reason
    // the deployment couldn't proceed.
    return { ok: false, error: 'DEPLOYMENT_FAILED', message: err instanceof Error ? err.message : String(err) };
  }
  const { adapter, factoryAddress } = resolved;

  const started = await startDeployment(admin, bag.id, targetChain, factoryAddress);
  if (!started.started) {
    return { ok: false, error: 'ALREADY_IN_PROGRESS_OR_DEPLOYED', deployment: started.deployment };
  }

  const onChainBagId = computeOnChainBagId(bag.id);
  const compositionHash = computeOnChainCompositionHash(version.recipe.assets);
  // Placeholder scheme pending a real metadata JSON endpoint (out of
  // Phase 4 scope — no NFT-style metadata hosting exists yet). Resolvable
  // once that endpoint exists without touching the on-chain contract.
  const metadataURI = `bag:${bag.id}`;

  try {
    const creatorAddress = (await getCreatorWalletAddress(admin, bag.creatorId)) ?? '0x0000000000000000000000000000000000dEaD';

    const result = await adapter.deployBag({
      onChainBagId,
      compositionHash,
      creatorAddress,
      metadataURI,
    });

    const deployment = await confirmDeployment(admin, started.deployment.id, {
      contractAddress: result.contractAddress,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    });

    // First successful on-chain deployment is what the "primary" pointer
    // (bags.contract_address/registry_id, Phase 3) reflects — later
    // deployments to additional chains are still fully tracked in
    // bag_deployments, just don't overwrite this pointer. See
    // supabase/schema.sql's bag_deployments comment for the reasoning.
    if (!bag.contractAddress) {
      await setProtocolDeployment(admin, bag.id, { registryId: targetChain, contractAddress: result.contractAddress });
    }
    if (bag.status === 'DRAFT') {
      await updateBagStatus(admin, bag.id, 'ACTIVE');
    }

    return { ok: true, deployment };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failDeployment(admin, started.deployment.id, message);
    return { ok: false, error: 'DEPLOYMENT_FAILED', message };
  }
}
