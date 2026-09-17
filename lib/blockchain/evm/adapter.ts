import { decodeEventLog } from 'viem';
import { BlockchainAdapter, DeployBagParams, DeployBagResult, MintNFTParams, TransferNFTParams } from '../adapter';
import { ChainId } from '@/types/basket-protocol';
import { getEvmChainConfig } from './config';
import { createEvmPublicClient, createEvmWalletClient } from './client';
import { bagFactoryAbi } from './factory-abi';

// -----------------------------------------------------------------------------
// Real on-chain counterpart to MockAdapter, scoped to Bag deployment only
// (Phase 4). mintNFT/transferNFT intentionally throw — this project's NFT
// flow (lib/domain/nft, lib/services/nft-service.ts) still runs entirely
// against `mockAdapter` (lib/blockchain/mock-adapter.ts's `blockchainAdapter`
// export, unchanged); wiring that to a real chain is a separate, later
// decision this phase does not make. `createEvmAdapter()` is only ever
// reached from lib/server/deploy-bag.ts's chain-based selection, never from
// the existing NFT code path.
// -----------------------------------------------------------------------------

const NOT_IMPLEMENTED = 'EvmAdapter only implements deployBag()/getBalance() (Phase 4 scope) — NFT minting/transfer still goes through mockAdapter.';

/** One adapter instance per chain — a chain's RPC/factory config is resolved once, at construction, so a misconfigured chain fails fast (before any deploy attempt) rather than deep inside deployBag(). */
export function createEvmAdapter(chain: ChainId): BlockchainAdapter {
  const config = getEvmChainConfig(chain);

  return {
    name: `evm:${chain}`,
    isLive: true,

    async mintNFT(_params: MintNFTParams): Promise<string> {
      throw new Error(NOT_IMPLEMENTED);
    },

    async transferNFT(_params: TransferNFTParams): Promise<string> {
      throw new Error(NOT_IMPLEMENTED);
    },

    async getBalance(address: string): Promise<string> {
      const publicClient = createEvmPublicClient(config);
      const balance = await publicClient.getBalance({ address: address as `0x${string}` });
      return balance.toString();
    },

    async deployBag(params: DeployBagParams): Promise<DeployBagResult> {
      const publicClient = createEvmPublicClient(config);
      const walletClient = createEvmWalletClient(config);
      if (!walletClient.account) {
        throw new Error('DEPLOYER_PRIVATE_KEY did not resolve to a signing account.');
      }

      const txHash = await walletClient.writeContract({
        address: config.factoryAddress,
        abi: bagFactoryAbi,
        functionName: 'createBag',
        args: [params.onChainBagId, params.creatorAddress as `0x${string}`, params.compositionHash, params.metadataURI],
        chain: config.viemChain,
        account: walletClient.account,
      });

      // Wait for confirmation — spec section 14 is explicit that "tx sent"
      // must never be treated as "deployed"; only a mined receipt is.
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status !== 'success') {
        throw new Error(`Bag deployment transaction reverted (tx ${txHash}).`);
      }

      const bagCreatedLog = receipt.logs
        .map((log) => {
          try {
            return decodeEventLog({ abi: bagFactoryAbi, data: log.data, topics: log.topics });
          } catch {
            return null;
          }
        })
        .find((decoded) => decoded?.eventName === 'BagCreated');

      if (!bagCreatedLog || bagCreatedLog.eventName !== 'BagCreated') {
        throw new Error(`Deployment tx ${txHash} confirmed but no BagCreated event was found in its logs.`);
      }

      return {
        contractAddress: bagCreatedLog.args.bag,
        txHash,
        blockNumber: Number(receipt.blockNumber),
      };
    },
  };
}
