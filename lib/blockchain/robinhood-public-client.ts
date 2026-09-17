import { createPublicClient, defineChain, http, type PublicClient } from 'viem';
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_RPC_URL } from '@/lib/config/robinhood-chain';

// -----------------------------------------------------------------------------
// One shared Robinhood Chain `defineChain()` + read-only `PublicClient` for
// every call site that just needs to read/simulate (quoting, pool lookups)
// rather than send a signed transaction. `creator-rewards-vault-chain-client.ts`
// defines its own local `robinhoodChain` for its (signing) client because it
// predates this file; new read-only callers (the Uniswap quoter, in
// particular) should use this one instead of adding a fourth copy of the
// same three-line `defineChain()` call.
// -----------------------------------------------------------------------------

const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC_URL] } },
});

let cached: PublicClient | null = null;

/** Lazily-constructed, memoized read-only client — cheap to call repeatedly; the underlying `http()` transport is itself connection-pooled. */
export function getRobinhoodPublicClient(): PublicClient {
  if (!cached) {
    cached = createPublicClient({ chain: robinhoodChain, transport: http(ROBINHOOD_RPC_URL) });
  }
  return cached;
}
