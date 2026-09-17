import { Asset, filterAssetsByQuery, formatPrice } from '@/lib/create-assets-data';
import { Search, X } from 'lucide-react';
import { useState } from 'react';

interface AssetSelectorProps {
  /** The full selectable pool (static demo assets + any registry-backed ones the caller has loaded) — see `app/dashboard/create/page.tsx`. */
  assets: Asset[];
  selectedIds: string[];
  onSelect: (assetId: string) => void;
  onDeselect: (assetId: string) => void;
  /** True while the caller's registry fetch is still in flight — shows a subtle inline note, never blocks the static assets from being selectable in the meantime. */
  loadingRegistryAssets?: boolean;
}

export function AssetSelector({ assets, selectedIds, onSelect, onDeselect, loadingRegistryAssets }: AssetSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'crypto' | 'stock'>('all');

  const results = searchQuery ? filterAssetsByQuery(assets, searchQuery) : assets;
  const filtered = filterType === 'all' ? results : results.filter(a => a.type === filterType);

  const selectedSet = new Set(selectedIds);
  const selectedAssets = assets.filter(a => selectedSet.has(a.id));
  const availableAssets = filtered.filter(a => !selectedSet.has(a.id));

  return (
    <div>
      <div className="search-input-wrap">
        <Search size={17} />
        <input
          type="text"
          className="search-input"
          placeholder="Search by symbol or name (BTC, Ethereum, etc)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <div className="chip-row">
        {(['all', 'crypto', 'stock'] as const).map((type) => (
          <button
            key={type}
            className={`chip ${filterType === type ? 'active' : ''}`}
            onClick={() => setFilterType(type)}
          >
            {type === 'all' ? 'All Assets' : type === 'crypto' ? 'Crypto' : 'Stocks'}
          </button>
        ))}
      </div>

      {loadingRegistryAssets && (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--mute)' }}>Loading live stock tokens…</div>
      )}

      {selectedAssets.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <span className="section-label">Selected ({selectedAssets.length})</span>
          <div className="asset-grid selected">
            {selectedAssets.map((asset) => (
              <div key={asset.id} className="asset-pick picked">
                <div className="asset-icon">{asset.icon}</div>
                <div className="asset-meta">
                  <div className="sym">{asset.symbol}</div>
                  <div className="nm">{asset.name}</div>
                </div>
                <button className="asset-remove" onClick={() => onDeselect(asset.id)} aria-label={`Remove ${asset.symbol}`}>
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 26 }}>
        <span className="section-label">
          Available Assets {availableAssets.length > 0 && `(${availableAssets.length})`}
        </span>
        <div className="asset-grid" style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
          {availableAssets.length > 0 ? (
            availableAssets.map((asset) => (
              <button key={asset.id} className="asset-pick" onClick={() => onSelect(asset.id)}>
                <div className="asset-icon">{asset.icon}</div>
                <div className="asset-meta">
                  <div className="sym">{asset.symbol}</div>
                  <div className="nm">{asset.name}</div>
                </div>
                {asset.price !== undefined && (
                  <div className="asset-price">
                    <div className="p">{formatPrice(asset.price)}</div>
                    {asset.change24h !== undefined && (
                      <div className={`c ${asset.change24h >= 0 ? 'pos' : 'neg'}`}>
                        {asset.change24h > 0 ? '+' : ''}{asset.change24h}%
                      </div>
                    )}
                  </div>
                )}
              </button>
            ))
          ) : (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '32px 0', color: 'var(--mute)' }}>
              No assets found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}