import { ExecutionPlan } from '@/types/basket-protocol';
import { PurchaseIntentStepRecord } from '@/types/purchase-intent';
import { ComposerTransactionSummary } from '@/lib/blockchain/lifi-purchase-quote';
import { CompiledExecution } from './types';
import { LegQuoteResult } from './providers/lifi-sequential-provider';

// -----------------------------------------------------------------------------
// lib/execution/purchase-intent-bridge.ts
//
// The seam between the new provider-independent `CompiledExecution` and the
// EXISTING `PurchaseIntent` persistence shape (`steps`, `composerTransaction`
// — types/purchase-intent.ts, unchanged). `lib/server/purchase-execution.ts`
// calls this INSTEAD of hand-rolling the mapping itself, so it never needs
// to know which provider produced `compiled` (spec item 6: "purchase-
// execution.ts provider-specific routing yapmasın") — this file is where
// that provider-specific knowledge (Composer's single shared tx vs
// sequential's per-leg `lifiStep`) is allowed to live, same boundary
// `lib/blockchain/lifi-purchase-quote.ts`'s `tryBuildComposerSteps()`
// already drew for the pre-compiler path.
//
// Deliberately built from the ORIGINAL `ExecutionPlan` (not just the
// `BagExecutionGraph`) — a `BagExecutionGraph` only carries SWAP legs
// (`plan.ts`'s `buildBagExecutionGraph()` skips `KEEP` steps entirely), but
// a `PurchaseIntent.steps` array needs a full row for every allocation,
// `KEEP` included. This function re-walks `plan.steps` in original order
// and reattaches each `SWAP` step's compiled result by position — the same
// `leg_<N>` id scheme `buildBagExecutionGraph()` assigns (Nth SWAP step,
// zero-indexed) is recomputed here rather than imported, since the two
// functions necessarily agree on it by construction (same filter, same
// order, over the same `plan.steps`).
// -----------------------------------------------------------------------------

export interface CompiledExecutionToStepsResult {
  steps: PurchaseIntentStepRecord[];
  /** Mirrors `BuildPurchaseIntentStepsResult.allSwapsQuoted` (lifi-purchase-quote.ts) — true iff every SWAP step above ended up with a real, non-FAILED result. */
  allSwapsQuoted: boolean;
  firstFailure: { failureCode: 'UNSUPPORTED_ROUTE' | 'PROVIDER_ERROR'; message: string } | null;
  composerTransaction: ComposerTransactionSummary | null;
}

export function compiledExecutionToPurchaseIntentSteps(
  plan: ExecutionPlan,
  compiled: CompiledExecution,
  /** A KEEP step's outputDecimals is always the (single) input asset's own decimals — same convention/reasoning as `buildPurchaseIntentSteps()`'s own `inputDecimals` parameter. */
  inputDecimals: number
): CompiledExecutionToStepsResult {
  const isComposer = compiled.mode === 'SINGLE_TX';
  const expectedByLegId = new Map(compiled.expectedOutputs.map((o) => [o.legId, o]));
  const legResults = (compiled.providerMetadata?.legResults as Record<string, LegQuoteResult> | undefined) ?? {};

  let swapIndex = 0;
  let firstFailure: { failureCode: 'UNSUPPORTED_ROUTE' | 'PROVIDER_ERROR'; message: string } | null = null;

  const steps: PurchaseIntentStepRecord[] = plan.steps.map((step, stepIndex) => {
    if (step.action === 'KEEP') {
      return {
        stepIndex,
        action: 'KEEP',
        targetSymbol: step.targetSymbol,
        inputAsset: step.route.inputAsset,
        outputAsset: step.route.outputAsset,
        sourceChain: step.route.sourceChain,
        destinationChain: step.route.destinationChain,
        inputAmountRaw: step.route.inputAmountRaw,
        targetValueRaw: step.route.targetValueRaw,
        outputAmountRaw: null,
        outputDecimals: inputDecimals,
        minOutputRaw: null,
        route: null,
        lifiStep: null,
        status: 'NOT_NEEDED',
        approvalTxHash: null,
        txHash: null,
        providerSubstatus: null,
        failureCode: null,
      };
    }

    const legId = `leg_${swapIndex}`;
    swapIndex += 1;
    const base = {
      stepIndex,
      action: 'SWAP' as const,
      targetSymbol: step.targetSymbol,
      inputAsset: step.route.inputAsset,
      outputAsset: step.route.outputAsset,
      sourceChain: step.route.sourceChain,
      destinationChain: step.route.destinationChain,
      inputAmountRaw: step.route.inputAmountRaw,
      targetValueRaw: step.route.targetValueRaw,
      approvalTxHash: null,
      txHash: null,
      providerSubstatus: null,
    };

    if (isComposer) {
      const expected = expectedByLegId.get(legId);
      if (!expected) {
        // Should not happen for a `mode: 'SINGLE_TX'` result the Composer
        // provider itself produced (every leg gets an entry) — handled
        // rather than assumed away, since this bridge must never silently
        // fabricate a PENDING step it has no data for.
        const failure = { failureCode: 'PROVIDER_ERROR' as const, message: `Composer result had no output for leg "${legId}".` };
        firstFailure = firstFailure ?? failure;
        return {
          ...base,
          outputAmountRaw: null,
          outputDecimals: null,
          minOutputRaw: null,
          route: null,
          lifiStep: null,
          status: 'FAILED' as const,
          failureCode: failure.failureCode,
        };
      }
      return {
        ...base,
        // Composer's figure is a SIMULATION, not an enforced minimum — same
        // field placement `tryBuildComposerSteps()` already used:
        // `outputAmountRaw` holds it, `minOutputRaw`/`route`/`lifiStep`
        // stay `null` (no per-leg LI.FI route exists for a shared Composer
        // transaction).
        outputAmountRaw: expected.minimumOutputRaw,
        outputDecimals: null,
        minOutputRaw: null,
        route: null,
        lifiStep: null,
        status: 'PENDING' as const,
        failureCode: null,
      };
    }

    const legResult = legResults[legId];
    if (!legResult || !legResult.ok) {
      const failure = legResult && !legResult.ok
        ? { failureCode: legResult.failureCode, message: legResult.message }
        : { failureCode: 'PROVIDER_ERROR' as const, message: `No quote result for leg "${legId}".` };
      firstFailure = firstFailure ?? failure;
      return {
        ...base,
        outputAmountRaw: null,
        outputDecimals: null,
        minOutputRaw: null,
        route: null,
        lifiStep: null,
        status: 'FAILED' as const,
        failureCode: failure.failureCode,
      };
    }

    return {
      ...base,
      outputAmountRaw: legResult.outputAmountRaw,
      outputDecimals: legResult.outputDecimals,
      minOutputRaw: legResult.minOutputRaw,
      route: legResult.route,
      lifiStep: legResult.lifiStep,
      status: 'PENDING' as const,
      failureCode: null,
    };
  });

  const composerTransaction: ComposerTransactionSummary | null = isComposer
    ? {
        to: compiled.transactions[0]?.to ?? '',
        data: compiled.transactions[0]?.data ?? '',
        value: compiled.transactions[0]?.value ?? '0',
        chainId: compiled.chainId,
        userProxy: (compiled.providerMetadata?.userProxy as string | undefined) ?? '',
      }
    : null;

  return {
    steps,
    allSwapsQuoted: firstFailure === null,
    firstFailure,
    composerTransaction,
  };
}
