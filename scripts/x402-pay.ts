/**
 * x402 paying-client demo — "agent as customer" against webcap's
 * POST /v1/x402/capture. The payer EOA signs a gasless EIP-3009
 * transferWithAuthorization (no tx is broadcast by the payer; the facilitator
 * submits it and pays gas), and the @x402/axios wrapper handles
 * 402 -> sign PAYMENT-SIGNATURE -> retry.
 *
 * Usage:
 *   X402_CUSTOMER_PRIVATE_KEY=0x... npx tsx scripts/x402-pay.ts <url> [base-url]
 *
 * Env:
 *   X402_CUSTOMER_PRIVATE_KEY  payer EOA private key (needs USDC on the
 *                              challenge's network, e.g. Base-sepolia faucet;
 *                              no ETH/gas required)
 *   X402_BASE_URL              webcap base URL (default http://localhost:8080)
 */
import axios, { type AxiosResponse } from 'axios';
import { decodePaymentResponseHeader, x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const BASE_URL = process.env.X402_BASE_URL ?? 'http://localhost:8080';
const targetUrl = process.argv[2];
const baseUrlArg = process.argv[3];
const baseUrl = baseUrlArg !== undefined ? baseUrlArg.replace(/\/+$/, '') : BASE_URL;

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const rawKey = process.env.X402_CUSTOMER_PRIVATE_KEY ?? '';
if (targetUrl === undefined) {
  fail('usage: npx tsx scripts/x402-pay.ts <url> [base-url]');
}
if (rawKey === '') {
  fail('X402_CUSTOMER_PRIVATE_KEY is required (payer EOA; gasless — needs USDC only)');
}
if (!/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
  fail('X402_CUSTOMER_PRIVATE_KEY must be 0x-prefixed 32-byte hex');
}
const privateKey = rawKey as `0x${string}`;

const account = privateKeyToAccount(privateKey);
const client = new x402Client().register('eip155:*', new ExactEvmScheme(account));

async function main(): Promise<void> {
  // Step 1: the raw 402 challenge (what any agent sees before paying).
  let challengeResponse: AxiosResponse | undefined;
  try {
    await axios.post(`${baseUrl}/v1/x402/capture`, { url: targetUrl });
    fail('expected 402 before payment but the request succeeded — is the route x402-gated?');
  } catch (err) {
    challengeResponse = (err as { response?: AxiosResponse }).response;
  }
  if (challengeResponse === undefined || challengeResponse.status !== 402) {
    fail(`expected 402 challenge, got ${challengeResponse?.status ?? 'no response'}`);
  }
  const challenge = decodePaymentRequiredHeader(String(challengeResponse.headers['payment-required']));
  const offer = challenge.accepts[0];
  console.log(`payer:      ${account.address}`);
  console.log(`challenge:  x402Version=${challenge.x402Version} scheme=${offer?.scheme} network=${offer?.network}`);
  console.log(`offer:      amount=${offer?.amount} asset=${offer?.asset} payTo=${offer?.payTo}`);
  console.log(`             timeout=${offer?.maxTimeoutSeconds}s eip712=${JSON.stringify(offer?.extra)}`);

  // Step 2: pay — 402 -> sign EIP-3009 (gasless) -> retry with PAYMENT-SIGNATURE.
  const api = wrapAxiosWithPayment(axios.create({ baseURL: baseUrl }), client);
  const res = await api.post('/v1/x402/capture', { url: targetUrl });
  if (res.status === 402) {
    const rejected = decodePaymentRequiredHeader(String(res.headers['payment-required']));
    fail(`payment rejected: ${rejected.error ?? 'unknown reason'}`);
  }
  if (res.status < 200 || res.status >= 300) {
    fail(`paid request failed with status ${res.status}`);
  }

  const body = res.data as {
    artifact?: { format?: string; bytes?: number; data?: string };
    payment?: { payer?: string; priceUsdcUnits?: number };
  };
  const data = body.artifact?.data ?? '';
  console.log('served:     200 OK');
  console.log(`artifact:   format=${body.artifact?.format} bytes=${body.artifact?.bytes} data=${data.slice(0, 64)}...`);
  console.log(`payment:    payer=${body.payment?.payer} priceUsdcUnits=${body.payment?.priceUsdcUnits}`);

  // Step 3: the settlement receipt (the facilitator's on-chain USDC transfer).
  const paymentResponse = String(res.headers['payment-response'] ?? res.headers['x-payment-response'] ?? '');
  if (paymentResponse !== '') {
    const settlement = decodePaymentResponseHeader(paymentResponse);
    console.log(`settlement: success=${settlement.success} tx=${settlement.transaction} network=${settlement.network}`);
    console.log(`             payer=${settlement.payer}`);
    if (settlement.transaction !== '') {
      const explorerBase = settlement.network === 'eip155:84532' ? 'https://sepolia.basescan.org' : 'https://basescan.org';
      console.log(`explorer:   ${explorerBase}/tx/${settlement.transaction}`);
    }
  } else {
    console.warn('settlement: no PAYMENT-RESPONSE header in response');
  }
  console.log('PASS: x402 payment accepted, settled, capture served');
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
