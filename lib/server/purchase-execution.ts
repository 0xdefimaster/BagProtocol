import { SupabaseClient } from '@supabase/supabase-js';
import { AssetIdentity } from '@/types/basket-protocol';
import { PurchaseIntent, PurchaseIntentFailureCode, PurchaseIntentStepRecord, PURCHASE_INTENT_TTL_MS } from '@/types/purchase-intent';
import { SessionPayload } from '@/lib/auth/session';
import { getBagById, getCurrentBagVersion } from '@/lib/server/bag-repo';
import { FORK_ROYALTY_BPS } from '@/lib/config/rewards';
import { getBagNavSafe } from '@/lib/server/bag-nav';
import { getShareSupply } from '@/lib/server/bag-share-state-repo';
import { getVerifiedIdentityKeys, listAssets } from '@/lib/server/asset-repo';
import { getPriceProvider } from '@/lib/server/price-provider';
import { computePurchasePreview } from '@/lib/server/purchase-preview';
import { calculateDepositAllocation, InvalidRecipeWeightsError } from '@/lib/domain/basket-protocol/deposit/allocation';
import { buildExecutionPlan } from '@/lib/domain/basket-protocol/deposit/execution-plan';
import { validateRecipeAssetsAgainstRegistry } from '@/lib/domain/basket-protocol/validation/registry-validation';
import { recipeAssetIdentity } from '@/lib/domain/basket-protocol/asset-identity';
import { computeExecutionPlanFingerprint } from '@/lib/domain/basket-protocol/purchase-intent/fingerprint';
import {
  assertValidPurchaseIntentStepTransition,
  isValidPurchaseIntentStepTransition,
} from '@/lib/domain/basket-protocol/purchase-intent/state-machine';
import { buildPurchaseIntentSteps, DEFAULT_COMPOSER_SLIPPAGE_BPS } from '@/lib/blockchain/lifi-purchase-quote';
import { trackStepStatus } from '@/lib/blockchain/lifi-status';
import { trackComposerTransaction } from '@/lib/blockchain/composer-status';
import {
  createPurchaseIntent as insertPurchaseIntent,
  findActivePurchaseIntentForBag,
  getPurchaseIntentForUser,
  markAccountingApplied,
  markReconciliationApplied,
  updatePurchaseIntentStatus,
  updatePurchaseIntentSteps,
} from '@/lib/server/purchase-intent-repo';
// -----------------------------------------------------------------------------
// BAG execution compiler integration (spec item — "purchase-execution.ts
// artık compileBagExecution() çağırıyor mu?"). Behind
// `BAG_EXECUTION_COMPILER_ENABLED` (feature-flag.ts): flag OFF takes the
// EXACT legacy `buildPurchaseIntentSteps()` path below, unchanged. Flag ON
// routes provider selection through `compileBagExecution()` instead — this
// file never picks Composer vs sequential itself (spec item 6: "purchase-
// execution.ts provider-specific routing yapmasın"), it only builds the
// provider-independent intent/graph, calls the compiler, and hands the
// result to `compiledExecutionToPurchaseIntentSteps()` to translate back
// into the SAME `PurchaseIntentStepRecord[]`/`composerTransaction` shape
// the legacy path already produces — nothing downstream of this function
// (persistence, verification, accounting) needs to know which path ran.
import { isBagExecutionCompilerEnabled } from '@/lib/config/execution';
import { buildBagExecutionGraph, purchaseIntentToBagExecutionIntent, computeBagExecutionGraphHash } from '@/lib/execution/plan';
import { compileBagExecution } from '@/lib/execution/compiler';
import { buildDefaultProviders } from '@/lib/execution/registry';
import { compiledExecutionToPurchaseIntentSteps } from '@/lib/execution/purchase-intent-bridge';
import { BagExecutionError } from '@/lib/execution/errors';
import { BagExecutionIntent, ExecutionMode } from '@/lib/execution/types';
import { assetIdentityKey } from '@/lib/domain/basket-protocol/asset-identity';
import { DEPLOYED_CONTRACTS, getBagRouterPlanSignerKey } from '@/lib/config/robinhood-chain';
import { computeOnChainBagId } from '@/lib/domain/basket-protocol/onchain';
import { createRobinhoodUniswapLegBuilder } from '@/lib/execution/legbuilders/robinhood-uniswap-leg-builder';
import { createRobinhoodUniswapQuoter } from '@/lib/blockchain/robinhood-uniswap-quoter';
import { getRobinhoodPublicClient } from '@/lib/blockchain/robinhood-public-client';
import { createBagRouterPlanSigner } from '@/lib/blockchain/bag-execution-router-signer';
import type { DefaultProvidersConfig } from '@/lib/execution/registry';

// -----------------------------------------------------------------------------
// PHASE 19.X-2 — wires `BagRouterProvider` (item 7) into the SAME
// `buildDefaultProviders()` call the Composer/LI.FI path already uses.
// Same "no key, never attempted" rule as `LIFI_API_KEY`: this builder
// returns `undefined` — meaning `bagRouter` is omitted from
// `DefaultProvidersConfig` entirely, so `BagRouterProvider` is never even
// registered — unless BOTH `BAG_EXECUTION_ROUTER_ADDRESS` and
// `BAG_ROUTER_PLAN_SIGNER_KEY` are set. A deployment missing either one is
// byte-for-byte the same as before this wiring existed: LI.FI Composer /
// sequential only, exactly as `registry.ts`'s own doc requires.
// -----------------------------------------------------------------------------
function buildBagRouterProviderConfig(verifiedIdentityKeys: Set<string>): DefaultProvidersConfig['bagRouter'] {
  const routerAddress = DEPLOYED_CONTRACTS.bagExecutionRouter;
  const planSignerKey = getBagRouterPlanSignerKey();
  if (!routerAddress || !planSignerKey) return undefined;

  return {
    routerAddress,
    chainId: 4663, // Robinhood Chain mainnet — see lib/config/robinhood-chain.ts's ROBINHOOD_CHAIN_ID.
    toOnChainBagId: computeOnChainBagId,
    legBuilder: createRobinhoodUniswapLegBuilder({
      routerAddress,
      // Same registry Set already computed above (getVerifiedIdentityKeys)
      // for `validateRecipeAssetsAgainstRegistry` — reused rather than
      // re-fetched, so there's one DB round-trip and one source of truth
      // for "is this identity canonical" per request.
      isCanonicalToken: (identity) => verifiedIdentityKeys.has(assetIdentityKey(identity)),
      quote: createRobinhoodUniswapQuoter(getRobinhoodPublicClient()),
    }),
    signPlan: createBagRouterPlanSigner(planSignerKey),
  };
}

// -----------------------------------------------------------------------------
// Phase 17 — the four operations every API route in app/api/purchase-intent
// and app/api/bags/[id]/purchase-intent delegates to. Route handlers stay
// I/O parsing + auth + status-code mapping only (same split the rest of
// this codebase already uses — see app/api/trades/route.ts); the actual
// orchestration (which repo calls happen in which order, which errors map
// to which typed outcome) lives here so it's independently testable and so
// two routes never duplicate the same sequencing.
// -----------------------------------------------------------------------------

const priceProvider = getPriceProvider();

/**
 * Builds a full `PurchaseIntentStepRecord[]` (every plan step, `KEEP`
 * included) with every `SWAP` step marked `FAILED` — used ONLY when
 * `compileBagExecution()` itself throws (no provider could even be
 * selected), so `createPurchaseIntentForUser` can still persist a
 * consistent, auditable intent row instead of one with no step data at
 * all. Field-for-field identical to a KEEP row from
 * `compiledExecutionToPurchaseIntentSteps()`/`buildPurchaseIntentSteps()`
 * for the KEEP case; the SWAP case mirrors those two functions' own
 * "quote failed" branch.
 */
function buildAllFailedSteps(
  steps: import('@/types/basket-protocol').ExecutionStep[],
  inputDecimals: number
): PurchaseIntentStepRecord[] {
  return steps.map((step, stepIndex) => {
    if (step.action === 'KEEP') {
      return {
        stepIndex,
        action: 'KEEP',
        targetSymbol: step.targetSymbol,
        inputAsset: step.route.inputAsset,
        outputAsset: step.route.outputAsset,
        sourceChain: step.route.sourceChain,
        destinationChain: step.route.destinationChain,
        inputAmountRaw: step.route.inputAmountRaw,
        targetValueRaw: step.route.targetValueRaw,
        outputAmountRaw: null,
        outputDecimals: inputDecimals,
        minOutputRaw: null,
        route: null,
        lifiStep: null,
        status: 'NOT_NEEDED',
        approvalTxHash: null,
        txHash: null,
        providerSubstatus: null,
        failureCode: null,
      };
    }
    return {
      stepIndex,
      action: 'SWAP',
      targetSymbol: step.targetSymbol,
      inputAsset: step.route.inputAsset,
      outputAsset: step.route.outputAsset,
      sourceChain: step.route.sourceChain,
      destinationChain: step.route.destinationChain,
      inputAmountRaw: step.route.inputAmountRaw,
      targetValueRaw: step.route.targetValueRaw,
      outputAmountRaw: null,
      outputDecimals: null,
      minOutputRaw: null,
      route: null,
      lifiStep: null,
      status: 'FAILED',
      approvalTxHash: null,
      txHash: null,
      providerSubstatus: null,
      failureCode: 'PROVIDER_ERROR',
    };
  });
}

export type PurchaseExecutionError =
  | { kind: 'BAG_NOT_FOUND' }
  | { kind: 'NO_PUBLISHED_RECIPE' }
  | { kind: 'REGISTRY_INVALID'; details: string[] }
  | { kind: 'UNKNOWN_INPUT_ASSET' }
  | { kind: 'PREVIEW_ERROR'; message: string }
  | { kind: 'PRICE_UNAVAILABLE'; message: string }
  | { kind: 'QUOTE_FAILED'; failureCode: PurchaseIntentFailureCode; message: string }
  | { kind: 'PURCHASE_IN_PROGRESS'; intentId: string }
  | { kind: 'NOT_FOUND' }
  | { kind: 'FORBIDDEN' }
  | { kind: 'EXPIRED' }
  | { kind: 'ROUTE_CHANGED' }
  | { kind: 'INVALID_STATE'; status: string };

export type PurchaseExecutionOutcome<T> = { ok: true; value: T } | { ok: false; error: PurchaseExecutionError };

// ----------------------------- 1. Create ------------------------------------

export interface CreatePurchaseIntentParams {
  admin: SupabaseClient;
  session: SessionPayload;
  bagId: string;
  inputAssetId: string;
  amount: string;
}

/**
 * Builds a fresh `PurchaseIntent`: recomputes the SAME registry-validated,
 * allocation-derived `ExecutionPlan` `computePurchasePreview()` already
 * produces for the preview UI (spec Aşama 3 — "existing quote adapter
 * contract mümkün olduğunca korunacak"), then quotes every SWAP step
 * against the REAL session wallet address (never a client-supplied one —
 * spec Aşama 12) via `buildPurchaseIntentSteps()`. Rejects outright if the
 * same wallet already has a non-terminal intent open for this bag (spec
 * Aşama 15's "duplicate execution logic" concern applies at the "don't let
 * two purchases race" level too, not just idempotent replay of the same
 * intent id).
 */
export async function createPurchaseIntentForUser(
  params: CreatePurchaseIntentParams
): Promise<PurchaseExecutionOutcome<PurchaseIntent>> {
  const { admin, session, bagId, inputAssetId, amount } = params;

  const existing = await findActivePurchaseIntentForBag(admin, session.userId, bagId);
  if (existing) {
    return { ok: false, error: { kind: 'PURCHASE_IN_PROGRESS', intentId: existing.id } };
  }

  const bag = await getBagById(admin, bagId);
  if (!bag) return { ok: false, error: { kind: 'BAG_NOT_FOUND' } };

  const version = await getCurrentBagVersion(admin, bagId);
  if (!version) return { ok: false, error: { kind: 'NO_PUBLISHED_RECIPE' } };

  // Same registry re-verification the preview route runs — never trust that
  // a Bag verified at publish time is still verified now (spec Aşama 12:
  // "canonical registry enforcement KESİNLİKLE korunacak").
  const outputIdentityKeys = await getVerifiedIdentityKeys(admin, version.recipe.assets.map(recipeAssetIdentity));
  const registryIssues = validateRecipeAssetsAgainstRegistry(version.recipe, {
    verifiedIdentityKeys: outputIdentityKeys,
    severity: 'ERROR',
  });
  if (registryIssues.length > 0) {
    return { ok: false, error: { kind: 'REGISTRY_INVALID', details: registryIssues.map((i) => i.message) } };
  }

  // Input asset resolved by registry id ONLY — the client never supplies
  // chain/address/decimals directly (same invariant as the preview route).
  const inputAssets = await listAssets(admin, { status: 'VERIFIED' });
  const inputAsset = inputAssets.find((a) => a.id === inputAssetId);
  if (!inputAsset) return { ok: false, error: { kind: 'UNKNOWN_INPUT_ASSET' } };

  const [navOutcome, shareSupply] = await Promise.all([
    getBagNavSafe(admin, bagId, priceProvider),
    getShareSupply(admin, bagId),
  ]);

  // Real-price fail-closed guard (Phase 18): never quote/lock a purchase
  // intent against a missing, stale, or invalid price — fail the whole
  // creation instead.
  if (!navOutcome.ok) {
    return { ok: false, error: { kind: 'PRICE_UNAVAILABLE', message: navOutcome.message } };
  }
  const nav = navOutcome.nav;

  const identity: AssetIdentity = { chain: inputAsset.chain, address: inputAsset.address };
  const outcome = computePurchasePreview({
    recipe: version.recipe,
    inputAsset: identity,
    inputSymbol: inputAsset.symbol,
    inputDecimals: inputAsset.decimals,
    amount,
    nav,
    shareSupply,
  });

  if (!outcome.ok) {
    const messageByKind: Record<string, string> = {
      INVALID_AMOUNT: 'Enter a valid amount.',
      ZERO_AMOUNT: 'Deposit amount must be greater than zero.',
      INVALID_RECIPE: 'This Bag has an invalid composition.',
      NAV_UNAVAILABLE: 'NAV is currently unavailable.',
    };
    return { ok: false, error: { kind: 'PREVIEW_ERROR', message: messageByKind[outcome.error.kind] ?? 'Unable to calculate allocation.' } };
  }

  // THE Phase 17 step: quote every SWAP step against the real, connected,
  // session-authenticated wallet — never PLACEHOLDER_ADDRESS (spec Aşama
  // 1/4). `session.walletAddress` is signed into the JWT cookie at sign-in
  // (lib/auth/session.ts) — never a request-body field.
  //
  // BAG_EXECUTION_COMPILER_ENABLED branch: provider selection goes through
  // `compileBagExecution()` (lib/execution/compiler.ts) instead of this
  // file calling `buildPurchaseIntentSteps()` directly. Both branches
  // produce the EXACT same `{ steps, allSwapsQuoted, firstFailure,
  // composerTransaction }` shape, so everything below this block (fingerprint,
  // persistence, the READY/FAILED status decision) is identical either way.
  let steps: PurchaseIntentStepRecord[];
  let allSwapsQuoted: boolean;
  let firstFailure: { failureCode: 'UNSUPPORTED_ROUTE' | 'PROVIDER_ERROR'; message: string } | null;
  let composerTransaction: { to: string; data: string; value: string; chainId: number; userProxy: string } | null;
  // Non-null iff `compileBagExecution()` actually ran and produced a
  // result — see `PurchaseIntent.executionPlanHash`'s own doc and
  // supabase/migrations/0022_add_execution_plan_hash.sql: null for every
  // legacy (flag-off) intent, exactly like `composerTransaction` is null
  // for every non-Composer intent.
  let executionPlanHash: string | null = null;
  // Item 8 — what the compiled execution ACTUALLY asks of the wallet.
  // Same null-for-legacy rule as `executionPlanHash` directly above: the
  // pre-compiler path never produced a `CompiledExecution`, so it has no
  // mode to report, and the UI must not invent one on its behalf.
  let executionMode: ExecutionMode | null = null;

  if (isBagExecutionCompilerEnabled()) {
    const graph = buildBagExecutionGraph(outcome.executionPlan, {
      wallet: session.walletAddress,
      chainId: identity.chain,
      defaultSlippageBps: DEFAULT_COMPOSER_SLIPPAGE_BPS,
    });
    const bagIntent: BagExecutionIntent = {
      bagId,
      wallet: session.walletAddress,
      chainId: identity.chain,
      inputAsset: identity,
      inputAmountRaw: outcome.inputAmountRaw,
      // Same per-leg weight `buildBagExecutionGraph()` already computed —
      // reused rather than re-derived, so there is exactly ONE place
      // (`plan.ts`) that turns a raw target value into a weight.
      targets: graph.legs.map((leg) => ({ asset: leg.targetAsset, weightBps: leg.weightBps })),
      maxSlippageBps: DEFAULT_COMPOSER_SLIPPAGE_BPS,
      deadline: Date.now() + PURCHASE_INTENT_TTL_MS,
      recipeVersion: version.version,
      compositionHash: version.compositionHash,
    };
    // Same "no key means Composer is never even attempted" rule the legacy
    // `composerOptions` check above enforced — `buildDefaultProviders()`
    // simply omits `LiFiComposerProvider` from the registry entirely when
    // there's no key, rather than registering it as permanently
    // ineligible (registry.ts's own doc on this).
    // The input asset is itself a canonical token for the purposes of the
    // leg builder's registry check — it comes from `listAssets({status:
    // 'VERIFIED'})` above, but isn't necessarily one of the recipe's OWN
    // output assets, so it must be added to `outputIdentityKeys` explicitly
    // rather than assumed to already be in that set.
    const canonicalIdentityKeys = new Set(outputIdentityKeys);
    canonicalIdentityKeys.add(assetIdentityKey(identity));

    const providers = buildDefaultProviders({
      ...(process.env.LIFI_API_KEY ? { lifiComposer: { apiKey: process.env.LIFI_API_KEY } } : {}),
      bagRouter: buildBagRouterProviderConfig(canonicalIdentityKeys),
    });

    try {
      const compiled = await compileBagExecution(bagIntent, graph, providers);
      const bridged = compiledExecutionToPurchaseIntentSteps(outcome.executionPlan, compiled, inputAsset.decimals);
      steps = bridged.steps;
      allSwapsQuoted = bridged.allSwapsQuoted;
      firstFailure = bridged.firstFailure;
      composerTransaction = bridged.composerTransaction;
      executionPlanHash = compiled.executionPlanHash;
      executionMode = compiled.mode;
    } catch (err) {
      // No provider could compile this purchase at all (e.g. every
      // registered provider is ineligible or every eligible one failed to
      // compile — `compileBagExecution()`'s own doc). Still persists a
      // FAILED, fully-auditable intent row exactly like the legacy path
      // does for a per-step quote failure, rather than silently dropping
      // the attempt — same "every purchase attempt gets an auditable row"
      // guarantee, just for a failure this abstraction layer's error
      // surface doesn't (yet) attribute to one specific step.
      if (!(err instanceof BagExecutionError)) throw err;
      steps = buildAllFailedSteps(outcome.executionPlan.steps, inputAsset.decimals);
      allSwapsQuoted = false;
      firstFailure = { failureCode: 'PROVIDER_ERROR', message: err.message };
      composerTransaction = null;
    }
  } else {
    // Phase 22 — attempts a single-signature LI.FI Composer transaction
    // first (composerOptions), falling back to the sequential per-step path
    // whenever Composer isn't configured/eligible/available — see
    // tryBuildComposerSteps()'s own doc for every condition that causes a
    // fall-through. LIFI_API_KEY missing simply means this deposit never
    // attempts Composer, not an error.
    const composerOptions = process.env.LIFI_API_KEY
      ? { apiKey: process.env.LIFI_API_KEY, slippageBps: DEFAULT_COMPOSER_SLIPPAGE_BPS }
      : undefined;
    const legacy = await buildPurchaseIntentSteps(
      outcome.executionPlan.steps,
      session.walletAddress,
      inputAsset.decimals,
      composerOptions
    );
    steps = legacy.steps;
    allSwapsQuoted = legacy.allSwapsQuoted;
    firstFailure = legacy.firstFailure;
    composerTransaction = legacy.composerTransaction;
  }

  const fingerprint = computeExecutionPlanFingerprint(outcome.executionPlan);
  const expiresAt = new Date(Date.now() + PURCHASE_INTENT_TTL_MS).toISOString();

  const intent = await insertPurchaseIntent(admin, {
    userId: session.userId,
    walletAddress: session.walletAddress,
    bagId,
    inputAsset: identity,
    inputAmountRaw: outcome.inputAmountRaw,
    // Locked in NOW, from the exact DepositQuote the Purchase Preview
    // already showed this user — minted verbatim on completion (see
    // PurchaseIntent.sharesRaw's doc comment), never recomputed against a
    // possibly-moved NAV at execution time.
    sharesRaw: outcome.depositQuote.sharesRaw,
    shareDecimals: outcome.depositQuote.shareDecimals,
    routeFingerprint: fingerprint,
    // Phase 18 — locked alongside the fingerprint, re-verified at execute
    // time (see prepareExecution() below) instead of the weaker "output
    // asset set" check Phase 17 shipped with.
    recipeVersion: version.version,
    compositionHash: version.compositionHash,
    navSnapshot: { grossNav: nav.grossNav, quoteCurrency: nav.quoteCurrency, asOf: nav.asOf },
    sharePriceAtQuote: outcome.depositQuote.isBootstrap ? null : outcome.depositQuote.sharePrice,
    // Phase 20 — locked now, from the same DepositQuote the Purchase
    // Preview already showed the user, so `applyAccountingIdempotently()`
    // below has a well-defined per-investor cost-basis delta regardless of
    // whether this deposit was a bootstrap (sharePriceAtQuote null) or not.
    depositAmount: outcome.depositQuote.depositAmount,
    steps,
    composerTransaction,
    executionPlanHash,
    executionMode,
    status: allSwapsQuoted ? 'READY' : 'FAILED',
    failureCode: allSwapsQuoted ? null : (firstFailure?.failureCode ?? 'UNKNOWN_ERROR'),
    expiresAt,
  });

  if (!allSwapsQuoted && firstFailure) {
    return { ok: false, error: { kind: 'QUOTE_FAILED', failureCode: firstFailure.failureCode, message: firstFailure.message } };
  }

  return { ok: true, value: intent };
}

// ----------------------------- shared guards ---------------------------------

async function loadOwnedIntent(
  admin: SupabaseClient,
  userId: string,
  intentId: string
): Promise<PurchaseExecutionOutcome<PurchaseIntent>> {
  const result = await getPurchaseIntentForUser(admin, intentId, userId);
  if (!result.ok) {
    return { ok: false, error: { kind: result.error === 'NOT_FOUND' ? 'NOT_FOUND' : 'FORBIDDEN' } };
  }
  return { ok: true, value: result.intent };
}

function isExpired(intent: PurchaseIntent): boolean {
  return new Date(intent.expiresAt).getTime() < Date.now();
}

// ----------------------------- 2. Execute (idempotent) ------------------------

/**
 * Spec Aşama 9 — idempotent execution endpoint. If the intent has already
 * moved past `READY` (AWAITING_SIGNATURE/SUBMITTED/CONFIRMING/COMPLETED/
 * FAILED/...), this returns the EXISTING state unchanged — never creates a
 * second transaction, never re-quotes. Only a fresh `READY` intent actually
 * advances (to `AWAITING_SIGNATURE`), after re-validating it hasn't expired
 * and the Bag's current `ExecutionPlan` fingerprint still matches what this
 * intent was quoted against (spec Aşama 3/8: a changed recipe/allocation
 * invalidates an in-flight intent rather than silently executing a stale
 * route).
 */
export async function prepareExecution(
  admin: SupabaseClient,
  session: SessionPayload,
  intentId: string
): Promise<PurchaseExecutionOutcome<PurchaseIntent>> {
  const owned = await loadOwnedIntent(admin, session.userId, intentId);
  if (!owned.ok) return owned;
  const intent = owned.value;

  // Idempotent replay: already advanced (or terminal) — return as-is,
  // create nothing new (spec Aşama 9's explicit table).
  if (intent.status !== 'READY' && intent.status !== 'QUOTED' && intent.status !== 'DRAFT') {
    return { ok: true, value: intent };
  }

  if (isExpired(intent)) {
    await updatePurchaseIntentStatus(admin, { id: intentId, from: intent.status, to: 'EXPIRED', failureCode: 'ROUTE_EXPIRED' });
    return { ok: false, error: { kind: 'EXPIRED' } };
  }

  // Re-derive the CURRENT ExecutionPlan fingerprint and compare — protects
  // against the Bag's recipe changing between quote and execute.
  const bag = await getBagById(admin, intent.bagId);
  const version = bag ? await getCurrentBagVersion(admin, intent.bagId) : null;
  if (!bag || !version) {
    await updatePurchaseIntentStatus(admin, { id: intentId, from: intent.status, to: 'FAILED', failureCode: 'UNSUPPORTED_ROUTE' });
    return { ok: false, error: { kind: 'ROUTE_CHANGED' } };
  }

  // Same registry re-verification the preview/create routes run — never
  // trust that a Bag verified at creation time is still verified now.
  const currentOutputIdentityKeys = await getVerifiedIdentityKeys(admin, version.recipe.assets.map(recipeAssetIdentity));
  const registryIssues = validateRecipeAssetsAgainstRegistry(version.recipe, {
    verifiedIdentityKeys: currentOutputIdentityKeys,
    severity: 'ERROR',
  });
  if (registryIssues.length > 0) {
    await updatePurchaseIntentStatus(admin, { id: intentId, from: intent.status, to: 'FAILED', failureCode: 'UNSUPPORTED_ROUTE' });
    return { ok: false, error: { kind: 'ROUTE_CHANGED' } };
  }

  // Phase 18 — compositionHash re-check: cheapest, most specific signal
  // that the Bag's recipe itself changed since this intent was quoted
  // (types/purchase-intent.ts's `PurchaseIntent.compositionHash` doc).
  if (version.compositionHash !== intent.compositionHash) {
    await updatePurchaseIntentStatus(admin, { id: intentId, from: intent.status, to: 'FAILED', failureCode: 'ROUTE_EXPIRED' });
    return { ok: false, error: { kind: 'ROUTE_CHANGED' } };
  }

  // Phase 18 — full ExecutionPlan re-derivation and fingerprint compare.
  // Supersedes the Phase 17 "output asset set" check: that only caught an
  // asset being added/removed, never a reweighting between the SAME
  // assets, a changed source/destination chain, or any other allocation-
  // math difference a still-matching compositionHash wouldn't itself
  // catch (compositionHash covers the recipe's declared composition, not
  // what `buildExecutionPlan()` derives from it plus the input asset/
  // amount). Reconstructible EXACTLY, with no precision loss, because
  // `DepositRequest.amountRaw` (unlike `computePurchasePreview()`'s human
  // `amount` string) takes the same raw integer string `intent
  // .inputAmountRaw` already is — no round-trip through a human decimal
  // string is needed here, so nothing is approximated.
  let currentPlan: import('@/types/basket-protocol').DepositPlan;
  let currentFingerprint: string;
  try {
    currentPlan = calculateDepositAllocation(
      { bagId: intent.bagId, inputAsset: intent.inputAsset, amountRaw: intent.inputAmountRaw },
      version.recipe
    );
    currentFingerprint = computeExecutionPlanFingerprint(buildExecutionPlan(currentPlan));
  } catch (err) {
    if (err instanceof InvalidRecipeWeightsError) {
      await updatePurchaseIntentStatus(admin, { id: intentId, from: intent.status, to: 'FAILED', failureCode: 'UNSUPPORTED_ROUTE' });
      return { ok: false, error: { kind: 'ROUTE_CHANGED' } };
    }
    throw err;
  }

  if (currentFingerprint !== intent.routeFingerprint) {
    await updatePurchaseIntentStatus(admin, { id: intentId, from: intent.status, to: 'FAILED', failureCode: 'ROUTE_EXPIRED' });
    return { ok: false, error: { kind: 'ROUTE_CHANGED' } };
  }

  // BAG_EXECUTION_COMPILER_ENABLED — the execute-time half of the
  // `executionPlanHash` lifecycle supabase/migrations/0022_add_execution_plan_hash.sql
  // and `PurchaseIntent.executionPlanHash`'s own doc already describe:
  // `intent.executionPlanHash` is non-null only for an intent CREATED
  // while the flag was on (see createPurchaseIntentForUser above); for
  // such an intent, this re-derives the CURRENT `BagExecutionGraph`'s hash
  // and compares. This is a genuine ADDITIONAL check, not a repeat of the
  // `routeFingerprint` compare above: that one proves the recipe/plan
  // hasn't changed (pre-compiler `ExecutionPlan` shape); this one proves
  // the compiler-layer `BagExecutionGraph` derived from that SAME plan is
  // still the one this intent's steps were actually compiled from. A
  // legacy (flag-off-at-create) intent has `executionPlanHash === null`
  // and skips this block entirely, exactly as the migration doc says.
  // The intent's own provenance decides whether this integrity check applies,
  // not the CURRENT feature-flag state. A compiler-created intent must remain
  // protected even if the rollout flag is later turned off or rolled back;
  // otherwise a stale/tampered graph could bypass the hash check merely by
  // disabling the feature flag between create and execute. Legacy intents have
  // a null hash and naturally skip this block.
  if (intent.executionPlanHash) {
    const graph = buildBagExecutionGraph(buildExecutionPlan(currentPlan), {
      wallet: intent.walletAddress,
      chainId: intent.inputAsset.chain,
      defaultSlippageBps: DEFAULT_COMPOSER_SLIPPAGE_BPS,
    });
    const currentGraphHash = computeBagExecutionGraphHash(graph);
    if (currentGraphHash !== intent.executionPlanHash) {
      await updatePurchaseIntentStatus(admin, { id: intentId, from: intent.status, to: 'FAILED', failureCode: 'VERIFICATION_FAILED' });
      return { ok: false, error: { kind: 'ROUTE_CHANGED' } };
    }

    // Second, independent invariant using `purchaseIntentToBagExecutionIntent()`
    // for real (not left as an unused helper — that function's own doc):
    // the STORED intent's own steps, translated back into
    // `BagExecutionTarget[]`, must still name the same assets in the same
    // weights as the FRESHLY rebuilt graph's legs. The hash check above
    // already implies this in practice, but this checks it independently,
    // via a completely different code path (per-field comparison instead
    // of hash equality) — the kind of redundant, cheap-to-run invariant
    // that is worth having specifically because this code moves real
    // money.
    const bagIntent = purchaseIntentToBagExecutionIntent(
      intent,
      intent.inputAsset.chain,
      DEFAULT_COMPOSER_SLIPPAGE_BPS,
      new Date(intent.expiresAt).getTime()
    );
    const targetsMatch =
      bagIntent.targets.length === graph.legs.length &&
      bagIntent.targets.every((target, i) => {
        const leg = graph.legs[i];
        return (
          target.asset.chain === leg.targetAsset.chain &&
          target.asset.address === leg.targetAsset.address &&
          target.weightBps === leg.weightBps
        );
      });
    if (!targetsMatch) {
      await updatePurchaseIntentStatus(admin, { id: intentId, from: intent.status, to: 'FAILED', failureCode: 'VERIFICATION_FAILED' });
      return { ok: false, error: { kind: 'ROUTE_CHANGED' } };
    }
  }

  const toStatus = intent.status === 'DRAFT' ? 'QUOTED' : intent.status === 'QUOTED' ? 'READY' : 'AWAITING_SIGNATURE';
  const updated = await updatePurchaseIntentStatus(admin, { id: intentId, from: intent.status, to: toStatus });
  if (!updated) {
    // Lost the race to another concurrent request — re-read and return
    // whatever the winner left behind (still idempotent from the caller's
    // point of view).
    const latest = await getPurchaseIntentForUser(admin, intentId, session.userId);
    return latest.ok ? { ok: true, value: latest.intent } : { ok: false, error: { kind: 'NOT_FOUND' } };
  }

  // READY -> AWAITING_SIGNATURE may need two hops (READY was the initial
  // create status) — recurse once to finish reaching AWAITING_SIGNATURE.
  if (updated.status !== 'AWAITING_SIGNATURE') {
    return prepareExecution(admin, session, intentId);
  }

  return { ok: true, value: updated };
}

// ----------------------------- 3. Per-step client report -----------------------

export type StepReportEvent =
  | { type: 'APPROVAL_REQUIRED' }
  | { type: 'APPROVAL_AWAITING_SIGNATURE' }
  | { type: 'APPROVAL_SUBMITTED'; txHash: string }
  | { type: 'APPROVAL_CONFIRMED' }
  | { type: 'AWAITING_SIGNATURE' }
  | { type: 'SUBMITTED'; txHash: string }
  | { type: 'REJECTED'; failureCode: 'USER_REJECTED' }
  | { type: 'FAILED'; failureCode: PurchaseIntentFailureCode; message?: string };

/**
 * Records what happened for ONE step, as reported by the client wallet
 * flow. Deliberately CANNOT mark a step `COMPLETED` — that only ever
 * happens via `verifyExecution()`'s on-chain check (spec section 12/13:
 * "Fake success" yok — a client claiming success is not evidence of
 * success; `StepReportEvent`'s type has no `COMPLETED` variant, and
 * .../report/route.ts's `parseEvent()` allow-list rejects any request body
 * that tries to claim one at the HTTP layer too — defense at both the
 * type system AND the wire boundary, not just one).
 *
 * A rejection/failure on THIS step fails the whole intent immediately only
 * if no OTHER step has ever been submitted on-chain (Phase 18: if another
 * step DOES already have a real `txHash` in flight, that transaction could
 * still land successfully regardless of this one being rejected/reverted
 * — finalizing the intent here would permanently stop `verifyExecution()`
 * from ever polling and reconciling it, silently losing whatever that
 * other step actually delivers on-chain). In that case this function only
 * records the step's own failure and leaves the intent's own status alone
 * — `verifyExecution()`'s mixed-outcome handling (PARTIAL_SUCCESS /
 * RECONCILIATION_REQUIRED) is what decides the intent's fate once every
 * step has reached a terminal per-step state.
 */
export async function recordStepEvent(
  admin: SupabaseClient,
  session: SessionPayload,
  intentId: string,
  stepIndex: number,
  event: StepReportEvent
): Promise<PurchaseExecutionOutcome<PurchaseIntent>> {
  const owned = await loadOwnedIntent(admin, session.userId, intentId);
  if (!owned.ok) return owned;
  const intent = owned.value;

  if (intent.status !== 'AWAITING_SIGNATURE' && intent.status !== 'SUBMITTED') {
    return { ok: false, error: { kind: 'INVALID_STATE', status: intent.status } };
  }

  const step = intent.steps[stepIndex];
  if (!step) return { ok: false, error: { kind: 'NOT_FOUND' } };
  if (step.action !== 'SWAP') return { ok: false, error: { kind: 'INVALID_STATE', status: step.status } };

  const nextStepStatus =
    event.type === 'REJECTED' || event.type === 'FAILED' ? 'FAILED' : event.type;

  if (!isValidPurchaseIntentStepTransition(step.status, nextStepStatus)) {
    return { ok: false, error: { kind: 'INVALID_STATE', status: step.status } };
  }
  assertValidPurchaseIntentStepTransition(stepIndex, step.status, nextStepStatus);

  const updatedStep: PurchaseIntentStepRecord = {
    ...step,
    status: nextStepStatus,
    approvalTxHash: event.type === 'APPROVAL_SUBMITTED' ? event.txHash : step.approvalTxHash,
    txHash: event.type === 'SUBMITTED' ? event.txHash : step.txHash,
    failureCode:
      event.type === 'REJECTED' ? event.failureCode : event.type === 'FAILED' ? event.failureCode : step.failureCode,
  };

  const nextSteps = intent.steps.map((s, i) => (i === stepIndex ? updatedStep : s));
  const updatedIntent = await updatePurchaseIntentSteps(admin, intentId, intent.status, nextSteps);
  if (!updatedIntent) return { ok: false, error: { kind: 'INVALID_STATE', status: intent.status } };

  // First real submission of any step moves the whole intent from
  // AWAITING_SIGNATURE -> SUBMITTED (spec Aşama 6's UI state list).
  if (event.type === 'SUBMITTED' && updatedIntent.status === 'AWAITING_SIGNATURE') {
    const advanced = await updatePurchaseIntentStatus(admin, { id: intentId, from: 'AWAITING_SIGNATURE', to: 'SUBMITTED' });
    if (advanced) return { ok: true, value: advanced };
  }

  if (nextStepStatus === 'FAILED') {
    // Phase 18: don't finalize the whole intent here if a DIFFERENT step
    // already has a real transaction in flight — that transaction's
    // outcome must still be reconciled, not discarded (see this
    // function's doc comment above).
    const anotherStepAlreadySubmitted = updatedIntent.steps.some(
      (s, i) => i !== stepIndex && s.action === 'SWAP' && s.txHash !== null
    );
    if (!anotherStepAlreadySubmitted) {
      const failureCode = event.type === 'REJECTED' ? event.failureCode : event.type === 'FAILED' ? event.failureCode : 'UNKNOWN_ERROR';
      const failed = await updatePurchaseIntentStatus(admin, {
        id: intentId,
        from: updatedIntent.status,
        to: 'FAILED',
        failureCode,
      });
      if (failed) return { ok: true, value: failed };
    }
  }

  return { ok: true, value: updatedIntent };
}

// ----------------------------- 4. Verify + accounting (idempotent) -------------

/**
 * Polls on-chain status for every SUBMITTED SWAP step (spec Aşama 7), and
 * only once EVERY step is confirmed `DONE` with its received asset matching
 * the registry-verified expected asset (spec Aşama 10) does it apply
 * accounting — atomically, via `apply_purchase_execution()` — and mark the
 * intent `COMPLETED`. `accountingAppliedAt` is checked BEFORE calling the
 * RPC, so a retried/racing call never double-applies (spec Aşama 11).
 */
export async function verifyExecution(
  admin: SupabaseClient,
  session: SessionPayload,
  intentId: string
): Promise<PurchaseExecutionOutcome<PurchaseIntent>> {
  const owned = await loadOwnedIntent(admin, session.userId, intentId);
  if (!owned.ok) return owned;
  let intent = owned.value;

  // Idempotent: already terminal — nothing to do.
  if (
    intent.status === 'COMPLETED' ||
    intent.status === 'RECONCILIATION_REQUIRED' ||
    intent.status === 'FAILED' ||
    intent.status === 'CANCELLED' ||
    intent.status === 'EXPIRED'
  ) {
    return { ok: true, value: intent };
  }
  // Phase 18 — PARTIAL_SUCCESS is a valid re-entry point: if a previous
  // call transitioned the intent to PARTIAL_SUCCESS but crashed/failed
  // before `reconcilePartialExecution()` finished (RPC call, or the
  // follow-up status write to RECONCILIATION_REQUIRED), a retried call
  // must resume reconciliation rather than being rejected as an invalid
  // state — `reconcilePartialExecution()` itself is idempotent either way.
  if (intent.status === 'PARTIAL_SUCCESS') {
    return { ok: true, value: await reconcilePartialExecution(admin, intent) };
  }
  if (intent.status !== 'SUBMITTED' && intent.status !== 'CONFIRMING') {
    return { ok: false, error: { kind: 'INVALID_STATE', status: intent.status } };
  }

  // Phase 22 — a Composer-executed intent has ONE shared receipt to check,
  // not N independent LI.FI-tracked routes: fetch it once here rather than
  // once per step inside the map below (same on-chain answer either way,
  // this just avoids N redundant RPC calls for what is, atomically, one
  // transaction).
  let composerOutcome: Awaited<ReturnType<typeof trackComposerTransaction>> | null = null;
  if (intent.composerTransaction) {
    const anySubmittedStep = intent.steps.find((s) => s.action === 'SWAP' && s.txHash);
    if (anySubmittedStep?.txHash) {
      composerOutcome = await trackComposerTransaction({
        txHash: anySubmittedStep.txHash,
        chain: anySubmittedStep.sourceChain,
        recipient: intent.walletAddress,
      });
    }
  }

  const nextSteps: PurchaseIntentStepRecord[] = await Promise.all(
    intent.steps.map(async (step): Promise<PurchaseIntentStepRecord> => {
      if (step.action === 'KEEP' || step.status === 'COMPLETED' || step.status === 'FAILED') return step;
      if (!step.txHash) return step; // not submitted yet — nothing to check

      // Composer path — see composer-status.ts's own doc for why this is a
      // direct receipt check, not LI.FI's getStatus(). Same
      // "VERIFICATION_FAILED on any asset mismatch, credit only what was
      // actually received" rule as the sequential path below, just
      // sourced from an on-chain Transfer log instead of a LI.FI status
      // response.
      if (composerOutcome) {
        if (composerOutcome.kind === 'PENDING') {
          return { ...step, status: 'CONFIRMING' };
        }
        if (composerOutcome.kind === 'FAILED') {
          return { ...step, status: 'FAILED', failureCode: composerOutcome.failureCode };
        }
        const received = composerOutcome.receivedAmountsByAddress[step.outputAsset.address.toLowerCase()];
        if (received === undefined) {
          return { ...step, status: 'FAILED', failureCode: 'VERIFICATION_FAILED' };
        }
        return { ...step, status: 'COMPLETED', providerSubstatus: 'COMPLETED', outputAmountRaw: received };
      }

      const outcome = await trackStepStatus({
        txHash: step.txHash,
        sourceChain: step.sourceChain,
        destinationChain: step.destinationChain,
        tool: step.route,
        expectedOutputAsset: step.outputAsset,
      });

      if (outcome.kind === 'PENDING') {
        return { ...step, status: 'CONFIRMING', providerSubstatus: outcome.substatus };
      }
      if (outcome.kind === 'FAILED') {
        return { ...step, status: 'FAILED', failureCode: outcome.failureCode };
      }
      // DONE — but only a genuine asset match counts as verified success
      // (spec Aşama 10: wrong destination asset => FAILED/VERIFICATION_FAILED,
      // never silently accepted).
      if (!outcome.matchesExpectedAsset) {
        return { ...step, status: 'FAILED', failureCode: 'VERIFICATION_FAILED' };
      }
      // Accounting below credits whatever was ACTUALLY received on-chain,
      // never the pre-execution quote estimate — a real swap's output can
      // differ from `minOutputRaw`/`outputAmountRaw`'s original quote by up
      // to the step's slippage tolerance, and crediting the bag with the
      // estimate rather than the verified receipt would let a worse-than-
      // quoted fill silently overstate what the bag actually holds.
      return {
        ...step,
        status: 'COMPLETED',
        providerSubstatus: 'COMPLETED',
        outputAmountRaw: outcome.receivedAmountRaw ?? step.outputAmountRaw,
      };
    })
  );

  const stepsChanged = JSON.stringify(nextSteps) !== JSON.stringify(intent.steps);
  if (stepsChanged) {
    const updated = await updatePurchaseIntentSteps(admin, intentId, intent.status, nextSteps);
    if (updated) intent = updated;
  }

  // Phase 18 — never finalize the intent while ANY SWAP step hasn't yet
  // reached a terminal per-step outcome (COMPLETED or FAILED): a step
  // still PENDING/CONFIRMING could still land on-chain and deliver real
  // assets after we've already decided the intent's fate, which is
  // exactly what the old "first failure wins" logic below this comment
  // used to risk losing.
  const swapSteps = intent.steps.filter((s) => s.action === 'SWAP');
  const stillInFlight = swapSteps.some((s) => s.status !== 'COMPLETED' && s.status !== 'FAILED');

  if (stillInFlight) {
    if (intent.status === 'SUBMITTED') {
      const confirming = await updatePurchaseIntentStatus(admin, { id: intentId, from: 'SUBMITTED', to: 'CONFIRMING' });
      return { ok: true, value: confirming ?? intent };
    }
    return { ok: true, value: intent }; // still confirming, nothing new to report
  }

  const anyCompleted = swapSteps.some((s) => s.status === 'COMPLETED');
  const anyFailed = swapSteps.some((s) => s.status === 'FAILED');

  if (anyFailed && anyCompleted) {
    // Mixed, final outcome: at least one SWAP step's assets are verifiably
    // on-chain (matched the expected asset — see the DONE branch above),
    // at least one genuinely failed, and nothing is left pending. Never
    // collapse this into plain FAILED (would discard the verified
    // holdings the succeeding steps actually received) and never silently
    // COMPLETE it either (would mint the full quoted shares against a
    // deposit that was only partially fulfilled) — PARTIAL_SUCCESS is its
    // own state; reconcilePartialExecution() credits exactly the verified
    // portion and stops at RECONCILIATION_REQUIRED.
    const partial = await updatePurchaseIntentStatus(admin, { id: intentId, from: intent.status, to: 'PARTIAL_SUCCESS' });
    return { ok: true, value: await reconcilePartialExecution(admin, partial ?? intent) };
  }

  if (anyFailed) {
    // Every SWAP step failed — nothing was ever received on-chain, so a
    // plain FAILED (no accounting applied at all) is the correct, complete
    // outcome, same as before Phase 18.
    const failedStep = swapSteps.find((s) => s.status === 'FAILED');
    const failed = await updatePurchaseIntentStatus(admin, {
      id: intentId,
      from: intent.status,
      to: 'FAILED',
      failureCode: failedStep?.failureCode ?? 'UNKNOWN_ERROR',
    });
    return { ok: true, value: failed ?? intent };
  }

  // Every SWAP step COMPLETED (KEEP steps are always NOT_NEEDED/trivially
  // done) — apply the FULL accounting exactly once.
  if (!intent.accountingAppliedAt) {
    await applyAccountingIdempotently(admin, intent);
  }

  const completed = await updatePurchaseIntentStatus(admin, {
    id: intentId,
    from: intent.status,
    to: 'COMPLETED',
    executedAt: new Date().toISOString(),
  });
  return { ok: true, value: completed ?? intent };
}

/**
 * Phase 18 — credits `bag_holdings` for exactly the SWAP steps that
 * genuinely completed on-chain (verified by `trackStepStatus()` inside
 * `verifyExecution()` above — never a client-reported success) plus any
 * KEEP allocations (never routed/never failable — see
 * lib/blockchain/lifi-execution-adapter.ts's module doc), for an intent
 * that ended in a mixed COMPLETED/FAILED outcome. Deliberately does NOT
 * mint any shares — see `RECONCILIATION_REQUIRED`'s doc comment on
 * `PURCHASE_INTENT_STATUSES` (types/purchase-intent.ts) for why inventing
 * a partial share-mint or refund here would be worse than stopping and
 * leaving the verified state visible for a follow-up process.
 *
 * Idempotent via `reconciliation_applied_at`, checked and set inside
 * `apply_partial_purchase_execution()` under the same row-lock pattern
 * `apply_purchase_execution()` already uses (see its own doc comment on
 * `applyAccountingIdempotently()` below) — a retried/racing call never
 * double-credits.
 */
async function reconcilePartialExecution(admin: SupabaseClient, intent: PurchaseIntent): Promise<PurchaseIntent> {
  if (!intent.reconciliationAppliedAt) {
    const completedSwapHoldings = intent.steps
      .filter((s) => s.action === 'SWAP' && s.status === 'COMPLETED' && s.outputAmountRaw && s.outputDecimals !== null)
      .map((s) => ({
        chain: s.outputAsset.chain,
        address: s.outputAsset.address,
        decimals: s.outputDecimals as number,
        delta_raw: s.outputAmountRaw as string,
      }));
    const keepHoldings = intent.steps
      .filter((s) => s.action === 'KEEP' && s.outputDecimals !== null)
      .map((s) => ({
        chain: s.outputAsset.chain,
        address: s.outputAsset.address,
        decimals: s.outputDecimals as number,
        delta_raw: s.inputAmountRaw,
      }));

    const { error: partialRpcError } = await admin.rpc('apply_partial_purchase_execution', {
      p_intent_id: intent.id,
      p_bag_id: intent.bagId,
      p_holdings: [...completedSwapHoldings, ...keepHoldings],
      p_user_id: intent.userId,
    });
    // Never advance to RECONCILIATION_REQUIRED (which implies "verified
    // holdings are now recorded") if the RPC itself reported an error —
    // that would misrepresent what actually happened. Left in
    // PARTIAL_SUCCESS, a retried verifyExecution() call re-enters this
    // same function and tries again (idempotent either way).
    if (partialRpcError) throw new Error(`apply_partial_purchase_execution failed: ${partialRpcError.message}`);

    await markReconciliationApplied(admin, intent.id);
  }

  const reconciled = await updatePurchaseIntentStatus(admin, {
    id: intent.id,
    from: 'PARTIAL_SUCCESS',
    to: 'RECONCILIATION_REQUIRED',
  });
  return reconciled ?? intent;
}

/**
 * Applies holdings + share-mint accounting for one fully-verified intent,
 * via the atomic, self-idempotent `apply_purchase_execution()` RPC
 * (supabase/migrations/0004_add_purchase_intents.sql — it takes its own row
 * lock on `purchase_intents` and checks `accounting_applied_at` itself, so
 * this function is safe to call even if two `verifyExecution()` calls race
 * — only one of them will actually write, the other gets `alreadyApplied:
 * true` back). `markAccountingApplied()` is still called afterwards purely
 * so the in-process `PurchaseIntent` this function's caller already holds
 * reflects the new state without a second round trip — it is belt-and-
 * suspenders, not the source of truth for the guard.
 */
async function applyAccountingIdempotently(admin: SupabaseClient, intent: PurchaseIntent): Promise<void> {
  if (intent.accountingAppliedAt) return;

  // SWAP steps credit the asset they actually swapped INTO.
  const swapHoldings = intent.steps
    .filter((s) => s.action === 'SWAP' && s.status === 'COMPLETED' && s.outputAmountRaw && s.outputDecimals !== null)
    .map((s) => ({
      chain: s.outputAsset.chain,
      address: s.outputAsset.address,
      decimals: s.outputDecimals as number,
      delta_raw: s.outputAmountRaw as string,
    }));

  // KEEP steps stay as the input asset itself — their value was never
  // routed anywhere, so they credit bag_holdings directly with the exact
  // portion of the deposit this step allocated. `outputDecimals` is set at
  // intent-creation time to the INPUT asset's decimals for every KEEP step
  // (see lib/blockchain/lifi-purchase-quote.ts — a KEEP step's
  // outputAsset === inputAsset by construction), so this never guesses.
  const keepHoldings = intent.steps
    .filter((s) => s.action === 'KEEP' && s.outputDecimals !== null)
    .map((s) => ({
      chain: s.outputAsset.chain,
      address: s.outputAsset.address,
      decimals: s.outputDecimals as number,
      delta_raw: s.inputAmountRaw,
    }));

  const holdings = [...swapHoldings, ...keepHoldings];

  // Phase 22, Layer 3 — fork royalty. Resolved fresh here (never trusted
  // from the client): only paid when THIS bag has a root_bag_id (i.e. it's
  // a fork), and to the ROOT bag's creator specifically — not this bag's
  // own creator (a fork's own creatorId is whoever forked it, a different
  // person in the common case).
  let rootCreatorId: string | null = null;
  const bag = await getBagById(admin, intent.bagId);
  if (bag?.rootBagId) {
    const rootBag = await getBagById(admin, bag.rootBagId);
    rootCreatorId = rootBag?.creatorId ?? null;
  }

  const { error: rpcError } = await admin.rpc('apply_purchase_execution', {
    p_intent_id: intent.id,
    p_bag_id: intent.bagId,
    p_holdings: holdings,
    p_shares_delta_raw: intent.sharesRaw,
    p_share_decimals: intent.shareDecimals,
    p_user_id: intent.userId,
    // Phase 20 — this depositor's bag_investor_positions cost-basis delta;
    // see depositAmount's doc comment on PurchaseIntent for why this value
    // (not a sharePriceAtQuote * sharesRaw derivation) is used.
    p_cost_basis_delta: intent.depositAmount,
    p_fork_royalty_bps: rootCreatorId ? FORK_ROYALTY_BPS : 0,
    p_root_creator_id: rootCreatorId,
  });
  // Same reasoning as reconcilePartialExecution() above: never mark
  // accounting applied (-> COMPLETED) on the strength of an RPC call that
  // itself reported failure.
  //
  // 0017 — apply_purchase_execution() now inserts the matching
  // creator_reward_settlements row itself, atomically, in the SAME
  // transaction as the royalty's own activities row (see that migration's
  // module doc: an earlier version of this bridge done here in
  // TypeScript, as a second statement after this RPC call, had a real
  // crash-window bug — a process crash between the two statements meant
  // the royalty could never get a settlement row via the normal path
  // again). Nothing left to do here.
  if (rpcError) throw new Error(`apply_purchase_execution failed: ${rpcError.message}`);

  await markAccountingApplied(admin, intent.id);
}
