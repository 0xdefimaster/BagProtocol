import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPriceProviderForTests,
  getPriceProvider,
  MockPriceProviderInProductionError,
} from '../price-provider';
import { CoinGeckoPriceProvider } from '@/lib/domain/basket-protocol/pricing/coingecko-provider';
import { MockPriceProvider } from '@/lib/domain/basket-protocol/pricing/mock-provider';

function resetEnv() {
  vi.unstubAllEnvs();
  __resetPriceProviderForTests();
}

describe('getPriceProvider', () => {
  afterEach(resetEnv);

  it('defaults to CoinGeckoPriceProvider — the only provider allowed to back real money', () => {
    vi.stubEnv('PRICE_PROVIDER', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(getPriceProvider()).toBeInstanceOf(CoinGeckoPriceProvider);
  });

  it('allows PRICE_PROVIDER=mock outside production, for local dev/CI', () => {
    vi.stubEnv('PRICE_PROVIDER', 'mock');
    vi.stubEnv('NODE_ENV', 'test');
    expect(getPriceProvider()).toBeInstanceOf(MockPriceProvider);
  });

  it('refuses to start a mock price provider in production — fails fast, never silently falls back', () => {
    vi.stubEnv('PRICE_PROVIDER', 'mock');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getPriceProvider()).toThrow(MockPriceProviderInProductionError);
  });

  it('uses a real provider in production regardless of the mock flag being unset', () => {
    vi.stubEnv('PRICE_PROVIDER', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(getPriceProvider()).toBeInstanceOf(CoinGeckoPriceProvider);
  });

  it('memoizes the provider across calls within a process', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const first = getPriceProvider();
    const second = getPriceProvider();
    expect(first).toBe(second);
  });
});
