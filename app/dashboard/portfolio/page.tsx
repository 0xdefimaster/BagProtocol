'use client';

import { usePaperPortfolio } from '@/hooks/usePaperPortfolio';
import { PositionsTable } from '@/components/trading/PositionsTable';
import { TradePanel } from '@/components/trading/TradePanel';
import { TRADABLE_ASSETS } from '@/lib/config/market';
import { useWallet } from '@/lib/wallet-context';

export default function PortfolioPage() {
  const {
    portfolio,
    trades,
    prices,
    positionsValue,
    unrealizedPnL,
    totalValue,
    buy,
    sell,
    source,
    isAuthenticated,
    isLoading,
  } = usePaperPortfolio();
  const { isConnected, isConnecting, isSigningIn, authError, connect, signIn } = useWallet();

  const ownedQuantity = (symbol: string) =>
    portfolio?.positions.find((p) => p.symbol === symbol)?.quantity ?? 0;

  if (!isAuthenticated) {
    return (
      <main className="wrap" style={{ paddingBottom: 80, paddingTop: 44 }}>
        <div className="app-intro">
          <span className="eyebrow">
            <span className="dot" />
            Paper Trading · Demo
          </span>
          <h1 style={{ marginTop: 16 }}>Portfolio</h1>
          <p className="lead">
            Trades and BAG Points are tied to your wallet now, not this browser — connect and sign in once so your
            portfolio follows you to any device.
          </p>
        </div>
        <div className="create-card" style={{ marginTop: 32, maxWidth: 480 }}>
          <button
            className="btn btn-primary"
            onClick={isConnected ? signIn : connect}
            disabled={isConnecting || isSigningIn}
          >
            {isConnecting
              ? 'Connecting…'
              : isSigningIn
                ? 'Confirm the signature in your wallet…'
                : isConnected
                  ? 'Sign in with wallet'
                  : 'Connect wallet'}
          </button>
          {authError && (
            <p style={{ color: '#E0847A', fontSize: 13, marginTop: 12 }}>{authError}</p>
          )}
          <p style={{ color: 'var(--ink-soft)', fontSize: 12.5, marginTop: 12 }}>
            Signing in is free — it&apos;s a message signature, not a transaction, and never costs gas.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap" style={{ paddingBottom: 80, paddingTop: 44 }}>
      <div className="app-intro">
        <span className="eyebrow">
          <span className="dot" />
          Paper Trading · Demo
          <span
            className="mono"
            style={{ marginLeft: 10, fontSize: 10, color: source === 'live' ? 'var(--emerald)' : 'var(--mute)' }}
          >
            {source === 'live' ? '● LIVE MARKET DATA' : '● SIMULATED DATA'}
          </span>
        </span>
        <h1 style={{ marginTop: 16 }}>Portfolio</h1>
        <p className="lead">
          $10,000 in demo funds. Every $10 of realized profit earns you 1 BAG Point.
          {source === 'live'
            ? ' Prices are live from the market.'
            : ' Live prices unavailable right now — using simulated market movement.'}
          {isLoading && ' Syncing…'}
        </p>
      </div>

      <div className="portfolio-summary" style={{ marginTop: 32 }}>
        <div className="dash-stat">
          <span className="l">Total Value</span>
          <div className="v">${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="dash-stat">
          <span className="l">Cash Balance</span>
          <div className="v">${(portfolio?.cashBalance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="dash-stat">
          <span className="l">Realized PnL</span>
          <div className="v" style={{ color: (portfolio?.realizedPnL ?? 0) >= 0 ? 'var(--emerald)' : '#E0847A' }}>
            {(portfolio?.realizedPnL ?? 0) >= 0 ? '+' : ''}${(portfolio?.realizedPnL ?? 0).toFixed(2)}
          </div>
        </div>
        <div className="dash-stat">
          <span className="l">Unrealized PnL</span>
          <div className="v" style={{ color: unrealizedPnL >= 0 ? 'var(--emerald)' : '#E0847A' }}>
            {unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL.toFixed(2)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 40 }}>
        <span className="section-label">Open Positions ({positionsValue.toFixed(0)} USD)</span>
        <div className="leaderboard-card">
          <PositionsTable
            positions={portfolio?.positions ?? []}
            prices={prices}
            onSell={(symbol) => sell(symbol, ownedQuantity(symbol))}
          />
        </div>
      </div>

      <div style={{ marginTop: 40 }}>
        <span className="section-label">Trade</span>
        <div className="create-card">
          <TradePanel
            assets={TRADABLE_ASSETS}
            prices={prices}
            ownedQuantity={ownedQuantity}
            onTrade={(symbol, side, quantity) => (side === 'BUY' ? buy(symbol, quantity) : sell(symbol, quantity))}
          />
        </div>
      </div>

      <div style={{ marginTop: 40 }}>
        <span className="section-label">Trade History</span>
        {trades.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>No trades yet.</p>
        ) : (
          <div className="leaderboard-card">
            <table className="positions-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Side</th>
                  <th>Asset</th>
                  <th>Quantity</th>
                  <th>Price</th>
                  <th>Realized PnL</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(0, 25).map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{new Date(t.createdAt).toLocaleString()}</td>
                    <td style={{ color: t.side === 'BUY' ? 'var(--emerald)' : '#E0847A', fontWeight: 600 }}>{t.side}</td>
                    <td>{t.symbol}</td>
                    <td className="mono">{t.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td className="mono">${t.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="mono" style={{ color: t.realizedPnL > 0 ? 'var(--emerald)' : t.realizedPnL < 0 ? '#E0847A' : 'var(--mute)' }}>
                      {t.realizedPnL !== 0 ? `${t.realizedPnL > 0 ? '+' : ''}$${t.realizedPnL.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
