// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Bag} from './Bag.sol';

/// @title BagFactory
/// @notice Deploys and registers `Bag` instances. This contract is
/// deliberately as thin as possible — it is orchestration, not business
/// logic. It does NOT:
///   - hold or move funds
///   - compute NAV
///   - touch a DEX or aggregator
///   - read an oracle
///   - rebalance anything
/// All of that is Phase 5+ (NAV Engine, Rebalance Engine, Mint/Redeem —
/// spec sections 12-14) and, per the Phase 4 brief, explicitly out of scope
/// here. What this contract DOES guarantee, on-chain, independent of
/// Supabase: a given `bagId` can be deployed at most once, the resulting
/// `Bag` address is permanently discoverable from that `bagId`, and the
/// deployer (creator) is permanently discoverable from that `Bag`.
contract BagFactory {
    /// @notice bagId (off-chain Supabase `bags.id`, as bytes32) -> deployed Bag address.
    mapping(bytes32 => address) public bagOf;

    /// @notice creator address -> bagIds they've deployed, in deployment order.
    mapping(address => bytes32[]) public bagsByCreator;

    /// @notice Contract owner — can rotate `deployer`. Not the same role as
    /// `deployer`: owner is a rarely-used admin key (ideally a multisig
    /// before any real deployment — see the Phase 4 report's security
    /// section), deployer is the hot server-side wallet that actually signs
    /// `createBag` transactions day to day.
    address public owner;

    /// @notice The single wallet allowed to call `createBag` — the backend
    /// deployment service's wallet (`DEPLOYER_PRIVATE_KEY`,
    /// `lib/blockchain/evm/client.ts`), NOT any individual creator's own
    /// wallet. `createBag` takes `creator` as an explicit parameter
    /// precisely because `msg.sender` here is always this deployer wallet,
    /// never the true creator — see that parameter's NatSpec.
    address public deployer;

    error AlreadyDeployed(bytes32 bagId, address existing);
    error ZeroAddress();
    error NotOwner();
    error NotDeployer();

    event DeployerUpdated(address indexed previousDeployer, address indexed newDeployer);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyDeployer() {
        if (msg.sender != deployer) revert NotDeployer();
        _;
    }

    /// @notice Emitted once per successful deployment. `bagId`/`creator`
    /// indexed for log filtering (e.g. "every Bag by creator X",
    /// "the deployment for bagId Y") — see the Phase 4 report's "Events"
    /// section for why these two specifically and not `bag`/`compositionHash`.
    event BagCreated(
        bytes32 indexed bagId,
        address indexed creator,
        address bag,
        bytes32 compositionHash,
        uint256 version
    );

    constructor(address _deployer) {
        if (_deployer == address(0)) revert ZeroAddress();
        owner = msg.sender;
        deployer = _deployer;
    }

    /// @notice Rotates the deployer wallet — e.g. if the backend's signing
    /// key is ever rotated for operational reasons. Owner-only.
    function setDeployer(address newDeployer) external onlyOwner {
        if (newDeployer == address(0)) revert ZeroAddress();
        emit DeployerUpdated(deployer, newDeployer);
        deployer = newDeployer;
    }

    /// @notice Deploys a new `Bag` for `bagId` and registers it. Reverts if
    /// `bagId` already has a deployed Bag (spec section 17: "same bag ->
    /// cannot deploy twice") — this is the on-chain half of duplicate
    /// prevention; the off-chain half is `bag_deployments`' `NOT_DEPLOYED`
    /// pre-check in `lib/server/bag-deployment-repo.ts`, which exists so a
    /// double-submit never even reaches an RPC call, but this on-chain
    /// check is what makes duplicate deployment impossible even if that
    /// off-chain guard is ever bypassed or racy. Restricted to `deployer`
    /// (see that field's NatSpec) — without this, anyone could call
    /// `createBag` directly with an arbitrary `creator` address for any
    /// not-yet-used `bagId`, registering junk under someone else's name;
    /// spec section 15 is explicit that ownership checks must never be
    /// left to the frontend alone, and the same principle applies here.
    /// @param bagId The off-chain Supabase `bags.id` (UUID), encoded as
    /// bytes32 by the caller — see `lib/domain/basket-protocol/onchain.ts`'s
    /// `computeOnChainBagId()` for the exact encoding (the UUID's 32 hex
    /// chars with dashes removed, left-padded to 32 bytes; NOT a hash of
    /// the UUID, so it round-trips).
    /// @param creator Wallet address of the Bag's creator. The caller
    /// (`lib/server/deploy-bag.ts`) is responsible for having already
    /// verified this is the session-authenticated creator's own wallet —
    /// this contract has no way to check that itself (spec section 15).
    /// @param compositionHash keccak256 of the canonical composition
    /// string — see `Bag.sol`'s `compositionHash` NatSpec for the exact
    /// preimage format. Passed straight through from
    /// `computeOnChainCompositionHash()` (`lib/domain/basket-protocol/
    /// onchain.ts`), which is deliberately built as a keccak256 of the SAME
    /// canonical serialization `computeCompositionHash()` (Phase 1) already
    /// sorts by symbol before hashing — see the Phase 4 report's
    /// "Composition Hash" section for why the two hash functions differ but
    /// agree on canonicalization.
    function createBag(
        bytes32 bagId,
        address creator,
        bytes32 compositionHash,
        string calldata metadataURI
    ) external onlyDeployer returns (address bag) {
        if (creator == address(0)) revert ZeroAddress();
        if (bagOf[bagId] != address(0)) revert AlreadyDeployed(bagId, bagOf[bagId]);

        bag = address(new Bag(bagId, creator, compositionHash, metadataURI));

        bagOf[bagId] = bag;
        bagsByCreator[creator].push(bagId);

        emit BagCreated(bagId, creator, bag, compositionHash, 1);
    }

    /// @notice Number of Bags a given creator has deployed through this factory.
    function bagCountOf(address creator) external view returns (uint256) {
        return bagsByCreator[creator].length;
    }
}
