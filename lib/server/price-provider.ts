import { PriceProvider } from '@/lib/domain/basket-protocol/pricing/provider';
import { CoinGeckoPriceProvider } from '@/lib/domain/basket-protocol/pricing/coingecko-provider';
import { MockPriceProvider } from '@/lib/domain/basket-protocol/pricing/mock-provider';

// -----------------------------------------------------------------------------
// Phase 18 — the ONLY place production code may obtain a `PriceProvider`.
// Every route/service that prices real money (purchase-preview,
// purchase-execution, bag-nav) must call `getPriceProvider()` here instead
// of importing `MockPriceProvider` directly. This is what makes
// "MockPriceProvider can't run in production" an enforced invariant rather
// than a convention: `PRICE_PROVIDER=mock` is only honored outside
// production, and this module throws at first use (fail fast, not fail
// silent) if that guard would otherwise be bypassed.
// -----------------------------------------------------------------------------

let cachedProvider: PriceProvider | null = null;

export class MockPriceProviderInProductionError extends Error {
  constructor() {
    super(
      'PRICE_PROVIDER=mock is set but NODE_ENV=production. Refusing to start a real-money price path on mock/deterministic prices.'
    );
    this.name = 'MockPriceProviderInProductionError';
  }
}

function buildProvider(): PriceProvider {
  const isProduction = process.env.NODE_ENV === 'production';
  const explicitMock = process.env.PRICE_PROVIDER === 'mock';

  if (explicitMock) {
    if (isProduction) throw new MockPriceProviderInProductionError();
    return new MockPriceProvider();
  }

  return new CoinGeckoPriceProvider({
    apiKey: process.env.COINGECKO_API_KEY,
  });
}

/** Returns the process-wide `PriceProvider` for all real-money code paths. Memoized so the CoinGecko provider's internal cache is actually shared across calls within one server process/request lifecycle. */
export function getPriceProvider(): PriceProvider {
  if (!cachedProvider) cachedProvider = buildProvider();
  return cachedProvider;
}

/** Test-only: clears the memoized provider so tests can rebuild it under different env vars. Never call from production code. */
export function __resetPriceProviderForTests(): void {
  cachedProvider = null;
}
