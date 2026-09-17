// -----------------------------------------------------------------------------
// Blockchain adapter interface.
//
// Nothing in this MVP touches a real chain — every write in the app goes
// through the domain services in `lib/services`, which persist to the local
// database stand-in (localStorage today, a real DB later). This interface is
// the seam where a real chain gets plugged in later without having to touch
// UI or domain logic: swap `mockAdapter` for a `RobinhoodChainAdapter` that
// implements the same shape.
// -----------------------------------------------------------------------------

export interface MintNFTParams {
  ownerAddress: string;
  bagNftId: string;
  metadataUri: string;
}

export interface TransferNFTParams {
  fromAddress: string;
  toAddress: string;
  tokenId: string;
}

// ----------------------------- Bag deployment (Phase 4) --------------------------

// Deliberately minimal — deployment/orchestration only. No NAV, no token,
// no mint/redeem here; see lib/blockchain/evm/factory-abi.ts and
// contracts/BagFactory.sol for the on-chain counterpart's equally minimal
// scope.
export interface DeployBagParams {
  /** bytes32 (0x-prefixed, 66 chars) — from computeOnChainBagId(), the UUID encoded directly (round-trippable), not hashed. */
  onChainBagId: `0x${string}`;
  /** bytes32 (0x-prefixed, 66 chars) — from computeOnChainCompositionHash(). */
  compositionHash: `0x${string}`;
  /** The real Bag creator's wallet address — recorded on-chain via an explicit param, NOT msg.sender (the deployer/relayer wallet sends the tx; see BagFactory.sol). */
  creatorAddress: string;
  metadataURI: string;
}

export interface DeployBagResult {
  contractAddress: string;
  txHash: string;
  blockNumber: number;
}

export interface BlockchainAdapter {
  readonly name: string;
  readonly isLive: boolean;

  mintNFT(params: MintNFTParams): Promise<string>;
  transferNFT(params: TransferNFTParams): Promise<string>;
  getBalance(address: string): Promise<string>;

  /** Deploys a new on-chain Bag instance via BagFactory.createBag() (or a mock equivalent) and waits for confirmation. Throws on revert/failure — never returns a partial/unconfirmed result. */
  deployBag(params: DeployBagParams): Promise<DeployBagResult>;
}
