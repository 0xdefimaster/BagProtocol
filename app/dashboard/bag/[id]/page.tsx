'use client';

import { mockBags, mockUserBags, mockUser } from '@/lib/mock-data';
import { useUserBags } from '@/lib/user-bags-store';
import { usePortfolio } from '@/lib/portfolio-store';
import { useActivity } from '@/lib/activity-store';
import { usePaperPortfolio } from '@/hooks/usePaperPortfolio';
import { useBag } from '@/hooks/useBag';
import { formatCompact } from '@/lib/format';
import { Bag } from '@/types';
import { useState } from 'react';
import {
  TrendingUp,
  ArrowDownLeft,
  Users,
  GitFork,
  Share2,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';
import { PurchasePreviewModal } from '@/components/app/PurchasePreviewModal';
import { RedeemPreviewModal } from '@/components/app/RedeemPreviewModal';
import { PerformanceTimeline } from '@/components/bags/PerformanceTimeline';
import { DiversificationScore } from '@/components/bags/DiversificationScore';
import { FollowButton } from '@/components/creator/FollowButton';
import { Reputation } from '@/components/creator/Reputation';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { PositionsTable } from '@/components/trading/PositionsTable';

interface BagDetailPageProps {
  params: { id: string };
}

// -----------------------------------------------------------------------------
// GET /api/bags/[id] is now the primary source. Mock/localStorage bags
// (demo fixtures + the old Create fallback path) are still resolved
// synchronously so their pages render instantly with no loading flash, but
// they're only ever used when the backend doesn't know about this id
// (never as an override of a real API response) — see the note on
// buildViewState below.
// -----------------------------------------------------------------------------

function buildViewState(
  id: string,
  localBag: Bag | undefined,
  api: ReturnType<typeof useBag>
): { bag: Bag | null; view: 'loading' | 'not_found' | 'error' } {
  if (api.bag) return { bag: api.bag, view: 'loading' }; // view unused when bag is set
  if (api.isNotFound || api.isError) {
    if (localBag) return { bag: localBag, view: 'loading' };
    return { bag: null, view: api.isNotFound ? 'not_found' : 'error' };
  }
  // still loading — render the local fixture instantly if we have one
  if (localBag) return { bag: localBag, view: 'loading' };
  return { bag: null, view: 'loading' };
}

export default function BagDetailPage({ params }: BagDetailPageProps) {
  const { id } = params;
  const { userBags, addBag } = useUserBags();
  const { following, toggleFollow } = usePortfolio();
  const { activity: allActivity, addActivity } = useActivity();
  const { portfolio: paperPortfolio, prices, sell: sellPaper } = usePaperPortfolio();
  const api = useBag(id);
  const localBag =
    userBags.find((b) => b.id === id) ?? mockUserBags.find((b) => b.id === id) ?? mockBags.find((b) => b.id === id);
  const { bag, view } = buildViewState(id, localBag, api);

  const [activeTab, setActiveTab] = useState('overview');
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showInvest, setShowInvest] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const [justForked, setJustForked] = useState(false);
  const isFollowing = bag ? following.includes(bag.id) : false;
  const bagActivity = bag ? allActivity.filter((item) => item.action.includes(bag.name)) : [];

  if (!bag) {
    if (view === 'not_found') {
      return (
        <main className="min-h-screen bg-black pb-20 flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <AlertTriangle className="w-10 h-10 text-white/40 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">Bag not found</h1>
            <p className="text-white/60 mb-6">
              This bag doesn&apos;t exist, was archived, or you don&apos;t have permission to view it.
            </p>
            <Link href="/dashboard/explore" className="text-emerald-400 hover:text-emerald-300 font-medium">
              ← Back to Explore
            </Link>
          </div>
        </main>
      );
    }
    if (view === 'error') {
      return (
        <main className="min-h-screen bg-black pb-20 flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">Couldn&apos;t load this bag</h1>
            <p className="text-white/60 mb-6">{api.error ?? 'Something went wrong. Please try again.'}</p>
            <button
              onClick={api.refresh}
              className="px-5 py-2.5 rounded-lg bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-all"
            >
              Retry
            </button>
          </div>
        </main>
      );
    }
    // loading — no local fixture and the API hasn't resolved yet
    return (
      <main className="min-h-screen bg-black pb-20 flex items-center justify-center">
        <p className="text-white/50">Loading bag…</p>
      </main>
    );
  }



  const tabs = ['Overview', 'Thesis', 'Composition', 'Rules', 'Performance', 'Activity', 'JSON'];

  const copyToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(bag, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleFollow = () => {
    const nowFollowing = toggleFollow(bag.id);
    addActivity(nowFollowing ? `Started following ${bag.name}` : `Unfollowed ${bag.name}`);
  };

  const handleFork = () => {
    if (justForked) return;
    const forked: Bag = {
      ...bag,
      id: `fork-${Date.now()}`,
      name: `${bag.name} (Fork)`,
      creator: { name: 'You', avatar: '👤', address: mockUser.address, followers: 0, forks: 0 },
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
    addBag(forked);
    addActivity(`Forked ${bag.name}`);
    setJustForked(true);
    setTimeout(() => setJustForked(false), 1800);
  };

  return (
    <>
    <main className="min-h-screen bg-black pb-20">
      {/* Hero Section */}
      <div className="bg-gradient-to-b from-emerald-500/10 to-transparent py-12 px-4">
        <div className="mx-auto max-w-7xl">
          <Link
            href="/dashboard/explore"
            className="text-sm text-white/60 hover:text-white transition-colors mb-8 inline-flex"
          >
            ← Back to Bags
          </Link>

          <div className="grid md:grid-cols-3 gap-8 mb-12">
            {/* Left Column - Bag Info */}
            <div className="md:col-span-2 space-y-6">
              <div>
                <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">
                  {bag.name}
                </h1>
                <p className="text-lg text-white/60">{bag.description}</p>
              </div>

              {/* Creator Info */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                <Link
                  href={`/dashboard/creator/${encodeURIComponent(bag.creator.address)}`}
                  className="flex items-center gap-4 flex-1 min-w-0 group"
                >
                  <span className="text-3xl">{bag.creator.avatar}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white group-hover:text-emerald-400 transition-colors">
                      {bag.creator.name}
                    </p>
                    <p className="text-sm text-white/60">{bag.creator.address}</p>
                    <div className="mt-1">
                      <Reputation score={bag.creator.creatorScore ?? 78} />
                    </div>
                  </div>
                </Link>
                <FollowButton creatorId={bag.creator.address} creatorName={bag.creator.name} />
              </div>
            </div>

            {/* Right Column - Stats */}
            <div className="space-y-3">
              <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                <p className="text-xs font-medium text-white/50 uppercase tracking-wider">TVL</p>
                <p className="text-2xl font-bold text-white mt-1">
                  ${formatCompact(bag.tvl)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                  <p className="text-xs font-medium text-white/50 uppercase tracking-wider">
                    Followers
                  </p>
                  <p className="text-xl font-bold text-white mt-1">
                    {formatCompact(bag.followers)}
                  </p>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                  <p className="text-xs font-medium text-white/50 uppercase tracking-wider">
                    Forks
                  </p>
                  <p className="text-xl font-bold text-white mt-1">{bag.forks}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <p className="text-xs font-medium text-white/50 uppercase tracking-wider">7D</p>
                  <p
                    className={`text-lg font-bold mt-1 ${
                      bag.performance7d >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {bag.performance7d > 0 ? '+' : ''}{bag.performance7d.toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <p className="text-xs font-medium text-white/50 uppercase tracking-wider">30D</p>
                  <p
                    className={`text-lg font-bold mt-1 ${
                      bag.performance30d >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {bag.performance30d > 0 ? '+' : ''}{bag.performance30d.toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <p className="text-xs font-medium text-white/50 uppercase tracking-wider">YTD</p>
                  <p
                    className={`text-lg font-bold mt-1 ${
                      bag.performanceYtd >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {bag.performanceYtd > 0 ? '+' : ''}{bag.performanceYtd.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-wrap gap-3 mb-12">
            <button
              onClick={() => setShowInvest(true)}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 text-black font-semibold transition-all hover:bg-emerald-400"
            >
              <TrendingUp className="w-5 h-5" />
              Invest Now
            </button>
            <button
              onClick={() => setShowRedeem(true)}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 text-white font-semibold border border-white/20 transition-all hover:bg-white/20"
              title="Sell your own holdings in this Bag back to an asset of your choice"
            >
              <ArrowDownLeft className="w-5 h-5" />
              Redeem
            </button>
            <button
              onClick={handleFork}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 text-white font-semibold border border-white/20 transition-all hover:bg-white/20"
            >
              {justForked ? <Check className="w-5 h-5" /> : <GitFork className="w-5 h-5" />}
              {justForked ? 'Forked!' : 'Fork Bag'}
            </button>
            <button
              onClick={handleFollow}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold border transition-all ${
                isFollowing
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30'
                  : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
              }`}
            >
              <Users className="w-5 h-5" />
              {isFollowing ? 'Following' : 'Follow'}
            </button>
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 text-white font-semibold border border-white/20 transition-all hover:bg-white/20"
            >
              {linkCopied ? <Check className="w-5 h-5" /> : <Share2 className="w-5 h-5" />}
              {linkCopied ? 'Link Copied!' : 'Share'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mx-auto max-w-7xl px-4">
        <div className="border-b border-white/10 mb-8">
          <div className="flex overflow-x-auto gap-8 -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab.toLowerCase())}
                className={`px-1 py-4 font-medium whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === tab.toLowerCase()
                    ? 'text-emerald-400 border-emerald-400'
                    : 'text-white/60 border-transparent hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="mb-12">
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-white mb-4">Thesis</h2>
                <p className="text-white/70 leading-relaxed">{bag.thesis}</p>
              </div>

              {bag.updateLog.length > 0 && (
                <div>
                  <h2 className="text-2xl font-bold text-white mb-4">Update Log</h2>
                  <div className="space-y-3">
                    {bag.updateLog.map((log, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-xl border border-white/10 bg-white/5"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <p className="font-semibold text-white">{log.change}</p>
                          <p className="text-xs text-white/60">{log.date}</p>
                        </div>
                        <p className="text-sm text-white/60">{log.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'thesis' && (
            <div>
              <p className="text-white/70 leading-relaxed text-lg">{bag.thesis}</p>
            </div>
          )}

          {activeTab === 'composition' && (
            <div className="space-y-6">
              <DiversificationScore composition={bag.composition} />

              {paperPortfolio && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-6">
                  <h3 className="text-lg font-bold text-white mb-4">Your Paper Positions in this Bag</h3>
                  <div style={{ margin: '-8px' }}>
                    <PositionsTable
                      positions={paperPortfolio.positions.filter((p) =>
                        bag.composition.some((c) => c.symbol === p.symbol)
                      )}
                      prices={prices}
                      onSell={async (symbol) => {
                        const qty = paperPortfolio.positions.find((p) => p.symbol === symbol)?.quantity ?? 0;
                        const result = await sellPaper(symbol, qty);
                        if (result.ok) {
                          const pointsNote = result.pointsAwarded ? ` +${result.pointsAwarded} BAG Points earned.` : '';
                          addActivity(`Sold ${symbol} position from ${bag.name}.${pointsNote}`);
                        }
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <h3 className="text-lg font-bold text-white mb-4">Allocation</h3>
                  <div className="space-y-3">
                    {bag.composition.map((pos) => (
                      <div key={pos.symbol}>
                        <div className="flex justify-between mb-2">
                          <span className="font-medium text-white">{pos.symbol}</span>
                          <span className="text-emerald-400 font-semibold">{pos.weight}%</span>
                        </div>
                        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                            style={{ width: `${pos.weight}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-6">
                  <h3 className="text-lg font-bold text-white mb-4">Breakdown</h3>
                  <div className="space-y-2">
                    {bag.composition.map((pos) => (
                      <div
                        key={pos.symbol}
                        className="flex justify-between text-white/70 py-2 border-b border-white/10 last:border-0"
                      >
                        <span>{pos.symbol}</span>
                        <span className="font-medium">{pos.weight}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="grid md:grid-cols-3 gap-6">
              <div className="rounded-xl border border-white/10 bg-white/5 p-6">
                <p className="text-sm font-medium text-white/50 uppercase tracking-wider">
                  Rebalance
                </p>
                <p className="text-2xl font-bold text-white mt-2">{bag.rules.rebalanceFrequency}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-6">
                <p className="text-sm font-medium text-white/50 uppercase tracking-wider">
                  Slippage
                </p>
                <p className="text-2xl font-bold text-white mt-2">{bag.rules.slippage}%</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-6">
                <p className="text-sm font-medium text-white/50 uppercase tracking-wider">
                  Min Investment
                </p>
                <p className="text-2xl font-bold text-white mt-2">
                  ${bag.rules.minInvestment}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'performance' && <PerformanceTimeline bag={bag} />}

          {activeTab === 'activity' && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <ActivityFeed
                items={bagActivity}
                emptyMessage="No activity yet for this bag — invest, fork, or follow it to see it here."
              />
            </div>
          )}

          {activeTab === 'json' && (
            <div className="space-y-4">
              <button
                onClick={copyToClipboard}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30 transition-all hover:bg-emerald-500/30"
              >
                <Copy className="w-4 h-4" />
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
              <pre className="bg-black border border-white/10 rounded-xl p-6 overflow-auto max-h-96 text-xs text-white/70 font-mono">
                {JSON.stringify(bag, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Supported Chains */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-6">
          <h3 className="text-lg font-bold text-white mb-4">Supported Chains</h3>
          <div className="flex flex-wrap gap-3">
            {bag.chains.map((chain) => (
              <span
                key={chain}
                className="px-4 py-2 rounded-lg bg-white/10 text-white border border-white/20 font-medium"
              >
                {chain}
              </span>
            ))}
          </div>
        </div>
      </div>
    </main>

    {showInvest && (
      <PurchasePreviewModal bagId={bag.id} bagName={bag.name} onClose={() => setShowInvest(false)} />
    )}
    {showRedeem && (
      <RedeemPreviewModal bagId={bag.id} bagName={bag.name} onClose={() => setShowRedeem(false)} />
    )}
    </>
  );
}
