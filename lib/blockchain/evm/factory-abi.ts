// -----------------------------------------------------------------------------
// Mirrors contracts/BagFactory.sol EXACTLY — deployment/orchestration
// surface only. If this ever needs a new entry, BagFactory.sol needs the
// matching function/event first; this file should never grow ahead of the
// actual contract.
// -----------------------------------------------------------------------------
export const bagFactoryAbi = [
  {
    type: 'function',
    name: 'createBag',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'bagId', type: 'bytes32' },
      { name: 'creator', type: 'address' },
      { name: 'compositionHash', type: 'bytes32' },
      { name: 'metadataURI', type: 'string' },
    ],
    outputs: [{ name: 'bag', type: 'address' }],
  },
  {
    type: 'function',
    name: 'bagOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'bagCountOf',
    stateMutability: 'view',
    inputs: [{ name: 'creator', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'BagCreated',
    inputs: [
      { name: 'bagId', type: 'bytes32', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'bag', type: 'address', indexed: false },
      { name: 'compositionHash', type: 'bytes32', indexed: false },
      { name: 'version', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'error',
    name: 'AlreadyDeployed',
    inputs: [
      { name: 'bagId', type: 'bytes32' },
      { name: 'existing', type: 'address' },
    ],
  },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'NotOwner', inputs: [] },
  { type: 'error', name: 'NotDeployer', inputs: [] },
] as const;
