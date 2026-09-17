import { BlockchainAdapter, DeployBagParams, DeployBagResult, MintNFTParams, TransferNFTParams } from './adapter';

let mockBlockNumber = 1_000_000;
const mockDeployedBagIds = new Set<string>();

function fakeTxHash(): string {
  const hex = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `0x${hex}`;
}

function fakeContractAddress(): string {
  const hex = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `0x${hex}`;
}

/**
 * Mock adapter — simulates chain latency and returns fake tx hashes.
 * Every NFT stays `blockchainStatus: 'OFFCHAIN'` in the database regardless
 * of what this returns; nothing here is authoritative.
 */
export const mockAdapter: BlockchainAdapter = {
  name: 'mock',
  isLive: false,

  async mintNFT(_params: MintNFTParams): Promise<string> {
    await new Promise((r) => setTimeout(r, 250));
    return fakeTxHash();
  },

  async transferNFT(_params: TransferNFTParams): Promise<string> {
    await new Promise((r) => setTimeout(r, 250));
    return fakeTxHash();
  },

  async getBalance(_address: string): Promise<string> {
    return '0';
  },

  async deployBag(params: DeployBagParams): Promise<DeployBagResult> {
    await new Promise((r) => setTimeout(r, 250));
    // Mirrors BagFactory.sol's `BagAlreadyDeployed` revert — a caller
    // driving both a real EvmAdapter and this MockAdapter through the same
    // orchestrator (lib/server/deploy-bag.ts) should see the same failure
    // mode from either.
    if (mockDeployedBagIds.has(params.onChainBagId)) {
      throw new Error(`BagAlreadyDeployed: ${params.onChainBagId}`);
    }
    mockDeployedBagIds.add(params.onChainBagId);
    mockBlockNumber += 1;
    return {
      contractAddress: fakeContractAddress(),
      txHash: fakeTxHash(),
      blockNumber: mockBlockNumber,
    };
  },
};

// Swap this export for a real adapter (e.g. a Robinhood Chain adapter) once
// mainnet integration begins — nothing else in the codebase needs to change.
export const blockchainAdapter: BlockchainAdapter = mockAdapter;
