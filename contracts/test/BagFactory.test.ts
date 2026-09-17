import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { keccak256, toHex, zeroAddress } from 'viem';

// -----------------------------------------------------------------------------
// UPDATE (Phase 19.X-A): the sandbox's network-access limitation described
// below has been worked around — see hardhat.config.ts, which now points
// `solidity.path` at the `solc` npm package's bundled WASM build instead of
// letting Hardhat download its own copy from binaries.soliditylang.org
// (blocked here). With that in place, `npx hardhat test` now actually runs
// in this environment, and this file's tests are confirmed passing (see the
// Phase 19.X-A report). Original note, kept for history:
//
// "NOT VERIFIED IN THE ENVIRONMENT THAT WROTE THIS FILE — `npx hardhat
// compile` fails here because the sandbox's network egress allowlist
// blocks binaries.soliditylang.org (Hardhat's solc download source)."
// -----------------------------------------------------------------------------

async function setup() {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const [owner, deployer, creator, other] = await viem.getWalletClients();
  const factory = await viem.deployContract('BagFactory', [deployer.account.address]);
  const factoryAsDeployer = await viem.getContractAt('BagFactory', factory.address, { client: { wallet: deployer } });
  return { viem, factory, factoryAsDeployer, publicClient, owner, deployer, creator, other };
}

function bagIdFromUuid(uuid: string): `0x${string}` {
  const hex = uuid.replace(/-/g, '');
  return `0x${hex.padStart(64, '0')}`;
}

function fakeCompositionHash(seed: string): `0x${string}` {
  return keccak256(toHex(seed));
}

describe('BagFactory', () => {
  it('deploys and reports the configured deployer address', async () => {
    const { factory, deployer } = await setup();
    assert.notEqual(factory.address, zeroAddress);
    assert.equal(((await factory.read.deployer()) as string).toLowerCase(), deployer.account.address.toLowerCase());
  });

  it('createBag: deploys a Bag instance and registers it under bagOf(bagId)', async () => {
    const { viem, factoryAsDeployer, factory, creator } = await setup();

    const bagId = bagIdFromUuid('11111111-1111-1111-1111-111111111111');
    const compositionHash = fakeCompositionHash('BTC:6000|ETH:4000');

    await factoryAsDeployer.write.createBag([bagId, creator.account.address, compositionHash, 'bag:test-1']);

    const bagAddress = (await factory.read.bagOf([bagId])) as string;
    assert.notEqual(bagAddress, zeroAddress);

    const bag = await viem.getContractAt('Bag', bagAddress as `0x${string}`);
    assert.equal(((await bag.read.creator()) as string).toLowerCase(), creator.account.address.toLowerCase());
    assert.equal((await bag.read.compositionHash()) as string, compositionHash);
    assert.equal((await bag.read.version()) as bigint, 1n);
    assert.equal(((await bag.read.factory()) as string).toLowerCase(), factory.address.toLowerCase());
  });

  it('same composition hash stored verbatim across two different bags (hash itself is computed off-chain — see lib/domain/basket-protocol/onchain.test.ts)', async () => {
    const { viem, factoryAsDeployer, factory, creator } = await setup();

    const hash = fakeCompositionHash('BTC:6000|ETH:4000');
    const bagIdA = bagIdFromUuid('22222222-2222-2222-2222-222222222222');
    const bagIdB = bagIdFromUuid('33333333-3333-3333-3333-333333333333');

    await factoryAsDeployer.write.createBag([bagIdA, creator.account.address, hash, 'bag:a']);
    await factoryAsDeployer.write.createBag([bagIdB, creator.account.address, hash, 'bag:b']);

    const bagA = await viem.getContractAt('Bag', (await factory.read.bagOf([bagIdA])) as `0x${string}`);
    const bagB = await viem.getContractAt('Bag', (await factory.read.bagOf([bagIdB])) as `0x${string}`);
    assert.equal(await bagA.read.compositionHash(), await bagB.read.compositionHash());
  });

  it('cannot deploy the same bagId twice — reverts with AlreadyDeployed', async () => {
    const { factoryAsDeployer, creator } = await setup();

    const bagId = bagIdFromUuid('44444444-4444-4444-4444-444444444444');
    const hash = fakeCompositionHash('BTC:10000');

    await factoryAsDeployer.write.createBag([bagId, creator.account.address, hash, 'bag:dup']);

    await assert.rejects(
      factoryAsDeployer.write.createBag([bagId, creator.account.address, hash, 'bag:dup-2']),
      /AlreadyDeployed/
    );
  });

  it('emits BagCreated with bagId, creator, bag address, compositionHash, version', async () => {
    const { factoryAsDeployer, factory, creator, publicClient } = await setup();

    const bagId = bagIdFromUuid('55555555-5555-5555-5555-555555555555');
    const hash = fakeCompositionHash('BTC:10000');

    const txHash = await factoryAsDeployer.write.createBag([bagId, creator.account.address, hash, 'bag:event']);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const events = await publicClient.getContractEvents({
      address: factory.address,
      abi: factory.abi,
      eventName: 'BagCreated',
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });

    assert.equal(events.length, 1);
    const event = events[0];
    assert.equal(event.args.bagId, bagId);
    assert.equal((event.args.creator as string).toLowerCase(), creator.account.address.toLowerCase());
    assert.equal(event.args.compositionHash, hash);
    assert.equal(event.args.version, 1n);
    assert.notEqual(event.args.bag, zeroAddress);
  });

  it('access control: a non-deployer wallet cannot call createBag', async () => {
    const { viem, factory, other, creator } = await setup();
    const factoryAsOther = await viem.getContractAt('BagFactory', factory.address, { client: { wallet: other } });

    const bagId = bagIdFromUuid('66666666-6666-6666-6666-666666666666');
    const hash = fakeCompositionHash('BTC:10000');

    await assert.rejects(
      factoryAsOther.write.createBag([bagId, creator.account.address, hash, 'bag:forbidden']),
      /NotDeployer/
    );
  });

  it('access control: owner can rotate the deployer wallet, old deployer loses access', async () => {
    const { viem, factory, owner, deployer, other, creator } = await setup();

    const factoryAsOwner = await viem.getContractAt('BagFactory', factory.address, { client: { wallet: owner } });
    await factoryAsOwner.write.setDeployer([other.account.address]);
    assert.equal(((await factory.read.deployer()) as string).toLowerCase(), other.account.address.toLowerCase());

    const factoryAsOldDeployer = await viem.getContractAt('BagFactory', factory.address, { client: { wallet: deployer } });
    const bagId = bagIdFromUuid('77777777-7777-7777-7777-777777777777');
    await assert.rejects(
      factoryAsOldDeployer.write.createBag([bagId, creator.account.address, fakeCompositionHash('x'), 'bag:x']),
      /NotDeployer/
    );
  });
});
