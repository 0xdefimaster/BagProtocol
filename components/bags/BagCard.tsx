'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bag } from '@/types';
import { formatCompact } from '@/lib/format';
import { useUserBags } from '@/lib/user-bags-store';
import { useActivity } from '@/lib/activity-store';
import { useWallet } from '@/lib/wallet-context';
import { PurchasePreviewModal } from '@/components/app/PurchasePreviewModal';
import { getCategoryBreakdown, getDiversificationScore, categoryForSymbol, CATEGORY_COLORS } from '@/lib/categorize';
import { Check, Users, GitFork, TrendingUp, TrendingDown } from 'lucide-react';
import { mockUser } from '@/lib/mock-data';

interface BagCardProps {
  bag: Bag;
  isNew?: boolean;
}

function initials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function riskLabel(score: number) {
  if (score >= 70) return 'Diversified';
  if (score >= 40) return 'Balanced';
  return 'Concentrated';
}

export function BagCard({ bag, isNew }: BagCardProps) {
  const isPositive = bag.performance7d >= 0;
  const topComposition = bag.composition.slice(0, 4);
  const restCount = bag.composition.length - topComposition.length;

  const breakdown = getCategoryBreakdown(bag.composition);
  const diversification = getDiversificationScore(bag.composition);
  const dominantCategory = breakdown[0]?.category ?? 'Crypto';
  const accent = CATEGORY_COLORS[dominantCategory];

  const { addBag } = useUserBags();
  const { addActivity } = useActivity();
  const { walletAddress, isConnected } = useWallet();
  const router = useRouter();
  const selfAddress = isConnected ? walletAddress : mockUser.address;

  const [showInvest, setShowInvest] = useState(false);
  const [justForked, setJustForked] = useState(false);
  const [isForking, setIsForking] = useState(false);

  const handleCreatorClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/dashboard/creator/${encodeURIComponent(bag.creator.address)}`);
  };

  /** Local-only placeholder bag — same shape the old (pre-backend) mock used. Only ever shown when the real fork request genuinely fails (offline, not signed in, Supabase not configured), same fallback convention app/dashboard/create/page.tsx's handlePublish() uses: never silently substituted for a rejected request, only for an infra failure. */
  function buildLocalFallbackFork(): Bag {
    return {
      ...bag,
      id: `fork-${Date.now()}`,
      name: `${bag.name} (Fork)`,
      creator: { name: 'You', avatar: '👤', address: selfAddress, followers: 0, forks: 0 },
      followers: 0,
      forks: 0,
      tvl: 0,
      performance7d: 0,
      performance30d: 0,
      performanceYtd: 0,
      social: { followers: 0, forks: 0 },
      performance: { returnsYTD: 0 },
      updateLog: [
        {
          date: new Date().toISOString().slice(0, 10),
          change: 'Forked bag',
          reason: `Forked from ${bag.creator.name}'s "${bag.name}"`,
        },
      ],
    };
  }

  const handleFork = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (justForked || isForking) return;

    setIsForking(true);
    try {
      // Real backend fork (app/api/bags/[id]/fork/route.ts) — copies the
      // source Bag's CURRENT recipe into a brand-new Bag owned by the
      // caller, with parent_bag_id/root_bag_id set for real lineage. This
      // is the same `Bag` shape `useUserBags().addBag()` already expects
      // (see lib/mappers/bag-mapper.ts's mapBagRecordToApiResponse), so no
      // separate reconciliation is needed once it succeeds.
      const res = await fetch(`/api/bags/${bag.id}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });

      if (!res.ok) throw new Error(`fork API responded ${res.status}`);
      const { bag: forkedBag } = (await res.json()) as { bag: Bag };

      addBag(forkedBag);
      addActivity(`Forked ${bag.name}`);
    } catch {
      // Genuine infra failure (offline, not signed in, Supabase not
      // configured, request threw) — fall back to a local/offline-only
      // fork rather than losing the action entirely, same as
      // handlePublish()'s fallback in app/dashboard/create/page.tsx.
      addBag(buildLocalFallbackFork());
      addActivity(`Forked ${bag.name} (saved locally — offline)`);
    } finally {
      setIsForking(false);
      setJustForked(true);
      setTimeout(() => setJustForked(false), 1800);
    }
  };

  return (
    <>
    <Link
      href={`/dashboard/bag/${bag.id}`}
      className={`bag-card bag-card-pro ${isNew ? 'bag-card-new' : ''}`}
      style={{ ['--accent' as string]: accent }}
    >
      <div className="bag-card-accent" />

      <div className="bag-card-head">
        <div className="bag-card-id">
          <span className="bag-avatar-ring">
            <span className="bag-avatar creator-link" onClick={handleCreatorClick}>
              {initials(bag.creator.name)}
            </span>
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="bag-card-title">{bag.name}</div>
            <div className="bag-card-sub">
              by <span className="creator-link" onClick={handleCreatorClick}>{bag.creator.name}</span>
            </div>
          </div>
        </div>
        {isNew && <span className="bag-new-badge">Just Published</span>}
      </div>

      <div className="bag-card-tags">
        <span className="bag-category-chip">
          <span className="dot" style={{ background: accent }} />
          {dominantCategory}
        </span>
        <span className="bag-risk-chip">{riskLabel(diversification)} risk</span>
        {/* Phase 11 — only strategy type today; falls back for pre-Phase-11 Bags. */}
        <span className="bag-risk-chip">{bag.strategyType === 'STATIC_BASKET' || !bag.strategyType ? 'Static Basket' : bag.strategyType}</span>
      </div>

      <div className="bag-hero">
        <div>
          <span className="l">TVL</span>
          <div className="bag-hero-value">${formatCompact(bag.tvl)}</div>
        </div>
        <div className={`bag-trend-badge ${isPositive ? 'pos' : 'neg'}`}>
          {isPositive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {isPositive ? '+' : ''}
          {bag.performance7d.toFixed(1)}% <span className="bag-trend-period">7D</span>
        </div>
      </div>

      <div className="bag-stats bag-stats-secondary">
        <div>
          <span className="l">30D</span>
          <div className={`v ${bag.performance30d >= 0 ? 'pos' : 'neg'}`}>
            {bag.performance30d >= 0 ? '+' : ''}
            {bag.performance30d.toFixed(1)}%
          </div>
        </div>
        <div>
          <span className="l">YTD</span>
          <div className={`v ${bag.performanceYtd >= 0 ? 'pos' : 'neg'}`}>
            {bag.performanceYtd >= 0 ? '+' : ''}
            {bag.performanceYtd.toFixed(1)}%
          </div>
        </div>
        <div>
          <span className="l">Diversification</span>
          <div className="v">{diversification}/100</div>
        </div>
      </div>

      <div className="bag-comp">
        <div className="bag-comp-bar">
          {topComposition.map((pos) => (
            <span
              key={pos.symbol}
              title={`${pos.symbol} · ${pos.weight}%`}
              style={{ width: `${pos.weight}%`, background: CATEGORY_COLORS[categoryForSymbol(pos.symbol)] }}
            />
          ))}
        </div>
        <div className="bag-comp-legend">
          {topComposition.map((pos) => (
            <span key={pos.symbol}>
              <span className="bag-comp-dot" style={{ background: CATEGORY_COLORS[categoryForSymbol(pos.symbol)] }} />
              {pos.symbol} <b>{pos.weight}%</b>
            </span>
          ))}
          {restCount > 0 && <span className="bag-comp-more">+{restCount}</span>}
        </div>
      </div>

      <div className="bag-card-footer">
        <div className="bag-footer-stats">
          <span>
            <Users size={12} /> {formatCompact(bag.followers)} holders
          </span>
          <span>
            <GitFork size={12} /> {formatCompact(bag.forks)} forks
          </span>
        </div>
        <div className="bag-chains">
          {bag.chains.map((chain) => (
            <span key={chain} className="bag-chain-tag">
              {chain}
            </span>
          ))}
        </div>
      </div>

      <div className="bag-actions">
        <button onClick={handleFork} className="btn btn-ghost" disabled={isForking}>
          {justForked ? <Check size={15} /> : null}
          {justForked ? 'Forked!' : isForking ? 'Forking…' : 'Fork'}
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowInvest(true);
          }}
          className="btn btn-primary"
        >
          Invest
        </button>
      </div>
    </Link>
    {showInvest && (
      <PurchasePreviewModal bagId={bag.id} bagName={bag.name} onClose={() => setShowInvest(false)} />
    )}
    </>
  );
}

