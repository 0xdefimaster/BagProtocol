import { SupabaseClient } from '@supabase/supabase-js';
import { ChainId } from '@/types/basket-protocol';

// -----------------------------------------------------------------------------
// Deployment state machine for a (bag, chain) pair. Same security boundary
// documented at the top of lib/server/bag-repo.ts: server-only, trusts the
// bagId/chain it's given — the caller (lib/server/deploy-bag.ts) is
// responsible for the ownership check before any function here is reached.
//
//   NOT_DEPLOYED -> DEPLOYING -> DEPLOYED
//                       \-----> FAILED -> (retry) -> DEPLOYING -> ...
//
// The NOT_DEPLOYED -> DEPLOYING transition is the only one with a real race
// to guard against (two deploy requests for the same bag+chain arriving
// close together) — see `start_bag_deployment` in supabase/schema.sql for
// why that one is a Postgres function and these aren't.
// -----------------------------------------------------------------------------

export type DeploymentStatus = 'NOT_DEPLOYED' | 'DEPLOYING' | 'DEPLOYED' | 'FAILED';

export interface BagDeployment {
  id: string;
  bagId: string;
  chain: ChainId;
  status: DeploymentStatus;
  factoryAddress: string | null;
  contractAddress: string | null;
  txHash: string | null;
  blockNumber: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BagDeploymentRow {
  id: string;
  bag_id: string;
  chain: string;
  status: string;
  factory_address: string | null;
  contract_address: string | null;
  tx_hash: string | null;
  block_number: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: BagDeploymentRow): BagDeployment {
  return {
    id: row.id,
    bagId: row.bag_id,
    chain: row.chain as ChainId,
    status: row.status as DeploymentStatus,
    factoryAddress: row.factory_address,
    contractAddress: row.contract_address,
    txHash: row.tx_hash,
    blockNumber: row.block_number,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getDeployment(
  admin: SupabaseClient,
  bagId: string,
  chain: ChainId
): Promise<BagDeployment | null> {
  const { data, error } = await admin
    .from('bag_deployments')
    .select()
    .eq('bag_id', bagId)
    .eq('chain', chain)
    .maybeSingle<BagDeploymentRow>();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export type StartDeploymentResult =
  | { started: true; deployment: BagDeployment }
  | { started: false; deployment: BagDeployment | null };

/** Atomically transitions NOT_DEPLOYED/FAILED -> DEPLOYING. Returns `started: false` (without writing anything) if a deployment for this (bagId, chain) is already DEPLOYING or DEPLOYED — this is what makes "same bag → cannot deploy twice" hold even under concurrent requests. */
export async function startDeployment(
  admin: SupabaseClient,
  bagId: string,
  chain: ChainId,
  factoryAddress: string
): Promise<StartDeploymentResult> {
  const { data, error } = await admin.rpc('start_bag_deployment', {
    p_bag_id: bagId,
    p_chain: chain,
    p_factory_address: factoryAddress,
  });
  if (error) throw new Error(error.message);

  const result = data as { started: boolean; deployment: BagDeploymentRow | null };
  return result.started
    ? { started: true, deployment: fromRow(result.deployment as BagDeploymentRow) }
    : { started: false, deployment: result.deployment ? fromRow(result.deployment) : null };
}

export interface ConfirmDeploymentInput {
  contractAddress: string;
  txHash: string;
  blockNumber: number;
}

/** DEPLOYING -> DEPLOYED. Only meaningful right after a `startDeployment()` that returned `started: true` — see the module header. */
export async function confirmDeployment(
  admin: SupabaseClient,
  deploymentId: string,
  input: ConfirmDeploymentInput
): Promise<BagDeployment> {
  const { data, error } = await admin
    .from('bag_deployments')
    .update({
      status: 'DEPLOYED',
      contract_address: input.contractAddress,
      tx_hash: input.txHash,
      block_number: input.blockNumber,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', deploymentId)
    .select()
    .single<BagDeploymentRow>();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

/** DEPLOYING -> FAILED. Leaves the row in a state `startDeployment()` will accept a retry from. */
export async function failDeployment(
  admin: SupabaseClient,
  deploymentId: string,
  errorMessage: string
): Promise<BagDeployment> {
  const { data, error } = await admin
    .from('bag_deployments')
    .update({ status: 'FAILED', error_message: errorMessage, updated_at: new Date().toISOString() })
    .eq('id', deploymentId)
    .select()
    .single<BagDeploymentRow>();
  if (error) throw new Error(error.message);
  return fromRow(data);
}
