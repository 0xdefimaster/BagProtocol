'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, ArrowRight, Loader2, CheckCircle2, AlertTriangle, Wallet } from 'lucide-react';
import { formatDecimalStringUsd, formatRawAmount, formatRawAmountUsd } from '@/lib/format';
import { useWallet } from '@/lib/wallet-context';
import { usePurchaseExecution } from '@/hooks/use-purchase-execution';
import { deriveSigningExpectation } from '@/lib/execution/signing-expectation';

// -----------------------------------------------------------------------------
// Phase 12 — Purchase Preview. Replaces InvestModal (components/app/
// InvestModal.tsx) as the "Invest" entry point on BagCard and both bag
// detail pages. Deliberately NOT the same flow as InvestModal's
// onConfirm(amount): that was — and, as a standalone file, still is — the
// existing PAPER TRADING confirm (creates a Position, no domain math).
// This component does not call it, does not create a paper position, and
// does not move any money — it only shows what the Phase 10 domain
// pipeline (calculateDepositAllocation -> getDepositQuote ->
// buildExecutionPlan, wired server-side in
// app/api/bags/[id]/purchase-preview/route.ts) says WOULD happen.
//
// UI computes nothing itself — every number here comes from the server
// response. See lib/server/purchase-preview.ts for where the actual math
// lives.
//
// Phase 13 cleanup — every raw/decimal-string display below goes through
// lib/format.ts's `formatRawAmount*`/`formatDecimalString*` helpers, never
// `Number(...)`. This wasn't a cosmetic-only concern: `Number(rawBigString)`
// silently loses precision for a large share quantity well before any
// `.toFixed()`/`.toLocaleString()` runs — the loss happens at the
// `Number(...)` conversion itself, which is exactly the "no JS number on
// the financial path" rule the domain layer (shares.ts) already follows
// for computation, now followed here for display too.
// -----------------------------------------------------------------------------

interface InputAssetOption {
  id: string;
  chain: string;
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

interface DepositAllocationView {
  targetSymbol: string;
  targetWeightBps: number;
  valueRaw: string;
  action: 'KEEP' | 'SWAP';
}

interface ExecutionStepView {
  targetSymbol: string;
  action: 'KEEP' | 'SWAP';
}

// Phase 14 — mirrors lib/blockchain/execution-adapter.ts's `ExecutionStepQuote`/
// `ExecutionQuoteError`/`ExecutionResult`. UI-local view types (not imported
// from lib/blockchain directly, same convention `DepositAllocationView`/
// `ExecutionStepView` above already establish for this file) — only the
// fields actually rendered are listed.
interface ExecutionQuoteView {
  outputAmountRaw: string;
  outputDecimals: number;
  minOutputRaw: string | null;
  route: string | null;
  gasCostRaw: string | null;
  gasCostAsset: { chain: string; address: string } | null;
}

interface ExecutionQuoteErrorView {
  code: 'QUOTE_UNAVAILABLE' | 'UNSUPPORTED_ROUTE' | 'INVALID_ASSET' | 'PROVIDER_ERROR';
  message: string;
}

interface ExecutionStepResultView {
  step: ExecutionStepView;
  quote: ExecutionQuoteView | null;
  error: ExecutionQuoteErrorView | null;
}

interface ExecutionResultView {
  steps: ExecutionStepResultView[];
}

interface PurchasePreviewResponse {
  disclaimer: string;
  inputSymbol: string;
  inputAmountDisplay: string;
  depositPlan: { allocations: DepositAllocationView[]; unallocatedRaw: string };
  depositQuote: { sharesRaw: string; shareDecimals: number; sharePrice: string; isBootstrap: boolean };
  executionPlan: { steps: ExecutionStepView[] };
  navGross: string;
  navQuoteCurrency: string;
  isBootstrap: boolean;
  /** Phase 14 — present (possibly `null`) only because this file always requests `?quotes=true`; a caller of the raw API without that flag never gets this field populated. */
  quotes: ExecutionResultView | null;
  quotesError: string | null;
}

interface PurchasePreviewModalProps {
  bagId: string;
  bagName: string;
  onClose: () => void;
}

export function PurchasePreviewModal({ bagId, bagName, onClose }: PurchasePreviewModalProps) {
  const [amount, setAmount] = useState('100');
  const [inputAssets, setInputAssets] = useState<InputAssetOption[] | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [assetsError, setAssetsError] = useState<string | null>(null);

  const [preview, setPreview] = useState<PurchasePreviewResponse | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const wallet = useWallet();
  const execution = usePurchaseExecution();
  const isExecuting = execution.state.phase !== 'idle' && execution.state.phase !== 'failed';

  // Item 8 — derived in ONE place (lib/execution/signing-expectation.ts)
  // from the compiled execution's persisted mode, never recomputed from
  // steps here. Null until an intent exists, because the mode is only
  // known once the purchase has actually been compiled.
  const signingExpectation = useMemo(
    () => (execution.state.intent ? deriveSigningExpectation(execution.state.intent) : null),
    [execution.state.intent]
  );

  // Load the verified input-asset list once per bag.
  useEffect(() => {
    let cancelled = false;
    setLoadingAssets(true);
    setAssetsError(null);
    fetch(`/api/bags/${bagId}/purchase-preview`, { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (${res.status})`);
        return res.json() as Promise<{ inputAssets: InputAssetOption[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setInputAssets(data.inputAssets);
        setSelectedAssetId(data.inputAssets[0]?.id ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setAssetsError(err instanceof Error ? err.message : 'Unable to load input assets.');
      })
      .finally(() => {
        if (!cancelled) setLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bagId]);

  // Recompute the preview whenever amount/asset changes (debounced —
  // "Calculating..." for the network round trip, not for pure local math,
  // since there isn't any local math here to begin with).
  useEffect(() => {
    if (!selectedAssetId) return;

    const trimmed = amount.trim();
    if (trimmed === '') {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setCalculating(true);
    setPreviewError(null);

    const timer = setTimeout(() => {
      fetch(`/api/bags/${bagId}/purchase-preview?quotes=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ inputAssetId: selectedAssetId, amount: trimmed }),
      })
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error(body?.error ?? 'Unable to calculate allocation.');
          return body.preview as PurchasePreviewResponse;
        })
        .then((data) => {
          if (cancelled) return;
          setPreview(data);
        })
        .catch((err) => {
          if (cancelled) return;
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : 'Unable to calculate allocation.');
        })
        .finally(() => {
          if (!cancelled) setCalculating(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bagId, selectedAssetId, amount]);

  const selectedAsset = useMemo(
    () => inputAssets?.find((a) => a.id === selectedAssetId) ?? null,
    [inputAssets, selectedAssetId]
  );

  const estimatedSharesDisplay = preview
    ? formatRawAmount(preview.depositQuote.sharesRaw, preview.depositQuote.shareDecimals, { maxFractionDigits: 4 })
    : null;

  return (
    <div
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{
          background: 'var(--surface, #0D0D0D)',
          border: '1px solid var(--line, rgba(217,185,139,0.16))',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 460,
          color: 'var(--ink, #F6F3EC)',
          fontFamily: 'var(--font-inter), sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Buy {bagName}</h3>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-soft, #B4AEA2)' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft, #B4AEA2)', marginBottom: 18 }}>
          {isExecuting || execution.state.phase === 'completed'
            ? 'This purchase uses a real, on-chain route signed by your wallet.'
            : 'Allocation below is a live preview. Purchasing executes real on-chain transactions from your wallet.'}
        </p>

        {/* Item 8 — the REAL signature/transaction expectation, taken from
            the compiled execution's own mode rather than assumed. Shown as
            soon as an intent exists (the mode is only determined once the
            purchase has been compiled); before that there is nothing
            truthful to state, so nothing is stated, and the copy above no
            longer implies a single transaction. */}
        {signingExpectation && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '9px 12px',
              borderRadius: 10,
              marginBottom: 14,
              fontSize: 12,
              border: '1px solid var(--line-soft, rgba(255,255,255,0.08))',
              color: 'var(--ink-soft, #B4AEA2)',
            }}
          >
            <Wallet size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              <strong style={{ color: 'var(--ink, #F6F3EC)', fontWeight: 600 }}>
                {signingExpectation.summary}
              </strong>
              {' — '}
              {signingExpectation.detail}
            </span>
          </div>
        )}

        {/* You Pay */}
        <div style={{ marginBottom: 6, fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-soft, #B4AEA2)' }}>
          You Pay
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            border: '1px solid var(--line-soft, rgba(255,255,255,0.08))',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 14,
            opacity: isExecuting ? 0.6 : 1,
          }}
        >
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            disabled={isExecuting}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--ink, #F6F3EC)',
              fontSize: 20,
              fontWeight: 600,
              minWidth: 0,
            }}
          />
          {loadingAssets ? (
            <span style={{ fontSize: 12.5, color: 'var(--ink-soft, #B4AEA2)' }}>Loading…</span>
          ) : assetsError ? (
            <span style={{ fontSize: 12.5, color: '#E27D60' }}>Assets unavailable</span>
          ) : inputAssets && inputAssets.length > 0 ? (
            <select
              value={selectedAssetId ?? ''}
              disabled={isExecuting}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              style={{
                background: 'var(--gold-tint, rgba(217,185,139,0.1))',
                border: '1px solid var(--line-soft, rgba(255,255,255,0.08))',
                borderRadius: 8,
                padding: '6px 10px',
                color: 'var(--gold-lt, #F0DFC0)',
                fontWeight: 600,
                fontSize: 13.5,
              }}
            >
              {inputAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.symbol}
                </option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--ink-soft, #B4AEA2)' }}>No verified input assets</span>
          )}
        </div>

        {previewError && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(226,125,96,0.4)',
              background: 'rgba(226,125,96,0.08)',
              color: '#E27D60',
              fontSize: 12.5,
              marginBottom: 14,
            }}
          >
            {previewError}
          </div>
        )}

        {calculating && !preview && !previewError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-soft, #B4AEA2)', fontSize: 12.5, marginBottom: 14 }}>
            <Loader2 size={14} className="spin" /> Calculating…
          </div>
        )}

        {preview && !previewError && (
          <>
            <div style={{ marginBottom: 6, fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-soft, #B4AEA2)' }}>
              Allocation
            </div>
            <div style={{ marginBottom: 14 }}>
              {preview.depositPlan.allocations.map((a) => {
                const valueDisplay = selectedAsset ? formatRawAmountUsd(a.valueRaw, selectedAsset.decimals) : '$0.00';
                return (
                  <div
                    key={a.targetSymbol}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      fontSize: 13,
                      borderBottom: '1px solid var(--line-soft, rgba(255,255,255,0.06))',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{a.targetSymbol}</span>
                    <span style={{ color: 'var(--ink-soft, #B4AEA2)' }}>{(a.targetWeightBps / 100).toFixed(0)}%</span>
                    <span>{valueDisplay}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: 0.3,
                        padding: '2px 8px',
                        borderRadius: 999,
                        color: a.action === 'KEEP' ? 'var(--gold-lt, #F0DFC0)' : 'var(--ink-soft, #B4AEA2)',
                        border: `1px solid ${a.action === 'KEEP' ? 'var(--gold, #D9B98B)' : 'var(--line-soft, rgba(255,255,255,0.1))'}`,
                      }}
                    >
                      {a.action}
                    </span>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 4,
                paddingTop: 10,
                borderTop: '1px solid var(--line-soft, rgba(255,255,255,0.08))',
              }}
            >
              <span style={{ fontSize: 12.5, color: 'var(--ink-soft, #B4AEA2)' }}>
                Estimated BAG Shares {preview.depositQuote.isBootstrap ? '(bootstrap quote)' : ''}
              </span>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{estimatedSharesDisplay}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, fontSize: 12.5, color: 'var(--ink-soft, #B4AEA2)' }}>
              <span>Price per share</span>
              <span>{formatDecimalStringUsd(preview.depositQuote.sharePrice)}</span>
            </div>

            <div style={{ marginBottom: 6, fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-soft, #B4AEA2)' }}>
              Allocation vs. Live Quote
            </div>
            <div style={{ marginBottom: 14, fontSize: 12.5, color: 'var(--ink-soft, #B4AEA2)' }}>
              {preview.executionPlan.steps.length} allocation{preview.executionPlan.steps.length === 1 ? '' : 's'}
              {preview.executionPlan.steps.map((s) => {
                const result = preview.quotes?.steps.find((r) => r.step.targetSymbol === s.targetSymbol);
                return (
                  <div key={s.targetSymbol} style={{ marginTop: 8, color: 'var(--ink, #F6F3EC)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{preview.inputSymbol}</span>
                      <ArrowRight size={12} />
                      <span>{s.targetSymbol}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ink-soft, #B4AEA2)' }}>
                        {s.action === 'KEEP' ? 'no route needed' : ''}
                      </span>
                    </div>
                    {s.action === 'SWAP' && (
                      <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--gold-lt, #F0DFC0)' }}>
                        {!preview.quotes && !preview.quotesError && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--ink-soft, #B4AEA2)' }}>
                            <Loader2 size={11} className="spin" /> Getting best route…
                          </span>
                        )}
                        {result?.quote && (
                          <span>
                            ≈ {formatRawAmount(result.quote.outputAmountRaw, result.quote.outputDecimals, { maxFractionDigits: 6 })}{' '}
                            {s.targetSymbol}
                            {result.quote.route ? <span style={{ color: 'var(--ink-soft, #B4AEA2)' }}> via {result.quote.route}</span> : null}
                          </span>
                        )}
                        {result?.error && (
                          <span style={{ color: '#E27D60' }}>
                            {result.error.code === 'QUOTE_UNAVAILABLE' ? 'No route available' : result.error.message}
                          </span>
                        )}
                        {!result && preview.quotes && (
                          <span style={{ color: 'var(--ink-soft, #B4AEA2)' }}>No route available</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {preview.quotesError && (
                <div style={{ marginTop: 10, color: '#E27D60' }}>Live quotes unavailable — allocation above is still accurate.</div>
              )}
            </div>
          </>
        )}

        {execution.state.phase !== 'idle' && (
          <PurchaseExecutionPanel
            state={execution.state}
            inputSymbol={preview?.inputSymbol ?? selectedAsset?.symbol ?? ''}
          />
        )}

        {execution.state.phase === 'completed' ? (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: 10,
              border: 'none',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              background: 'linear-gradient(155deg, var(--gold-lt, #F0DFC0), var(--gold, #D9B98B) 55%, var(--gold-dk, #9C7B49))',
              color: '#0A0805',
            }}
          >
            Done
          </button>
        ) : !wallet.hasProvider ? (
          <button
            disabled
            title="Install MetaMask, Coinbase Wallet, or Rabby to purchase"
            style={disabledButtonStyle}
          >
            No wallet detected
          </button>
        ) : !wallet.isConnected ? (
          <button onClick={() => wallet.connect()} disabled={wallet.isConnecting} style={primaryButtonStyle}>
            {wallet.isConnecting ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center', width: '100%' }}>
                <Loader2 size={14} className="spin" /> Connecting…
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center', width: '100%' }}>
                <Wallet size={15} /> Connect Wallet
              </span>
            )}
          </button>
        ) : !wallet.authUser ? (
          <button onClick={() => wallet.signIn()} disabled={wallet.isSigningIn} style={primaryButtonStyle}>
            {wallet.isSigningIn ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center', width: '100%' }}>
                <Loader2 size={14} className="spin" /> Confirm in wallet…
              </span>
            ) : (
              'Sign in to continue'
            )}
          </button>
        ) : (
          <button
            onClick={() => {
              if (!selectedAssetId) return;
              void execution.start(bagId, selectedAssetId, amount.trim(), wallet.walletAddress);
            }}
            disabled={!preview || !!previewError || calculating || isExecuting || !selectedAssetId}
            style={{
              ...primaryButtonStyle,
              opacity: !preview || !!previewError || calculating || isExecuting || !selectedAssetId ? 0.5 : 1,
              cursor: !preview || !!previewError || calculating || isExecuting || !selectedAssetId ? 'not-allowed' : 'pointer',
            }}
          >
            {isExecuting ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center', width: '100%' }}>
                <Loader2 size={14} className="spin" /> Purchase in progress…
              </span>
            ) : execution.state.phase === 'failed' ? (
              'Try again'
            ) : (
              'Purchase'
            )}
          </button>
        )}

        {wallet.error && <div style={{ marginTop: 10, fontSize: 12, color: '#E27D60' }}>{wallet.error}</div>}
        {wallet.authError && <div style={{ marginTop: 10, fontSize: 12, color: '#E27D60' }}>{wallet.authError}</div>}
      </div>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  background: 'linear-gradient(155deg, var(--gold-lt, #F0DFC0), var(--gold, #D9B98B) 55%, var(--gold-dk, #9C7B49))',
  color: '#0A0805',
};

const disabledButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'not-allowed',
  opacity: 0.5,
  background: 'linear-gradient(155deg, var(--gold-lt, #F0DFC0), var(--gold, #D9B98B) 55%, var(--gold-dk, #9C7B49))',
  color: '#0A0805',
};

// -----------------------------------------------------------------------------
// Phase 17 — real execution status, rendered above the button once a
// purchase has been started. Mirrors spec Aşama 6's suggested UI states
// (READY -> Wallet Confirmation Required -> Approve Token -> Confirm Swap
// -> Transaction Submitted -> Confirming -> Completed) without inventing
// any state this component doesn't actually have from the hook.
// -----------------------------------------------------------------------------

const FAILURE_MESSAGES: Partial<Record<string, string>> = {
  USER_REJECTED: 'You rejected the request in your wallet.',
  INSUFFICIENT_BALANCE: 'Insufficient balance to complete this purchase.',
  INSUFFICIENT_ALLOWANCE: 'Token approval failed or was insufficient.',
  SLIPPAGE_EXCEEDED: 'Price moved beyond the allowed slippage.',
  ROUTE_EXPIRED: 'This quote expired. Start a new purchase.',
  TRANSACTION_REVERTED: 'The transaction reverted on-chain.',
  EXECUTION_TIMEOUT: 'The transaction took too long to confirm.',
  UNSUPPORTED_ROUTE: 'This route is not currently supported.',
  PROVIDER_ERROR: 'The routing provider is temporarily unavailable.',
  VERIFICATION_FAILED: 'Received asset did not match what was quoted — no funds were credited.',
  UNKNOWN_ERROR: 'Something went wrong completing this purchase.',
};

function PurchaseExecutionPanel({
  state,
  inputSymbol,
}: {
  state: ReturnType<typeof usePurchaseExecution>['state'];
  inputSymbol: string;
}) {
  const swapSteps = state.intent?.steps.filter((s) => s.action === 'SWAP') ?? [];
  const activeSwapIndex = swapSteps.findIndex((s) => s.stepIndex === state.activeStepIndex);

  let label: string;
  if (state.phase === 'creating') label = 'Preparing your purchase…';
  else if (state.phase === 'preparing') label = 'Wallet confirmation required…';
  else if (state.phase === 'awaiting_signature') {
    const step = swapSteps[activeSwapIndex] ?? swapSteps[0];
    const position = swapSteps.length > 1 && activeSwapIndex >= 0 ? ` (${activeSwapIndex + 1}/${swapSteps.length})` : '';
    label = step ? `Confirm swap to ${step.targetSymbol} in your wallet${position}` : 'Confirm in your wallet…';
  } else if (state.phase === 'confirming') label = 'Confirming on-chain…';
  else if (state.phase === 'completed') label = 'Purchase complete';
  else if (state.phase === 'failed') label = FAILURE_MESSAGES[state.failureCode ?? ''] ?? state.error ?? 'Purchase failed.';
  else label = '';

  const isError = state.phase === 'failed';
  const isDone = state.phase === 'completed';

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 10,
        marginBottom: 14,
        fontSize: 12.5,
        border: `1px solid ${isError ? 'rgba(226,125,96,0.4)' : isDone ? 'rgba(122,200,140,0.4)' : 'var(--line-soft, rgba(255,255,255,0.08))'}`,
        background: isError ? 'rgba(226,125,96,0.08)' : isDone ? 'rgba(122,200,140,0.08)' : 'var(--gold-tint, rgba(217,185,139,0.06))',
        color: isError ? '#E27D60' : isDone ? '#7AC88C' : 'var(--ink, #F6F3EC)',
      }}
    >
      {isError ? <AlertTriangle size={14} /> : isDone ? <CheckCircle2 size={14} /> : <Loader2 size={14} className="spin" />}
      <span>{label}</span>
      {!isError && !isDone && inputSymbol && state.phase === 'creating' && (
        <span style={{ marginLeft: 'auto', color: 'var(--ink-soft, #B4AEA2)' }}>from {inputSymbol}</span>
      )}
    </div>
  );
}
