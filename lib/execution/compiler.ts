import { BagExecutionError } from './errors';
import { assertValidExecutionGraph, computeBagExecutionGraphHash } from './plan';
import { BagExecutionGraph, BagExecutionIntent, CompiledExecution } from './types';
import { BagExecutionProvider } from './providers/types';

// -----------------------------------------------------------------------------
// lib/execution/compiler.ts
//
// `compileBagExecution()` — spec item 3's compiler. Takes a
// provider-independent intent + graph and an ORDERED list of registered
// providers, and returns a normalized `CompiledExecution`. Never imports or
// references a specific provider package (LI.FI or otherwise) — see
// providers/types.ts's module doc.
//
// Provider order IS the fallback policy (spec item 6: "Composer uygunsa
// Composer provider, uygun değilse normal LI.FI provider, ..."). Callers
// wire that policy up by the ORDER they pass providers in — this file
// itself has no opinion on which provider should come first; see
// lib/execution/registry.ts for where BAG's own default order lives (not
// hardcoded here, so a test can pass a different order without touching
// this file).
// -----------------------------------------------------------------------------

/**
 * Compiles `intent` against `graph`, trying every ELIGIBLE provider (in
 * `providers` order — see `registry.ts`) in turn until one's `compile()`
 * succeeds. This is the generalized form of the legacy
 * `tryBuildComposerSteps()` → sequential fallback (spec item 6/9's
 * "Composer başarısız/ineligible olduğunda sequential fallback çalışıyor
 * mu?"): a provider that claimed `supports() === true` but then fails to
 * actually compile (network error, quote/simulation failure) does NOT abort
 * the whole call — the compiler moves on to the next eligible provider,
 * exactly the way a real Composer outage degrades to the sequential path
 * today. Throws:
 *   - `UNSATISFIABLE_CONSTRAINTS` if `intent.constraints.atomic` is set and
 *     at least one provider is otherwise eligible, but none of the eligible
 *     ones support `atomic` — checked BEFORE compiling, so a non-atomic
 *     provider is never even asked.
 *   - `NO_ELIGIBLE_PROVIDER` if no provider (after `allowedProviders`
 *     filtering, if set) supports this intent/graph at all.
 *   - `PROVIDER_COMPILE_FAILED` only once EVERY eligible provider's
 *     `compile()` has thrown — carries every provider's failure message
 *     (`details.compileFailures`), not just the last one.
 */
export async function compileBagExecution(
  intent: BagExecutionIntent,
  graph: BagExecutionGraph,
  providers: readonly BagExecutionProvider[]
): Promise<CompiledExecution> {
  assertValidExecutionGraph(graph);

  const allowList = intent.constraints?.allowedProviders;
  const candidates = allowList ? providers.filter((p) => allowList.includes(p.identify())) : providers;

  const eligible = candidates.filter((p) => {
    if (intent.constraints?.atomic && !p.getCapabilities().atomic) return false;
    return p.supports(intent, graph);
  });

  if (eligible.length === 0) {
    if (intent.constraints?.atomic && candidates.some((p) => p.supports(intent, graph))) {
      throw new BagExecutionError(
        'UNSATISFIABLE_CONSTRAINTS',
        'An eligible provider exists for this intent, but none of them support atomic (single-transaction) execution.'
      );
    }
    throw new BagExecutionError(
      'NO_ELIGIBLE_PROVIDER',
      `No registered execution provider supports this intent (chain=${intent.chainId}, targets=${intent.targets.length}).`,
      { candidateIds: candidates.map((p) => p.identify()) }
    );
  }

  const executionPlanHash = computeBagExecutionGraphHash(graph);
  const compileFailures: { providerId: string; message: string }[] = [];

  for (const provider of eligible) {
    try {
      const compiled = await provider.compile(intent, graph);
      // Providers report their own `providerId`/`executionPlanHash` inside
      // `compile()` too (they have to, to satisfy the `CompiledExecution`
      // shape) — the compiler re-stamps both here from what IT knows to be
      // true, so a provider bug (wrong id, stale hash) can never leak a
      // mismatched value past this seam.
      return { ...compiled, providerId: provider.identify(), executionPlanHash };
    } catch (err) {
      compileFailures.push({ providerId: provider.identify(), message: (err as Error).message ?? String(err) });
      // Fall through to the next eligible provider — same "degrade, don't
      // abort" behavior `tryBuildComposerSteps()` already has for Composer
      // specifically, generalized across however many providers are
      // registered.
    }
  }

  throw new BagExecutionError(
    'PROVIDER_COMPILE_FAILED',
    `Every eligible provider failed to compile this execution: ${compileFailures.map((f) => `${f.providerId}: ${f.message}`).join('; ')}`,
    { compileFailures }
  );
}
