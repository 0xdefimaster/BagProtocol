import { keccak256, encodeAbiParameters, concat, toHex } from 'viem';

// -----------------------------------------------------------------------------
// Single source of truth for RedeemFeeRouter's EIP-712 shape — imported by
// both the server-side signer (redeem-fee-attestation.ts) and anything that
// needs to independently recompute the same hash (tests, the client-side
// verification step in use-redeem-execution.ts). A hand-copied duplicate of
// this logic in two places is exactly how a silent domain/typehash mismatch
// (attestation always fails on-chain, or worse, always fails a certain way
// that gets "fixed" by loosening a check) would slip in — see
// contracts/RedeemFeeRouter.sol's `LEG_TYPEHASH`/`FEE_ATTESTATION_TYPEHASH`
// for the Solidity side these constants must stay byte-for-byte in sync with.
// -----------------------------------------------------------------------------

export const REDEEM_FEE_ROUTER_EIP712_DOMAIN_NAME = 'BagRedeemFeeRouter';
export const REDEEM_FEE_ROUTER_EIP712_DOMAIN_VERSION = '2';

export const FEE_ATTESTATION_TYPES = {
  FeeAttestation: [
    { name: 'redemptionId', type: 'bytes32' },
    { name: 'user', type: 'address' },
    { name: 'creator', type: 'address' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'minUserProceeds', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'legsHash', type: 'bytes32' },
  ],
} as const;

/** Matches `RedeemFeeRouter.sol`'s `LEG_TYPEHASH` constant exactly. */
export const LEG_TYPEHASH = keccak256(toHex('RedeemLegAttestation(address inputToken,uint256 inputAmount)'));

export interface AttestedLeg {
  inputToken: `0x${string}`;
  inputAmount: bigint;
}

/**
 * Mirrors `RedeemFeeRouter._verifyAttestation()`'s on-chain computation
 * EXACTLY: `keccak256(abi.encodePacked(leg1Hash, leg2Hash, ...))` where each
 * `legHash = keccak256(abi.encode(LEG_TYPEHASH, inputToken, inputAmount))`.
 * Order-sensitive — the legs array passed to `redeem()` must be in the same
 * order this was computed from, or the attestation will not verify
 * on-chain (by design — see RedeemFeeRouter.sol's own test for this).
 */
export function computeLegsHash(legs: AttestedLeg[]): `0x${string}` {
  const legHashes = legs.map((leg) =>
    keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }], [LEG_TYPEHASH, leg.inputToken, leg.inputAmount]))
  );
  return keccak256(concat(legHashes));
}
