import { describe, expect, it } from 'vitest';
import { getAddress, id } from 'ethers';
import {
  TRANSFER_TOPIC,
  decodeTransferLog,
  encodeAddressTopic,
  type TransferLog,
} from '../../src/payment/erc20.js';

const fromAddr = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // anvil account 0
const toAddr = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // anvil account 1
const value = 12_345n;

function buildTransferLog(): TransferLog {
  return {
    address: `0x${'11'.repeat(20)}`,
    topics: [TRANSFER_TOPIC, encodeAddressTopic(fromAddr), encodeAddressTopic(toAddr)],
    data: `0x${value.toString(16).padStart(64, '0')}`,
  };
}

describe('payment/erc20', () => {
  it('TRANSFER_TOPIC is the keccak256 of Transfer(address,address,uint256)', () => {
    expect(TRANSFER_TOPIC).toBe(id('Transfer(address,address,uint256)'));
  });

  it('encodeAddressTopic pads an address into a 32-byte hex topic', () => {
    const topic = encodeAddressTopic(fromAddr);
    expect(topic).toMatch(/^0x[0-9a-f]{64}$/);
    expect(topic).toBe(`0x${fromAddr.slice(2).toLowerCase().padStart(64, '0')}`);
  });

  it('decodeTransferLog round-trips from/to/value of a hand-built log', () => {
    const decoded = decodeTransferLog(buildTransferLog());
    expect(decoded.from).toBe(getAddress(fromAddr));
    expect(decoded.to).toBe(getAddress(toAddr));
    expect(decoded.value).toBe(value);
  });
});
