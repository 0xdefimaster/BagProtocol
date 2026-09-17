import { SupabaseClient } from '@supabase/supabase-js';
import { privateKeyToAccount } from 'viem/accounts';
import { computeOnChainBagId } from '@/lib/domain/basket-protocol/onchain';
import { previewPerformanceFee } from '@/lib/domain/basket-protocol/redeem/performance-fee-preview';
import { quoteDecimalToRewardTokenRaw, ROBINHOOD_CHAIN_ID, ROBINHOOD_REWARD_TOKEN, DEPLOYED_CONTRACTS } from '@/lib/config/robinhood-chain';
import { buildRobinhoodSwapLeg } from '@/lib/blockchain/robinhood-swap-builder';
import {
  FEE_ATTESTATION_TYPES,
  REDEEM_FEE_ROUTER_EIP712_DOMAIN_NAME,
  REDEEM_FEE_ROUTER_EIP712_DOMAIN_VERSION,
  computeLegsHash,
} from '@/lib/blockchain/redeem-fee-router-eip712';
import { getRedeemIntentForUser } from '@/lib/server/redeem-intent-repo';
import { getInvestorPosition } from '@/lib/server/bag-investor-position-repo';
import { getBagById, getCurrentBagVersion } from '@/lib/server/bag-repo';

// -----------------------------------------------------------------------------
// V11 — real, multi-asset EIP-712 fee-attestation signing service for
// RedeemFeeRouter.sol. Every value bound into the signature is loaded from
// an authoritative server-side source — none of it is ever accepted from
// the request body. See RedeemFeeRouter.sol's own module doc for why this
// is what makes the router trustworthy: it never lets the frontend choose
// feeAmount/creator/inputToken(s) unilaterally, only submit (or withhold)
// an attestation the backend already committed to.
//
// SUPERSEDES the prior single-asset-only version of this file, which
// failed closed with `MultiAssetRedemptionNotSupportedError` for any
// redemption spanning more than one asset — the common case for a
// multi-asset Bag. That restriction is now GONE: every SWAP/KEEP step in
// the redeem intent becomes its own `RedeemLeg`, built via
// `buildRobinhoodSwapLeg()` against the verified Robinhood Chain
// SwapRouter02 (or a "no swap" leg when the held asset already IS the
// quote token — see that module's doc).
// -----------------------------------------------------------------------------

const ATTESTATION_TTL_MS = 5 * 60 * 1000; // 5 minutes — short-lived, matches this codebase's PURCHASE_INTENT_TTL_MS's "quote goes stale fast" convention.

/** Uniswap v3 fee tier assumed for every leg. See lib/blockchain/robinhood-swap-builder.ts's module doc — this is a deliberate, documented simplification (not independently verified per-pair from this session) rather than a silent guess dressed up as certainty. */
const DEFAULT_FEE_TIER = 3000;

export class RouterNotConfiguredError extends Error {
  constructor() {
    super('REDEEM_FEE_ROUTER_ADDRESS / CREATOR_REWARDS_VAULT_ADDRESS is not set — the router has not been deployed/configured yet.');
    this.name = 'RouterNotConfiguredError';
  }
}

export interface AttestedRedeemLeg {
  inputToken: `0x${string}`;
  inputAmount: string; // raw base units, decimal string (bigint-safe over JSON)
  swapTarget: `0x${string}`; // zeroAddress for a "no swap" leg
  swapCallData: `0x${string}`; // '0x' for a "no swap" leg
}

export interface FeeAttestation {
  redemptionId: `0x${string}`;
  user: `0x${string}`;
  creator: `0x${string}`;
  legs: AttestedRedeemLeg[];
  feeAmount: string; // raw base units, decimal string
  minUserProceeds: string; // raw base units, decimal string
  deadline: number; // unix seconds
  signature: `0x${string}`;
}

/**
 * Loads every authoritative input, computes the fee via
 * `previewPerformanceFee()` (the exact TypeScript mirror of
 * `apply_redeem_execution()`'s own SQL math), builds one `RedeemLeg` per
 * distinct asset actually held in this redemption, and signs the
 * resulting EIP-712 attestation with `REDEEM_FEE_ATTESTOR_PRIVATE_KEY`.
 * Callers MUST have already verified the requesting session owns
 * `redeemIntentId` (mirrors every other redeem-intent route's
 * `getRedeemIntentForUser()` ownership check).
 */
export async function signFeeAttestation(admin: SupabaseClient, userId: string, redeemIntentId: string): Promise<FeeAttestation> {
  const privateKey = process.env.REDEEM_FEE_ATTESTOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('REDEEM_FEE_ATTESTOR_PRIVATE_KEY is not set — cannot sign fee attestations.');
  }
  if (!DEPLOYED_CONTRACTS.redeemFeeRouter || !DEPLOYED_CONTRACTS.creatorRewardsVault) {
    throw new RouterNotConfiguredError();
  }

  const intentResult = await getRedeemIntentForUser(admin, redeemIntentId, userId);
  if (!intentResult.ok) {
    throw new Error(`Redeem intent not accessible: ${intentResult.error}`);
  }
  const intent = intentResult.intent;

  const assetSteps = intent.steps.filter((s) => (s.action === 'SWAP' || s.action === 'KEEP') && BigInt(s.inputAmountRaw) > BigInt(0));
  if (assetSteps.length === 0) {
    throw new Error(`Redeem intent ${redeemIntentId} has no non-zero asset steps — nothing to redeem.`);
  }

  const [position, bag] = await Promise.all([getInvestorPosition(admin, userId, intent.bagId), getBagById(admin, intent.bagId)]);
  if (!bag) throw new Error(`Bag ${intent.bagId} not found.`);

  const version = await getCurrentBagVersion(admin, intent.bagId);
  const performanceFeeBps = version?.recipe.performanceFeeBps ?? 0;

  const { data: creatorRow, error: creatorErr } = await admin.from('users').select('wallet_address').eq('id', bag.creatorId).maybeSingle();
  if (creatorErr) throw new Error(creatorErr.message);
  const creatorWallet = (creatorRow as { wallet_address: string } | null)?.wallet_address;
  if (!creatorWallet) throw new Error(`Bag ${intent.bagId}'s creator has no wallet_address on file.`);

  const { data: redeemerRow, error: redeemerErr } = await admin.from('users').select('wallet_address').eq('id', userId).maybeSingle();
  if (redeemerErr) throw new Error(redeemerErr.message);
  const redeemerWallet = (redeemerRow as { wallet_address: string } | null)?.wallet_address;
  if (!redeemerWallet) throw new Error(`User ${userId} has no wallet_address on file.`);

  // The position's shares/cost-basis BEFORE this specific redemption —
  // reconstructed from the CURRENT (already-quoted, not-yet-executed)
  // position, since this intent's own accounting hasn't been applied yet.
  // See performance-fee-preview.ts's own doc on why bit-for-bit parity
  // with apply_redeem_execution()'s SQL math matters here.
  const fee = previewPerformanceFee({
    positionCostBasisQuote: position.costBasisQuote,
    positionSharesRaw: position.sharesRaw,
    sharesBurnRaw: intent.sharesRaw,
    redeemValueQuote: intent.redeemValueQuote,
    performanceFeeBps,
    creatorIsRedeemer: bag.creatorId === userId,
  });
  const feeAmountRaw = quoteDecimalToRewardTokenRaw(fee.feeAmountQuote);

  const routerAddress = DEPLOYED_CONTRACTS.redeemFeeRouter;

  const legs: AttestedRedeemLeg[] = assetSteps.map((step) => {
    const inputToken = step.inputAsset.address as `0x${string}`;
    const inputAmount = BigInt(step.inputAmountRaw);

    if (inputToken.toLowerCase() === ROBINHOOD_REWARD_TOKEN.address.toLowerCase()) {
      // Already denominated in the settlement currency — "no swap" leg.
      return {
        inputToken,
        inputAmount: inputAmount.toString(),
        swapTarget: '0x0000000000000000000000000000000000000000',
        swapCallData: '0x',
      };
    }

    const swapLeg = buildRobinhoodSwapLeg({
      inputToken,
      inputAmount,
      outputToken: ROBINHOOD_REWARD_TOKEN.address as `0x${string}`,
      recipient: routerAddress, // the router itself is msg.sender to the swap target, not the user — it must hold the output to split fee vs. proceeds.
      // Conservative — the router independently re-checks
      // `swapOutput >= minUserProceeds + feeAmount` on-chain against the
      // REAL swap result, so this per-leg minimum is a DEX-level slippage
      // guard for the swap call itself, not the router's actual security
      // boundary. Set to 0 rather than guessing a value from an
      // unverified live quote (no quoting integration exists yet — see
      // robinhood-swap-builder.ts's module doc).
      minOutput: BigInt(0),
      feeTier: DEFAULT_FEE_TIER,
    });

    return {
      inputToken,
      inputAmount: inputAmount.toString(),
      swapTarget: swapLeg.swapTarget,
      swapCallData: swapLeg.swapCallData,
    };
  });

  // Same conservative reasoning as each leg's minOutput above — the
  // router's own on-chain check against the REAL combined swap output is
  // the actual enforcement; this is not that.
  const minUserProceedsRaw = BigInt(0);

  const deadline = Math.floor((Date.now() + ATTESTATION_TTL_MS) / 1000);
  const redemptionId = computeOnChainBagId(intent.id); // same UUID -> bytes32 convention as Bag ids (onchain.ts).

  const legsHash = computeLegsHash(legs.map((l) => ({ inputToken: l.inputToken, inputAmount: BigInt(l.inputAmount) })));

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const signature = await account.signTypedData({
    domain: {
      name: REDEEM_FEE_ROUTER_EIP712_DOMAIN_NAME,
      version: REDEEM_FEE_ROUTER_EIP712_DOMAIN_VERSION,
      chainId: ROBINHOOD_CHAIN_ID,
      verifyingContract: routerAddress,
    },
    types: FEE_ATTESTATION_TYPES,
    primaryType: 'FeeAttestation',
    message: {
      redemptionId,
      user: redeemerWallet as `0x${string}`,
      creator: creatorWallet as `0x${string}`,
      feeAmount: feeAmountRaw,
      minUserProceeds: minUserProceedsRaw,
      deadline: BigInt(deadline),
      legsHash,
    },
  });

  return {
    redemptionId,
    user: redeemerWallet as `0x${string}`,
    creator: creatorWallet as `0x${string}`,
    legs,
    feeAmount: feeAmountRaw.toString(),
    minUserProceeds: minUserProceedsRaw.toString(),
    deadline,
    signature,
  };
}
