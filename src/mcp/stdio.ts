#!/usr/bin/env node
/**
 * webcap MCP server — newline-delimited JSON-RPC over stdio.
 *
 * Wire it into any MCP host (Claude Desktop, Cursor, agent frameworks):
 *
 *   {
 *     "mcpServers": {
 *       "webcap": { "command": "node", "args": ["/path/to/webcap/dist/mcp/stdio.js"] }
 *     }
 *   }
 *
 * From this repo: `npm run mcp` (or `node dist/mcp/stdio.js`). Not on npm yet:
 * the unscoped `webcap` name is an unrelated package, so a publish must be scoped.
 *
 * Free tools work with no configuration. To let paid tools (capture, extract,
 * audit, map-lite, video, analyze) settle automatically, set
 * WEBCAP_MCP_WALLET_KEY (or X402_CUSTOMER_PRIVATE_KEY) to a Base-mainnet USDC
 * EOA key: the payer is gasless (it signs EIP-3009; the facilitator pays gas).
 * With no key, paid tools return the x402 402 challenge so the host can pay.
 * Alternative with no wallet at all: WEBCAP_MCP_API_KEY to an operator-funded
 * account key (POST /v1/register, then fund via POST /v1/invoice) — paid
 * tools bill 1 credit each from that balance. A configured wallet wins over
 * the account key.
 *
 * stdout carries the protocol only; diagnostics go to stderr.
 */
import { createInterface } from 'node:readline';
import axios, { type AxiosResponse } from 'axios';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { handleRpc, MCP_SERVER_VERSION, type McpHttp, type McpResponse } from './server.js';

const DEFAULT_BASE_URL = 'https://webcap.shoutsid.fyi';
const TIMEOUT_MS = 120_000;

function log(msg: string): void {
  process.stderr.write(`webcap-mcp: ${msg}\n`);
}

function toResponse(res: AxiosResponse): McpResponse {
  return { status: res.status, body: res.data };
}

function baseUrl(): string {
  const raw = process.env.WEBCAP_MCP_BASE_URL ?? process.env.WEBCAP_BASE_URL ?? DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

/** The plain client accepts every status so a 402 body reaches the tool layer. */
function plainClient(base: string) {
  return axios.create({ baseURL: base, timeout: TIMEOUT_MS, validateStatus: () => true });
}

/** The paying client: 402 -> sign EIP-3009 -> retry with PAYMENT-SIGNATURE. */
async function payingClient(base: string): Promise<ReturnType<typeof wrapAxiosWithPayment> | undefined> {
  const raw = (process.env.WEBCAP_MCP_WALLET_KEY ?? process.env.X402_CUSTOMER_PRIVATE_KEY ?? '').trim();
  if (raw === '') return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    log('WEBCAP_MCP_WALLET_KEY is not 0x-prefixed 32-byte hex; paid tools will return the 402 challenge');
    return undefined;
  }
  try {
    const account = privateKeyToAccount(raw as `0x${string}`);
    const client = new x402Client().register('eip155:*', new ExactEvmScheme(account));
    log(`payer configured: ${account.address}`);
    return wrapAxiosWithPayment(axios.create({ baseURL: base, timeout: TIMEOUT_MS }), client);
  } catch (err) {
    log(`could not build the payer client (${err instanceof Error ? err.message : String(err)}); paid tools will return the 402 challenge`);
    return undefined;
  }
}

async function main(): Promise<void> {
  const base = baseUrl();
  const plain = plainClient(base);
  const paying = await payingClient(base);
  const creditKey = paying !== undefined ? undefined : (process.env.WEBCAP_MCP_API_KEY ?? '').trim() || undefined;

  const http: McpHttp = {
    async request(method, path, body, headers) {
      try {
        // Free tools are all GETs; paid tools are POSTs and may auto-pay.
        const res =
          method === 'GET'
            ? await plain.get(path, { headers })
            : await (paying ?? plain).post(path, body ?? {}, { headers });
        return toResponse(res as AxiosResponse);
      } catch (err) {
        // The paying wrapper can still throw on an unrecoverable 402/5xx; surface the body.
        const response = (err as { response?: AxiosResponse }).response;
        if (response !== undefined) return toResponse(response);
        throw err;
      }
    },
  };

  const ctx = { baseUrl: base, version: MCP_SERVER_VERSION, http, canPay: paying !== undefined, ...(creditKey !== undefined ? { creditKey } : {}) };
  log(
    `webcap MCP server ready (base ${base}, paid ${paying !== undefined ? 'wallet' : creditKey !== undefined ? 'account-credits' : 'return-402'})`,
  );

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // A host keeps stdin open, so calls resolve long before EOF. On EOF (piped
  // input, host shutdown) we must still flush in-flight responses rather than
  // exiting under them — so track pending handlers and exit only when drained.
  let pending = 0;
  let closed = false;
  const maybeExit = (): void => {
    if (closed && pending === 0) process.exit(0);
  };
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
      return;
    }
    pending += 1;
    void handleRpc(message, ctx)
      .then((response) => {
        if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`);
      })
      .catch((err) => {
        log(`handler error: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        pending -= 1;
        maybeExit();
      });
  });
  rl.on('close', () => {
    closed = true;
    maybeExit();
  });
}

void main();
