'use client';

import { useState } from 'react';
import Link from 'next/link';
import { mockUser, mockBags } from '@/lib/mock-data';
import { useUserBags } from '@/lib/user-bags-store';
import { useActivity } from '@/lib/activity-store';
import { useCreatorFollows } from '@/lib/creator-follow-store';
import { useWallet, shortenAddress } from '@/lib/wallet-context';
import { useXConnection } from '@/lib/x-connect-store';
import { usePaperPortfolio } from '@/hooks/usePaperPortfolio';
import { useCreatorRewards } from '@/hooks/useCreatorRewards';
import { usePoints } from '@/hooks/usePoints';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { useBagNFTs } from '@/hooks/useBagNFTs';
import { formatCompact, formatAge } from '@/lib/format';
import { Reputation } from '@/components/creator/Reputation';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { formatRelativeTime } from '@/lib/activity-store';
import { ConnectXModal } from '@/components/creator/ConnectXModal';
import { NFTCard } from '@/components/nft/NFTCard';
import { BagCard } from '@/components/bags/BagCard';
import { Wallet, X as XIcon, Check, LayoutGrid, List as ListIcon } from 'lucide-react';

type BagFilter = 'all' | 'tvl' | 'performance' | 'forks' | 'newest';
type ViewMode = 'grid' | 'list';

const BAG_FILTERS: { id: BagFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'tvl', label: 'Top TVL' },
  { id: 'performance', label: 'Best Performance' },
  { id: 'forks', label: 'Most Forked' },
  { id: 'newest', label: 'Newest' },
];

export default function ProfilePage() {
  const { userBags, hydrated } = useUserBags();
  const { activity } = useActivity();
  const { following } = useCreatorFollows();
  const { isConnected, isConnecting, hasProvider, walletAddress, connect, disconnect } = useWallet();
  const { handle, isConnected: xConnected, connectHandle, disconnectHandle } = useXConnection();
  const { portfolio } = usePaperPortfolio();
  const { rewards, totalQuote, claimableDisplay, claimableTokenSymbol, isVaultConfigured, isClaiming, claimError, lastClaimTxHash, claim } =
    useCreatorRewards(walletAddress);
  const { points } = usePoints();
  const { result: leaderboard } = useLeaderboard();
  const { nfts } = useBagNFTs();
  const [showXModal, setShowXModal] = useState(false);
  const [bagFilter, setBagFilter] = useState<BagFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // "Your" bags = anything created locally, plus the demo bag pre-seeded for you.
  const myBags = hydrated ? userBags.filter((b) => b.creator.name === 'You') : [];

  const sortedBags = [...myBags].sort((a, b) => {
    switch (bagFilter) {
      case 'tvl':
        return b.tvl - a.tvl;
      case 'performance':
        return b.performanceYtd - a.performanceYtd;
      case 'forks':
        return b.forks - a.forks;
      case 'newest':
        return (b.updateLog?.[b.updateLog.length - 1]?.date ?? '').localeCompare(
          a.updateLog?.[a.updateLog.length - 1]?.date ?? ''
        );
      default:
        return 0;
    }
  });

  const totalTVL = myBags.reduce((sum, b) => sum + b.tvl, 0);
  const totalForksReceived = myBags.reduce((sum, b) => sum + b.forks, 0);
  const successfulBags = myBags.filter((b) => b.performanceYtd > 0).length;

  const stats = [
    { label: 'Total TVL', value: `$${formatCompact(totalTVL)}` },
    { label: 'Followers', value: formatCompact(mockUser.followers) },
    { label: 'Successful Bags', value: `${successfulBags}/${myBags.length || 0}` },
    { label: 'Forks', value: formatCompact(totalForksReceived + mockUser.forks) },
    { label: 'Age', value: formatAge(mockUser.joinedAt) },
  ];

  const gameStats = [
    {
      label: 'Realized PnL',
      value: `${(portfolio?.realizedPnL ?? 0) >= 0 ? '+' : ''}$${(portfolio?.realizedPnL ?? 0).toFixed(0)}`,
    },
    { label: 'BAG Points', value: `${points?.bagPoints ?? 0}` },
    { label: 'Genesis Rank', value: leaderboard?.self ? `#${leaderboard.self.rank}` : '—' },
    { label: 'BAG NFTs', value: `${nfts.length}` },
  ];

  const selfAddress = isConnected ? walletAddress : mockUser.address;
  const displayAddress = isConnected ? shortenAddress(walletAddress) : mockUser.address;

  return (
    <main className="wrap" style={{ paddingBottom: 80, paddingTop: 44 }}>
      <div className="profile-header">
        <div className="profile-avatar">👤</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="profile-name-row">
            <h2 style={{ margin: 0 }}>You</h2>
            {xConnected && (
              <span className="reason-chip" style={{ padding: '4px 10px' }}>
                <XIcon size={11} /> @{handle}
              </span>
            )}
          </div>
          <div className="profile-handle">
            {displayAddress} &middot; {mockUser.network}
            {!isConnected && <span style={{ color: 'var(--mute)' }}> (demo address — connect a real wallet below)</span>}
          </div>
          <div className="profile-follow-counts">
            <span><b>{following.length}</b> Following</span>
            <span><b>{formatCompact(mockUser.followers)}</b> Followers</span>
            <span><b>{myBags.length}</b> Bags Published</span>
          </div>
          <div style={{ marginTop: 10 }}>
            <Reputation score={mockUser.reputation} size="lg" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href={`/dashboard/creator/${encodeURIComponent(selfAddress)}`} className="btn btn-ghost">
            View public profile
          </Link>
          <Link href="/dashboard/create" className="btn btn-primary">
            Create a Bag
          </Link>
        </div>
      </div>

      {/* Connected accounts */}
      <div className="profile-section" style={{ marginTop: 0 }}>
        <h3>Connected Accounts</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isConnected ? (
            <button className="follow-btn following" onClick={disconnect}>
              <Check size={13} />
              {shortenAddress(walletAddress)} · Disconnect
            </button>
          ) : (
            <button className="follow-btn" onClick={connect} disabled={isConnecting}>
              <Wallet size={13} />
              {isConnecting ? 'Connecting…' : hasProvider ? 'Connect Wallet' : 'Install Wallet'}
            </button>
          )}

          {xConnected ? (
            <button className="follow-btn following" onClick={disconnectHandle}>
              <Check size={13} />@{handle} · Disconnect
            </button>
          ) : (
            <button className="follow-btn" onClick={() => setShowXModal(true)}>
              <XIcon size={13} />
              Connect X
            </button>
          )}
        </div>
      </div>

      <div className="account-stats-grid">
        {stats.map((s) => (
          <div className="account-stat" key={s.label}>
            <span className="sl">{s.label}</span>
            <span className="sv">{s.value}</span>
          </div>
        ))}
      </div>

      <div className="profile-section" style={{ marginTop: 24 }}>
        <h3>BAG Protocol Game</h3>
        <div className="account-stats-grid">
          {gameStats.map((s) => (
            <div className="account-stat" key={s.label}>
              <span className="sl">{s.label}</span>
              <span className="sv">{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {(rewards.length > 0 || Number(totalQuote) > 0) && (
        <div className="profile-section" style={{ marginTop: 24 }}>
          <h3>Creator Rewards</h3>
          <div className="account-stats-grid" style={{ marginBottom: rewards.length > 0 ? 14 : 0 }}>
            <div className="account-stat">
              <span className="sl">Total Earned</span>
              <span className="sv">${Number(totalQuote).toFixed(2)}</span>
            </div>
            <div className="account-stat">
              <span className="sl">Fork Royalties</span>
              <span className="sv">{rewards.filter((r) => r.type === 'FORK_ROYALTY').length}</span>
            </div>
            <div className="account-stat">
              <span className="sl">Performance Fees</span>
              <span className="sv">{rewards.filter((r) => r.type === 'PERFORMANCE_FEE').length}</span>
            </div>
          </div>
          <p style={{ color: 'var(--ink-soft)', fontSize: 12.5, marginBottom: rewards.length > 0 ? 14 : 0 }}>
            Credited to your paper trading balance (below) — a real, tracked ledger balance, not yet an on-chain
            payout.
          </p>
          {isVaultConfigured && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--surface-2, rgba(255,255,255,0.04))',
                marginBottom: rewards.length > 0 ? 14 : 0,
              }}
            >
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Claimable on-chain (Robinhood Chain)</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {claimableDisplay !== null ? `${claimableDisplay} ${claimableTokenSymbol}` : '—'}
                </div>
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={isClaiming || !claimableDisplay || Number(claimableDisplay) <= 0 || !isConnected}
                onClick={() => claim()}
              >
                {isClaiming ? 'Claiming…' : 'Claim'}
              </button>
            </div>
          )}
          {claimError && (
            <p style={{ color: 'var(--danger, #e5484d)', fontSize: 12.5, marginBottom: 8 }}>{claimError}</p>
          )}
          {lastClaimTxHash && (
            <p style={{ color: 'var(--ink-soft)', fontSize: 12, marginBottom: 8 }}>
              Claimed — tx {lastClaimTxHash.slice(0, 10)}…
            </p>
          )}
          {rewards.length > 0 && (
            <div className="activity-feed">
              {rewards.slice(0, 10).map((r) => (
                <div className="activity-row" key={r.id}>
                  <span className="activity-dot">{r.type === 'FORK_ROYALTY' ? '🌱' : '📈'}</span>
                  <div className="activity-text">
                    {r.type === 'FORK_ROYALTY' ? 'Fork royalty' : 'Performance fee'} — ${Number(r.amountQuote).toFixed(2)}
                  </div>
                  <div className="activity-time">{formatRelativeTime(new Date(r.createdAt).getTime())}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {nfts.length > 0 && (
        <div className="profile-section">
          <h3>BAG NFTs</h3>
          <div className="nft-grid">
            {nfts.map((nft) => (
              <NFTCard key={nft.id} nft={nft} />
            ))}
          </div>
        </div>
      )}

      <div className="profile-section" id="my-bags">
        <div className="bags-section-head">
          <h3 style={{ marginBottom: 0 }}>
            Created Bags{myBags.length > 0 ? ` (${myBags.length})` : ''}
          </h3>

          {myBags.length > 0 && (
            <div className="bags-controls">
              <div className="bags-filter-bar">
                {BAG_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    className={`filter-pill ${bagFilter === f.id ? 'active' : ''}`}
                    onClick={() => setBagFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="view-toggle">
                <button
                  className={viewMode === 'grid' ? 'active' : ''}
                  onClick={() => setViewMode('grid')}
                  aria-label="Grid view"
                  title="Grid view"
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  className={viewMode === 'list' ? 'active' : ''}
                  onClick={() => setViewMode('list')}
                  aria-label="List view"
                  title="List view"
                >
                  <ListIcon size={15} />
                </button>
              </div>
            </div>
          )}
        </div>

        {myBags.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>
            You haven&apos;t published a Bag yet.{' '}
            <Link href="/dashboard/create" style={{ color: 'var(--gold-lt)' }}>
              Create your first one →
            </Link>
          </p>
        ) : viewMode === 'grid' ? (
          <div className="bags-grid">
            {sortedBags.map((b) => (
              <BagCard key={b.id} bag={b} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sortedBags.map((b) => (
              <Link
                key={b.id}
                href={`/dashboard/bag/${b.id}`}
                className="alloc-row"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textDecoration: 'none' }}
              >
                <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{b.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--mute)' }}>
                    ${formatCompact(b.tvl)} TVL
                  </span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--mute)' }}>
                    {formatCompact(b.forks)} forks
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 12.5, color: b.performanceYtd >= 0 ? 'var(--emerald)' : '#E0847A' }}
                  >
                    {b.performanceYtd >= 0 ? '+' : ''}
                    {b.performanceYtd.toFixed(1)}% YTD
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="profile-section">
        <h3>Following</h3>
        {following.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>
            You&apos;re not following any creators yet — follow one from a Bag page to see updates here.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {mockBags
              .filter((b) => following.includes(b.creator.address))
              .map((b) => (
                <Link
                  key={b.creator.address}
                  href={`/dashboard/creator/${encodeURIComponent(b.creator.address)}`}
                  className="reason-chip creator-link"
                  style={{ textDecoration: 'none' }}
                >
                  {b.creator.avatar} {b.creator.name}
                </Link>
              ))}
          </div>
        )}
      </div>

      <div className="profile-section">
        <h3>Activity</h3>
        <ActivityFeed items={activity} emptyMessage="No activity yet." />
      </div>

      <div style={{ marginTop: 40 }}>
        <Link href="/dashboard" className="btn btn-ghost">
          ← Back to dashboard
        </Link>
      </div>

      {showXModal && (
        <ConnectXModal
          onConfirm={(h) => {
            connectHandle(h);
            setShowXModal(false);
          }}
          onClose={() => setShowXModal(false)}
        />
      )}
    </main>
  );
}
