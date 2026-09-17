import { describe, expect, it } from 'vitest';
import { BagRecord, BagVersionRecord, DEFAULT_REBALANCE_RULE, DEFAULT_STRATEGY_TYPE } from '@/types/basket-protocol';
import {
  CreateBagApiRequest,
  mapBagRecordToApiResponse,
  mapCreateBagRequestToRecipeInput,
} from '../bag-mapper';

// -----------------------------------------------------------------------------
// Phase 11 — strategyType must survive the full API boundary round trip:
//   UI create payload -> mapCreateBagRequestToRecipeInput -> CreateBagInput
//   BagRecord (+ version) -> mapBagRecordToApiResponse -> Bag
// Not user-selectable (spec section 6), so the request-side mapper never
// reads it off the body — this only asserts what it always produces.
// -----------------------------------------------------------------------------

function bagRecord(overrides: Partial<BagRecord> = {}): BagRecord {
  return {
    id: 'bag_1',
    slug: 'majors-basket',
    name: 'Majors Basket',
    symbol: 'MAJORS',
    description: 'BTC + ETH',
    creatorId: 'creator_1',
    chain: 'ethereum',
    strategyType: 'STATIC_BASKET',
    mutability: 'MUTABLE',
    status: 'ACTIVE',
    currentVersion: 1,
    currentVersionId: 'version_1',
    parentBagId: null,
    rootBagId: null,
    registryId: null,
    contractAddress: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function bagVersionRecord(overrides: Partial<BagVersionRecord> = {}): BagVersionRecord {
  return {
    id: 'version_1',
    bagId: 'bag_1',
    version: 1,
    compositionHash: 'hash',
    recipe: {
      id: 'recipe_bag_1_v1',
      bagId: 'bag_1',
      name: 'Majors Basket',
      symbol: 'MAJORS',
      description: 'BTC + ETH',
      chain: 'ethereum',
      strategyType: 'STATIC_BASKET',
      assets: [
        { chain: 'ethereum', address: '0x1111111111111111111111111111111111111111', symbol: 'BTC', decimals: 18, weightBps: 6000 },
        { chain: 'ethereum', address: '0x2222222222222222222222222222222222222222', symbol: 'ETH', decimals: 18, weightBps: 4000 },
      ],
      rebalanceRule: DEFAULT_REBALANCE_RULE,
      minInvestment: 100,
      maxAssets: 10,
      minWeightBps: 100,
      maxWeightBps: 8000,
      mutability: 'MUTABLE',
      version: 1,
      createdAt: new Date().toISOString(),
    },
    createdBy: 'creator_1',
    reason: 'Genesis',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('mapCreateBagRequestToRecipeInput — strategy type (Phase 11)', () => {
  it('always sets strategyType to the default, regardless of request body', () => {
    const body: CreateBagApiRequest = {
      name: 'Majors Basket',
      composition: [
        { symbol: 'BTC', weight: 60 },
        { symbol: 'ETH', weight: 40 },
      ],
    };
    const input = mapCreateBagRequestToRecipeInput(body, 'creator_1');
    expect(input.recipe.strategyType).toBe(DEFAULT_STRATEGY_TYPE);
  });

  it('ignores a client-supplied strategyType (not part of CreateBagApiRequest at all)', () => {
    const body = {
      name: 'Majors Basket',
      composition: [{ symbol: 'BTC', weight: 100 }],
      strategyType: 'DYNAMIC_BASKET',
    } as CreateBagApiRequest;
    const input = mapCreateBagRequestToRecipeInput(body, 'creator_1');
    expect(input.recipe.strategyType).toBe('STATIC_BASKET');
  });
});

describe('mapCreateBagRequestToRecipeInput — asset registry lookup (Phase 17)', () => {
  it('a symbol found in the lookup uses ITS OWN chain, not the bag-level chain', () => {
    const body: CreateBagApiRequest = {
      name: 'NVDA Bag',
      chain: 'ethereum', // bag defaults to ethereum
      composition: [{ symbol: 'NVDA', weight: 100 }],
    };
    const input = mapCreateBagRequestToRecipeInput(body, 'creator_1', {
      NVDA: { chain: 'robinhood', address: '0xaaaa000000000000000000000000000000aaaa', decimals: 6 },
    });

    expect(input.recipe.assets[0]).toMatchObject({
      symbol: 'NVDA',
      chain: 'robinhood',
      address: '0xaaaa000000000000000000000000000000aaaa',
      decimals: 6,
    });
  });

  it('a symbol NOT in the lookup falls back to the bag-level chain and __PENDING__ (unchanged pre-Phase-17 behavior)', () => {
    const body: CreateBagApiRequest = {
      name: 'Unregistered Bag',
      chain: 'ethereum',
      composition: [{ symbol: 'BTC', weight: 100 }],
    };
    const input = mapCreateBagRequestToRecipeInput(body, 'creator_1', {});

    expect(input.recipe.assets[0]).toMatchObject({ symbol: 'BTC', chain: 'ethereum', address: '__PENDING__', decimals: 18 });
  });

  it('mixed composition: each asset resolves independently against the lookup', () => {
    const body: CreateBagApiRequest = {
      name: 'Mixed Bag',
      chain: 'robinhood',
      composition: [
        { symbol: 'NVDA', weight: 60 },
        { symbol: 'BTC', weight: 40 },
      ],
    };
    const input = mapCreateBagRequestToRecipeInput(body, 'creator_1', {
      NVDA: { chain: 'robinhood', address: '0xaaaa000000000000000000000000000000aaaa', decimals: 6 },
    });

    const bySymbol = Object.fromEntries(input.recipe.assets.map((a) => [a.symbol, a]));
    expect(bySymbol.NVDA).toMatchObject({ chain: 'robinhood', address: '0xaaaa000000000000000000000000000000aaaa' });
    // BTC isn't in the lookup, so it falls back to the bag's own chain — 'robinhood' here, matching this body's `chain`.
    expect(bySymbol.BTC).toMatchObject({ chain: 'robinhood', address: '__PENDING__' });
  });

  it('with no third argument at all, behaves exactly as before Phase 17 (default empty lookup)', () => {
    const body: CreateBagApiRequest = {
      name: 'No Lookup Bag',
      composition: [{ symbol: 'ETH', weight: 100 }],
    };
    const input = mapCreateBagRequestToRecipeInput(body, 'creator_1');

    expect(input.recipe.assets[0]).toMatchObject({ symbol: 'ETH', chain: 'ethereum', address: '__PENDING__' });
  });
});

describe('mapBagRecordToApiResponse — strategy type (Phase 11)', () => {
  it('carries strategyType from the BagRecord onto the Bag response', () => {
    const bag = mapBagRecordToApiResponse(bagRecord({ strategyType: 'STATIC_BASKET' }), bagVersionRecord());
    expect(bag.strategyType).toBe('STATIC_BASKET');
  });

  it('falls back to the default when there is no current version', () => {
    const bag = mapBagRecordToApiResponse(bagRecord({ strategyType: 'STATIC_BASKET' }), null);
    expect(bag.strategyType).toBe('STATIC_BASKET');
  });
});
