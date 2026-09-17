import { ChainId } from '@/types/basket-protocol';
import { base, arbitrum, mainnet } from 'viem/chains';
import { defineChain } from 'viem';
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_RPC_URL, ROBINHOOD_EXPLORER_URL } from '@/lib/config/robinhood-chain';

// -----------------------------------------------------------------------------
// Per-chain deployment config, read from env — never hardcoded RPC URLs,
// factory addresses, or keys in source. See .env.example for the full list.
// Only EVM chains here; Solana (in `SUPPORTED_CHAINS`, types/basket-protocol.ts)
// has no EVM factory and isn't addressed by this module — same "don't force
// multi-chain support that doesn't exist yet" principle Phase 1 already
// applied to `ChainId`.
//
// `robinhood` was added here in Phase 19.X-continuation, closing a gap
// scripts/deploy-bag-factory.ts's own header used to document explicitly
// ("Robinhood Chain is intentionally NOT one of the choices here"). Before
// this change, `isEvmChainConfigured('robinhood')` was always false, so
// `deploy-bag.ts` always fell back to `mockAdapter` for every Bag deployed
// on Robinhood Chain — even in a real dev/staging run with a funded wallet
// — and produced a fake tx hash recorded as a "successful" deployment.
// That fallback is still exactly correct behavior for "chain genuinely not
// configured yet" (missing FACTORY_ADDRESS_ROBINHOOD); this change only
// makes it possible to CONFIGURE robinhood in the first place.
// -----------------------------------------------------------------------------

const EVM_CHAINS = ['ethereum', 'base', 'arbitrum', 'robinhood'] as const;
type EvmChainId = (typeof EVM_CHAINS)[number];

function isEvmChain(chain: ChainId): chain is EvmChainId {
  return (EVM_CHAINS as readonly string[]).includes(chain);
}

/**
 * Robinhood Chain has no entry in `viem/chains` (it's not a viem-maintained
 * chain), so it's defined here from the same verified constants
 * `lib/config/robinhood-chain.ts` is the sole source of truth for —
 * `chainId`/RPC/explorer are never re-typed as separate literals in this
 * file. Kept typed as `typeof mainnet` (like `base`/`arbitrum` already are,
 * via their own `as unknown as typeof mainnet` casts below) purely so
 * `VIEM_CHAIN_BY_ID`'s value type stays a single shared shape — this is a
 * pre-existing pattern in this file, not something new introduced here.
 */
const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC_URL] } },
  blockExplorers: { default: { name: 'Blockscout', url: ROBINHOOD_EXPLORER_URL } },
}) as unknown as typeof mainnet;

const VIEM_CHAIN_BY_ID: Record<EvmChainId, typeof mainnet> = {
  ethereum: mainnet,
  base: base as unknown as typeof mainnet,
  arbitrum: arbitrum as unknown as typeof mainnet,
  robinhood: robinhoodChain,
};

function envKey(chain: EvmChainId): string {
  return chain.toUpperCase();
}

export interface EvmChainConfig {
  chain: EvmChainId;
  viemChain: typeof mainnet;
  rpcUrl: string;
  factoryAddress: `0x${string}`;
  explorerUrl?: string;
}

export class ChainNotConfiguredError extends Error {
  constructor(chain: ChainId) {
    super(
      `No EVM deployment config for chain "${chain}". Set RPC_URL_${chain.toUpperCase()} and ` +
        `FACTORY_ADDRESS_${chain.toUpperCase()} (see .env.example) before deploying to it.`
    );
    this.name = 'ChainNotConfiguredError';
  }
}

/** Just the `viemChain` for an EVM chain, with no requirement that RPC_URL/FACTORY_ADDRESS be configured yet — for deploy scripts (which are establishing that config, not consuming it) and anything else that needs "what chain object is this" without needing a full `EvmChainConfig`. */
export function getViemChainFor(chain: ChainId): typeof mainnet {
  if (!isEvmChain(chain)) {
    throw new ChainNotConfiguredError(chain);
  }
  return VIEM_CHAIN_BY_ID[chain];
}

/** Reads RPC_URL_<CHAIN> / FACTORY_ADDRESS_<CHAIN> from env. Throws `ChainNotConfiguredError` (not a generic Error) so callers — deploy-bag.ts in particular — can tell "not configured" apart from "misconfigured"/"RPC down" and fall back to the mock adapter accordingly. */
export function getEvmChainConfig(chain: ChainId): EvmChainConfig {
  if (!isEvmChain(chain)) {
    throw new ChainNotConfiguredError(chain);
  }
  const key = envKey(chain);
  // Robinhood Chain has one verified, canonical public RPC URL
  // (`ROBINHOOD_RPC_URL`) — unlike ethereum/base/arbitrum, which have no
  // protocol-blessed default and MUST come from env (an Infura/Alchemy/etc.
  // URL this codebase has no business guessing). `RPC_URL_ROBINHOOD` can
  // still override it (e.g. to point at a private/faster RPC provider),
  // it's just not REQUIRED the way it is for the other three chains.
  const rpcUrl = process.env[`RPC_URL_${key}`] || (chain === 'robinhood' ? ROBINHOOD_RPC_URL : undefined);
  const factoryAddress = process.env[`FACTORY_ADDRESS_${key}`];
  if (!rpcUrl || !factoryAddress) {
    throw new ChainNotConfiguredError(chain);
  }
  return {
    chain,
    viemChain: VIEM_CHAIN_BY_ID[chain],
    rpcUrl,
    factoryAddress: factoryAddress as `0x${string}`,
    explorerUrl: process.env[`EXPLORER_URL_${key}`] || (chain === 'robinhood' ? ROBINHOOD_EXPLORER_URL : undefined),
  };
}

/** True if every env var `getEvmChainConfig(chain)` needs is present — lets deploy-bag.ts decide "use EvmAdapter" vs "fall back to MockAdapter" without throwing/catching as control flow. */
export function isEvmChainConfigured(chain: ChainId): boolean {
  try {
    getEvmChainConfig(chain);
    return true;
  } catch {
    return false;
  }
}

