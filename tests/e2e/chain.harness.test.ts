import { beforeAll, describe, expect, it } from 'vitest';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { loadTestChain, type TestChain } from '../helpers/chain.js';
import {
  TRANSFER_TOPIC,
  contractMethod,
  decodeTransferLog,
  encodeAddressTopic,
  makeUsdcContract,
} from '../../src/payment/erc20.js';

const TRANSFER_ABI: readonly string[] = ['function transfer(address to, uint256 amount) returns (bool)'];

describe('chain harness: anvil + MintableUSDC (on-chain detection critical path)', () => {
  let chain: TestChain;
  let provider: JsonRpcProvider;
  let usdc: Contract;

  beforeAll(() => {
    chain = loadTestChain();
    provider = new JsonRpcProvider(chain.rpcUrl, undefined, { cacheTimeout: -1 });
    usdc = makeUsdcContract(chain.rpcUrl, chain.usdcContract);
  });

  it('deployed contract reports USDC with 6 decimals', async () => {
    expect(await contractMethod(usdc, 'symbol')()).toBe('USDC');
    expect(Number(await contractMethod(usdc, 'decimals')())).toBe(6);
  });

  it('detects a real USDC transfer to the merchant via eth_getLogs', async () => {
    const customer = new Wallet(chain.customer.privateKey, provider);
    const sender = new Contract(chain.usdcContract, TRANSFER_ABI, customer);
    const balanceOf = contractMethod(usdc, 'balanceOf');
    const before = await balanceOf(chain.merchant.address);

    const transfer = contractMethod(sender, 'transfer');
    const receipt = await (await transfer(chain.merchant.address, 50_000n)).wait(); // 0.05 USDC
    expect(receipt?.status).toBe(1);

    const logs = await provider.getLogs({
      address: chain.usdcContract,
      topics: [TRANSFER_TOPIC, null, encodeAddressTopic(chain.merchant.address)],
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);

    const last = logs.at(-1);
    if (last === undefined) throw new Error('no Transfer log found for the merchant');
    const decoded = decodeTransferLog(last);
    expect(decoded.from).toBe(chain.customer.address);
    expect(decoded.to).toBe(chain.merchant.address);
    expect(decoded.value).toBe(50_000n);
    expect(await balanceOf(chain.merchant.address)).toBe(before + 50_000n);
  });
});
