'use client';

import { allAssets, cryptoAssets, formatUSD, stockAssets } from '@/lib/create-assets-data';
import { fetchRegistryStockAssets } from '@/lib/registry-assets-client';
import { AssetSelector } from '@/components/create/AssetSelector';
import { AllocationEditor } from '@/components/create/AllocationEditor';
import { NetworkSelector } from '@/components/create/NetworkSelector';
import { useUserBags } from '@/lib/user-bags-store';
import { useActivity } from '@/lib/activity-store';
import { useNotifications } from '@/lib/notifications-store';
import { useWallet } from '@/lib/wallet-context';
import { mockUser } from '@/lib/mock-data';
import { NETWORKS } from '@/lib/constants';
import { Bag } from '@/types';
import { MAX_PERFORMANCE_FEE_BPS } from '@/types/basket-protocol';
import { ArrowRight, Save, Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const INVEST_PRESETS = [100, 500, 1000, 5000, 10000];

// Proportionally shrinks/grows the other allocations so the total always stays at 100.
function rebalance(
  ids: string[],
  current: Record<string, number>,
  changedId: string,
  rawValue: number
): Record<string, number> {
  const newValue = Math.max(0, Math.min(100, Math.round(rawValue) || 0));
  const others = ids.filter(id => id !== changedId);
  const next: Record<string, number> = { ...current, [changedId]: newValue };

  if (others.length === 0) {
    next[changedId] = 100;
    return next;
  }

  const oldOthersTotal = others.reduce((s, id) => s + (current[id] || 0), 0);
  const targetOthersTotal = 100 - newValue;

  if (targetOthersTotal <= 0) {
    others.forEach(id => (next[id] = 0));
  } else if (oldOthersTotal <= 0) {
    const equal = Math.floor(targetOthersTotal / others.length);
    let remainder = targetOthersTotal - equal * others.length;
    others.forEach(id => {
      next[id] = equal + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
    });
  } else {
    let allocatedSoFar = 0;
    others.forEach((id, idx) => {
      const share = (current[id] || 0) / oldOthersTotal;
      const val =
        idx === others.length - 1
          ? Math.max(0, targetOthersTotal - allocatedSoFar)
          : Math.max(0, Math.round(share * targetOthersTotal));
      next[id] = val;
      allocatedSoFar += val;
    });
  }

  return next;
}

export default function CreatePage() {
  const router = useRouter();
  const { addBag } = useUserBags();
  const { addActivity } = useActivity();
  const { addNotification } = useNotifications();
  const { walletAddress, isConnected } = useWallet();
  const selfAddress = isConnected ? walletAddress : mockUser.address;
  const [bagName, setBagName] = useState('');
  const [description, setDescription] = useState('');
  const [thesis, setThesis] = useState('');
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [investmentAmount, setInvestmentAmount] = useState(1000);
  const [selectedNetworkIds, setSelectedNetworkIds] = useState<string[]>(['ethereum']);
  // Phase 22 — basis points of realized profit paid to this bag's creator
  // on redemption (types/basket-protocol.ts's Phase 22 doc block). Default
  // 0 = no fee, which is a fully valid choice, not a placeholder — the
  // creator opts INTO a fee, never has one silently applied.
  const [performanceFeeBps, setPerformanceFeeBps] = useState(0);
  const [currentStep, setCurrentStep] = useState<'basic' | 'assets' | 'allocation' | 'review'>('basic');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string[] | null>(null);

  // Real, registry-backed assets for whichever network is actually used at
  // submission time (`selectedNetworkIds[0]` — see the `chain: ...` line in
  // handlePublish below; the selector's other toggled chips aren't sent).
  // Starts empty (not a static list) so `assetPool` below correctly falls
  // back to the full static demo list per asset type until this resolves,
  // rather than showing a partial pool during the fetch.
  //
  // Refetches whenever the primary network changes: a coin or stock's
  // contract address is chain-specific (coingecko-import.ts /
  // robinhood-import.ts each write one chain's deployment per run), so
  // "registry has USDC" on Ethereum says nothing about whether it has USDC
  // on Base — this must re-ask per chain, not just once on mount.
  const primaryChain = selectedNetworkIds[0];
  const [registryAssets, setRegistryAssets] = useState<typeof allAssets>([]);
  const [registryAssetsLoading, setRegistryAssetsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRegistryAssetsLoading(true);
    fetchRegistryStockAssets(primaryChain)
      .then((assets) => {
        if (!cancelled) setRegistryAssets(assets);
      })
      .finally(() => {
        if (!cancelled) setRegistryAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [primaryChain]);

  // Prefer real registry-backed assets once loaded, per asset type
  // independently — e.g. Base might have VERIFIED crypto deployments but
  // no Stock Tokens yet, and should show real crypto alongside the static
  // stock list rather than falling back to static for both just because
  // one type came back empty. Falls back to the full static list for a
  // type only when the registry has nothing of that type yet for this
  // chain (e.g. Supabase not configured locally, or neither importer has
  // run for this chain) so Create Basket still works in dev.
  //
  // NOTE: switching the primary network after assets are already selected
  // does not currently clear `selectedAssetIds` — a composition chosen
  // against one chain's registry can end up submitted against another. Not
  // fixed here; flagging it rather than silently discarding a person's
  // selections without being asked to.
  const registryCrypto = useMemo(() => registryAssets.filter((a) => a.type === 'crypto'), [registryAssets]);
  const registryStock = useMemo(() => registryAssets.filter((a) => a.type === 'stock'), [registryAssets]);

  const assetPool = useMemo(() => {
    const crypto = registryCrypto.length > 0 ? registryCrypto : cryptoAssets;
    const stock = registryStock.length > 0 ? registryStock : stockAssets;
    return [...crypto, ...stock];
  }, [registryCrypto, registryStock]);

  const selectedAssets = selectedAssetIds
    .map(id => assetPool.find(a => a.id === id))
    .filter(Boolean)
    .sort((a, b) => a!.symbol.localeCompare(b!.symbol));

  const totalAllocation = selectedAssetIds.reduce((sum, id) => sum + (allocations[id] || 0), 0);
  const isValid = totalAllocation === 100 && selectedAssetIds.length > 0;

  const steps = [
    { key: 'basic', label: 'Bag Info', disabled: false },
    { key: 'assets', label: 'Select Assets', disabled: !bagName },
    { key: 'allocation', label: 'Allocate', disabled: selectedAssetIds.length === 0 },
    { key: 'review', label: 'Review', disabled: !isValid },
  ] as const;

  const equalize = (ids: string[]) => {
    if (ids.length === 0) return {};
    const equal = Math.floor(100 / ids.length);
    const remainder = 100 % ids.length;
    const next: Record<string, number> = {};
    ids.forEach((id, i) => (next[id] = equal + (i === 0 ? remainder : 0)));
    return next;
  };

  const handleSelectAsset = (assetId: string) => {
    if (selectedAssetIds.includes(assetId)) return;
    const newIds = [...selectedAssetIds, assetId];
    setSelectedAssetIds(newIds);
    setAllocations(equalize(newIds));
  };

  const handleDeselectAsset = (assetId: string) => {
    const newIds = selectedAssetIds.filter(id => id !== assetId);
    setSelectedAssetIds(newIds);
    setAllocations(equalize(newIds));
  };

  const handleAllocationChange = (assetId: string, value: number) => {
    setAllocations(prev => rebalance(selectedAssetIds, prev, assetId, value));
  };

  const handleAutoBalance = () => setAllocations(equalize(selectedAssetIds));

  const toggleNetwork = (networkId: string) => {
    setSelectedNetworkIds((prev) =>
      prev.includes(networkId)
        ? prev.length > 1
          ? prev.filter((id) => id !== networkId) // keep at least one network selected
          : prev
        : [...prev, networkId]
    );
  };

  const buildLocalFallbackBag = (): Bag => {
    const composition = selectedAssets.map((asset) => ({
      symbol: asset!.symbol,
      weight: allocations[asset!.id] || 0,
    }));

    return {
      id: `user-${Date.now()}`,
      name: bagName,
      creator: {
        name: 'You',
        avatar: '👤',
        address: selfAddress,
        followers: 0,
        forks: 0,
      },
      description: description || `A custom bag with ${selectedAssets.length} assets.`,
      thesis: thesis || 'No thesis provided yet.',
      tvl: investmentAmount,
      followers: 0,
      forks: 0,
      performance7d: 0,
      performance30d: 0,
      performanceYtd: 0,
      chains: NETWORKS.filter((n) => selectedNetworkIds.includes(n.id)).map((n) => n.label),
      // Phase 11 — the only strategy type that exists; not user-selectable
      // (see the read-only "Strategy" row in the review step below), so
      // there's nothing to derive this from besides the constant.
      strategyType: 'STATIC_BASKET',
      composition,
      rules: {
        rebalanceFrequency: 'Monthly',
        slippage: 2,
        minInvestment: investmentAmount,
      },
      social: { followers: 0, forks: 0 },
      performance: { returnsYTD: 0 },
      updateLog: [
        {
          date: new Date().toISOString().slice(0, 10),
          change: 'Bag created',
          reason: thesis || 'Initial creation',
        },
      ],
    };
  };

  // Backend (POST /api/bags) is now source of truth for newly-created bags.
  // localStorage/addBag() is only a fallback — used when the caller isn't
  // signed in yet, Supabase isn't configured, or the request fails — so a
  // demo/offline user never loses the bag they just built.
  const handlePublish = async () => {
    if (!isValid) return;
    setIsPublishing(true);
    setPublishError(null);

    const composition = selectedAssets.map((asset) => ({
      symbol: asset!.symbol,
      weight: allocations[asset!.id] || 0,
    }));

    try {
      const res = await fetch('/api/bags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: bagName,
          description,
          thesis,
          chain: selectedNetworkIds[0],
          composition,
          minInvestment: investmentAmount,
          rebalanceFrequency: 'Monthly',
          performanceFeeBps,
        }),
      });

      // A real, structured validation failure from the domain layer
      // (validateBasketRecipe via createBag) — e.g. an unsupported asset,
      // weights that don't sum to 100%, or a duplicate. This is
      // authoritative and must NOT be papered over with a local fallback
      // bag: doing so would show the creator a "published!" success state
      // for a bag that was, in fact, rejected.
      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as
          | { error: string; issues?: { message: string; severity: 'ERROR' | 'WARNING' }[] }
          | null;
        const messages = (body?.issues ?? [])
          .filter((i) => i.severity === 'ERROR')
          .map((i) => i.message);
        setPublishError(messages.length > 0 ? messages : [body?.error ?? 'Recipe validation failed.']);
        setIsPublishing(false);
        return;
      }

      if (!res.ok) throw new Error(`bags API responded ${res.status}`);
      const { bag } = (await res.json()) as { bag: Bag };

      addActivity(`Published new bag: ${bag.name}`);
      addNotification(
        `You published a new Bag`,
        `"${bag.name}" is live on ${bag.chains.join(', ')} — your followers have been notified.`
      );
      router.push('/dashboard');
    } catch {
      // Genuine infra failure (offline, Supabase not configured, request
      // threw) rather than a rejected recipe — safe to fall back to a
      // local/offline-only bag, but say so explicitly rather than implying
      // it was published the same way a real one would be.
      const fallback = buildLocalFallbackBag();
      addBag(fallback);
      addActivity(`Saved bag locally (offline): ${bagName}`);
      addNotification(
        `Bag saved locally`,
        `"${bagName}" was saved to this device only — we couldn't reach the server to publish it yet.`
      );
      router.push('/dashboard');
    }
  };

  return (
    <main className="wrap" style={{ paddingBottom: 80 }}>
      <div className="create-header">
        <Link href="/dashboard" className="create-back">← Back to Dashboard</Link>
        <h1>Create a Bag</h1>
        <p className="lead">Build your custom investment portfolio</p>
      </div>

      <div className="step-nav">
        {steps.map((step) => (
          <button
            key={step.key}
            className={`step-btn ${currentStep === step.key ? 'active' : ''}`}
            disabled={step.disabled}
            onClick={() => !step.disabled && setCurrentStep(step.key)}
          >
            {step.label}
          </button>
        ))}
      </div>

      <div className="create-grid">
        <div>
          {currentStep === 'basic' && (
            <div className="create-card">
              <div className="field">
                <label>Bag Name *</label>
                <input
                  type="text"
                  placeholder="e.g., AI Leaders, L2 Ecosystem, etc."
                  value={bagName}
                  onChange={(e) => setBagName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Description</label>
                <textarea
                  placeholder="What does this bag contain? What's the theme?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="field">
                <label>Thesis (Why This Bag?)</label>
                <textarea
                  placeholder="Explain your investment thesis and reasoning..."
                  value={thesis}
                  onChange={(e) => setThesis(e.target.value)}
                  rows={4}
                />
              </div>
              <div className="field">
                <label>Deploy On</label>
                <NetworkSelector selected={selectedNetworkIds} onToggle={toggleNetwork} />
              </div>
              <div className="create-actions">
                <button className="btn btn-primary" disabled={!bagName} onClick={() => setCurrentStep('assets')}>
                  Next: Select Assets <ArrowRight size={17} />
                </button>
              </div>
            </div>
          )}

          {currentStep === 'assets' && (
            <div className="create-card">
              <AssetSelector
                assets={assetPool}
                selectedIds={selectedAssetIds}
                onSelect={handleSelectAsset}
                onDeselect={handleDeselectAsset}
                loadingRegistryAssets={registryAssetsLoading}
              />
              <div className="create-actions">
                <button className="btn btn-ghost back" onClick={() => setCurrentStep('basic')}>Back</button>
                <button className="btn btn-primary" disabled={selectedAssetIds.length === 0} onClick={() => setCurrentStep('allocation')}>
                  Next: Allocate <ArrowRight size={17} />
                </button>
              </div>
            </div>
          )}

          {currentStep === 'allocation' && (
            <div className="create-card">
              <div className="invest-box">
                <span className="lbl">How much do you want to invest?</span>
                <div className="invest-input-row">
                  <span className="dollar">$</span>
                  <input
                    type="number"
                    min={0}
                    value={investmentAmount}
                    onChange={(e) => setInvestmentAmount(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
                <div className="invest-presets">
                  {INVEST_PRESETS.map((amt) => (
                    <button
                      key={amt}
                      className={`invest-preset ${investmentAmount === amt ? 'active' : ''}`}
                      onClick={() => setInvestmentAmount(amt)}
                    >
                      {formatUSD(amt)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="invest-box" style={{ marginTop: 18 }}>
                <span className="lbl">Creator performance fee (optional)</span>
                <div className="nm" style={{ marginTop: 4, marginBottom: 12, lineHeight: 1.5 }}>
                  Charged only on REALIZED profit when an investor redeems — never on their principal,
                  and never if their position is at a loss. 0% is a fully valid choice.
                </div>
                <div className="alloc-slider-row">
                  <input
                    type="range"
                    min={0}
                    max={MAX_PERFORMANCE_FEE_BPS / 100}
                    step={0.5}
                    value={performanceFeeBps / 100}
                    onChange={(e) => setPerformanceFeeBps(Math.round(parseFloat(e.target.value || '0') * 100))}
                    className="alloc-slider"
                  />
                  <input
                    type="number"
                    min={0}
                    max={MAX_PERFORMANCE_FEE_BPS / 100}
                    step={0.5}
                    value={performanceFeeBps / 100}
                    onChange={(e) =>
                      setPerformanceFeeBps(
                        Math.max(0, Math.min(MAX_PERFORMANCE_FEE_BPS, Math.round(parseFloat(e.target.value || '0') * 100)))
                      )
                    }
                    className="alloc-num"
                  />
                  <span className="nm" style={{ marginLeft: -4 }}>%</span>
                </div>
              </div>

              <AllocationEditor
                assetPool={assetPool}
                assetIds={selectedAssetIds}
                allocations={allocations}
                investmentAmount={investmentAmount}
                onAllocationChange={handleAllocationChange}
                onAutoBalance={handleAutoBalance}
              />

              <div className="create-actions">
                <button className="btn btn-ghost back" onClick={() => setCurrentStep('assets')}>Back</button>
                <button className="btn btn-primary" disabled={!isValid} onClick={() => setCurrentStep('review')}>
                  Review <ArrowRight size={17} />
                </button>
              </div>
            </div>
          )}

          {currentStep === 'review' && (
            <div className="create-card">
              <span className="section-label">Bag Details</span>
              <div className="alloc-row" style={{ marginBottom: 22 }}>
                <div className="nm" style={{ marginBottom: 4 }}>NAME</div>
                <div style={{ color: 'var(--ink)', fontWeight: 600, marginBottom: description || thesis ? 12 : 0 }}>{bagName}</div>
                {description && (
                  <>
                    <div className="nm" style={{ marginBottom: 4 }}>DESCRIPTION</div>
                    <div style={{ color: 'var(--ink-soft)', fontSize: 13.5, marginBottom: thesis ? 12 : 0 }}>{description}</div>
                  </>
                )}
                {thesis && (
                  <>
                    <div className="nm" style={{ marginBottom: 4 }}>THESIS</div>
                    <div style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>{thesis}</div>
                  </>
                )}
              </div>

              <span className="section-label">Strategy</span>
              <div style={{ marginBottom: 22 }}>
                <span className="bag-chain-tag">Static Basket</span>
              </div>

              <span className="section-label">Creator Fee</span>
              <div style={{ marginBottom: 22 }}>
                <span className="bag-chain-tag">
                  {performanceFeeBps > 0 ? `${(performanceFeeBps / 100).toFixed(1)}% of realized profit` : 'No performance fee'}
                </span>
              </div>

              <span className="section-label">Networks</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
                {NETWORKS.filter((n) => selectedNetworkIds.includes(n.id)).map((n) => (
                  <span key={n.id} className="bag-chain-tag">
                    {n.glyph} {n.label}
                  </span>
                ))}
              </div>

              <span className="section-label">Composition</span>
              <div className="review-list">
                {selectedAssets.map((asset) => {
                  const pct = allocations[asset!.id] || 0;
                  return (
                    <div key={asset!.id} className="review-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="asset-icon">{asset!.icon}</div>
                        <div className="asset-meta">
                          <div className="sym">{asset!.symbol}</div>
                          <div className="nm">{formatUSD((pct / 100) * investmentAmount)}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="review-bar-wrap">
                          <div className="review-bar" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="alloc-pct">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {publishError && (
                <div className="publish-error" role="alert" style={{
                  marginTop: 16,
                  marginBottom: 4,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(239,68,68,0.4)',
                  background: 'rgba(239,68,68,0.08)',
                  color: '#ef4444',
                  fontSize: 13.5,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Couldn&apos;t publish this bag</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {publishError.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="create-actions">
                <button className="btn btn-ghost back" onClick={() => setCurrentStep('allocation')}>Back</button>
                <button className="btn btn-primary" disabled={!isValid || isPublishing} onClick={handlePublish}>
                  {isPublishing ? <Check size={17} /> : <Save size={17} />}
                  {isPublishing ? 'Publishing…' : 'Publish Bag'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="summary-card">
          <span className="section-label">Bag Summary</span>
          <div className="summary-row"><span className="l">Name</span><span className="v">{bagName || '-'}</span></div>
          <div className="summary-row"><span className="l">Investment</span><span className="v">{formatUSD(investmentAmount)}</span></div>
          <div className="summary-row"><span className="l">Assets</span><span className="v">{selectedAssetIds.length}</span></div>
          <div className="summary-row"><span className="l">Networks</span><span className="v">{selectedNetworkIds.length}</span></div>
          <div className="summary-row">
            <span className="l">Allocation</span>
            <span className={`v ${totalAllocation === 100 ? 'ok' : 'bad'}`}>{totalAllocation}%</span>
          </div>
          <div className="summary-row"><span className="l">Crypto</span><span className="v">{selectedAssets.filter(a => a!.type === 'crypto').length}</span></div>
          <div className="summary-row"><span className="l">Stocks</span><span className="v">{selectedAssets.filter(a => a!.type === 'stock').length}</span></div>

          {currentStep === 'review' && (
            <div className="summary-ready">✓ Ready to publish your bag!</div>
          )}
        </div>
      </div>
    </main>
  );
}