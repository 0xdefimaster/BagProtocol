# BAG execution layer — current status

This directory is BAG’s provider-independent “Intent → Portfolio Execution”
layer. It sits above the existing purchase-intent / LI.FI flow and provides a
provider-neutral execution graph, ordered provider fallback, compilation, and
a persistence bridge back into the existing `PurchaseIntent` shape.

## Current implementation status

Items **1–6 are implemented and wired behind** `BAG_EXECUTION_COMPILER_ENABLED`.
The legacy path remains the default when the flag is absent or not `true`.

| File | Role |
|---|---|
| `types.ts` | `BagExecutionIntent`, `BagExecutionGraph`/`BagExecutionLeg`, `CompiledExecution`, `ExecutionMode` |
| `errors.ts` | `BagExecutionError` + typed codes |
| `plan.ts` | Existing `ExecutionPlan` → `BagExecutionGraph`, `PurchaseIntent` → `BagExecutionIntent`, graph validation + hashing |
| `compiler.ts` | Provider capability filtering, ordered fallback, compile-error fallback, error mapping, final `executionPlanHash` stamping |
| `providers/types.ts` | `BagExecutionProvider` interface + `ProviderCapabilities` |
| `providers/lifi-composer-provider.ts` | Existing LI.FI Composer flow wrapped as a `SINGLE_TX` provider |
| `providers/lifi-sequential-provider.ts` | Existing per-leg LI.FI quote flow wrapped as `MULTI_TX` / `CROSS_CHAIN` fallback |
| `registry.ts` | Default provider order: Composer → sequential LI.FI; Composer is omitted when its API key is unavailable |
| `purchase-intent-bridge.ts` | Converts provider-independent `CompiledExecution` back to the existing persisted `PurchaseIntent` step shape |
| `lib/server/purchase-execution.ts` | Real feature-flagged integration; persists `executionPlanHash` and verifies it again at execute time |
| `__tests__/compiler.test.ts` | Compiler selection, constraints, provider-throw fallback, hash behavior |
| `lib/server/__tests__/purchase-execution.test.ts` | Live-path wiring, Composer/sequential mapping, failure persistence, legacy isolation, hash lifecycle |

### Important fallback behavior

`compileBagExecution()` does **not** stop at the first provider whose
`supports()` returns `true`. It tries every eligible provider in registry order.
If Composer is eligible but `compile()` throws, the next eligible provider is
attempted. Only when every eligible provider fails does the compiler return
`PROVIDER_COMPILE_FAILED`.

A sequential provider’s **individual leg quote failure is not a compiler-level
provider failure**. The provider returns per-leg outcomes in
`providerMetadata.legResults`, and the bridge recreates the existing per-step
FAILED/quoted persistence semantics.

## Execution-plan integrity

When the compiler path creates an intent, `CompiledExecution.executionPlanHash`
is persisted to `purchase_intents.execution_plan_hash` by migration
`0022_add_execution_plan_hash.sql`. At execute time, a fresh
`BagExecutionGraph` is rebuilt and its hash is compared with the stored value.
This check is driven by the **intent’s non-null stored hash**, not by the current
feature-flag state, so disabling the rollout flag later cannot silently remove
the integrity check from an already compiler-created intent. Legacy intents have
a null hash and skip this compiler-layer check.

The existing `routeFingerprint` and `compositionHash` checks remain in place;
the graph hash is an additional compiler-layer integrity invariant, not a
replacement for them.

## Known limitation

`LiFiSequentialProvider.compile()` deliberately returns `transactions: []`.
Existing sequential LI.FI quotes carry an opaque `lifiStep` which the browser
turns into executable/signed transactions through the existing
`hooks/use-purchase-execution.ts` + `@lifi/sdk` flow. The compiler layer preserves
that payload instead of duplicating the client-side route conversion server-side.

## Not implemented yet

**Item 7 — BAG-native Router: IMPLEMENTED.** See
`contracts/BagExecutionRouter.sol` (trust boundary, allowlists, EIP-712
plan binding, delta-based output verification) and
`providers/bag-router-provider.ts` (the same `BagExecutionProvider` seam —
no second execution abstraction). `contracts/spike/BagRouterSpike.sol` is
untouched and remains spike-only; it must never move real funds (it accepts
an arbitrary `target`, so its leg calldata can be pointed at an ERC-20 to
spend another user's leftover allowance, and it verifies output with an
absolute `balanceOf`, so donated tokens satisfy a minimum its legs never
produced — both are explicitly tested as rejected in the new router).

The router is registered ONLY when a deployment configures it
(`DefaultProvidersConfig.bagRouter`: a deployed address, a leg builder, and
a plan signer). Absent that config, `buildDefaultProviders()` returns
exactly what it returned before, so the `BAG_EXECUTION_COMPILER_ENABLED`
rollout behaviour is unchanged.

Still open within item 7's boundary, deliberately: the `legBuilder` is an
injected dependency with no production implementation yet (building real
DEX calldata is a routing concern, and fabricating it here is the failure
mode the 19.X spikes exist to avoid), and no deployment/address config or
migration is wired up — nothing constructs a `BagRouterProvider` in
application code yet.

**Item 8 — UI signaling: IMPLEMENTED.** `CompiledExecution.mode` was
previously computed and then discarded at the bridge, so nothing
downstream could see it and the purchase modal told every user the same
singular sentence ("signs and sends a real transaction") whether the
compiled result was one Composer transaction or a sequential plan needing
an approval plus a swap per leg. The mode is now persisted
(`purchase_intents.execution_mode`,
`supabase/migrations/0023_add_execution_mode.sql`, null for legacy
flag-off intents) and surfaced through `signing-expectation.ts`'s
`deriveSigningExpectation()` — one pure function, the single place that
decides "how many wallet confirmations is this?".

Two honesty rules it enforces, both tested: never under-report (a
MULTI_TX plan states its real count, approval included), and never
over-claim precision (`CROSS_CHAIN` and legacy null-mode intents return
`exact: false` and describe rather than assert a number). It also refuses
to conflate "one transaction" with "one confirmation" — SINGLE_TX still
reports 2 confirmations while an ERC-20 approval is required, since
Permit2 remains a later phase.

**Item 9 — basket-level cost optimization:** no solver currently ranks or
optimizes providers/routes across the whole basket.

**Item 11 — output verification:** `ExpectedOutput` data is carried through the
compiled result, but execute-time on-chain output reconciliation is not yet a
completed invariant.

**Item 12 — accounting separation:** not yet started.
