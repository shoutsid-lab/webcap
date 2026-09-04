import { isAddress, isHex, verifyTypedData } from 'viem';
import type { FacilitatorClient } from '@x402/core/server';
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types';

const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const AUTH_FIELDS = ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'] as const;

// Canonical EIP-712 domains of the chain USDC deploys (matches src/server/x402.ts).
const EIP712_DOMAINS: Record<string, { name: string; version: string; chainId: number }> = {
  'eip155:84532': { name: 'USDC', version: '2', chainId: 84532 },
  'eip155:8453': { name: 'USD Coin', version: '2', chainId: 8453 },
};

export const MOCK_SETTLE_TX = '0xabababababababababababababababababababababababababababababababab';

export interface Eip3009Authorization {
  readonly from: string;
  readonly to: string;
  readonly value: string;
  readonly validAfter: string;
  readonly validBefore: string;
  readonly nonce: string;
}

function extractAuthorization(payload: Record<string, unknown>): Eip3009Authorization | undefined {
  const auth = payload['authorization'];
  if (typeof auth !== 'object' || auth === null) return undefined;
  const record = auth as Record<string, unknown>;
  if (!AUTH_FIELDS.every((field) => typeof record[field] === 'string')) return undefined;
  return {
    from: record['from'] as string,
    to: record['to'] as string,
    value: record['value'] as string,
    validAfter: record['validAfter'] as string,
    validBefore: record['validBefore'] as string,
    nonce: record['nonce'] as string,
  };
}

export interface MockFacilitatorCalls {
  verify: number;
  settle: number;
  getSupported: number;
}

export interface SettlementRecord {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
}

export interface MockFacilitator {
  readonly facilitator: FacilitatorClient;
  readonly calls: MockFacilitatorCalls;
  readonly settlements: SettlementRecord[];
}

/**
 * In-memory FacilitatorClient fake. verify() performs the same off-chain
 * checks the reference facilitator does (field checks + EIP-712 signature
 * recovery via viem); settle() records the settlement and reports success.
 * No chain access — real on-chain settlement is proven at deploy time.
 */
export function makeMockFacilitator(network: Network): MockFacilitator {
  const domain = EIP712_DOMAINS[network];
  if (domain === undefined) throw new Error(`mock facilitator has no domain for network: ${network}`);
  const calls: MockFacilitatorCalls = { verify: 0, settle: 0, getSupported: 0 };
  const settlements: SettlementRecord[] = [];

  const invalid = (reason: string): VerifyResponse => ({ isValid: false, invalidReason: reason });

  const verify = async (paymentPayload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> => {
    calls.verify += 1;
    const signature = paymentPayload.payload['signature'];
    const auth = extractAuthorization(paymentPayload.payload);
    if (typeof signature !== 'string' || !isHex(signature) || auth === undefined) {
      return invalid('invalid_exact_evm_payload');
    }
    if (!isAddress(auth.from) || !isAddress(auth.to)) return invalid('invalid_exact_evm_payload');
    if (!isAddress(requirements.asset)) return invalid('invalid_exact_evm_payload_asset');
    if (auth.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return invalid('invalid_exact_evm_payload_recipient_mismatch');
    }
    // v2 exact scheme: the authorized value must equal the required amount.
    if (auth.value !== requirements.amount) return invalid('invalid_exact_evm_payload_authorization_value');
    const now = Math.floor(Date.now() / 1000);
    const validAfter = Number(auth.validAfter);
    const validBefore = Number(auth.validBefore);
    if (!Number.isFinite(validAfter) || validAfter > now) {
      return invalid('invalid_exact_evm_payload_authorization_valid_after');
    }
    if (!Number.isFinite(validBefore) || validBefore < now + 6) {
      return invalid('invalid_exact_evm_payload_authorization_valid_before');
    }
    // bytes32 nonce on the wire is 0x + 64 hex chars.
    if (!isHex(auth.nonce) || auth.nonce.length !== 66) return invalid('invalid_exact_evm_payload_nonce');
    const extra = requirements.extra;
    const name = typeof extra?.['name'] === 'string' ? extra['name'] : domain.name;
    const version = typeof extra?.['version'] === 'string' ? extra['version'] : domain.version;
    try {
      const matchesSigner = await verifyTypedData({
        address: auth.from,
        domain: { name, version, chainId: domain.chainId, verifyingContract: requirements.asset },
        types: AUTHORIZATION_TYPES,
        primaryType: 'TransferWithAuthorization',
        signature,
        message: {
          from: auth.from,
          to: auth.to,
          value: BigInt(auth.value),
          validAfter: BigInt(auth.validAfter),
          validBefore: BigInt(auth.validBefore),
          nonce: auth.nonce,
        },
      });
      if (!matchesSigner) return invalid('invalid_exact_evm_payload_signature');
    } catch {
      return invalid('invalid_exact_evm_payload_signature');
    }
    return { isValid: true, payer: auth.from };
  };

  const settle = async (paymentPayload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> => {
    calls.settle += 1;
    settlements.push({ payload: paymentPayload, requirements });
    const auth = extractAuthorization(paymentPayload.payload);
    return {
      success: true,
      transaction: MOCK_SETTLE_TX,
      network: requirements.network,
      payer: auth?.from ?? '',
      amount: requirements.amount,
    };
  };

  const getSupported = async (): Promise<SupportedResponse> => {
    calls.getSupported += 1;
    return { kinds: [{ x402Version: 2, scheme: 'exact', network }], extensions: [], signers: {} };
  };

  return { facilitator: { verify, settle, getSupported }, calls, settlements };
}
