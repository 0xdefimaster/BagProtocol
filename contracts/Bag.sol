// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Bag
/// @notice On-chain identity for a single Bag (basket). Deliberately holds
/// ONLY identity/versioning state — no token, no NAV, no mint/redeem, no
/// oracle, no rebalance. Those are Phase 5+ (see the Phase 4 report,
/// section "smart contract minimum scope"). Deployed exclusively by
/// `BagFactory.createBag()` — never constructed directly, so `factory` is
/// always a real, trusted `BagFactory` address, never an EOA.
///
/// `bagId` mirrors the off-chain `bags.id` (Supabase, `supabase/schema.sql`)
/// verbatim, encoded as bytes32 (`keccak256` is NOT used — see
/// `BagFactory.createBag()` for how a UUID becomes a bytes32). This is what
/// lets a Supabase row and an on-chain Bag be looked up from each other in
/// both directions without an extra indirection table.
contract Bag {
    /// @notice The off-chain Supabase `bags.id` (UUID) this contract is the
    /// on-chain identity for, encoded as bytes32.
    bytes32 public immutable bagId;

    /// @notice Wallet address of the Bag's creator/arranger. Matches
    /// `bags.creator_id`'s linked wallet off-chain (spec section 8: Creator
    /// → Arranger) — NOT re-derived on-chain from `bags.creator_id`, which
    /// is a Supabase users.id, not an address.
    address public immutable creator;

    /// @notice The BagFactory that deployed this contract.
    address public immutable factory;

    /// @notice Current composition version. Starts at 1 (matches
    /// `bags.current_version` off-chain at creation — see
    /// `lib/server/bag-repo.ts`'s `create_bag_with_initial_version`).
    uint256 public version;

    /// @notice `computeCompositionHash()` output (Phase 1,
    /// `lib/domain/basket-protocol/version.ts`) for the CURRENT version —
    /// NOT the JS hash's exact bytes (that's a 64-hex-char non-cryptographic
    /// fingerprint meant for fast off-chain equality checks), but a
    /// keccak256 of the same canonical `chain:address:symbol:decimals:
    /// weightBps` string the JS side builds, so the two are independently
    /// re-derivable from the same recipe and comparable off-chain even
    /// though the JS hash function itself doesn't run in the EVM. See
    /// `BagFactory.createBag()` NatSpec for the exact preimage format.
    bytes32 public compositionHash;

    /// @notice Off-chain metadata pointer (e.g. an HTTPS or ipfs:// URI
    /// resolving to a JSON document with name/description/composition —
    /// mirrors `bags` + the current `bag_versions.recipe` off-chain).
    /// Intentionally NOT authoritative for composition — `compositionHash`
    /// is what a verifier checks against; `metadataURI` is display-only,
    /// same trust level as an ERC-721 `tokenURI`.
    string public metadataURI;

    error NotFactory();

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    event CompositionUpdated(uint256 indexed version, bytes32 compositionHash, string metadataURI);

    constructor(bytes32 _bagId, address _creator, bytes32 _compositionHash, string memory _metadataURI) {
        bagId = _bagId;
        creator = _creator;
        factory = msg.sender;
        version = 1;
        compositionHash = _compositionHash;
        metadataURI = _metadataURI;
    }

    /// @notice Records a new composition version. Called by the factory on
    /// behalf of the creator (spec section 9: only meaningful for a MUTABLE
    /// bag — enforcing IMMUTABLE-vs-MUTABLE is done off-chain today, at
    /// `lib/server/bag-repo.ts`'s `createBagVersion()`, same place
    /// `bags.mutability` already lives; duplicating that check on-chain is
    /// Phase 5+ scope once mutability itself is tracked on-chain).
    /// @dev Deliberately dumb: takes the new hash/URI as given, does not
    /// recompute or validate them — `validateBasketRecipe()` (Phase 2) and
    /// `createBagVersion()` (Phase 3) already ran off-chain before this is
    /// ever called. This function's only job is to make the version bump
    /// tamper-evident and publicly observable via `CompositionUpdated`.
    function recordVersion(bytes32 _compositionHash, string calldata _metadataURI) external onlyFactory {
        version += 1;
        compositionHash = _compositionHash;
        metadataURI = _metadataURI;
        emit CompositionUpdated(version, _compositionHash, _metadataURI);
    }
}
