import { BagExecutionGraph, BagExecutionIntent, CompiledExecution } from '../types';

// -----------------------------------------------------------------------------
// lib/execution/providers/types.ts
//
// `BagExecutionProvider` — the interface every execution backend (LI.FI
// Composer, plain LI.FI, a future direct-DEX adapter, the future BAG
// Router) implements. `lib/execution/compiler.ts` only ever talks to THIS
// interface — it never imports `@lifi/composer-sdk`, `@lifi/sdk`, or any
// other provider-specific package directly (spec item 3: "Compiler hiçbir
// zaman 'LI.FI kullan' diye hardcode edilmemeli").
// -----------------------------------------------------------------------------

/**
 * What a provider can and can't do — the compiler picks a provider by
 * matching an intent/graph's requirements against these, never by name.
 * Every flag is a plain boolean; a provider that "sometimes" supports a
 * capability (e.g. atomic only below N legs) expresses that nuance in
 * `supports()`, not by fudging one of these into a partial truth.
 */
export interface ProviderCapabilities {
  sameChain: boolean;
  crossChain: boolean;
  multiAsset: boolean;
  singleTransaction: boolean;
  requiresApproval: boolean;
  requiresMultipleSignatures: boolean;
  nativeAsset: boolean;
  erc20: boolean;
  atomic: boolean;
  supportsRecipient: boolean;
  supportsPermit: boolean;
  supportsComposer: boolean;
}

export interface ProviderQuoteLeg {
  legId: string;
  outputAmountRaw: string;
  minimumOutputRaw: string;
}

export interface ProviderQuote {
  legs: ProviderQuoteLeg[];
  /** Provider-reported total fee, in the input asset's raw units — `null` when the provider doesn't report one (never fabricated, same convention as `ExecutionStepQuote`). */
  estimatedFeeRaw: string | null;
}

export interface BagExecutionProvider {
  /** Stable machine-readable name (e.g. `'lifi-composer'`, `'lifi-sequential'`) — used for `providerId` on `CompiledExecution`, `providerHint` matching, and `constraints.allowedProviders`. Never shown to end users as-is. */
  identify(): string;

  getCapabilities(): ProviderCapabilities;

  /**
   * True iff this provider can plausibly serve `intent`/`graph` — never
   * throws, safe to call speculatively (same convention as the existing
   * `isComposerEligible()`). The compiler calls this on every registered
   * provider before choosing one; a provider returning `true` here that
   * then fails in `compile()` is a real failure (`PROVIDER_COMPILE_FAILED`),
   * not an expected/silent case.
   */
  supports(intent: BagExecutionIntent, graph: BagExecutionGraph): boolean;

  /** Optional — a provider without a meaningful pre-compile quote step (e.g. one where quoting and compiling are the same network call) may omit this; the compiler treats a missing `quote()` as "quote unavailable, proceed straight to compile()". */
  quote?(graph: BagExecutionGraph): Promise<ProviderQuote>;

  /**
   * Compiles `graph` into a normalized `CompiledExecution`. Must throw
   * (never return a partially-filled result) if compilation fails for a
   * provider that claimed `supports() === true` — the compiler wraps that
   * throw into `BagExecutionError('PROVIDER_COMPILE_FAILED', ...)`.
   */
  compile(intent: BagExecutionIntent, graph: BagExecutionGraph): Promise<CompiledExecution>;
}
