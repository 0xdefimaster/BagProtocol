import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import factoryArtifact from '../artifacts/contracts/BagFactory.sol/BagFactory.json' with { type: 'json' };
import { getViemChainFor } from '../lib/blockchain/evm/config';
import { ROBINHOOD_RPC_URL } from '../lib/config/robinhood-chain';

// -----------------------------------------------------------------------------
// scripts/deploy-bag-factory.ts — deploys contracts/BagFactory.sol to ONE of
// the four EVM chains lib/blockchain/evm/config.ts knows how to talk to
// (ethereum | base | arbitrum | robinhood). Robinhood Chain support was
// added here alongside evm/config.ts's own EVM_CHAINS update — before that,
// this script (and deploy-bag.ts's `resolveAdapter()`) explicitly excluded
// it, which meant a Bag "deployed" on Robinhood Chain in dev never touched
// a real chain at all (silent MockAdapter fallback — see
// lib/server/deploy-bag.ts's own doc on that fallback).
//
// Now routes through `getEvmChainConfig()` directly (one implementation of
// "how do I get an RPC URL/viem chain for chain X," not a second copy of
// the ethereum/base/arbitrum table this file used to keep locally) — so
// this script and `deploy-bag.ts`'s adapter selection can never drift
// out of sync on what "robinhood is configured" means.
//
// Same shape as scripts/deploy-creator-rewards.ts: plain viem, no hardhat
// network config, one-shot script that only prints — it never writes env
// files or any other state itself, so a bad run can't silently become "the"
// deployment.
//
// IMPORTANT — read before running against a real mainnet:
//   BagFactory's `owner` is set to `msg.sender` at construction time and
//   there is NO function on the contract to change it afterwards (only
//   `setDeployer`, which rotates the separate `deployer` role). Whichever
//   wallet broadcasts this script's deploy transaction is PERMANENTLY the
//   owner of the deployed BagFactory. The contract's own NatSpec recommends
//   that be a multisig before any real deployment — if you want that, the
//   multisig itself must be the one broadcasting this transaction (e.g. via
//   a Safe transaction builder), not a plain private key passed to this
//   script. This script's `DEPLOYER_PRIVATE_KEY` account is used for BOTH
//   broadcasting (-> owner) and as the `_deployer` constructor arg (-> the
//   day-to-day createBag signer) for simplicity; that means owner and
//   deployer are the same hot wallet unless you change this script before
//   running it. Decide on your ownership model BEFORE running this against
//   mainnet — it cannot be changed after.
//
// CANNOT BE RUN FROM THIS SANDBOX: this container's network egress
// allowlist has no RPC-provider domains (Alchemy/Infura/Robinhood's own
// RPC/etc.) on it, only npm/pypi/github. Compiles fine here (see
// BagFactory.test.ts passing), but an actual broadcast to ANY of these four
// chains, Robinhood Chain included, has NOT been performed or verified
// from here — run it yourself with a real RPC endpoint (VS Code, real
// network access).
//
// USAGE
//   export DEPLOYER_PRIVATE_KEY=0x...
//   # Robinhood Chain has a verified default RPC (ROBINHOOD_RPC_URL,
//   # lib/config/robinhood-chain.ts) — RPC_URL_ROBINHOOD is optional,
//   # only needed to override it (e.g. a private/faster RPC provider).
//   npx tsx scripts/deploy-bag-factory.ts robinhood
//
//   # ethereum / base / arbitrum still require RPC_URL_<CHAIN> explicitly —
//   # no protocol-blessed default RPC exists for those.
//   export RPC_URL_ETHEREUM=...
//   npx tsx scripts/deploy-bag-factory.ts ethereum   # or base | arbitrum
//
// OUTPUT
//   Deployed BagFactory address, printed with the exact env line to paste
//   into .env (FACTORY_ADDRESS_<CHAIN>=...). Nothing is written to disk.
// -----------------------------------------------------------------------------

const SUPPORTED = ['ethereum', 'base', 'arbitrum', 'robinhood'] as const;
type SupportedChain = (typeof SUPPORTED)[number];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function parseChainArg(): SupportedChain {
  const arg = process.argv[2];
  if (!arg || !(SUPPORTED as readonly string[]).includes(arg)) {
    throw new Error(`Usage: npx tsx scripts/deploy-bag-factory.ts <${SUPPORTED.join('|')}>`);
  }
  return arg as SupportedChain;
}

async function main() {
  const chain = parseChainArg();
  const key = chain.toUpperCase();
  const deployerKey = requireEnv('DEPLOYER_PRIVATE_KEY') as `0x${string}`;

  let rpcUrl = process.env[`RPC_URL_${key}`];
  if (!rpcUrl && chain === 'robinhood') rpcUrl = ROBINHOOD_RPC_URL;
  if (!rpcUrl) throw new Error(`Missing required env var: RPC_URL_${key}`);

  const viemChain = getViemChainFor(chain);
  const account = privateKeyToAccount(deployerKey);

  const publicClient = createPublicClient({ chain: viemChain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: viemChain, transport: http(rpcUrl) });

  const liveChainId = await publicClient.getChainId();
  if (liveChainId !== viemChain.id) {
    throw new Error(
      `RPC_URL_${key} reports chain id ${liveChainId}, expected ${viemChain.id} for "${chain}". ` +
        'Refusing to deploy — this looks like the wrong RPC endpoint for this chain.'
    );
  }

  console.log(`Deploying BagFactory to ${chain} (chain id ${viemChain.id}) as ${account.address}`);
  console.log(`  owner (permanent, = broadcasting wallet): ${account.address}`);
  console.log(`  deployer (createBag signer, rotatable via setDeployer): ${account.address}`);

  const deployHash = await walletClient.deployContract({
    abi: factoryArtifact.abi,
    bytecode: factoryArtifact.bytecode as `0x${string}`,
    args: [account.address],
  });
  console.log(`  tx: ${deployHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  if (receipt.status !== 'success' || !receipt.contractAddress) {
    throw new Error(`Deployment transaction failed or returned no contract address. Receipt: ${JSON.stringify(receipt)}`);
  }

  console.log('\n--- Deployed ---');
  console.log(`BagFactory (${chain}): ${receipt.contractAddress}`);
  console.log(`Block: ${receipt.blockNumber}`);
  console.log('\nPaste into .env:');
  console.log(`FACTORY_ADDRESS_${key}=${receipt.contractAddress}`);
  if (chain === 'robinhood') console.log(`RPC_URL_${key}=${rpcUrl}  # optional — omit to use the built-in default`);
}

main().catch((err) => {
  console.error('\nDeployment FAILED:');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

