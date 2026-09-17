import { beforeEach, describe, expect, it } from 'vitest';
import { BasketRecipe, DEFAULT_REBALANCE_RULE, RecipeAsset } from '@/types/basket-protocol';
import { createBag } from '../bag-repo';
import { deployBagToChain } from '../deploy-bag';

// -----------------------------------------------------------------------------
// Exercises lib/server/deploy-bag.ts end to end: ownership check, the
// NOT_DEPLOYED -> DEPLOYING -> DEPLOYED state machine, duplicate-deploy
// prevention, and failure handling. Runs entirely against the REAL
// mockAdapter (lib/blockchain/mock-adapter.ts) — no env vars are set for
// any chain, so deploy-bag.ts's resolveAdapter() always falls through to
// it, exactly as it would in CI/dev with no RPC configured. This is the
// "MockAdapter -> tests don't require RPC" requirement, verified directly
// rather than asserted.
//
// The Supabase fake here is deliberately its own (not reused from
// bag-repo.test.ts): it needs `bag_deployments` and `users` on top of
// `bags`/`bag_versions`, plus a `start_bag_deployment` RPC implementing the
// same conditional-upsert semantics as supabase/schema.sql's real function
// (NOT_DEPLOYED/FAILED -> DEPLOYING succeeds; DEPLOYING/DEPLOYED does not).
// -----------------------------------------------------------------------------

interface Row {
  [key: string]: unknown;
}

class FakeQueryBuilder {
  private filters: Array<(row: Row) => boolean> = [];
  private patch: Row | null = null;

  constructor(private table: Map<string, Row>, private tableName: string) {}

  select() {
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push((row) => row[col] === val);
    return this;
  }

  update(patch: Row) {
    this.patch = patch;
    return this;
  }

  private resolve(): Row[] {
    let rows = Array.from(this.table.values());
    for (const f of this.filters) rows = rows.filter(f);
    if (this.patch) {
      rows = rows.map((row) => {
        const updated = { ...row, ...this.patch };
        this.table.set(updated.id as string, updated);
        return updated;
      });
    }
    return rows;
  }

  async maybeSingle() {
    const rows = this.resolve();
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const rows = this.resolve();
    if (rows.length === 0) return { data: null, error: { message: `no row found in ${this.tableName}` } };
    return { data: rows[0], error: null };
  }
}

class FakeSupabase {
  bags = new Map<string, Row>();
  bagVersions = new Map<string, Row>();
  bagDeployments = new Map<string, Row>();
  users = new Map<string, Row>();

  from(tableName: string) {
    const table =
      tableName === 'bags'
        ? this.bags
        : tableName === 'bag_versions'
          ? this.bagVersions
          : tableName === 'bag_deployments'
            ? this.bagDeployments
            : this.users;
    return new FakeQueryBuilder(table, tableName);
  }

  async rpc(name: string, params: Record<string, unknown>) {
    if (name === 'create_bag_with_initial_version') return this.createBagWithInitialVersion(params);
    if (name === 'start_bag_deployment') return this.startBagDeployment(params);
    throw new Error(`unknown rpc: ${name}`);
  }

  private createBagWithInitialVersion(p: Record<string, unknown>) {
    const now = new Date().toISOString();
    const bagRow: Row = {
      id: p.p_id,
      slug: p.p_slug,
      name: p.p_name,
      symbol: p.p_symbol,
      description: p.p_description,
      creator_id: p.p_creator_id,
      chain: p.p_chain,
      strategy_type: p.p_strategy_type ?? 'STATIC_BASKET',
      mutability: p.p_mutability,
      status: p.p_status,
      current_version: 1,
      current_version_id: null,
      registry_id: null,
      contract_address: null,
      parent_bag_id: null,
      root_bag_id: null,
      created_at: now,
      updated_at: now,
    };

    const versionId = crypto.randomUUID();
    const versionRow: Row = {
      id: versionId,
      bag_id: p.p_id,
      version: 1,
      composition_hash: p.p_composition_hash,
      recipe: p.p_recipe,
      created_by: p.p_creator_id,
      reason: p.p_reason,
      created_at: now,
    };
    bagRow.current_version_id = versionId;

    this.bags.set(bagRow.id as string, bagRow);
    this.bagVersions.set(versionId, versionRow);

    return { data: { bag: bagRow, version: versionRow }, error: null };
  }

  // Mirrors start_bag_deployment()'s `ON CONFLICT ... DO UPDATE ... WHERE
  // status IN ('NOT_DEPLOYED', 'FAILED')`: only actually transitions the row
  // (and returns started: true) from those two statuses; DEPLOYING/DEPLOYED
  // are left untouched.
  private startBagDeployment(p: Record<string, unknown>) {
    const existing = [...this.bagDeployments.values()].find((r) => r.bag_id === p.p_bag_id && r.chain === p.p_chain);

    if (!existing) {
      const now = new Date().toISOString();
      const row: Row = {
        id: crypto.randomUUID(),
        bag_id: p.p_bag_id,
        chain: p.p_chain,
        status: 'DEPLOYING',
        factory_address: p.p_factory_address,
        contract_address: null,
        tx_hash: null,
        block_number: null,
        error_message: null,
        created_at: now,
        updated_at: now,
      };
      this.bagDeployments.set(row.id as string, row);
      return { data: { started: true, deployment: row }, error: null };
    }

    if (existing.status === 'NOT_DEPLOYED' || existing.status === 'FAILED') {
      existing.status = 'DEPLOYING';
      existing.factory_address = p.p_factory_address;
      existing.error_message = null;
      existing.updated_at = new Date().toISOString();
      return { data: { started: true, deployment: existing }, error: null };
    }

    return { data: { started: false, deployment: existing }, error: null };
  }
}

// ----------------------------- Fixtures -----------------------------------------

function asset(overrides: Partial<RecipeAsset>): RecipeAsset {
  return {
    chain: 'ethereum',
    address: '0x11111111111111111111111111111111111111aa',
    symbol: 'BTC',
    decimals: 18,
    weightBps: 6000,
    ...overrides,
  };
}

function validRecipeInput(): Omit<BasketRecipe, 'id' | 'bagId' | 'version' | 'createdAt'> {
  return {
    name: 'Majors Basket',
    symbol: 'MAJORS',
    description: 'BTC + ETH',
    chain: 'ethereum',
    strategyType: 'STATIC_BASKET',
    assets: [
      asset({ symbol: 'BTC', weightBps: 6000 }),
      asset({ symbol: 'ETH', address: '0x22222222222222222222222222222222222222bb', weightBps: 4000 }),
    ],
    rebalanceRule: DEFAULT_REBALANCE_RULE,
    minInvestment: 100,
    maxAssets: 10,
    minWeightBps: 100,
    maxWeightBps: 7000,
    mutability: 'MUTABLE',
  };
}

const CREATOR_ID = 'user_creator_1';
const OTHER_USER_ID = 'user_other_1';

let db: FakeSupabase;

beforeEach(() => {
  db = new FakeSupabase();
  db.users.set(CREATOR_ID, { id: CREATOR_ID, wallet_address: '0x0000000000000000000000000000000000c0de' });
  db.users.set(OTHER_USER_ID, { id: OTHER_USER_ID, wallet_address: '0x0000000000000000000000000000000000beef' });
});

async function createTestBag() {
  const result = await createBag(db as never, {
    slug: `majors-${crypto.randomUUID()}`,
    creatorId: CREATOR_ID,
    mutability: 'MUTABLE',
    status: 'DRAFT',
    recipe: validRecipeInput(),
    reason: 'Initial creation',
  });
  if (!result.ok) throw new Error('fixture setup failed: ' + JSON.stringify(result));
  return result.bag;
}

describe('deployBagToChain — happy path', () => {
  it('deploys a DRAFT bag: returns a valid contract address and flips the bag to ACTIVE', async () => {
    const bag = await createTestBag();
    expect(bag.status).toBe('DRAFT');

    const result = await deployBagToChain(db as never, CREATOR_ID, bag.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.deployment.status).toBe('DEPLOYED');
    expect(result.deployment.contractAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(result.deployment.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.deployment.blockNumber).toBeGreaterThan(0);

    const updatedBag = db.bags.get(bag.id) as Row;
    expect(updatedBag.status).toBe('ACTIVE');
    expect(updatedBag.contract_address).toBe(result.deployment.contractAddress);
    expect(updatedBag.registry_id).toBe('ethereum');
  });
});

describe('deployBagToChain — production safety guard', () => {
  it('refuses to fall back to the mock adapter when NODE_ENV=production and the target chain has no RPC/factory configured — never fabricates a deployment', async () => {
    const bag = await createTestBag();
    const originalNodeEnv = process.env.NODE_ENV;
    // @ts-expect-error — NODE_ENV is readonly in some TS lib configs; test-only override.
    process.env.NODE_ENV = 'production';
    try {
      const result = await deployBagToChain(db as never, CREATOR_ID, bag.id);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('DEPLOYMENT_FAILED');
      expect((result as { message: string }).message).toMatch(/mock adapter/i);

      // Never even started a deployment attempt row — this fails BEFORE
      // startDeployment(), so the bag is left exactly as it was, not stuck
      // in a phantom DEPLOYING state.
      const unchangedBag = db.bags.get(bag.id) as Row;
      expect(unchangedBag.status).toBe('DRAFT');
    } finally {
      // @ts-expect-error — see above.
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});

describe('deployBagToChain — ownership', () => {
  it('rejects deployment by a user who is not the creator', async () => {
    const bag = await createTestBag();
    const result = await deployBagToChain(db as never, OTHER_USER_ID, bag.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('FORBIDDEN');

    // Nothing should have been written for the wrong-user attempt.
    const stillUndeployed = [...db.bagDeployments.values()].filter((d) => d.bag_id === bag.id);
    expect(stillUndeployed).toEqual([]);
  });

  it('rejects deployment of a bag that does not exist', async () => {
    const result = await deployBagToChain(db as never, CREATOR_ID, 'nonexistent-bag-id');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('BAG_NOT_FOUND');
  });
});

describe('deployBagToChain — duplicate deployment', () => {
  it('cannot deploy the same bag to the same chain twice', async () => {
    const bag = await createTestBag();

    const first = await deployBagToChain(db as never, CREATOR_ID, bag.id);
    expect(first.ok).toBe(true);

    const second = await deployBagToChain(db as never, CREATOR_ID, bag.id);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('ALREADY_IN_PROGRESS_OR_DEPLOYED');

    // Still exactly one deployment row for this bag+chain, still DEPLOYED
    // from the first call — the second call did not overwrite it.
    const deployments = [...db.bagDeployments.values()].filter((d) => d.bag_id === bag.id && d.chain === 'ethereum');
    expect(deployments).toHaveLength(1);
    expect(deployments[0].status).toBe('DEPLOYED');
  });

  it('two concurrent deploy calls for the same bag+chain: exactly one succeeds', async () => {
    const bag = await createTestBag();

    const [a, b] = await Promise.all([
      deployBagToChain(db as never, CREATOR_ID, bag.id),
      deployBagToChain(db as never, CREATOR_ID, bag.id),
    ]);

    const successes = [a, b].filter((r) => r.ok);
    const failures = [a, b].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (!failures[0].ok) expect(failures[0].error).toBe('ALREADY_IN_PROGRESS_OR_DEPLOYED');
  });
});

describe('deployBagToChain — failure and retry', () => {
  it('a deployment that fails on-chain lands in FAILED, and FAILED can be retried (not permanently stuck)', async () => {
    const bag = await createTestBag();

    // First deploy succeeds normally.
    const first = await deployBagToChain(db as never, CREATOR_ID, bag.id);
    expect(first.ok).toBe(true);

    // Simulate an operator resetting a stuck row back to NOT_DEPLOYED (or
    // a bag whose deployment row was reset for any other reason) so a
    // second attempt re-enters DEPLOYING and calls the adapter again — the
    // mock adapter throws "BagAlreadyDeployed" for a repeat onChainBagId
    // (lib/blockchain/mock-adapter.ts), exactly the failure mode a real
    // chain would produce for a genuinely duplicate on-chain id. This is
    // the cleanest deterministic way to exercise the FAILED path without
    // reaching into deploy-bag.ts's internals.
    const deployedRow = [...db.bagDeployments.values()].find((d) => d.bag_id === bag.id) as Row;
    deployedRow.status = 'NOT_DEPLOYED';

    const second = await deployBagToChain(db as never, CREATOR_ID, bag.id);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('DEPLOYMENT_FAILED');

    const failedRow = [...db.bagDeployments.values()].find((d) => d.bag_id === bag.id) as Row;
    expect(failedRow.status).toBe('FAILED');
    expect(typeof failedRow.error_message).toBe('string');
    expect((failedRow.error_message as string).length).toBeGreaterThan(0);

    // Retry: start_bag_deployment() accepts FAILED -> DEPLOYING the same
    // way it accepts NOT_DEPLOYED -> DEPLOYING — the row is not stuck.
    const retry = await deployBagToChain(db as never, CREATOR_ID, bag.id);
    expect(retry.ok).toBe(false); // still fails for the same underlying reason (same onChainBagId)
    if (!retry.ok) expect(retry.error).not.toBe('ALREADY_IN_PROGRESS_OR_DEPLOYED'); // proves the retry attempt was actually allowed to start
  });
});
