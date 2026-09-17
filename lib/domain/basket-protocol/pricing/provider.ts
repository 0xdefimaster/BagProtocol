import { AssetIdentity, AssetPrice } from '@/types/basket-protocol';

// -----------------------------------------------------------------------------
// The seam every future price source (Chainlink, Pyth, CoinGecko, DEX TWAP
// — spec section 6) is meant to implement. Phase 5 ships exactly one
// implementation, `MockPriceProvider` (./mock-provider.ts) — a real
// HTTP/RPC-backed provider is explicitly out of scope until a later phase
// names one (spec section 6/12: no CoinGecko wiring in this phase).
// -----------------------------------------------------------------------------

export interface PriceProvider {
  getPrice(asset: AssetIdentity): Promise<AssetPrice>;
}

/** Thrown by a `PriceProvider` implementation when no price can be produced for an asset (unknown to the source, delisted, RPC failure, etc). Not thrown by `MockPriceProvider`, which always returns a deterministic price — reserved for real providers. */
export class PriceUnavailableError extends Error {
  constructor(public readonly asset: AssetIdentity) {
    super(`No price available for ${asset.chain}:${asset.address}`);
    this.name = 'PriceUnavailableError';
  }
}
