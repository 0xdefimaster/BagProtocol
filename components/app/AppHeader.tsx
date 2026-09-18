'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Menu, Wallet, Loader2 } from 'lucide-react';
import { useWallet, shortenAddress } from '@/lib/wallet-context';
import { NotificationBell } from './NotificationBell';

export function AppHeader() {
  const { isConnected, isConnecting, hasProvider, walletAddress, chainName, error, connect, disconnect } =
    useWallet();

  return (
    <header>
      <div className="wrap nav">
        <Link href="/dashboard" className="brand">
          <Image src="/logo.png" alt="Bag Protocol mark" width={32} height={32} />
          <div className="brand-text">
            <span className="b1">BAG PROTOCOL</span>
            <span className="b2 mono">Studio</span>
          </div>
        </Link>

        <nav className="navlinks">
          <Link href="/dashboard/explore">Explore</Link>
          <Link href="/dashboard/leaderboard">Leaderboard</Link>
          <Link href="/dashboard/create">Create</Link>
          <Link href="/dashboard/portfolio">Portfolio</Link>
          <Link href="/dashboard/inventory">Inventory</Link>
          <Link href="/dashboard/profile">Profile</Link>
        </nav>

        <div className="flex items-center gap-3" style={{ position: 'relative' }}>
          <span className="chain-badge">
            <span className="dot" />
            {chainName ?? 'Robinhood Chain'}
          </span>

          <NotificationBell />

          {!isConnected ? (
            <button onClick={connect} disabled={isConnecting} className="btn btn-primary">
              {isConnecting ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
              {isConnecting ? 'Connecting…' : hasProvider ? 'Connect Wallet' : 'Install Wallet'}
            </button>
          ) : (
            <button onClick={disconnect} className="wallet-pill" title="Click to disconnect">
              <span className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--emerald)' }} />
              {shortenAddress(walletAddress)}
            </button>
          )}

          {error && (
            <div className="wallet-error-toast">
              {error}
              {!hasProvider && (
                <a href="https://metamask.io/download" target="_blank" rel="noreferrer">
                  {' '}
                  Get MetaMask →
                </a>
              )}
            </div>
          )}

          <button className="md:hidden p-2" aria-label="Menu">
            <Menu size={18} color="var(--ink)" />
          </button>
        </div>
      </div>
    </header>
  );
}
