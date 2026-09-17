import { keccak256, stringToHex, type Hex } from 'viem';
import { RecipeAsset } from '@/types/basket-protocol';
import { canonicalCompositionString } from './version';

// -----------------------------------------------------------------------------
// Derives the two bytes32 values BagFactory.createBag() needs (bagId,
// compositionHash) from off-chain identifiers. Pure functions — no RPC, no
// network, safe to unit test directly (see onchain.test.ts).
//
// Deliberately NOT the same hash as `computeCompositionHash()`
// (lib/domain/basket-protocol/version.ts): that one is explicitly
// documented as non-cryptographic (a 64-bit FNV-style mix, good enough for
// "did this change" checks and DB fingerprints). A value that gets written
// on-chain and treated as a collision-resistant identity commitment needs
// an actual cryptographic hash — both functions here start from the exact
// same `canonicalCompositionString()` (so both are guaranteed
// order-independent for the same reason) and pipe it through keccak256
// instead.
// -----------------------------------------------------------------------------

/**
 * bytes32 compositionHash for BagFactory.createBag() / Bag.compositionHash.
 * Same order-independence guarantee as `computeCompositionHash()` — a
 * reordered `assets` array (or a JSONB round-trip that reorders object
 * keys) never changes this value; only an actual change in chain, address,
 * symbol, decimals, or weight does.
 */
export function computeOnChainCompositionHash(assets: RecipeAsset[]): Hex {
  return keccak256(stringToHex(canonicalCompositionString(assets)));
}

/**
 * bytes32 bagId for BagFactory.createBag() / Bag.bagId — derived from the
 * off-chain Supabase `bags.id` (a UUID string) by encoding it directly,
 * NOT hashing it: the UUID's 32 hex digits (dashes stripped) become the
 * low 16 bytes of the bytes32, left-padded with zero bytes. This is
 * deliberately round-trippable — `decodeOnChainBagId()` below recovers the
 * original UUID — so a Bag contract or an indexed `BagCreated` event can
 * be mapped straight back to its Supabase row without a reverse-lookup
 * table. (Unlike `computeOnChainCompositionHash`, there's no
 * order-independence property to preserve here, and no collision-
 * resistance need either — a UUID is already unique — so keccak256 would
 * only cost the round-trip property for no benefit.)
 */
export function computeOnChainBagId(bagId: string): Hex {
  const hex = bagId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`computeOnChainBagId: "${bagId}" is not a valid UUID.`);
  }
  return `0x${hex.padStart(64, '0')}`;
}

/** Inverse of `computeOnChainBagId()` — recovers the Supabase `bags.id` UUID from an on-chain bytes32 bagId (e.g. read off a `BagCreated` event). */
export function decodeOnChainBagId(onChainBagId: Hex): string {
  const hex = onChainBagId.slice(2).replace(/^0+/, '').padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
