'use client';

import { createClient, SDKClient } from '@lifi/sdk';
import { EthereumProvider, EthereumSDKProvider } from '@lifi/sdk-provider-ethereum';
import { createWalletClient, custom, type Chain, type WalletClient } from 'viem';
import { arbitrum, base, mainnet } from 'viem/chains';

// -----------------------------------------------------------------------------
// Phase 17 — spec Aşama 1/4/6: THE ONLY place a real transaction gets built
// and signed. This module runs entirely in the browser ('use client'), talks
// only to `window.ethereum` (the same EIP-1193 provider lib/wallet-context.tsx
// already connects), and never imports anything server-only. No private
// key, seed phrase, or server-issued credential of any kind is read here —
// every signature comes from the wallet extension's own UI.
//
// Deliberately separate from lib/blockchain/lifi-config.ts (the SERVER's
// memoized `@lifi/sdk` client, used for quoting only) — that module is
// imported from API routes and must never see this file's browser-only
// EthereumProvider setup, and this file must never import that module's
// `LIFI_API_KEY`-reading `getLiFiClient()` (server-only secret).
// -----------------------------------------------------------------------------

// Mirrors lib/blockchain/lifi-config.ts's ChainId -> numeric mapping, but
// as a viem `Chain` object (id + native currency + a fallback RPC) rather
// than a bare number — needed here because viem's `WalletClient` uses this
// for signing-domain/typed-data validation. `custom(window.ethereum)` is
// what actually SENDS requests, so `rpcUrls` below is only ever a fallback
// viem itself may consult, never load-bearing for signing.
const ROBINHOOD_CHAIN: Chain = {
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.robinhood.chain'] } },
};

const VIEM_CHAINS_BY_NUMERIC_ID: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
  [ROBINHOOD_CHAIN.id]: ROBINHOOD_CHAIN,
};

function toHexChainId(numericChainId: number): `0x${string}` {
  return `0x${numericChainId.toString(16)}`;
}

/** Throws with a clear, UI-safe message rather than a `window.ethereum` `undefined` TypeError — this file is only ever called after `useWallet().isConnected`/`hasProvider` is already true, so hitting this is a real bug, not an expected path. */
function requireInjectedProvider(): NonNullable<Window['ethereum']> {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No wallet extension found. Connect a wallet first.');
  }
  return window.ethereum;
}

/** Builds a fresh viem `WalletClient` for `walletAddress`, bound to whichever chain the wallet is CURRENTLY on (or `preferredNumericChainId` right after a chain switch, since some wallets fire `eth_chainId` slightly behind `wallet_switchEthereumChain` resolving). */
async function buildWalletClient(walletAddress: string, preferredNumericChainId?: number): Promise<WalletClient> {
  const provider = requireInjectedProvider();
  const numericChainId =
    preferredNumericChainId ?? parseInt((await provider.request({ method: 'eth_chainId' })) as string, 16);
  const chain = VIEM_CHAINS_BY_NUMERIC_ID[numericChainId];
  if (!chain) {
    throw new Error(`Your wallet is on an unsupported network (chain id ${numericChainId}). Switch networks and try again.`);
  }
  return createWalletClient({
    account: walletAddress as `0x${string}`,
    chain,
    transport: custom(provider),
  });
}

/** Requests the wallet switch to `targetNumericChainId` (EIP-3326) and returns a fresh `WalletClient` bound to it — passed to `@lifi/sdk-provider-ethereum` as its `switchChain` hook, so LI.FI's own `executeRoute()` drives "Switch Network" prompts itself rather than this app pre-guessing which chain a route needs. */
async function switchChainAndRebuildClient(walletAddress: string, targetNumericChainId: number): Promise<WalletClient> {
  const provider = requireInjectedProvider();
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: toHexChainId(targetNumericChainId) }],
    });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code: number }).code : undefined;
    if (code === 4001) throw new Error('Network switch was rejected.');
    throw err instanceof Error ? err : new Error('Could not switch networks.');
  }
  return buildWalletClient(walletAddress, targetNumericChainId);
}

/**
 * Public counterpart to `getBrowserLiFiClient()` for the ONE thing that
 * needs a raw viem `WalletClient` instead of a LI.FI SDK client: sending
 * an already-compiled LI.FI Composer transaction
 * (lib/blockchain/lifi-composer-adapter.ts's `transactionRequest` —
 * plain `{to, data, value}` calldata, not a `LiFiStep`/`Route` LI.FI's own
 * `executeRoute()` knows how to drive). Switches chain first if the
 * wallet isn't already on `numericChainId` — same EIP-3326 path
 * `switchChainAndRebuildClient()` already uses for LI.FI route execution,
 * reused here rather than duplicated.
 */
export async function getBrowserWalletClientForChain(walletAddress: string, numericChainId: number): Promise<WalletClient> {
  const provider = requireInjectedProvider();
  const currentChainId = parseInt((await provider.request({ method: 'eth_chainId' })) as string, 16);
  if (currentChainId === numericChainId) {
    return buildWalletClient(walletAddress, numericChainId);
  }
  return switchChainAndRebuildClient(walletAddress, numericChainId);
}

let cachedSdkClient: SDKClient | null = null;
let cachedEvmProvider: EthereumSDKProvider | null = null;
let cachedForAddress: string | null = null;

/**
 * Returns the browser-side LI.FI SDK client, configured to sign/send with
 * `walletAddress`'s CURRENT wallet client. Memoized per address — a
 * changed `walletAddress` (account switch — lib/wallet-context.tsx's
 * `accountsChanged` listener) rebuilds the provider's `getWalletClient`
 * hook rather than reusing a stale one bound to the previous account.
 */
export function getBrowserLiFiClient(walletAddress: string): SDKClient {
  if (cachedEvmProvider && cachedForAddress === walletAddress) {
    return cachedSdkClient as SDKClient;
  }

  const evmProvider = EthereumProvider({
    getWalletClient: () => buildWalletClient(walletAddress),
    switchChain: (chainId) => switchChainAndRebuildClient(walletAddress, chainId),
  });

  if (!cachedSdkClient) {
    cachedSdkClient = createClient({
      integrator: process.env.NEXT_PUBLIC_LIFI_INTEGRATOR ?? 'bag-protocol',
      providers: [evmProvider],
    });
  } else {
    cachedSdkClient.setProviders([evmProvider]);
  }

  cachedEvmProvider = evmProvider;
  cachedForAddress = walletAddress;
  return cachedSdkClient;
}

/** Test-only: drop every memoized client/provider — mirrors lib/blockchain/lifi-config.ts's `resetLiFiClientForTests()`. */
export function resetBrowserLiFiClientForTests(): void {
  cachedSdkClient = null;
  cachedEvmProvider = null;
  cachedForAddress = null;
}

/**
 * Sends ONE already-compiled transaction as-is — the Composer counterpart
 * to `getBrowserLiFiClient()` + `executeRoute()` above. Composer
 * (lib/blockchain/lifi-composer-adapter.ts) returns plain `{to, data,
 * value}` calldata, not a LI.FI `LiFiStep`/route, so there is nothing for
 * `@lifi/sdk`'s `executeRoute()` to do here — this just signs and
 * broadcasts exactly what the server already compiled, the same "one
 * place a real transaction gets built and signed" boundary this file's
 * header comment describes, extended to a second kind of transaction
 * rather than bypassed by building one somewhere else.
 *
 * Switches the wallet to `tx.chainId` first if it isn't already there
 * (same `wallet_switchEthereumChain` flow `executeRoute()` itself drives
 * for a LI.FI route, via `switchChainAndRebuildClient` above) — a
 * same-chain Composer flow still needs the wallet ON that chain to sign
 * correctly, this just isn't automatic the way it is inside
 * `executeRoute()`.
 */
export async function sendComposerTransaction(
  walletAddress: string,
  tx: { to: string; data: string; value: string; chainId: number }
): Promise<`0x${string}`> {
  const provider = requireInjectedProvider();
  const currentChainId = parseInt((await provider.request({ method: 'eth_chainId' })) as string, 16);
  const client =
    currentChainId === tx.chainId
      ? await buildWalletClient(walletAddress, tx.chainId)
      : await switchChainAndRebuildClient(walletAddress, tx.chainId);

  if (!client.chain) {
    throw new Error(`Your wallet is on an unsupported network. Switch to chain id ${tx.chainId} and try again.`);
  }

  return client.sendTransaction({
    account: walletAddress as `0x${string}`,
    chain: client.chain,
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value: BigInt(tx.value),
  });
}
