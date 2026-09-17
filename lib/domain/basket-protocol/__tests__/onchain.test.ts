import { describe, expect, it } from 'vitest';
import { RecipeAsset } from '@/types/basket-protocol';
import { computeOnChainBagId, computeOnChainCompositionHash, decodeOnChainBagId } from '../onchain';

function asset(overrides: Partial<RecipeAsset>): RecipeAsset {
  return {
    chain: 'ethereum',
    address: '0x1111111111111111111111111111111111111a',
    symbol: 'BTC',
    decimals: 18,
    weightBps: 6000,
    ...overrides,
  };
}

describe('computeOnChainCompositionHash', () => {
  it('returns a 32-byte (66-char, 0x-prefixed) hex string', () => {
    const hash = computeOnChainCompositionHash([asset({})]);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is independent of array order — reordering assets never changes the hash', () => {
    const a = asset({ symbol: 'BTC', address: '0x1111111111111111111111111111111111111a', weightBps: 6000 });
    const b = asset({ symbol: 'ETH', address: '0x2222222222222222222222222222222222222b', weightBps: 4000 });

    const forward = computeOnChainCompositionHash([a, b]);
    const reversed = computeOnChainCompositionHash([b, a]);

    expect(forward).toBe(reversed);
  });

  it('is independent of object key order within each asset (JSONB round-trip simulation)', () => {
    const a: RecipeAsset = {
      chain: 'ethereum',
      address: '0x1111111111111111111111111111111111111a',
      symbol: 'BTC',
      decimals: 18,
      weightBps: 6000,
    };
    // Same asset, but JSON.parse(JSON.stringify()) with keys inserted in a
    // different order — simulates what a JSONB round-trip through Supabase
    // can do to key order (Postgres JSONB does not preserve insertion
    // order across a read).
    const reordered: RecipeAsset = JSON.parse(
      `{"weightBps":6000,"decimals":18,"symbol":"BTC","address":"0x1111111111111111111111111111111111111a","chain":"ethereum"}`
    );

    expect(computeOnChainCompositionHash([a])).toBe(computeOnChainCompositionHash([reordered]));
  });

  it('changes when a weight actually changes', () => {
    const v1 = computeOnChainCompositionHash([asset({ weightBps: 6000 })]);
    const v2 = computeOnChainCompositionHash([asset({ weightBps: 6001 })]);
    expect(v1).not.toBe(v2);
  });

  it('changes when the asset set actually changes', () => {
    const v1 = computeOnChainCompositionHash([asset({ symbol: 'BTC' })]);
    const v2 = computeOnChainCompositionHash([asset({ symbol: 'ETH' })]);
    expect(v1).not.toBe(v2);
  });

  it('is deterministic — same input, called twice, same output', () => {
    const assets = [asset({ symbol: 'BTC' }), asset({ symbol: 'ETH', weightBps: 4000 })];
    expect(computeOnChainCompositionHash(assets)).toBe(computeOnChainCompositionHash(assets));
  });
});

describe('computeOnChainBagId', () => {
  it('returns a 32-byte hex string', () => {
    expect(computeOnChainBagId('11111111-1111-1111-1111-111111111111')).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input id', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    expect(computeOnChainBagId(id)).toBe(computeOnChainBagId(id));
  });

  it('is different for different bag ids', () => {
    const a = computeOnChainBagId('11111111-1111-1111-1111-111111111111');
    const b = computeOnChainBagId('22222222-2222-2222-2222-222222222222');
    expect(a).not.toBe(b);
  });

  it('round-trips through decodeOnChainBagId — the whole point of encoding rather than hashing', () => {
    const uuid = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';
    expect(decodeOnChainBagId(computeOnChainBagId(uuid))).toBe(uuid);
  });

  it('rejects a non-UUID input rather than silently encoding garbage', () => {
    expect(() => computeOnChainBagId('not-a-uuid')).toThrow();
  });
});
