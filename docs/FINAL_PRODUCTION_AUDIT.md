# BAG Protocol — Final Production Audit

Date of this pass: 2026-09-09 (sandbox clock; conversation date 2026-09-10).
Scope: full repository audit + implementation of the production-critical
gaps that were both genuinely missing and safely fixable without external
infrastructure access (no live Robinhood Chain RPC, no live Supabase
instance, no Google Fonts network access from this sandbox). Every claim
below was checked against the actual code and, where possible, against a
real local Postgres 16 instance and a real Hardhat/viem chain — not
inferred from documentation or comments.

---

## A. Completed this pass

1. **Vercel Cron routes were non-functional — fixed.** Verified against
   Vercel's own docs that Cron Jobs trigger registered paths with an HTTP
   **GET** request, not POST. Both `app/api/cron/settle-creator-rewards`
   and `app/api/cron/reconcile-creator-rewards` only exported `POST` —
   a real Vercel Cron invocation would have gotten a 405 and never run.
   Added `GET` handlers (delegating to the same logic) to both routes.
   `POST` is kept for manual/alternate-scheduler use.

2. **New fork royalties were never reaching `creator_reward_settlements`
   — fixed atomically.** Migration 0016 (already in the repo before this
   pass) added `royaltyActivityId`/`royaltyAmount` to
   `apply_purchase_execution()`'s return value, but nothing in
   `lib/server/purchase-execution.ts` ever read it — every fork royalty
   earned after 0014 shipped was silently falling through to the same gap
   only migration 0015's legacy backfill covered. Fixed by adding
   migration `0017_atomic_fork_royalty_settlement_row.sql`, which moves
   the `creator_reward_settlements` insert INTO the same SQL transaction
   as the royalty's own `activities` row — closing a real crash-window
   bug an earlier two-statement (SQL then separate TypeScript insert)
   version would have had. Verified end-to-end against a real local
   Postgres 16: atomic insert, idempotency on retry (0 duplicate rows),
   self-fork exemption (creator buying their own root bag pays no
   royalty and creates no settlement row) — all confirmed by direct RPC
   calls, not just read from the SQL.

3. **Full-repository audit performed and cross-checked against actual
   code** (not just `docs/CREATOR_REWARDS_SETTLEMENT.md`, which was
   already stale in places — e.g. it didn't mention 0016/0017 existing).
   Confirmed genuinely complete and working, with real tests run (not
   assumed): `CreatorRewardsVault.sol`, `RedeemFeeRouter.sol` (in
   isolation), the Supabase-backed `RewardSettlementRepo` /
   `ReconciliationRepo` implementations, the real viem-backed
   `VaultChainClient` / `VaultReadClient` implementations, the EIP-712
   fee-attestation signing service, and the Create Bag performance-fee UI
   (already present, `performanceFeeBps` 0–30%, server-authoritative).

---

## B. Remaining blockers (genuine — not fixable from this pass)

1. **`RedeemFeeRouter` is not wired into the real redemption UX.**
   `hooks/use-redeem-execution.ts` still drives redemption entirely
   through LI.FI's `executeRoute()` + the legacy `apply_redeem_execution()`
   RPC. The backend half (`/api/redeem-intent/:id/attest-fee`,
   `signFeeAttestation()`) is real and correct, but nothing calls it.
   **Why this can't be safely finished right now:** `RedeemFeeRouter.redeem()`
   takes a caller-supplied `swapTarget` + raw `swapCallData` — the actual
   DEX route/calldata construction is a genuine client-side responsibility
   this codebase has no code for (LI.FI served this role for the
   multi-chain purchase flow, but that's a different execution model; a
   single-chain router call needs either a Uniswap SDK integration or a
   swap-routing API this app doesn't call anywhere). Building that against
   a swap target that isn't verified yet (see #2) would mean either
   inventing an address or building unusable dead code.
   **Exact action required:** (a) resolve #2 below, (b) implement a
   client-side swap-route builder for the specific allowlisted DEX
   (Uniswap v3/v4 on Robinhood Chain, per third-party volume reports —
   never independently confirmed as canonical by this pass), (c) replace
   `use-redeem-execution.ts`'s LI.FI call with a direct
   `RedeemFeeRouter.redeem()` viem call using the attestation + swap
   calldata, (d) have the owner call `RedeemFeeRouter.setAllowedSwapTarget`
   once a real target is confirmed.

2. **`ROBINHOOD_UNISWAP_SWAP_TARGET_ADDRESS` / router address — still
   not verified.** Robinhood's own `docs.robinhood.com/chain/protocol-contracts`
   page lists Permit2 but no canonical Uniswap router/factory address for
   Robinhood Chain. Third-party sources report Uniswap pools exist on the
   chain, which is not the same as an official canonical router address.
   `lib/config/robinhood-chain.ts` correctly encodes this as `null` with a
   fail-closed contract (verified — every call site that would need this
   throws rather than guessing). **Exact action required:** confirm
   directly against Uniswap's own deployment registry
   (`docs.uniswap.org/contracts/v3/reference/deployments` or the v4
   equivalent) or a second, independent Robinhood-side confirmation, then
   fill in `UNISWAP_ROUTER_ADDRESS` and have the vault/router owner
   allowlist it on-chain.

3. **Real deployment has never been broadcast.** `scripts/deploy-creator-rewards.ts`
   compiles and typechecks; this sandbox has no network route to
   `rpc.mainnet.chain.robinhood.com` (not in the container's egress
   allowlist), so `CREATOR_REWARDS_VAULT_ADDRESS` / `REDEEM_FEE_ROUTER_ADDRESS`
   remain unset. Every downstream consumer (settlement worker, reconciliation
   job, dashboard claim button) already fails closed on this — verified
   by reading each one's `null` handling, not assumed.

4. **`npm run build` could not be completed in this sandbox** — it fails
   at the `next/font/google` fetch step (`fonts.googleapis.com` is not in
   the container's network allowlist), not on any application code. `tsc
   --noEmit` (which covers the same type-level surface `next build` would
   hit first) is clean. **Exact action required:** run `npm run build`
   once in an environment with normal internet access before deploying;
   nothing in this pass gives a reason to expect it to fail there.

5. **Multi-asset redemptions cannot use `RedeemFeeRouter` at all** (by
   design — `signFeeAttestation()` fails closed with
   `MultiAssetRedemptionNotSupportedError` rather than attesting a fee for
   only part of such a redemption). This protocol has no pooled custody,
   so a redemption can genuinely span several distinct underlying assets.
   Not a bug — a documented, correct scope limit — but it means even once
   #1/#2 are resolved, single-asset redemptions are the only ones that can
   go through the fee-enforced path; multi-asset redemptions still need
   either N separate signed calls or a multi-leg router redesign, neither
   built.

6. **No automated scheduler is actually running the cron routes anywhere
   yet.** `vercel.json` declares the schedule; nothing in this sandbox can
   confirm Vercel (or any other scheduler) is actually deployed and
   invoking it. This is an infrastructure/deployment step, not a code gap.

---

## C. Security findings

| Severity | Finding | Detail |
|---|---|---|
| **HIGH** (fixed) | Cron routes silently non-functional | See A.1 — would have meant NO reward ever settles or gets reconciled in production, with no error surfaced (Vercel would just log 405s an operator might never check). |
| **HIGH** (fixed) | New fork royalties permanently stuck as paper credit | See A.2 — every post-0014 royalty was invisible to the settlement worker with no automatic recovery path. |
| **LOW** | `creator_reward_settlements`'s RLS policy is dead code | `using (creator_id = auth.uid())` — this app has no Supabase Auth session (custom wallet-signature JWT model, confirmed via `durum-raporu-v2.md` and by grepping for any browser-side Supabase client — none exists), so `auth.uid()` is always `null` and this policy never matches any row for anyone. Not currently exploitable (the browser never talks to Supabase directly; every access goes through Next.js API routes using the service-role key, which bypasses RLS by design, and those routes were checked to filter by the authenticated session's own user id). Recommend either removing the misleading policy or documenting plainly that RLS is not this app's security boundary, so a future engineer doesn't mistake it for one. |
| **LOW** | Cron secret comparison is not timing-safe | `require-cron-secret.ts` uses `!==` string comparison. Low practical risk (the secret is high-entropy and this isn't a user-facing auth path), but a constant-time comparison is cheap and removes the concern entirely. |
| **INFO** | No rate limiting observed on `/api/redeem-intent/:id/attest-fee` | Each call re-derives the fee from authoritative server state (no client-controlled amount), so spamming it can't manipulate accounting — but it does re-run a DB round trip + a signature per call. Low priority; note for later if abuse is observed. |

No other client-trust violations were found in the routes and RPCs
inspected this pass (purchase, redeem, creator rewards, deployment):
price, fee amount, creator id, and settlement status are all
server-derived in every path checked.

---

## D. Test results (actually run this pass, not assumed)

```
npx hardhat test        → 40 passing (40 nodejs)
npx vitest run           → 46 test files, 477 tests passed
npx tsc --noEmit         → clean (only scripts/spike/deploy-19x-a.ts's
                            pre-existing BigInt-literal/ES2017-target
                            errors remain — unrelated spike script, not
                            touched by any phase of this work)
npm run build            → NOT completed — fails at next/font/google's
                            fetch step due to this sandbox's network
                            egress allowlist (fonts.googleapis.com is not
                            reachable). Not an application defect.
```

Plus, verified directly against a real local Postgres 16 instance (not
just read for syntax): migrations 0015/0016/0017's atomicity,
idempotency, and self-fork-exemption behavior, via direct RPC calls with
real fixture data.

---

## E. Production configuration checklist

| Item | Status |
|---|---|
| Robinhood Chain RPC (`ROBINHOOD_RPC_URL`) | ✅ verified, hardcoded in `lib/config/robinhood-chain.ts` |
| USDG reward token address | ✅ verified against `docs.robinhood.com/chain/contracts` |
| USDG decimals (6) | ✅ third-party cross-confirmed (Robinhood's own page doesn't print it) |
| Uniswap/DEX swap target | ❌ NOT verified — see B.2. `UNISWAP_ROUTER_ADDRESS = null`, fails closed |
| `CreatorRewardsVault` address | ❌ not deployed — `CREATOR_REWARDS_VAULT_ADDRESS` unset |
| `RedeemFeeRouter` address | ❌ not deployed — `REDEEM_FEE_ROUTER_ADDRESS` unset |
| Settlement signer (`CREATOR_REWARDS_SETTLEMENT_PRIVATE_KEY`) | ❌ not provisioned |
| Fee attestor (`REDEEM_FEE_ATTESTOR_PRIVATE_KEY`) | ❌ not provisioned |
| Owner/multisig (`CREATOR_REWARDS_OWNER_ADDRESS`) | ❌ not provisioned |
| Supabase project (URL + service role key) | ❌ not connected in this sandbox — code fails closed (`isSupabaseConfigured()`) when absent, verified |
| `CRON_SECRET` | ❌ not provisioned — routes correctly return 503 when absent, verified |
| Vercel Cron schedule | ✅ declared in `vercel.json`; not verified as actually running (needs a real deployment) |
| Historical reward migration (0015 backfill functions) | ✅ implemented, idempotent, tested against real Postgres |

---

## F. Final production readiness

> **NOT READY**

Real on-chain execution for the performance-fee path
(`RedeemFeeRouter`) is still disconnected from the actual user-facing
redeem flow, and the swap-target address it depends on has not been
independently verified — per this brief's own final rule, that alone is
disqualifying regardless of how much else is solid. The fork-royalty
settlement pipeline (purchase → `creator_reward_settlements` → cron
worker → `CreatorRewardsVault.settleReward` → creator claim) is now
genuinely complete and internally consistent end-to-end in code and
locally-verified behavior, but has never run against a real deployed
vault or a real Supabase instance, since neither exists yet outside this
sandbox.
