import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BagRecord, BagVersionRecord, BasketRecipe, CanonicalAsset, DEFAULT_REBALANCE_RULE, NavResult, ShareSupply } from '@/types/basket-protocol';
import { PurchaseIntent, PurchaseIntentStepRecord } from '@/types/purchase-intent';
import { SessionPayload } from '@/lib/auth/session';
import { calculateDepositAllocation } from '@/lib/domain/basket-protocol/deposit/allocation';
import { buildExecutionPlan } from '@/lib/domain/basket-protocol/deposit/execution-plan';
import { computeExecutionPlanFingerprint } from '@/lib/domain/basket-protocol/purchase-intent/fingerprint';
import { buildBagExecutionGraph, computeBagExecutionGraphHash } from '@/lib/execution/plan';
import { DEFAULT_COMPOSER_SLIPPAGE_BPS } from '@/lib/blockchain/lifi-purchase-quote';
import { BagExecutionError } from '@/lib/execution/errors';
import { CompiledExecution } from '@/lib/execution/types';

// -----------------------------------------------------------------------------
// Phase 17 — orchestration-level tests for lib/server/purchase-execution.ts.
// Same "mock every repo, run the real pure domain math" convention as
// lib/server/__tests__/purchase-preview-route.test.ts: computePurchasePreview
// itself is exercised for real (fixtures below), while all I/O
// (bag-repo, asset-repo, bag-nav, bag-share-state-repo,
// purchase-intent-repo, the real-wallet LI.FI quoting/status modules) is
// mocked — no real network or database call happens in this suite.
//
// Covers the spec Aşama 13 test list items this module is responsible for:
// unauthorized intent access, expired intent, quote-fingerprint mismatch,
// duplicate/idempotent execution, canonical registry enforcement remaining
// active, and accounting idempotency.
// -----------------------------------------------------------------------------

const getBagByIdMock = vi.fn();
const getCurrentBagVersionMock = vi.fn();
const getVerifiedIdentityKeysMock = vi.fn();
const listAssetsMock = vi.fn();
const getBagNavMock = vi.fn();
const getShareSupplyMock = vi.fn();
const buildPurchaseIntentStepsMock = vi.fn();
const trackStepStatusMock = vi.fn();
const compileBagExecutionMock = vi.fn();
const buildDefaultProvidersMock = vi.fn();

const findActivePurchaseIntentForBagMock = vi.fn();
const createPurchaseIntentMock = vi.fn();
const getPurchaseIntentForUserMock = vi.fn();
const updatePurchaseIntentStatusMock = vi.fn();
const updatePurchaseIntentStepsMock = vi.fn();
const markAccountingAppliedMock = vi.fn();
const markReconciliationAppliedMock = vi.fn();

vi.mock('@/lib/server/bag-repo', () => ({
  getBagById: (...args: unknown[]) => getBagByIdMock(...args),
  getCurrentBagVersion: (...args: unknown[]) => getCurrentBagVersionMock(...args),
}));
vi.mock('@/lib/server/asset-repo', () => ({
  getVerifiedIdentityKeys: (...args: unknown[]) => getVerifiedIdentityKeysMock(...args),
  listAssets: (...args: unknown[]) => listAssetsMock(...args),
}));
vi.mock('@/lib/server/bag-nav', () => ({
  getBagNav: (...args: unknown[]) => getBagNavMock(...args),
  getBagNavSafe: async (...args: unknown[]) => ({ ok: true, nav: await getBagNavMock(...args) }),
}));
vi.mock('@/lib/server/bag-share-state-repo', () => ({
  getShareSupply: (...args: unknown[]) => getShareSupplyMock(...args),
}));
vi.mock('@/lib/blockchain/lifi-purchase-quote', () => ({
  buildPurchaseIntentSteps: (...args: unknown[]) => buildPurchaseIntentStepsMock(...args),
  DEFAULT_COMPOSER_SLIPPAGE_BPS: 100,
}));
vi.mock('@/lib/blockchain/lifi-status', () => ({
  trackStepStatus: (...args: unknown[]) => trackStepStatusMock(...args),
}));
vi.mock('@/lib/execution/compiler', () => ({
  compileBagExecution: (...args: unknown[]) => compileBagExecutionMock(...args),
}));
vi.mock('@/lib/execution/registry', () => ({
  buildDefaultProviders: (...args: unknown[]) => buildDefaultProvidersMock(...args),
}));
vi.mock('@/lib/server/purchase-intent-repo', () => ({
  createPurchaseIntent: (...args: unknown[]) => createPurchaseIntentMock(...args),
  findActivePurchaseIntentForBag: (...args: unknown[]) => findActivePurchaseIntentForBagMock(...args),
  getPurchaseIntentForUser: (...args: unknown[]) => getPurchaseIntentForUserMock(...args),
  markAccountingApplied: (...args: unknown[]) => markAccountingAppliedMock(...args),
  markReconciliationApplied: (...args: unknown[]) => markReconciliationAppliedMock(...args),
  updatePurchaseIntentStatus: (...args: unknown[]) => updatePurchaseIntentStatusMock(...args),
  updatePurchaseIntentSteps: (...args: unknown[]) => updatePurchaseIntentStepsMock(...args),
}));

const {
  createPurchaseIntentForUser,
  prepareExecution,
  recordStepEvent,
  verifyExecution,
} = await import('../purchase-execution');

// ----------------------------- fixtures ---------------------------------------

const USDC: CanonicalAsset = {
  id: 'asset_usdc',
  chain: 'ethereum',
  address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  status: 'VERIFIED',
  assetType: 'crypto',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const NVDA_ADDRESS = '0x1111111111111111111111111111111111111111';
const AAPL_ADDRESS = '0x2222222222222222222222222222222222222222';

function recipe(): BasketRecipe {
  return {
    id: 'recipe_bag_1_v1',
    bagId: 'bag_1',
    name: 'AI Revolution',
    symbol: 'AIREV',
    description: 'NVDA + AAPL',
    chain: 'ethereum',
    strategyType: 'STATIC_BASKET',
    assets: [
      { chain: 'ethereum', address: NVDA_ADDRESS, symbol: 'NVDA', decimals: 18, weightBps: 6000 },
      { chain: 'ethereum', address: AAPL_ADDRESS, symbol: 'AAPL', decimals: 18, weightBps: 4000 },
    ],
    rebalanceRule: DEFAULT_REBALANCE_RULE,
    minInvestment: 1,
    maxAssets: 10,
    minWeightBps: 100,
    maxWeightBps: 8000,
    mutability: 'MUTABLE',
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

function bagRecord(): BagRecord {
  return {
    id: 'bag_1',
    slug: 'ai-revolution',
    name: 'AI Revolution',
    symbol: 'AIREV',
    description: 'NVDA + AAPL',
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
  };
}

function bagVersion(overrides: Partial<BagVersionRecord> = {}): BagVersionRecord {
  return {
    id: 'version_1',
    bagId: 'bag_1',
    version: 1,
    compositionHash: 'hash',
    recipe: recipe(),
    createdBy: 'creator_1',
    reason: 'initial',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function nav(): NavResult {
  return { asOf: new Date().toISOString(), quoteCurrency: 'USD', components: [], grossNav: '1000', netNav: '1000' };
}

function shareSupply(): ShareSupply {
  return { bagId: 'bag_1', totalSharesRaw: '100000000000000000000', shareDecimals: 18, updatedAt: new Date().toISOString() };
}

function session(): SessionPayload {
  return { userId: 'user_1', walletAddress: '0xREALWALLET000000000000000000000000000001' };
}

function swapStepRecord(overrides: Partial<PurchaseIntentStepRecord> = {}): PurchaseIntentStepRecord {
  return {
    stepIndex: 0,
    action: 'SWAP',
    targetSymbol: 'xNVDA',
    inputAsset: { chain: 'ethereum', address: USDC.address },
    outputAsset: { chain: 'ethereum', address: NVDA_ADDRESS },
    sourceChain: 'ethereum',
    destinationChain: 'ethereum',
    inputAmountRaw: '60000000',
    targetValueRaw: '60000000',
    outputAmountRaw: '10000000000000000000',
    outputDecimals: 18,
    minOutputRaw: '9900000000000000000',
    route: 'uniswap',
    lifiStep: { some: 'lifi-step-payload' },
    status: 'PENDING',
    approvalTxHash: null,
    txHash: null,
    providerSubstatus: null,
    failureCode: null,
    ...overrides,
  };
}

function intentFixture(overrides: Partial<PurchaseIntent> = {}): PurchaseIntent {
  return {
    id: 'intent_1',
    userId: 'user_1',
    walletAddress: session().walletAddress,
    bagId: 'bag_1',
    inputAsset: { chain: 'ethereum', address: USDC.address },
    inputAmountRaw: '100000000',
    sharesRaw: '100000000000000000000',
    shareDecimals: 18,
    // Real fingerprint of `recipe()`/USDC/'100000000' (Phase 18: prepareExecution
    // now recomputes and compares this exactly, not just an "output asset
    // set" heuristic) — a hardcoded fake string would make every "still
    // matches" test fail against the new strict check.
    routeFingerprint: computeExecutionPlanFingerprint(
      buildExecutionPlan(
        calculateDepositAllocation({ bagId: 'bag_1', inputAsset: { chain: 'ethereum', address: USDC.address }, amountRaw: '100000000' }, recipe())
      )
    ),
    recipeVersion: 1,
    compositionHash: 'hash',
    navSnapshot: { grossNav: '1000', quoteCurrency: 'USD', asOf: new Date().toISOString() },
    sharePriceAtQuote: '10',
    depositAmount: '1000',
    steps: [swapStepRecord()],
    composerTransaction: null,
    executionPlanHash: null,
    executionMode: null,
    status: 'READY',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    executedAt: null,
    accountingAppliedAt: null,
    reconciliationAppliedAt: null,
    failureCode: null,
    ...overrides,
  };
}

/** Real hash of the `BagExecutionGraph` `recipe()`/USDC/'100000000' (the
 * exact plan `intentFixture()`'s `routeFingerprint` is also computed from)
 * produces — the compiler-layer counterpart to `routeFingerprint` in the
 * fixture above, used by the `executionPlanHash` integrity tests below so a
 * hardcoded fake hash doesn't make every "still matches" case fail against
 * the real check. */
function realExecutionPlanHash(): string {
  const plan = calculateDepositAllocation(
    { bagId: 'bag_1', inputAsset: { chain: 'ethereum', address: USDC.address }, amountRaw: '100000000' },
    recipe()
  );
  const graph = buildBagExecutionGraph(buildExecutionPlan(plan), {
    wallet: session().walletAddress,
    chainId: 'ethereum',
    defaultSlippageBps: DEFAULT_COMPOSER_SLIPPAGE_BPS,
  });
  return computeBagExecutionGraphHash(graph);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Deterministic regardless of the host shell's own env — the Composer
  // attempt in createPurchaseIntentForUser is opt-in based on
  // process.env.LIFI_API_KEY, and these tests exercise the plain
  // sequential path via the mocked buildPurchaseIntentSteps above either
  // way, so a real key in the test runner's environment must not change
  // what args that mock is asserted to have been called with.
  delete process.env.LIFI_API_KEY;
  delete process.env.BAG_EXECUTION_COMPILER_ENABLED;
  buildDefaultProvidersMock.mockReturnValue([]);
  getBagByIdMock.mockResolvedValue(bagRecord());
  getCurrentBagVersionMock.mockResolvedValue(bagVersion());
  getVerifiedIdentityKeysMock.mockResolvedValue(new Set(['ethereum:' + NVDA_ADDRESS, 'ethereum:' + AAPL_ADDRESS]));
  listAssetsMock.mockResolvedValue([USDC]);
  getBagNavMock.mockResolvedValue(nav());
  getShareSupplyMock.mockResolvedValue(shareSupply());
  findActivePurchaseIntentForBagMock.mockResolvedValue(null);
  createPurchaseIntentMock.mockImplementation(async (_admin: unknown, input: Record<string, unknown>) => ({
    ...intentFixture(),
    ...input,
  }));
});

// ----------------------------- 1. create ---------------------------------------

describe('createPurchaseIntentForUser', () => {
  it('quotes against the REAL session wallet address, never a client-supplied one', async () => {
    buildPurchaseIntentStepsMock.mockResolvedValue({ steps: [swapStepRecord()], allSwapsQuoted: true, firstFailure: null, composerTransaction: null });

    const outcome = await createPurchaseIntentForUser({
      admin: {} as never,
      session: session(),
      bagId: 'bag_1',
      inputAssetId: 'asset_usdc',
      amount: '100',
    });

    expect(outcome.ok).toBe(true);
    expect(buildPurchaseIntentStepsMock).toHaveBeenCalledWith(expect.anything(), session().walletAddress, USDC.decimals, undefined);
    expect(createPurchaseIntentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ walletAddress: session().walletAddress, userId: session().userId, status: 'READY' })
    );
  });

  it('rejects when a non-terminal intent already exists for this (user, bag)', async () => {
    findActivePurchaseIntentForBagMock.mockResolvedValue(intentFixture({ id: 'existing_intent' }));

    const outcome = await createPurchaseIntentForUser({
      admin: {} as never,
      session: session(),
      bagId: 'bag_1',
      inputAssetId: 'asset_usdc',
      amount: '100',
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({ kind: 'PURCHASE_IN_PROGRESS', intentId: 'existing_intent' });
    expect(buildPurchaseIntentStepsMock).not.toHaveBeenCalled();
  });

  it('fails closed when the recipe references an unverified asset (canonical registry enforcement)', async () => {
    getVerifiedIdentityKeysMock.mockResolvedValue(new Set()); // nothing verified

    const outcome = await createPurchaseIntentForUser({
      admin: {} as never,
      session: session(),
      bagId: 'bag_1',
      inputAssetId: 'asset_usdc',
      amount: '100',
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe('REGISTRY_INVALID');
    expect(buildPurchaseIntentStepsMock).not.toHaveBeenCalled();
  });

  it('persists a FAILED intent (not silently discarded) when a real quote fails', async () => {
    buildPurchaseIntentStepsMock.mockResolvedValue({
      steps: [swapStepRecord({ status: 'FAILED', failureCode: 'UNSUPPORTED_ROUTE', lifiStep: null })],
      allSwapsQuoted: false,
      firstFailure: { failureCode: 'UNSUPPORTED_ROUTE', message: 'No route available for your wallet.' },
      composerTransaction: null,
    });

    const outcome = await createPurchaseIntentForUser({
      admin: {} as never,
      session: session(),
      bagId: 'bag_1',
      inputAssetId: 'asset_usdc',
      amount: '100',
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({ kind: 'QUOTE_FAILED', failureCode: 'UNSUPPORTED_ROUTE', message: 'No route available for your wallet.' });
    expect(createPurchaseIntentMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'FAILED' }));
  });
});

// ----------------------------- 1b. createPurchaseIntentForUser — BAG_EXECUTION_COMPILER_ENABLED ---

// The compiler-layer counterpart to the legacy-path tests above. Same
// fixtures (`recipe()` = NVDA 60% / AAPL 40%, USDC input), but
// `compileBagExecution()` (mocked here — its OWN behavior is covered by
// lib/execution/__tests__/compiler.test.ts) drives provider selection
// instead of this file's `buildPurchaseIntentSteps` mock. The bridge
// (`compiledExecutionToPurchaseIntentSteps`) is deliberately left REAL and
// unmocked so these tests exercise the actual CompiledExecution ->
// PurchaseIntentStepRecord[] mapping end to end, not just that a mock was
// called.
describe('createPurchaseIntentForUser — BAG_EXECUTION_COMPILER_ENABLED', () => {
  const composerCompiled: CompiledExecution = {
    mode: 'SINGLE_TX',
    chainId: 1,
    transactions: [{ to: '0xComposerRouter', data: '0xdeadbeef', value: '0', chainId: 1 }],
    expectedOutputs: [
      { legId: 'leg_0', asset: { chain: 'ethereum', address: NVDA_ADDRESS }, minimumOutputRaw: '10000000000000000000' },
      { legId: 'leg_1', asset: { chain: 'ethereum', address: AAPL_ADDRESS }, minimumOutputRaw: '4000000000000000000' },
    ],
    providerId: 'lifi-composer',
    executionPlanHash: 'test-hash-composer-abc',
    providerMetadata: { userProxy: '0xProxy', legQuotes: {} },
  };

  const sequentialCompiled: CompiledExecution = {
    mode: 'MULTI_TX',
    chainId: 1,
    transactions: [],
    expectedOutputs: [
      { legId: 'leg_0', asset: { chain: 'ethereum', address: NVDA_ADDRESS }, minimumOutputRaw: '9900000000000000000' },
      { legId: 'leg_1', asset: { chain: 'ethereum', address: AAPL_ADDRESS }, minimumOutputRaw: '3900000000000000000' },
    ],
    providerId: 'lifi-sequential',
    executionPlanHash: 'test-hash-sequential-xyz',
    providerMetadata: {
      legResults: {
        leg_0: { ok: true, outputAmountRaw: '10000000000000000000', outputDecimals: 18, minOutputRaw: '9900000000000000000', route: 'uniswap', lifiStep: { some: 'lifi-step-nvda' } },
        leg_1: { ok: true, outputAmountRaw: '4000000000000000000', outputDecimals: 18, minOutputRaw: '3900000000000000000', route: 'uniswap', lifiStep: { some: 'lifi-step-aapl' } },
      },
    },
  };

  it('routes through compileBagExecution() instead of the legacy buildPurchaseIntentSteps() path (item 4: no provider-specific routing left in this file)', async () => {
    process.env.BAG_EXECUTION_COMPILER_ENABLED = 'true';
    compileBagExecutionMock.mockResolvedValue(composerCompiled);

    const outcome = await createPurchaseIntentForUser({
      admin: {} as never,
      session: session(),
      bagId: 'bag_1',
      inputAssetId: 'asset_usdc',
      amount: '100',
    });

    expect(outcome.ok).toBe(true);
    expect(buildPurchaseIntentStepsMock).not.toHaveBeenCalled();
    expect(compileBagExecutionMock).toHaveBeenCalledTimes(1);
    const [bagIntentArg, graphArg] = compileBagExecutionMock.mock.calls[0];
    expect(bagIntentArg).toMatchObject({ wallet: session().walletAddress, chainId: 'ethereum', bagId: 'bag_1' });
    expect(graphArg.legs).toHaveLength(2);
  });

  it('a SINGLE_TX (Composer) CompiledExecution maps into composerTransaction + PENDING steps, and persists executionPlanHash', async () => {
    process.env.BAG_EXECUTION_COMPILER_ENABLED = 'true';
    compileBagExecutionMock.mockResolvedValue(composerCompiled);

    const outcome = await createPurchaseIntentForUser({
      admin: {} as never,
      session: session(),
      bagId: 'bag_1',
      inputAssetId: 'asset_usdc',
      amount: '100',
    });

    expect(outcome.ok).toBe(true);
    const insertedInput = createPurchaseIntentMock.mock.calls[0][1];
    expect(insertedInput.status).toBe('READY');
    expect(insertedInput.executionPlanHash).toBe('test-hash-composer-abc');
    expect(insertedInput.composerTransaction).toEqual({ to: '0xComposerRouter', data: '0xdeadbeef', value: '0', chainId: 1, userProxy: '0xProxy' });
    expect(insertedInput.steps).toHaveLength(2);
    expect(insertedInput.steps[0]).toMatchObject({ action: 'SWAP', status: 'PENDING', outputAmountRaw: '10000000000000000000', minOutputRaw: null, route: null, lifiStep: null });
    expect(insertedInput.steps[1]).toMatchObject({ action: 'SWAP', status: 'PENDING', outputAmountRaw: '4000000000000000000' });
  });

  it('a MULTI_TX (sequential) CompiledExecution maps providerMetadata.legResults into steps carrying the real lifiStep/route, composerTransaction stays null', async () => {
    process.env.BAG_EXECUTION_COMPILER_ENABLED = 'true';
    compileBagExecutionMock.mockResolvedValue(sequentialCompiled);

    const outcome = await createPurchaseIntentForUser({
      admin: {} as never,
      session: session(),
      bagId: 'bag_1',
      inputAssetId: 'asset_usdc',
      amount: '100',
    });

    expect(outcome.ok).toBe(true);
    const insertedInput = createPurchaseIntentMock.mock.calls[0][1];
    expect(insertedInput.composerTransaction).toBeNull();
    expect(insertedInput.executionPlanHash).toBe('test-hash-sequential-xyz');
    expect(insertedInput.steps[0]).toMatchObject({ status: 'PENDING', outputAmountRaw: '10000000000000000000', outputDecimals: 18, route: 'uniswap', lifiStep: { some: 'lifi-step-nvda' } });
    expect(insertedInput.steps[1]).toMatchObject({ status: 'PENDING', lifiStep: { some: 'lifi-step-aapl' } });
  });

  it('when every provider is ineligible/fails (compileBagExecution throws), still persists a FAILED, auditable intent rather than dropping the attempt', async () => {
    process.env.BAG_EXECUTION_COMPILER_ENABLED = 'true';
    compileBagExecutionMock.mockRejectedValue(new BagExecutionError('NO_ELIGIBLE_PROVIDER', 'no providers support this intent'));

    const outcome = await createPurchaseIntentForUser({
      admin: {} as never,
      session: session(),
      bagId: 'bag_1',
      inputAssetId: 'asset_usdc',
      amount: '100',
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe('QUOTE_FAILED');
    const insertedInput = createPurchaseIntentMock.mock.calls[0][1];
    expect(insertedInput.status).toBe('FAILED');
    expect(insertedInput.executionPlanHash).toBeNull();
    expect(
      (insertedInput.steps as PurchaseIntentStepRecord[]).every((s) => s.action === 'KEEP' || s.status === 'FAILED')
    ).toBe(true);
  });

  it('a compiler error that is NOT a BagExecutionError still propagates (never silently swallowed as a quote failure)', async () => {
    process.env.BAG_EXECUTION_COMPILER_ENABLED = 'true';
    compileBagExecutionMock.mockRejectedValue(new Error('unexpected bug'));

    await expect(
      createPurchaseIntentForUser({ admin: {} as never, session: session(), bagId: 'bag_1', inputAssetId: 'asset_usdc', amount: '100' })
    ).rejects.toThrow('unexpected bug');
  });
});

// ----------------------------- 1c. createPurchaseIntentForUser — flag OFF stays legacy ---

describe('createPurchaseIntentForUser — BAG_EXECUTION_COMPILER_ENABLED unset (default)', () => {
  it('never calls compileBagExecution — uses the legacy buildPurchaseIntentSteps path exactly as before', async () => {
    buildPurchaseIntentStepsMock.mockResolvedValue({ steps: [swapStepRecord()], allSwapsQuoted: true, firstFailure: null, composerTransaction: null });

    const outcome = await createPurchaseIntentForUser({
      admin: {} as never,
      session: session(),
      bagId: 'bag_1',
      inputAssetId: 'asset_usdc',
      amount: '100',
    });

    expect(outcome.ok).toBe(true);
    expect(compileBagExecutionMock).not.toHaveBeenCalled();
    expect(buildPurchaseIntentStepsMock).toHaveBeenCalledTimes(1);
    expect(createPurchaseIntentMock.mock.calls[0][1].executionPlanHash).toBeNull();
  });
});

// ----------------------------- 2. prepareExecution (idempotent) -----------------

describe('prepareExecution', () => {
  it('never re-executes an intent already past READY — returns the existing state unchanged', async () => {
    const submitted = intentFixture({ status: 'SUBMITTED' });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: submitted });

    const outcome = await prepareExecution({} as never, session(), 'intent_1');

    expect(outcome).toEqual({ ok: true, value: submitted });
    expect(updatePurchaseIntentStatusMock).not.toHaveBeenCalled();
  });

  it('rejects an intent belonging to a different user', async () => {
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: false, error: 'FORBIDDEN' });

    const outcome = await prepareExecution({} as never, session(), 'intent_1');

    expect(outcome).toEqual({ ok: false, error: { kind: 'FORBIDDEN' } });
  });

  it('expires a READY intent past its expiry instead of executing it', async () => {
    const expiredIntent = intentFixture({ status: 'READY', expiresAt: new Date(Date.now() - 1000).toISOString() });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: expiredIntent });
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...expiredIntent, status: 'EXPIRED' });

    const outcome = await prepareExecution({} as never, session(), 'intent_1');

    expect(outcome).toEqual({ ok: false, error: { kind: 'EXPIRED' } });
    expect(updatePurchaseIntentStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ from: 'READY', to: 'EXPIRED' })
    );
  });

  it('fails a READY intent whose target assets no longer match the Bag current recipe (route changed)', async () => {
    const readyIntent = intentFixture({ status: 'READY' });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: readyIntent });
    // Current recipe now targets a DIFFERENT asset than what the intent was quoted for.
    getCurrentBagVersionMock.mockResolvedValue(
      bagVersion({
        recipe: {
          ...recipe(),
          assets: [{ chain: 'ethereum', address: '0x9999999999999999999999999999999999999999', symbol: 'xTSLA', decimals: 18, weightBps: 10000 }],
        },
      })
    );
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...readyIntent, status: 'FAILED' });

    const outcome = await prepareExecution({} as never, session(), 'intent_1');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe('ROUTE_CHANGED');
  });

  it('fails a READY intent reweighted between the SAME assets — a case the old "output asset set" check alone would have missed', async () => {
    const readyIntent = intentFixture({ status: 'READY' });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: readyIntent });
    // Same two assets (NVDA/AAPL), same compositionHash fixture value, but
    // reweighted 60/40 -> 50/50 — the Phase 17 check only compared the SET
    // of output asset addresses, which is unchanged here, so it would have
    // let this execute against a route the user never actually saw quoted.
    getCurrentBagVersionMock.mockResolvedValue(
      bagVersion({
        recipe: {
          ...recipe(),
          assets: [
            { chain: 'ethereum', address: NVDA_ADDRESS, symbol: 'NVDA', decimals: 18, weightBps: 5000 },
            { chain: 'ethereum', address: AAPL_ADDRESS, symbol: 'AAPL', decimals: 18, weightBps: 5000 },
          ],
        },
      })
    );
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...readyIntent, status: 'FAILED' });

    const outcome = await prepareExecution({} as never, session(), 'intent_1');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe('ROUTE_CHANGED');
    expect(updatePurchaseIntentStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: 'FAILED', failureCode: 'ROUTE_EXPIRED' })
    );
  });

  it('fails a READY intent whose Bag composition changed (compositionHash mismatch) even before recomputing the full plan', async () => {
    const readyIntent = intentFixture({ status: 'READY' });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: readyIntent });
    getCurrentBagVersionMock.mockResolvedValue(bagVersion({ compositionHash: 'a-different-hash' }));
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...readyIntent, status: 'FAILED' });

    const outcome = await prepareExecution({} as never, session(), 'intent_1');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe('ROUTE_CHANGED');
  });

  it('advances a fresh READY intent all the way to AWAITING_SIGNATURE', async () => {
    const readyIntent = intentFixture({
      status: 'READY',
      steps: [swapStepRecord({ stepIndex: 0, targetSymbol: 'xNVDA', outputAsset: { chain: 'ethereum', address: NVDA_ADDRESS } }), swapStepRecord({ stepIndex: 1, targetSymbol: 'xAAPL', outputAsset: { chain: 'ethereum', address: AAPL_ADDRESS } })],
    });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: readyIntent });
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...readyIntent, status: 'AWAITING_SIGNATURE' });

    const outcome = await prepareExecution({} as never, session(), 'intent_1');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe('AWAITING_SIGNATURE');
  });
});

// ----------------------------- 2b. prepareExecution — executionPlanHash integrity ---

// Spec item 8: "executionPlanHash gerçek lifecycle'a bağlanmalı ... execute
// aşamasında yeniden hesaplanabilmeli. Mismatch: ayrı bir integrity error
// olarak ele alınmalı." — the execute-time half of
// supabase/migrations/0022_add_execution_plan_hash.sql.
describe('prepareExecution — executionPlanHash integrity (BAG_EXECUTION_COMPILER_ENABLED)', () => {
  it('an intent whose executionPlanHash still matches the freshly rebuilt graph advances normally', async () => {
    process.env.BAG_EXECUTION_COMPILER_ENABLED = 'true';
    const readyIntent = intentFixture({
      status: 'READY',
      executionPlanHash: realExecutionPlanHash(),
      // Same convention the legacy "advances a fresh READY intent" test
      // above uses — the default fixture's single step doesn't match the
      // 2-asset `recipe()`, which the new targets-match invariant below
      // (correctly) treats as a real inconsistency, not something to wave
      // through silently.
      steps: [
        swapStepRecord({ stepIndex: 0, targetSymbol: 'xNVDA', outputAsset: { chain: 'ethereum', address: NVDA_ADDRESS }, targetValueRaw: '60000000' }),
        swapStepRecord({ stepIndex: 1, targetSymbol: 'xAAPL', outputAsset: { chain: 'ethereum', address: AAPL_ADDRESS }, targetValueRaw: '40000000' }),
      ],
    });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: readyIntent });
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...readyIntent, status: 'AWAITING_SIGNATURE' });

    const outcome = await prepareExecution({} as never, session(), 'intent_1');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe('AWAITING_SIGNATURE');
  });

  it('an intent whose executionPlanHash no longer matches the current graph fails with VERIFICATION_FAILED, distinct from a plain ROUTE_EXPIRED', async () => {
    process.env.BAG_EXECUTION_COMPILER_ENABLED = 'true';
    const readyIntent = intentFixture({ status: 'READY', executionPlanHash: 'a-stale-hash-from-before-a-provider-bug-or-tamper' });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: readyIntent });
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...readyIntent, status: 'FAILED' });

    const outcome = await prepareExecution({} as never, session(), 'intent_1');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe('ROUTE_CHANGED');
    expect(updatePurchaseIntentStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: 'FAILED', failureCode: 'VERIFICATION_FAILED' })
    );
  });

  it('a legacy intent (executionPlanHash null) skips the check entirely, even with the flag on — never fails an intent this check was never meant to guard', async () => {
    process.env.BAG_EXECUTION_COMPILER_ENABLED = 'true';
    const readyIntent = intentFixture({ status: 'READY', executionPlanHash: null });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: readyIntent });
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...readyIntent, status: 'AWAITING_SIGNATURE' });

    const outcome = await prepareExecution({} as never, session(), 'intent_1');

    expect(outcome.ok).toBe(true);
  });

  it('flag off after creation: a non-null executionPlanHash is still verified, because the intent itself proves compiler provenance', async () => {
    delete process.env.BAG_EXECUTION_COMPILER_ENABLED;
    const readyIntent = intentFixture({ status: 'READY', executionPlanHash: 'this-would-fail-the-check-if-it-ran' });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: readyIntent });
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...readyIntent, status: 'FAILED' });

    const outcome = await prepareExecution({} as never, session(), 'intent_1');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe('ROUTE_CHANGED');
    expect(updatePurchaseIntentStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: 'FAILED', failureCode: 'VERIFICATION_FAILED' })
    );
  });
});

// ----------------------------- 3. recordStepEvent -------------------------------

describe('recordStepEvent', () => {
  it('fails the WHOLE intent when the user rejects a step in their wallet', async () => {
    const awaiting = intentFixture({ status: 'AWAITING_SIGNATURE', steps: [swapStepRecord({ status: 'AWAITING_SIGNATURE' })] });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: awaiting });
    updatePurchaseIntentStepsMock.mockResolvedValue({ ...awaiting, steps: [swapStepRecord({ status: 'FAILED', failureCode: 'USER_REJECTED' })] });
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...awaiting, status: 'FAILED', failureCode: 'USER_REJECTED' });

    const outcome = await recordStepEvent({} as never, session(), 'intent_1', 0, { type: 'REJECTED', failureCode: 'USER_REJECTED' });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe('FAILED');
    expect(updatePurchaseIntentStatusMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ to: 'FAILED' }));
  });

  it('can never mark a step (or the intent) COMPLETED from a client report', async () => {
    const awaiting = intentFixture({ status: 'AWAITING_SIGNATURE', steps: [swapStepRecord({ status: 'AWAITING_SIGNATURE' })] });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: awaiting });

    // @ts-expect-error — 'COMPLETED' is intentionally not a member of StepReportEvent['type'].
    const outcome = await recordStepEvent({} as never, session(), 'intent_1', 0, { type: 'COMPLETED' });

    expect(outcome.ok).toBe(false);
  });

  it('Phase 18: does NOT immediately fail the whole intent when a DIFFERENT step already has a real transaction submitted — defers to verifyExecution reconciliation', async () => {
    // Step 0 already submitted on-chain (has a txHash); step 1 is the one
    // whose signature the user is now rejecting.
    const submittedStep = swapStepRecord({ stepIndex: 0, targetSymbol: 'xNVDA', outputAsset: { chain: 'ethereum', address: NVDA_ADDRESS }, status: 'SUBMITTED', txHash: '0xalreadysubmitted' });
    const awaitingStep = swapStepRecord({ stepIndex: 1, targetSymbol: 'xAAPL', outputAsset: { chain: 'ethereum', address: AAPL_ADDRESS }, status: 'AWAITING_SIGNATURE' });
    const intent = intentFixture({ status: 'SUBMITTED', steps: [submittedStep, awaitingStep] });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent });
    updatePurchaseIntentStepsMock.mockResolvedValue({
      ...intent,
      steps: [submittedStep, { ...awaitingStep, status: 'FAILED', failureCode: 'USER_REJECTED' }],
    });

    const outcome = await recordStepEvent({} as never, session(), 'intent_1', 1, { type: 'REJECTED', failureCode: 'USER_REJECTED' });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Never finalized to FAILED here — step 0's already-submitted
    // transaction still needs to be polled/reconciled.
    expect(outcome.value.status).not.toBe('FAILED');
    expect(updatePurchaseIntentStatusMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ to: 'FAILED' }));
  });
});

// ----------------------------- 4. verifyExecution (idempotent) ------------------

describe('verifyExecution', () => {
  it('is a no-op for an already-terminal intent', async () => {
    const completed = intentFixture({ status: 'COMPLETED', accountingAppliedAt: new Date().toISOString() });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: completed });

    const outcome = await verifyExecution({} as never, session(), 'intent_1');

    expect(outcome).toEqual({ ok: true, value: completed });
    expect(trackStepStatusMock).not.toHaveBeenCalled();
  });

  it('marks a step FAILED when the received asset does not match the registry-verified expected asset', async () => {
    const submitted = intentFixture({
      status: 'SUBMITTED',
      steps: [swapStepRecord({ status: 'SUBMITTED', txHash: '0xabc' })],
    });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: submitted });
    trackStepStatusMock.mockResolvedValue({
      kind: 'DONE',
      receivedAsset: { chain: 'ethereum', address: '0xWRONGASSET' },
      receivedAmountRaw: '123',
      matchesExpectedAsset: false,
    });
    updatePurchaseIntentStepsMock.mockImplementation(async (_admin: unknown, _id: string, _status: string, steps: PurchaseIntentStepRecord[]) => ({
      ...submitted,
      steps,
    }));
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...submitted, status: 'FAILED', failureCode: 'VERIFICATION_FAILED' });

    const outcome = await verifyExecution({} as never, session(), 'intent_1');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe('FAILED');
    expect(updatePurchaseIntentStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: 'FAILED', failureCode: 'VERIFICATION_FAILED' })
    );
  });

  it('applies accounting exactly once, then marks the intent COMPLETED', async () => {
    const submitted = intentFixture({
      status: 'SUBMITTED',
      steps: [swapStepRecord({ status: 'SUBMITTED', txHash: '0xabc' })],
    });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: submitted });
    trackStepStatusMock.mockResolvedValue({
      kind: 'DONE',
      receivedAsset: { chain: 'ethereum', address: NVDA_ADDRESS },
      receivedAmountRaw: '9950000000000000000',
      matchesExpectedAsset: true,
    });

    const completedSteps = [swapStepRecord({ status: 'COMPLETED', txHash: '0xabc', outputAmountRaw: '9950000000000000000' })];
    updatePurchaseIntentStepsMock.mockResolvedValue({ ...submitted, steps: completedSteps });
    updatePurchaseIntentStatusMock.mockResolvedValue({
      ...submitted,
      steps: completedSteps,
      status: 'COMPLETED',
      executedAt: new Date().toISOString(),
    });

    const rpcMock = vi.fn().mockResolvedValue({ data: { alreadyApplied: false }, error: null });
    const admin = { rpc: rpcMock } as never;

    const outcome = await verifyExecution(admin, session(), 'intent_1');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe('COMPLETED');
    expect(rpcMock).toHaveBeenCalledWith(
      'apply_purchase_execution',
      expect.objectContaining({
        p_intent_id: submitted.id,
        p_bag_id: submitted.bagId,
        p_shares_delta_raw: submitted.sharesRaw,
        p_user_id: submitted.userId,
        p_cost_basis_delta: submitted.depositAmount,
      })
    );
    // Credits the ACTUAL received amount, not the pre-execution estimate.
    expect(rpcMock.mock.calls[0][1].p_holdings).toEqual(
      expect.arrayContaining([expect.objectContaining({ delta_raw: '9950000000000000000' })])
    );
    expect(markAccountingAppliedMock).toHaveBeenCalledWith(expect.anything(), submitted.id);
  });

  // ----------------------------- Phase 22: fork royalty -------------------------

  it('resolves the ROOT bag creator (not this fork bag\'s own creator) and passes FORK_ROYALTY_BPS when the bag has a root_bag_id', async () => {
    const submitted = intentFixture({
      status: 'SUBMITTED',
      steps: [swapStepRecord({ status: 'SUBMITTED', txHash: '0xabc' })],
    });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: submitted });
    trackStepStatusMock.mockResolvedValue({
      kind: 'DONE',
      receivedAsset: { chain: 'ethereum', address: NVDA_ADDRESS },
      receivedAmountRaw: '9950000000000000000',
      matchesExpectedAsset: true,
    });
    updatePurchaseIntentStepsMock.mockResolvedValue({
      ...submitted,
      steps: [swapStepRecord({ status: 'COMPLETED', txHash: '0xabc', outputAmountRaw: '9950000000000000000' })],
    });
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...submitted, status: 'COMPLETED', executedAt: new Date().toISOString() });

    // This bag (bag_1) is itself a fork of bag_0, created by someone OTHER
    // than bag_0's original creator — the exact case FORK_ROYALTY_BPS
    // exists for.
    getBagByIdMock.mockImplementation(async (_admin: unknown, id: string) => {
      if (id === 'bag_1') return { ...bagRecord(), id: 'bag_1', creatorId: 'forker_1', rootBagId: 'bag_0' };
      if (id === 'bag_0') return { ...bagRecord(), id: 'bag_0', creatorId: 'original_creator', rootBagId: null };
      return null;
    });

    const rpcMock = vi.fn().mockResolvedValue({ data: { alreadyApplied: false }, error: null });
    const admin = { rpc: rpcMock } as never;

    await verifyExecution(admin, session(), 'intent_1');

    expect(rpcMock).toHaveBeenCalledWith(
      'apply_purchase_execution',
      expect.objectContaining({
        p_fork_royalty_bps: 150,
        p_root_creator_id: 'original_creator',
      })
    );
  });

  it('passes zero royalty and no recipient for a non-fork bag (root_bag_id is null)', async () => {
    // beforeEach already stubs getBagByIdMock to bagRecord() (rootBagId: null).
    const submitted = intentFixture({
      status: 'SUBMITTED',
      steps: [swapStepRecord({ status: 'SUBMITTED', txHash: '0xabc' })],
    });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: submitted });
    trackStepStatusMock.mockResolvedValue({
      kind: 'DONE',
      receivedAsset: { chain: 'ethereum', address: NVDA_ADDRESS },
      receivedAmountRaw: '9950000000000000000',
      matchesExpectedAsset: true,
    });
    updatePurchaseIntentStepsMock.mockResolvedValue({
      ...submitted,
      steps: [swapStepRecord({ status: 'COMPLETED', txHash: '0xabc', outputAmountRaw: '9950000000000000000' })],
    });
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...submitted, status: 'COMPLETED', executedAt: new Date().toISOString() });

    const rpcMock = vi.fn().mockResolvedValue({ data: { alreadyApplied: false }, error: null });
    const admin = { rpc: rpcMock } as never;

    await verifyExecution(admin, session(), 'intent_1');

    expect(rpcMock).toHaveBeenCalledWith(
      'apply_purchase_execution',
      expect.objectContaining({
        p_fork_royalty_bps: 0,
        p_root_creator_id: null,
      })
    );
  });

  it('never finalizes the intent while one step failed but ANOTHER step is still pending/confirming — waits for both to reach a terminal state', async () => {
    const failedStep = swapStepRecord({ stepIndex: 0, targetSymbol: 'xNVDA', outputAsset: { chain: 'ethereum', address: NVDA_ADDRESS }, status: 'FAILED', failureCode: 'SLIPPAGE_EXCEEDED', txHash: '0xfailed' });
    const pendingStep = swapStepRecord({ stepIndex: 1, targetSymbol: 'xAAPL', outputAsset: { chain: 'ethereum', address: AAPL_ADDRESS }, status: 'SUBMITTED', txHash: '0xpending' });
    const submitted = intentFixture({ status: 'CONFIRMING', steps: [failedStep, pendingStep] });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: submitted });
    // Only the still-pending step gets polled (the failed one is already terminal and skipped).
    trackStepStatusMock.mockResolvedValue({ kind: 'PENDING', substatus: 'WAIT_DESTINATION_TRANSACTION' });
    updatePurchaseIntentStepsMock.mockResolvedValue({
      ...submitted,
      steps: [failedStep, { ...pendingStep, status: 'CONFIRMING', providerSubstatus: 'WAIT_DESTINATION_TRANSACTION' }],
    });

    const outcome = await verifyExecution({} as never, session(), 'intent_1');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Must NOT be finalized to FAILED, PARTIAL_SUCCESS, or anything else —
    // step 1 could still complete on-chain.
    expect(updatePurchaseIntentStatusMock).not.toHaveBeenCalled();
    expect(outcome.value.status).toBe('CONFIRMING');
  });

  it('moves to PARTIAL_SUCCESS -> RECONCILIATION_REQUIRED when one step verifiably completes and a sibling genuinely fails — credits ONLY the verified holdings, never mints shares', async () => {
    const completedStep = swapStepRecord({ stepIndex: 0, targetSymbol: 'xNVDA', outputAsset: { chain: 'ethereum', address: NVDA_ADDRESS }, status: 'COMPLETED', txHash: '0xdone', outputAmountRaw: '9950000000000000000' });
    const failedStep = swapStepRecord({ stepIndex: 1, targetSymbol: 'xAAPL', outputAsset: { chain: 'ethereum', address: AAPL_ADDRESS }, status: 'FAILED', failureCode: 'SLIPPAGE_EXCEEDED', txHash: '0xfailed' });
    const submitted = intentFixture({ status: 'CONFIRMING', steps: [completedStep, failedStep] });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: submitted });
    // Both steps already terminal (COMPLETED/FAILED) — nothing left to poll.

    const partial = { ...submitted, status: 'PARTIAL_SUCCESS' as const };
    const reconciled = { ...submitted, status: 'RECONCILIATION_REQUIRED' as const, reconciliationAppliedAt: new Date().toISOString() };
    updatePurchaseIntentStatusMock
      .mockResolvedValueOnce(partial) // SUBMITTED/CONFIRMING -> PARTIAL_SUCCESS
      .mockResolvedValueOnce(reconciled); // PARTIAL_SUCCESS -> RECONCILIATION_REQUIRED

    const rpcMock = vi.fn().mockResolvedValue({ data: { alreadyApplied: false }, error: null });
    const admin = { rpc: rpcMock } as never;

    const outcome = await verifyExecution(admin, session(), 'intent_1');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe('RECONCILIATION_REQUIRED');
    expect(updatePurchaseIntentStatusMock).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ to: 'PARTIAL_SUCCESS' }));
    expect(updatePurchaseIntentStatusMock).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ from: 'PARTIAL_SUCCESS', to: 'RECONCILIATION_REQUIRED' }));

    // Credits the verified-COMPLETED step's holdings...
    expect(rpcMock).toHaveBeenCalledWith(
      'apply_partial_purchase_execution',
      expect.objectContaining({
        p_intent_id: submitted.id,
        p_bag_id: submitted.bagId,
        p_user_id: submitted.userId,
      })
    );
    expect(rpcMock.mock.calls[0][1].p_holdings).toEqual([
      expect.objectContaining({ chain: 'ethereum', address: NVDA_ADDRESS, delta_raw: '9950000000000000000' }),
    ]);
    // ...and never mints shares — no call to the full apply_purchase_execution RPC.
    expect(rpcMock).not.toHaveBeenCalledWith('apply_purchase_execution', expect.anything());
    expect(markReconciliationAppliedMock).toHaveBeenCalledWith(expect.anything(), submitted.id);
    expect(markAccountingAppliedMock).not.toHaveBeenCalled();
  });

  it('reconciliation is idempotent — a second verifyExecution call on an already-RECONCILIATION_REQUIRED intent never re-credits holdings', async () => {
    const reconciled = intentFixture({
      status: 'RECONCILIATION_REQUIRED',
      reconciliationAppliedAt: new Date().toISOString(),
      steps: [
        swapStepRecord({ stepIndex: 0, status: 'COMPLETED', outputAmountRaw: '9950000000000000000' }),
        swapStepRecord({ stepIndex: 1, status: 'FAILED', failureCode: 'SLIPPAGE_EXCEEDED' }),
      ],
    });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: reconciled });

    const outcome = await verifyExecution({} as never, session(), 'intent_1');

    expect(outcome).toEqual({ ok: true, value: reconciled });
    expect(trackStepStatusMock).not.toHaveBeenCalled();
    expect(updatePurchaseIntentStatusMock).not.toHaveBeenCalled();
  });

  it('retrying from PARTIAL_SUCCESS (previous reconciliation attempt did not finish) resumes without double-crediting', async () => {
    // reconciliationAppliedAt already set by a PRIOR call whose RPC
    // succeeded but crashed before the PARTIAL_SUCCESS -> RECONCILIATION_REQUIRED
    // status write landed.
    const stuckPartial = intentFixture({
      status: 'PARTIAL_SUCCESS',
      reconciliationAppliedAt: new Date().toISOString(),
      steps: [
        swapStepRecord({ stepIndex: 0, status: 'COMPLETED', outputAmountRaw: '9950000000000000000' }),
        swapStepRecord({ stepIndex: 1, status: 'FAILED', failureCode: 'SLIPPAGE_EXCEEDED' }),
      ],
    });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: stuckPartial });
    const reconciled = { ...stuckPartial, status: 'RECONCILIATION_REQUIRED' as const };
    updatePurchaseIntentStatusMock.mockResolvedValue(reconciled);
    const rpcMock = vi.fn();
    const admin = { rpc: rpcMock } as never;

    const outcome = await verifyExecution(admin, session(), 'intent_1');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe('RECONCILIATION_REQUIRED');
    // reconciliationAppliedAt was already set -> the RPC must NOT be called again.
    expect(rpcMock).not.toHaveBeenCalled();
    expect(markReconciliationAppliedMock).not.toHaveBeenCalled();
  });

  it('never advances to RECONCILIATION_REQUIRED if the partial-credit RPC itself reports an error', async () => {
    const submitted = intentFixture({
      status: 'CONFIRMING',
      steps: [
        swapStepRecord({ stepIndex: 0, status: 'COMPLETED', outputAmountRaw: '9950000000000000000' }),
        swapStepRecord({ stepIndex: 1, status: 'FAILED', failureCode: 'SLIPPAGE_EXCEEDED' }),
      ],
    });
    getPurchaseIntentForUserMock.mockResolvedValue({ ok: true, intent: submitted });
    updatePurchaseIntentStatusMock.mockResolvedValue({ ...submitted, status: 'PARTIAL_SUCCESS' });
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'db unavailable' } });
    const admin = { rpc: rpcMock } as never;

    await expect(verifyExecution(admin, session(), 'intent_1')).rejects.toThrow('apply_partial_purchase_execution failed');
    expect(markReconciliationAppliedMock).not.toHaveBeenCalled();
  });
});
