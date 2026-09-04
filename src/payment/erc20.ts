import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  getAddress,
  id,
  isAddress,
  zeroPadValue,
  type BaseContractMethod,
} from 'ethers';

/** Read-only + balance ABI subset the service needs (payments are detected, not sent). */
export const usdcAbi: readonly string[] = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
];

/** Topic of the ERC-20 Transfer event. */
export const TRANSFER_TOPIC: string = id('Transfer(address,address,uint256)');

/** Minimal log shape (satisfied by ethers' `Log` from `provider.getLogs`). */
export interface TransferLog {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
}

export interface TransferPayload {
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
}

/**
 * Extract a dynamically-typed Contract method, throwing when the ABI does not
 * provide it. Needed because strict TS types index-signature access as
 * `BaseContractMethod | undefined`.
 */
export function contractMethod(contract: Contract, name: string): BaseContractMethod {
  const method = contract[name];
  if (typeof method !== 'function') throw new Error(`contract has no method: ${name}`);
  return method;
}

/** Right-justify an address into the 32-byte indexed topic form. */
export function encodeAddressTopic(address: string): string {
  if (!isAddress(address)) throw new Error(`invalid address: ${address}`);
  return zeroPadValue(address.toLowerCase(), 32);
}

/** Decode an ERC-20 Transfer log into from/to/value. Throws if not a Transfer. */
export function decodeTransferLog(log: TransferLog): TransferPayload {
  const topic0 = log.topics[0];
  if (topic0 !== TRANSFER_TOPIC) throw new Error('log is not an ERC-20 Transfer');
  const fromTopic = log.topics[1];
  const toTopic = log.topics[2];
  if (fromTopic === undefined || toTopic === undefined) {
    throw new Error('Transfer log is missing indexed topics');
  }
  const [value] = AbiCoder.defaultAbiCoder().decode(['uint256'], log.data);
  return {
    from: getAddress(fromTopic.slice(26)),
    to: getAddress(toTopic.slice(26)),
    value,
  };
}

export function makeUsdcContract(rpcUrl: string, address: string): Contract {
  // cacheTimeout: -1 — the service must read fresh on-chain state (balances,
  // nonces); ethers 6.17's default 250ms response cache is stale by design
  // here (see scripts/devchain.ts).
  const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
  return new Contract(address, usdcAbi, provider);
}
