import { getStatus } from '@lifi/sdk';
import { AssetIdentity, ChainId } from '@/types/basket-protocol';
import { PurchaseIntentFailureCode } from '@/types/purchase-intent';
import { getLiFiClient, toLiFiChainId } from './lifi-config';
import { mapLiFiError } from './lifi-execution-adapter';
import { assetIdentitiesEqual } from '@/lib/domain/basket-protocol/asset-identity';

// -----------------------------------------------------------------------------
// Phase 17 — spec Aşama 7/10: server-side transaction status tracking +
// post-execution verification. This is the ONLY place `@lifi/sdk`'s
// `getStatus()` is called — the server polls it (never trusts a client's
// self-reported "it worked"), maps LI.FI's own status/substatus vocabulary
// to this protocol's typed `PurchaseIntentFailureCode` list, and — the
// verification step spec Aşama 10 asks for — cross-checks the asset LI.FI
// says was actually received against the registry-verified asset this
// step's `PurchaseIntentStepRecord.outputAsset` expected, not just trusting
// "status: DONE" at face value.
// -----------------------------------------------------------------------------

export type TrackedStepOutcome =
  | { kind: 'PENDING'; substatus: string | null }
  | {
      kind: 'DONE';
      receivedAsset: AssetIdentity;
      receivedAmountRaw: string | null;
      matchesExpectedAsset: boolean;
    }
  | { kind: 'FAILED'; failureCode: PurchaseIntentFailureCode; message: string };

/** Maps a LI.FI `SubstatusFailed` value (its own failure taxonomy) to this protocol's `PurchaseIntentFailureCode` list — spec Aşama 7's explicit table. */
function mapSubstatusFailed(substatus: string | undefined): PurchaseIntentFailureCode {
  switch (substatus) {
    case 'INSUFFICIENT_ALLOWANCE':
      return 'INSUFFICIENT_ALLOWANCE';
    case 'INSUFFICIENT_BALANCE':
      return 'INSUFFICIENT_BALANCE';
    case 'SLIPPAGE_EXCEEDED':
      return 'SLIPPAGE_EXCEEDED';
    case 'EXPIRED':
      return 'ROUTE_EXPIRED';
    case 'OUT_OF_GAS':
      return 'TRANSACTION_REVERTED';
    default:
      return 'UNKNOWN_ERROR';
  }
}

export interface TrackStepStatusInput {
  txHash: string;
  sourceChain: ChainId;
  destinationChain: ChainId;
  /** LI.FI's own bridge/tool identifier for this step (`LiFiStep.tool`) — required by `getStatus()` for cross-chain routes, harmless for same-chain swaps. */
  tool: string | null;
  /** The registry-verified asset this step expects to receive — used ONLY to compare against what LI.FI reports was actually received (spec Aşama 10), never sent to LI.FI as a request parameter. */
  expectedOutputAsset: AssetIdentity;
}

/**
 * Polls LI.FI's status for one submitted step's transaction. Never throws
 * for a "still pending" result — that's the expected common case while a
 * transaction confirms — only for a genuinely unexpected provider error,
 * mapped the same way `lifi-execution-adapter.ts`'s quote path already
 * maps errors.
 */
export async function trackStepStatus(input: TrackStepStatusInput): Promise<TrackedStepOutcome> {
  const client = getLiFiClient();

  let response;
  try {
    response = await getStatus(client, {
      txHash: input.txHash,
      fromChain: toLiFiChainId(input.sourceChain),
      toChain: toLiFiChainId(input.destinationChain),
      bridge: input.tool ?? undefined,
    });
  } catch (err) {
    const mapped = mapLiFiError(err);
    return { kind: 'FAILED', failureCode: 'PROVIDER_ERROR', message: mapped.message };
  }

  if (response.status === 'FAILED') {
    return {
      kind: 'FAILED',
      failureCode: mapSubstatusFailed(response.substatus),
      message: response.substatusMessage ?? 'The transaction failed on-chain.',
    };
  }

  if (response.status === 'NOT_FOUND' || response.status === 'INVALID' || response.status === 'PENDING') {
    return { kind: 'PENDING', substatus: response.substatus ?? null };
  }

  // status === 'DONE'
  const receiving = 'token' in response.receiving ? response.receiving : null;
  if (!receiving?.token) {
    // LI.FI reports DONE but hasn't yet attached receiving-token detail —
    // treat as still-pending rather than guessing (spec: never fabricate a
    // value the provider hasn't actually returned).
    return { kind: 'PENDING', substatus: response.substatus ?? null };
  }

  const receivedAsset: AssetIdentity = { chain: input.destinationChain, address: receiving.token.address };
  return {
    kind: 'DONE',
    receivedAsset,
    receivedAmountRaw: receiving.amount ?? null,
    matchesExpectedAsset: assetIdentitiesEqual(receivedAsset, input.expectedOutputAsset),
  };
}
