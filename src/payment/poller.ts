import type { Contract, Filter, LogParams } from 'ethers';
import type { Db } from '../db/index.js';
import type { WebcapConfig } from '../config.js';
import { makeInvoicesRepo } from '../db/invoices.js';
import { makePaymentsRepo } from '../db/payments.js';
import { makePaymentWebhooksRepo } from '../db/payment-webhooks.js';
import { TRANSFER_TOPIC, decodeTransferLog, encodeAddressTopic } from './erc20.js';
import { settleInvoice } from './settle.js';
import { fireSignedWebhook } from '../watch/webhook.js';
import { consoleServiceLogger, type ServiceLogger } from '../util/logger.js';

/** The narrow chain surface the poller needs (a real Provider satisfies it). */
export interface LogReader {
  getBlockNumber(): Promise<number>;
  getLogs(filter: Filter): Promise<LogParams[]>;
}

export interface PollInput {
  readonly db: Db;
  readonly provider: LogReader;
  readonly usdc: Contract;
  readonly merchantAddress: string;
  readonly chain: string;
}

/**
 * One deterministic poll pass: for each open, non-expired invoice (oldest
 * first), find USDC Transfer logs to the merchant since the last polled block
 * whose value covers the invoice, and settle. Advances poll_state to latest.
 * Returns the number of invoices settled. Idempotent across passes.
 */
export async function processPendingInvoices(input: PollInput): Promise<number> {
  const { db, provider, usdc, merchantAddress, chain } = input;
  const invoicesRepo = makeInvoicesRepo(db);
  const paymentsRepo = makePaymentsRepo(db);
  const nowMs = Date.now();
  const pending = invoicesRepo.listOpenInvoices().filter((inv) => new Date(inv.expires_at).getTime() > nowMs);
  if (pending.length === 0) return 0;

  const lastBlock = paymentsRepo.getPollState(chain);
  const latest = await provider.getBlockNumber();
  let settled = 0;
  if (latest > lastBlock) {
    const logs = await provider.getLogs({
      address: contractAddress(usdc),
      topics: [TRANSFER_TOPIC, null, encodeAddressTopic(merchantAddress)],
      fromBlock: lastBlock,
      toBlock: latest,
    });
    for (const log of logs) {
      if (pending.length === 0) break;
      const payload = decodeTransferLog(log);
      if (payload.to.toLowerCase() !== merchantAddress.toLowerCase()) continue;
      const invoice = pending[0];
      if (invoice === undefined) break;
      if (payload.value < BigInt(invoice.usdc_amount)) continue;
      const isSettled = settleInvoice({
        db,
        invoice,
        txHash: log.transactionHash,
        logIndex: log.index,
        fromAddr: payload.from,
        toAddr: payload.to,
        value: payload.value,
        block: log.blockNumber,
      });
      if (isSettled) {
        settled += 1;
        pending.shift();
        // Fire payment webhooks (fire-and-forget, don't block the poller)
        firePaymentWebhooks(db, invoice, log.transactionHash, payload.from, payload.value).catch(() => {});
      }
    }
    paymentsRepo.setPollState(chain, latest);
  }
  return settled;
}

export interface StartPollerInput {
  readonly db: Db;
  readonly config: WebcapConfig;
  readonly provider: LogReader;
  readonly usdc: Contract;
  readonly merchantAddress: string;
  readonly intervalMs?: number;
  /** Failure logger (default: console, matching the historical output). */
  readonly logger?: ServiceLogger;
}

export interface Poller {
  stop(): void;
}

/** Run processPendingInvoices on an interval until stop() is called. */
export function startPoller(input: StartPollerInput): Poller {
  const intervalMs = input.intervalMs ?? 5_000;
  const log = input.logger ?? consoleServiceLogger();
  const base: PollInput = {
    db: input.db,
    provider: input.provider,
    usdc: input.usdc,
    merchantAddress: input.merchantAddress,
    chain: input.config.chain.name,
  };
  const timer = setInterval(() => {
    processPendingInvoices(base).catch((err: unknown) => {
      log.error('webcap poller tick failed:', err);
    });
  }, intervalMs);
  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}

function contractAddress(usdc: Contract): string {
  const target = usdc.target;
  if (typeof target !== 'string') throw new Error('usdc contract has no address');
  return target;
}

/**
 * Fire payment webhooks for a settled invoice. Reads all active webhooks
 * and delivers a signed POST to each. Failures are silently swallowed
 * (fire-and-forget from the poller's perspective).
 */
async function firePaymentWebhooks(
  db: Db,
  invoice: { account_id: number; usdc_amount: number; pack: string },
  txHash: string,
  fromAddr: string,
  value: bigint,
): Promise<void> {
  const webhooksRepo = makePaymentWebhooksRepo(db);
  const active = webhooksRepo.listActive();
  if (active.length === 0) return;

  const payload = {
    event: 'payment.settled',
    timestamp: new Date().toISOString(),
    invoice: {
      id: invoice.account_id,
      pack: invoice.pack,
      usdcAmount: invoice.usdc_amount,
    },
    payment: {
      txHash,
      from: fromAddr,
      value: value.toString(),
    },
  };

  // Fire all webhooks concurrently (fire-and-forget)
  await Promise.allSettled(
    active.map((wh) =>
      fireSignedWebhook(wh.url, payload, wh.secret, 3, 5000),
    ),
  );
}
