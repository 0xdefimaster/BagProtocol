import { describe, expect, it, vi } from 'vitest';
import {
  buildComposerPurchase,
  computeCascadeSplitBps,
  ComposerIneligibleError,
  isComposerEligible,
} from '../lifi-composer-adapter';

// -----------------------------------------------------------------------------
// Mocks fetch at the HTTP boundary (fetchImpl injection), not the SDK
// itself — this exercises the real @lifi/composer-sdk flow-building and
// request serialization code, only faking the network response. The mock
// response shape below is copied from node_modules/@lifi/composer-sdk/dist
// /client.js's own parsing code (parseCompileSuccessBody: `{ data: {...} }`
// envelope; producedResources[*].simulated.amountOut must be a numeric
// STRING on the wire, the client converts it to bigint) — not guessed.
// -----------------------------------------------------------------------------

function mockComposeFetch(overrides: Partial<{ status: number; body: unknown }> = {}) {
  const status = overrides.status ?? 200;
  const body =
    overrides.body ??
    {
      data: {
        producedResources: {
          swap_0: { kind: 'erc20', chainId: 1, token: '0xTargetA', availability: 'now', owner: '0xSigner', simulated: { amountOut: '600000' } },
          swap_1: { kind: 'erc20', chainId: 1, token: '0xTargetB', availability: 'now', owner: '0xSigner', simulated: { amountOut: '400000' } },
        },
        transactionRequest: { to: '0xComposerVM', chainId: 1, data: '0xdeadbeef', value: '0' },
        userProxy: '0xUserProxy',
      },
    };
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe('isComposerEligible', () => {
  it('accepts ethereum/base/arbitrum with at least one leg', () => {
    expect(isComposerEligible('ethereum', [{ address: '0xa', weightBps: 10000, symbol: 'A' }])).toBe(true);
    expect(isComposerEligible('base', [{ address: '0xa', weightBps: 10000, symbol: 'A' }])).toBe(true);
    expect(isComposerEligible('arbitrum', [{ address: '0xa', weightBps: 10000, symbol: 'A' }])).toBe(true);
  });

  it('rejects solana — Composer is EVM-only per docs.li.fi', () => {
    expect(isComposerEligible('solana', [{ address: 'abc', weightBps: 10000, symbol: 'A' }])).toBe(false);
  });

  it('rejects robinhood — not independently verified for Composer specifically, unlike the plain LI.FI quote API', () => {
    expect(isComposerEligible('robinhood', [{ address: '0xa', weightBps: 10000, symbol: 'A' }])).toBe(false);
  });

  it('rejects zero legs', () => {
    expect(isComposerEligible('ethereum', [])).toBe(false);
  });
});

describe('computeCascadeSplitBps', () => {
  it('computes a single relative bps for a 2-leg 60/40 split', () => {
    const legs = [
      { address: '0xa', weightBps: 6000, symbol: 'A' },
      { address: '0xb', weightBps: 4000, symbol: 'B' },
    ];
    // Only N-1 = 1 split step; the last leg needs no split.
    expect(computeCascadeSplitBps(legs)).toEqual([6000]);
  });

  it('recomputes each step relative to the REMAINING pool, not the original total, for a 3-leg 50/30/20 split', () => {
    const legs = [
      { address: '0xa', weightBps: 5000, symbol: 'A' },
      { address: '0xb', weightBps: 3000, symbol: 'B' },
      { address: '0xc', weightBps: 2000, symbol: 'C' },
    ];
    // Step 1: 5000/10000 = 5000 bps of the original pool.
    // Step 2: remaining pool is 5000 bps; leg B wants 3000 of the
    // original 10000, i.e. 3000/5000 = 6000 bps of what's LEFT.
    // Leg C (last) needs no split — it just takes what remains.
    expect(computeCascadeSplitBps(legs)).toEqual([5000, 6000]);
  });

  it('throws if weights do not sum to exactly 10000 bps, rather than silently normalizing', () => {
    const legs = [
      { address: '0xa', weightBps: 5000, symbol: 'A' },
      { address: '0xb', weightBps: 4000, symbol: 'B' },
    ];
    expect(() => computeCascadeSplitBps(legs)).toThrow(/sum to exactly 10000/);
  });

  it('returns an empty array for a single leg (no split needed at all)', () => {
    expect(computeCascadeSplitBps([{ address: '0xa', weightBps: 10000, symbol: 'A' }])).toEqual([]);
  });
});

describe('buildComposerPurchase', () => {
  const baseRequest = {
    chain: 'ethereum' as const,
    inputTokenAddress: '0xInputToken',
    inputAmountRaw: '1000000',
    signerAddress: '0xSigner',
    slippageBps: 100,
    apiKey: 'test-key',
  };

  it('throws ComposerIneligibleError for an ineligible chain instead of building a broken flow', async () => {
    await expect(
      buildComposerPurchase({
        ...baseRequest,
        chain: 'solana' as unknown as 'ethereum',
        legs: [{ address: '0xa', weightBps: 10000, symbol: 'A' }],
      })
    ).rejects.toThrow(ComposerIneligibleError);
  });

  it('compiles a multi-leg flow and returns transactionRequest + userProxy + producedResources', async () => {
    const fetchImpl = mockComposeFetch();
    const result = await buildComposerPurchase({
      ...baseRequest,
      fetchImpl,
      legs: [
        { address: '0xTargetA', weightBps: 6000, symbol: 'A' },
        { address: '0xTargetB', weightBps: 4000, symbol: 'B' },
      ],
    });

    expect(result.transactionRequest).toEqual({
      to: '0xComposerVM',
      data: '0xdeadbeef',
      value: '0',
      chainId: 1,
    });
    expect(result.userProxy).toBe('0xUserProxy');
    expect(result.producedResources.swap_0.simulated?.amountOut).toBe(BigInt(600000));
    expect(result.producedResources.swap_1.simulated?.amountOut).toBe(BigInt(400000));

    // Exactly one POST to /compose — one signature's worth of work, not N.
    const composeCalls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.filter((call: unknown[]) =>
      String(call[0]).endsWith('/compose')
    );
    expect(composeCalls).toHaveLength(1);
  });

  it('sends the API key as x-lifi-api-key and hits the production composer.li.quest base URL by default', async () => {
    const fetchImpl = mockComposeFetch();
    await buildComposerPurchase({
      ...baseRequest,
      fetchImpl,
      legs: [{ address: '0xTargetA', weightBps: 10000, symbol: 'A' }],
    });

    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe('https://composer.li.quest/compose');
    expect((init.headers as Record<string, string>)['x-lifi-api-key']).toBe('test-key');
  });

  it('throws with the server-reported reason on a partial/reverted compile result, rather than returning a half-built transaction', async () => {
    const fetchImpl = mockComposeFetch({
      status: 206,
      body: {
        data: {
          producedResources: {},
          transactionRequest: { to: '0xComposerVM', chainId: 1, data: '0x', value: '0' },
          userProxy: '0xUserProxy',
        },
        error: { kind: 'SIMULATION_REVERTED', message: 'insufficient liquidity' },
      },
    });

    await expect(
      buildComposerPurchase({
        ...baseRequest,
        fetchImpl,
        legs: [{ address: '0xTargetA', weightBps: 10000, symbol: 'A' }],
      })
    ).rejects.toThrow(/insufficient liquidity/);
  });
});
