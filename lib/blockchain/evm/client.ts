import { createPublicClient, createWalletClient, http, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { EvmChainConfig } from './config';

// -----------------------------------------------------------------------------
// Thin viem client builders — no caching/singletons here (unlike
// lib/supabase/server.ts's cached client) because chain config can differ
// per call (different chain param) and these are cheap to construct; only
// the actual network calls are expensive.
// -----------------------------------------------------------------------------

export function createEvmPublicClient(config: EvmChainConfig): PublicClient {
  return createPublicClient({
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });
}

/**
 * Server-only. `DEPLOYER_PRIVATE_KEY` is the single service wallet that
 * sends `createBag` transactions (see contracts/BagFactory.sol's
 * `onlyDeployer` — this must be the address configured there). It is NOT
 * any individual creator's wallet; the real creator is passed as an
 * explicit `creator` argument to `createBag`, never inferred from
 * `msg.sender`. Never import this from client-side code.
 */
export function createEvmWalletClient(config: EvmChainConfig): WalletClient {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY is not set (see .env.example) — cannot sign a deployment transaction.');
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return createWalletClient({
    account,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });
}
