import { createComposeSdk, guards, materialisers, resources } from '@lifi/composer-sdk';
import type { Bindable, ComposeSdkOptions } from '@lifi/composer-sdk';
import type { ProducedResource } from '@lifi/compose-spec';
import { ChainId } from '@/types/basket-protocol';
import { toLiFiChainId } from './lifi-config';

// -----------------------------------------------------------------------------
// lifi-composer-adapter.ts — genuinely single-signature multi-asset purchase,
// via LI.FI's Composer product (`@lifi/composer-sdk`, real published package,
// verified against its actual installed type definitions before writing this
// file — not from memory or marketing copy alone).
//
// WHY THIS EXISTS: lifi-purchase-quote.ts (the existing path) builds one
// `getQuote()` per target asset, and hooks/use-purchase-execution.ts
// deliberately executes them ONE AT A TIME — N target assets means N wallet
// signatures. That is a real, previously-documented limitation (see
// docs/PHASE_19X_REPORT.md, V13_DURUM_RAPORU.md section K). Composer bundles
// multiple on-chain actions into ONE transaction, so a same-chain multi-asset
// Bag purchase can become ONE signature instead of N. This module is that
// alternate path — NOT a replacement for lifi-purchase-quote.ts, which
// remains the only option for cross-chain and Solana-target purchases (see
// ELIGIBLE eligibility check below).
//
// HOW THE FAN-OUT IS BUILT: Composer's `core.split` op only ever produces
// TWO outputs from ONE bps ratio (verified against
// node_modules/@lifi/composer-sdk/dist/generated/operations.generated.d.ts's
// own doc comment: "Split a resource into two outputs by basis-point ratio"
// — there is no N-way split op). An N-leg purchase is therefore built as a
// CASCADE of N-1 two-way splits, each one splitting off the next leg's share
// from whatever remains, with each step's bps recomputed relative to the
// REMAINING pool (not the original total) so the final percentages come out
// right. The very last leg consumes the final remainder directly with no
// split at all — this is also where any bps-rounding dust lands, rather than
// being silently lost or requiring a separate sweep-in step.
//
// WHAT THIS MODULE DOES NOT DO: sign or broadcast anything. It returns
// compiled calldata (`transactionRequest`) for the caller's wallet layer to
// sign — same boundary as lifi-execution-adapter.ts. It also does not touch
// BagFactory, Supabase, or any existing execution path; wiring this in as an
// actual alternative to the sequential path is a separate, deliberate
// integration decision for whoever calls this.
// -----------------------------------------------------------------------------

/**
 * Chains this module will build a Composer flow for. Deliberately NOT the
 * same list as `SUPPORTED_CHAINS` (types/basket-protocol.ts) — Composer's
 * own docs say "EVM chains only" with no other chain-specific allowlist
 * published, but that's a claim about the product in general, not a
 * per-chain guarantee this project has independently confirmed for each of
 * its own chains:
 *   - 'solana' — excluded. Composer's docs explicitly say non-EVM chains
 *     are not supported.
 *   - 'robinhood' — NOT included by default even though it's a confirmed
 *     EVM chain (Arbitrum Orbit, see lifi-config.ts) and LI.FI's own base
 *     swap/routing API is confirmed to support it (same file's comment on
 *     `LIFI_CHAIN_IDS.robinhood`). That confirmation was for the plain
 *     quote/execute API, not specifically for Composer — nobody has run a
 *     real Composer flow against chain id 4663 and confirmed it compiles.
 *     Add it here only after that's actually been done, not on the
 *     assumption that "EVM chain LI.FI already routes to" implies
 *     "Composer supports it too".
 */
export const COMPOSER_ELIGIBLE_CHAINS: readonly ChainId[] = ['ethereum', 'base', 'arbitrum'];

export interface ComposerPurchaseLeg {
  /** Target ERC-20 address for this leg. */
  address: string;
  /** This leg's share of the total input, in basis points. All legs' weightBps must sum to exactly 10000. */
  weightBps: number;
  /** For error messages only — not sent to Composer. */
  symbol: string;
}

export interface ComposerPurchaseRequest {
  chain: ChainId;
  /** Input token address (ERC-20 — native-asset input is not handled by this module; see `resources.erc20` usage below). */
  inputTokenAddress: string;
  /** Raw input amount (token's smallest unit), as a decimal string. */
  inputAmountRaw: string;
  legs: ComposerPurchaseLeg[];
  /** The wallet that will sign the compiled transaction. */
  signerAddress: string;
  /** Per-leg slippage tolerance in basis points (e.g. 100 = 1%). Applied uniformly — callers wanting per-leg values should call this module once per distinct tolerance and merge, not something this module infers on its own. */
  slippageBps: number;
  /** REQUIRED — verified against the installed `@lifi/composer-sdk` package's own types, not assumed: unlike the plain LI.FI quote API, Composer rejects unauthenticated requests outright. `LIFI_API_KEY` (.env.example) must be set for this path to work at all — this is a real, new requirement this integration adds, not something the existing sequential lifi-purchase-quote.ts path needed. */
  apiKey: string;
  /** Defaults to Composer's production API (`https://composer.li.quest`) per docs.li.fi's quickstart. Override only for the documented ETHGlobal preview environment or in tests. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class ComposerIneligibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposerIneligibleError';
  }
}

/**
 * True only when a Composer flow can plausibly express this purchase as one
 * same-chain transaction: the chain is one this module has actually been
 * pointed at Composer for (see `COMPOSER_ELIGIBLE_CHAINS`'s doc comment),
 * and there's at least one leg. Callers should fall back to
 * lifi-purchase-quote.ts's sequential path whenever this returns false —
 * this function never throws, so it's safe to call speculatively before
 * deciding which path to build.
 */
export function isComposerEligible(chain: ChainId, legs: readonly ComposerPurchaseLeg[]): boolean {
  return COMPOSER_ELIGIBLE_CHAINS.includes(chain) && legs.length > 0;
}

/** Recomputes each leg's split-bps relative to the REMAINING pool at that cascade step, not the original total — see this file's header comment for why. Exported standalone (pure, no SDK calls) so the math can be unit-tested without mocking fetch. */
export function computeCascadeSplitBps(legs: readonly ComposerPurchaseLeg[]): number[] {
  const totalBps = legs.reduce((sum, leg) => sum + leg.weightBps, 0);
  if (totalBps !== 10000) {
    throw new Error(`Leg weights must sum to exactly 10000 bps, got ${totalBps}.`);
  }
  const splitBpsByStep: number[] = [];
  let remainingBps = 10000;
  // Only the first N-1 legs need a split step — the last leg consumes
  // whatever's left directly (see header comment).
  for (let i = 0; i < legs.length - 1; i++) {
    const leg = legs[i];
    const stepBps = Math.round((leg.weightBps / remainingBps) * 10000);
    // Clamp defensively against floating-point drift landing on exactly
    // 10000 (which would leave nothing for the remainder handle) or
    // negative (shouldn't happen given the sum check above, but a leg with
    // weightBps <= 0 could get here from bad upstream data).
    splitBpsByStep.push(Math.min(9999, Math.max(1, stepBps)));
    remainingBps -= leg.weightBps;
  }
  return splitBpsByStep;
}

export interface ComposerPurchaseResult {
  /** Ready to pass to the wallet as-is: { to, data, value }. */
  transactionRequest: { to: string; data: string; value: string; chainId?: number };
  /** The Composer execution proxy this transaction runs through — informational, matches what CreatorRewardsVault/RedeemFeeRouter's own "who actually holds funds mid-transaction" documentation style expects callers to be told, not hidden. */
  userProxy: string;
  /** Per-leg simulated output, keyed by this module's own `swap_<index>` node ids — see buildLegNodeId(). Re-exports the SDK's own `ProducedResource` type as-is rather than a hand-narrowed shape, so a field this module doesn't use today doesn't silently get dropped for a future caller that needs it. */
  producedResources: Record<string, ProducedResource>;
}

function buildLegNodeId(index: number): string {
  return `swap_${index}`;
}

/**
 * Builds and compiles a single Composer Flow that swaps one input into all
 * of `request.legs` in one transaction, then returns the compiled calldata.
 * Throws `ComposerIneligibleError` if called for a chain/leg combination
 * `isComposerEligible` would have rejected — check that first; this
 * function re-checks and throws rather than silently degrading, since
 * building half a flow for an ineligible chain is worse than refusing
 * outright.
 */
export async function buildComposerPurchase(request: ComposerPurchaseRequest): Promise<ComposerPurchaseResult> {
  if (!isComposerEligible(request.chain, request.legs)) {
    throw new ComposerIneligibleError(
      `Chain "${request.chain}" with ${request.legs.length} leg(s) is not eligible for a Composer flow — use the sequential lifi-purchase-quote.ts path instead.`
    );
  }

  const chainId = toLiFiChainId(request.chain);
  const sdkOptions: ComposeSdkOptions = {
    baseUrl: request.baseUrl ?? 'https://composer.li.quest',
    apiKey: request.apiKey,
  };
  if (request.fetchImpl !== undefined) {
    (sdkOptions as { fetch?: typeof fetch }).fetch = request.fetchImpl;
  }
  const sdk = createComposeSdk(sdkOptions);

  const builder = sdk.flow(chainId, {
    name: `bag-purchase-${request.legs.length}-legs`,
    inputs: {
      amountIn: resources.erc20(request.inputTokenAddress as `0x${string}`, chainId),
    },
  });

  const slippage = request.slippageBps / 10000;
  const splitBpsByStep = computeCascadeSplitBps(request.legs);

  let currentResource: Bindable<'resource'> = builder.inputs.amountIn;
  for (let i = 0; i < request.legs.length - 1; i++) {
    const leg = request.legs[i];
    const { a, b } = builder.core.split(`split_${i}`, {
      bind: { source: currentResource },
      config: { bps: splitBpsByStep[i] },
    });
    builder.lifi.swap(buildLegNodeId(i), {
      bind: { amountIn: a },
      config: {
        resourceOut: { kind: 'erc20', token: leg.address as `0x${string}`, chainId },
        slippage,
      },
      guards: [guards.slippage({ port: 'unspentIn', bps: request.slippageBps })],
    });
    currentResource = b;
  }

  // Last leg: whatever remains, no split needed.
  const lastIndex = request.legs.length - 1;
  const lastLeg = request.legs[lastIndex];
  builder.lifi.swap(buildLegNodeId(lastIndex), {
    bind: { amountIn: currentResource },
    config: {
      resourceOut: { kind: 'erc20', token: lastLeg.address as `0x${string}`, chainId },
      slippage,
    },
    guards: [guards.slippage({ port: 'unspentIn', bps: request.slippageBps })],
  });

  const result = await builder.compile({
    signer: request.signerAddress as `0x${string}`,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: BigInt(request.inputAmountRaw) }),
    },
    sweepTo: { $ref: 'context.sender' },
    // Avoids an unnecessary approval step (and its own signature) when the
    // signer already approved this exact spend previously — see
    // ComposeRunInput's own doc comment on this flag.
    checkOnChainAllowances: true,
  });

  if (result.status !== 'success') {
    throw new Error(`Composer flow compilation failed: ${result.error.kind} — ${result.error.message}`);
  }
  if (!result.transactionRequest) {
    // Not expected given `status === 'success'`, but this module never
    // hands a wallet layer a possibly-missing `to`/`data` without checking
    // — see the "never fabricate a transaction" principle applied
    // everywhere else in this codebase's blockchain adapters.
    throw new Error('Composer flow reported success but returned no transactionRequest.');
  }

  return {
    transactionRequest: {
      to: result.transactionRequest.to,
      data: result.transactionRequest.data,
      value: result.transactionRequest.value ?? '0',
      chainId,
    },
    userProxy: result.userProxy,
    producedResources: result.producedResources,
  };
}
