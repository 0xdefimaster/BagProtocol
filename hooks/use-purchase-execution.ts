'use client';

import { useCallback, useRef, useState } from 'react';
import { executeRoute, convertQuoteToRoute, LiFiStep, RouteExtended, ExecutionAction } from '@lifi/sdk';
import { PurchaseIntent, PurchaseIntentFailureCode, PurchaseIntentStepRecord } from '@/types/purchase-intent';
import { getBrowserLiFiClient, getBrowserWalletClientForChain } from '@/lib/blockchain/lifi-wallet-client';

// -----------------------------------------------------------------------------
// Phase 17 — spec Aşama 6: drives the "Purchase" button's entire lifecycle
// from `PurchasePreviewModal`. Every network call that CREATES or ADVANCES
// server state goes through the typed `/api/.../purchase-intent*` routes
// (lib/server/purchase-execution.ts) — this hook never talks to Supabase or
// LI.FI's quote endpoints directly, only `@lifi/sdk`'s `executeRoute()` for
// the one thing that must run in-browser: turning an already-quoted,
// already-authorized LI.FI step into a signed, sent transaction via the
// user's own wallet (lib/blockchain/lifi-wallet-client.ts).
//
// SEQUENTIAL, not parallel, in the fallback case: a Bag purchase can have
// several SWAP steps (one per target asset); when `intent.composerTransaction`
// is null (Composer wasn't eligible/configured for this purchase — see
// lib/blockchain/lifi-purchase-quote.ts's `tryBuildComposerSteps()`), this
// hook executes them ONE AT A TIME so the wallet only ever shows one
// signature prompt at once and a rejection on step 2 doesn't leave step 1's
// tx racing an abandoned step 3.
//
// Phase 22 — when `intent.composerTransaction` IS set, every SWAP step was
// built as ONE shared LI.FI Composer transaction instead, and this hook
// sends that ONE transaction (`executeComposerTransaction()` below) rather
// than looping — genuinely one signature for every target asset, not N.
// -----------------------------------------------------------------------------

export type PurchaseExecutionPhase =
  | 'idle'
  | 'creating'
  | 'preparing'
  | 'awaiting_signature'
  | 'confirming'
  | 'completed'
  | 'failed';

export interface PurchaseExecutionState {
  phase: PurchaseExecutionPhase;
  intent: PurchaseIntent | null;
  /** Index of the SWAP step currently prompting the wallet — drives "Approve Token (2/3)"-style UI. */
  activeStepIndex: number | null;
  error: string | null;
  failureCode: PurchaseIntentFailureCode | null;
}

const INITIAL_STATE: PurchaseExecutionState = {
  phase: 'idle',
  intent: null,
  activeStepIndex: null,
  error: null,
  failureCode: null,
};

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new PurchaseExecutionHttpError(data?.error ?? `Request failed (${res.status})`, data?.failureCode ?? null);
  }
  return data as T;
}

class PurchaseExecutionHttpError extends Error {
  constructor(
    message: string,
    public readonly failureCode: PurchaseIntentFailureCode | null
  ) {
    super(message);
    this.name = 'PurchaseExecutionHttpError';
  }
}

async function reportStep(
  intentId: string,
  stepIndex: number,
  event:
    | { type: 'APPROVAL_REQUIRED' | 'APPROVAL_AWAITING_SIGNATURE' | 'APPROVAL_CONFIRMED' | 'AWAITING_SIGNATURE' }
    | { type: 'APPROVAL_SUBMITTED' | 'SUBMITTED'; txHash: string }
    | { type: 'REJECTED' }
    | { type: 'FAILED'; failureCode: PurchaseIntentFailureCode; message?: string }
): Promise<PurchaseIntent> {
  const { intent } = await postJson<{ intent: PurchaseIntent }>(
    `/api/purchase-intent/${intentId}/step/${stepIndex}/report`,
    event
  );
  return intent;
}

async function verifyIntent(intentId: string): Promise<PurchaseIntent> {
  const { intent } = await postJson<{ intent: PurchaseIntent }>(`/api/purchase-intent/${intentId}/verify`);
  return intent;
}

/** Flattens every included LI.FI step's `execution.actions` into one ordered list — a single `PurchaseIntentStepRecord` (one asset swap) can involve more than one on-chain action (allowance + swap, or swap + bridge leg), and this app reports ONE approval state + ONE main-tx state per record, not per LI.FI sub-action. */
function flattenActions(route: RouteExtended): ExecutionAction[] {
  return route.steps.flatMap((s) => s.execution?.actions ?? []);
}

const ALLOWANCE_ACTION_TYPES = new Set(['CHECK_ALLOWANCE', 'SET_ALLOWANCE', 'RESET_ALLOWANCE', 'PERMIT', 'NATIVE_PERMIT']);
const MAIN_ACTION_TYPES = new Set(['SWAP', 'CROSS_CHAIN', 'RECEIVING_CHAIN']);

function isUserRejection(action: ExecutionAction): boolean {
  const code = action.error?.code;
  const message = action.error?.message?.toLowerCase() ?? '';
  return code === 4001 || code === '4001' || message.includes('reject') || message.includes('denied') || message.includes('user cancel');
}

/**
 * Maps the latest allowance/main action from a LI.FI route update to a
 * server step-report event. Returns `null` when there's nothing new to
 * report (e.g. `STARTED` with no signature prompt yet) — the caller only
 * calls the report endpoint for a non-null result, and only when it
 * differs from the last-reported event for that step (deduped by the
 * caller via a ref), to avoid spamming the server on every LI.FI progress
 * tick.
 */
function mapActionToEvent(
  action: ExecutionAction,
  kind: 'approval' | 'main'
): Parameters<typeof reportStep>[2] | null {
  switch (action.status) {
    case 'ACTION_REQUIRED':
      return kind === 'approval' ? { type: 'APPROVAL_REQUIRED' } : { type: 'AWAITING_SIGNATURE' };
    case 'PENDING':
      if (action.txHash) {
        return kind === 'approval' ? { type: 'APPROVAL_SUBMITTED', txHash: action.txHash } : { type: 'SUBMITTED', txHash: action.txHash };
      }
      return kind === 'approval' ? { type: 'APPROVAL_AWAITING_SIGNATURE' } : { type: 'AWAITING_SIGNATURE' };
    case 'DONE':
      return kind === 'approval' ? { type: 'APPROVAL_CONFIRMED' } : action.txHash ? { type: 'SUBMITTED', txHash: action.txHash } : null;
    case 'FAILED':
      if (isUserRejection(action)) return { type: 'REJECTED' };
      return {
        type: 'FAILED',
        failureCode: kind === 'approval' ? 'INSUFFICIENT_ALLOWANCE' : 'TRANSACTION_REVERTED',
        message: action.error?.message,
      };
    default:
      return null;
  }
}

export function usePurchaseExecution() {
  const [state, setState] = useState<PurchaseExecutionState>(INITIAL_STATE);
  // Dedupes reportStep() calls across rapid-fire updateRouteHook ticks —
  // keyed by `${stepIndex}:${kind}`, value is the last event `type` sent.
  const lastReportedRef = useRef<Map<string, string>>(new Map());

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
    lastReportedRef.current.clear();
  }, []);

  const fail = useCallback((error: string, failureCode: PurchaseIntentFailureCode | null = null) => {
    setState((s) => ({ ...s, phase: 'failed', error, failureCode }));
  }, []);

  /**
   * Single-signature path (Phase 22): `intent.composerTransaction` is set
   * when `lib/blockchain/lifi-purchase-quote.ts`'s `tryBuildComposerSteps()`
   * built every SWAP step as ONE shared LI.FI Composer transaction rather
   * than N independent LI.FI routes. Sends that ONE transaction directly
   * (not via `executeRoute()` — Composer's `transactionRequest` is plain
   * `{to, data, value}` calldata, not a `LiFiStep`/`Route`) and reports the
   * SAME resulting tx hash for EVERY swap step index, since the server's
   * `/verify` endpoint still checks each step's `txHash` independently —
   * this keeps that check meaningful (one real receipt, looked up once per
   * step) without needing a server-side concept of "these N steps share a
   * hash".
   */
  const executeComposerTransaction = useCallback(
    async (
      intentId: string,
      composerTransaction: NonNullable<PurchaseIntent['composerTransaction']>,
      swapSteps: PurchaseIntentStepRecord[],
      walletAddress: string
    ): Promise<void> => {
      setState((s) => ({ ...s, activeStepIndex: swapSteps[0]?.stepIndex ?? null, phase: 'awaiting_signature' }));
      await Promise.all(
        swapSteps.map((step) => reportStep(intentId, step.stepIndex, { type: 'AWAITING_SIGNATURE' }).catch(() => {}))
      );

      let txHash: string;
      try {
        const walletClient = await getBrowserWalletClientForChain(walletAddress, composerTransaction.chainId);
        txHash = await walletClient.sendTransaction({
          account: walletAddress as `0x${string}`,
          to: composerTransaction.to as `0x${string}`,
          data: composerTransaction.data as `0x${string}`,
          value: BigInt(composerTransaction.value),
          chain: null,
        });
      } catch (err) {
        const code = err && typeof err === 'object' && 'code' in err ? (err as { code: number }).code : undefined;
        const message = err instanceof Error ? err.message : String(err);
        const rejected = code === 4001 || message.toLowerCase().includes('reject') || message.toLowerCase().includes('denied');
        await Promise.all(
          swapSteps.map((step) =>
            reportStep(
              intentId,
              step.stepIndex,
              rejected ? { type: 'REJECTED' } : { type: 'FAILED', failureCode: 'UNKNOWN_ERROR', message }
            ).catch(() => {})
          )
        );
        throw err;
      }

      setState((s) => ({ ...s, phase: 'confirming' }));
      await Promise.all(
        swapSteps.map((step) => reportStep(intentId, step.stepIndex, { type: 'SUBMITTED', txHash }).catch(() => {}))
      );
    },
    []
  );

  const executeOneStep = useCallback(
    async (intentId: string, step: PurchaseIntentStepRecord, walletAddress: string): Promise<void> => {
      if (step.action !== 'SWAP' || !step.lifiStep) return; // KEEP / already-failed steps need nothing
      setState((s) => ({ ...s, activeStepIndex: step.stepIndex, phase: 'awaiting_signature' }));

      const client = getBrowserLiFiClient(walletAddress);
      const route = convertQuoteToRoute(step.lifiStep as LiFiStep);

      const handleUpdate = (updatedRoute: RouteExtended) => {
        const actions = flattenActions(updatedRoute);
        const approvalAction = [...actions].reverse().find((a) => ALLOWANCE_ACTION_TYPES.has(a.type));
        const mainAction = [...actions].reverse().find((a) => MAIN_ACTION_TYPES.has(a.type));

        for (const [kind, action] of [
          ['approval', approvalAction] as const,
          ['main', mainAction] as const,
        ]) {
          if (!action) continue;
          const key = `${step.stepIndex}:${kind}`;
          const dedupeKey = `${action.status}:${action.txHash ?? ''}`;
          if (lastReportedRef.current.get(key) === dedupeKey) continue;
          const event = mapActionToEvent(action, kind);
          if (!event) continue;
          lastReportedRef.current.set(key, dedupeKey);
          // Fire-and-forget from LI.FI's own callback (which isn't async-
          // aware) — errors here surface on the NEXT poll/report, never
          // silently swallowed, since `executeRoute()`'s own resolution/
          // rejection below is still the source of truth for this step.
          reportStep(intentId, step.stepIndex, event).catch(() => {});
          if (event.type === 'SUBMITTED') {
            setState((s) => ({ ...s, phase: 'confirming' }));
          }
        }
      };

      try {
        await executeRoute(client, route, { updateRouteHook: handleUpdate });
      } catch (err) {
        // executeRoute() throwing after a rejection/failure is expected —
        // the LAST updateRouteHook tick already reported the specific
        // REJECTED/FAILED reason above; this catch only guards against a
        // step that failed before ever producing a reportable action tick.
        const key = `${step.stepIndex}:main`;
        if (!lastReportedRef.current.has(key)) {
          const message = err instanceof Error ? err.message : 'Wallet execution failed.';
          await reportStep(intentId, step.stepIndex, { type: 'FAILED', failureCode: 'UNKNOWN_ERROR', message }).catch(() => {});
        }
        throw err;
      }
    },
    []
  );

  const start = useCallback(
    async (bagId: string, inputAssetId: string, amount: string, walletAddress: string): Promise<void> => {
      reset();
      setState((s) => ({ ...s, phase: 'creating' }));

      // Tracks whether an intent has actually been created server-side yet.
      // Used below to decide whether a thrown error means "nothing to
      // verify, fail now" (nothing happened) or "something may already be
      // on-chain, ask the server" (a wallet/execution error AFTER an
      // intent existed and at least one step attempted to sign).
      let createdIntentId: string | null = null;

      try {
        const { intent: created } = await postJson<{ intent: PurchaseIntent }>(`/api/bags/${bagId}/purchase-intent`, {
          inputAssetId,
          amount,
        });
        createdIntentId = created.id;
        setState((s) => ({ ...s, intent: created }));

        setState((s) => ({ ...s, phase: 'preparing' }));
        const { intent: prepared } = await postJson<{ intent: PurchaseIntent }>(
          `/api/purchase-intent/${created.id}/execute`
        );
        setState((s) => ({ ...s, intent: prepared }));

        const swapSteps = prepared.steps.filter((s) => s.action === 'SWAP');
        if (prepared.composerTransaction) {
          await executeComposerTransaction(prepared.id, prepared.composerTransaction, swapSteps, walletAddress);
        } else {
          for (const step of swapSteps) {
            await executeOneStep(prepared.id, step, walletAddress);
          }
        }
      } catch (err) {
        if (createdIntentId === null || err instanceof PurchaseExecutionHttpError) {
          // Nothing was ever signed/sent — either the intent itself never
          // got created, or it failed a purely server-side check (expired,
          // route changed) before any wallet interaction. There is
          // nothing on-chain for /verify to check, so this client-side
          // reason IS the final answer.
          if (err instanceof PurchaseExecutionHttpError) fail(err.message, err.failureCode);
          else fail(err instanceof Error ? err.message : 'Purchase failed.');
          return;
        }
        // A wallet/execution-layer error (user rejection, revert, an RPC
        // hiccup while broadcasting) AFTER the intent existed and a step
        // was attempted. executeOneStep() already reported the specific
        // REJECTED/FAILED reason to the server before rethrowing here —
        // deliberately fall through to the SAME verify loop the happy
        // path uses below, rather than ending the flow on this client-side
        // guess. The server's own on-chain check is the one thing that
        // actually decides the outcome (spec: never client say-so) — it
        // may confirm this step failed, or (a broadcast hiccup that LOOKED
        // like a rejection but the transaction actually landed) it may
        // not. Falling through here, instead of returning immediately, is
        // what makes that correction possible.
      }

      setState((s) => ({ ...s, phase: 'confirming' }));

      try {
        // Poll verification until the intent reaches a terminal status —
        // this is the ONLY path that can mark the purchase COMPLETED (spec
        // Aşama 10/12/13: server-verified on-chain, never client say-so).
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const verified = await verifyIntent(createdIntentId);
          setState((s) => ({ ...s, intent: verified }));
          if (verified.status === 'COMPLETED') {
            setState((s) => ({ ...s, phase: 'completed' }));
            return;
          }
          if (verified.status === 'FAILED' || verified.status === 'EXPIRED' || verified.status === 'CANCELLED') {
            fail('The purchase could not be completed.', verified.failureCode);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 4000));
        }
      } catch (err) {
        if (err instanceof PurchaseExecutionHttpError) {
          fail(err.message, err.failureCode);
        } else {
          fail(err instanceof Error ? err.message : 'Purchase failed.');
        }
      }
    },
    [executeOneStep, executeComposerTransaction, fail, reset]
  );

  return { state, start, reset };
}
