/**
 * The legacy credits-rail (API-key account) routes: wallet registration +
 * API-key minting (POST /v1/register), USDC credit invoices (POST
 * /v1/invoice), the credit-metered capture (POST /v1/capture), the merchant
 * revenue ledger (GET /v1/ledger), and the account balance view (GET
 * /v1/account). The x402 paid routes stay in ./routes.ts. Split out of
 * routes.ts as a pure function move (no behavior change).
 */
import type { FastifyInstance } from 'fastify';
import { getAddress, Wallet, ZeroAddress } from 'ethers';import {
  CAPTURE_COST_CREDITS,
  DEFAULT_CREDITS,
  DEFAULT_INVOICE_TTL_MS,
  PACKS,
  USDC_SCALE,
  USDC_UNITS_PER_CREDIT,
  usdcForCredits,
  usdcUnitsForCredits,
  type WebcapConfig,
} from '../config.js';
import { makeAccountsRepo } from '../db/accounts.js';
import { makeApiKeysRepo } from '../db/api_keys.js';
import { makeCreditsRepo } from '../db/credits.js';
import type { Db } from '../db/index.js';
import { makeInvoicesRepo, type InvoiceRow } from '../db/invoices.js';
import { makePaymentWebhooksRepo } from '../db/payment-webhooks.js';
import { makeRevenueRepo } from '../db/revenue.js';
import { CaptureError } from '../capture/errors.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { generateApiKey, hashKey } from '../util/keys.js';
import { RateLimiter, rejectRateLimited } from '../util/ratelimit.js';
import { storeArtifact } from '../extract/service.js';
import { isRecord, parseFormat, parseOptions, validatedUrl } from './capture-parse.js';
import { authenticate } from './auth.js';
import type { AppDeps } from './server.js';

// Fixed 60s window for the registration per-peer budget below.
const RATE_LIMIT_WINDOW_MS = 60_000;
const REGISTER_RATE_LIMIT = 3;

export function registerBillingRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const accounts = makeAccountsRepo(db);
  const keys = makeApiKeysRepo(db);
  const credits = makeCreditsRepo(db);
  const invoices = makeInvoicesRepo(db);
  const revenue = makeRevenueRepo(db);
  const merchantAddress = merchantAddressOf(config);
  const allowHosts = deps.captureAllowHosts;
  const registerLimiter = new RateLimiter(REGISTER_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);

  app.post('/v1/register', async (req, reply) => {
    if (!registerLimiter.allow(req.ip)) {
      rejectRateLimited(reply, registerLimiter, req.ip, 'registration rate limit exceeded');
    }
    const raw = isRecord(req.body) ? req.body.address : undefined;
    if (typeof raw !== 'string') throw unprocessable('address is required');
    let address: string;
    try {
      address = getAddress(raw);
    } catch {
      throw unprocessable('invalid address');
    }
    // A merchant/ledger-bearing account is exactly one whose address matches
    // config.merchantAddress (the /v1/ledger gate compares the same pair). On
    // live chains that identity is granted out-of-band by ops, never via this
    // unauthenticated endpoint.
    if (config.chain.name !== 'local' && address.toLowerCase() === config.merchantAddress.toLowerCase()) {
      throw new HttpError(403, 'forbidden', 'merchant registration is disabled on live chains; see the README ops runbook');
    }
    const accountId = accounts.findByAddress(address) ?? accounts.create(address);
    const apiKey = generateApiKey();
    keys.create(accountId, hashKey(apiKey));
    return reply.status(201).send({ address, apiKey, balance: 0 });
  });

  app.post('/v1/invoice', async (req, reply) => {
    const { account } = authenticate(req, db);
    const creditsAmount = parseCredits(req.body, config.defaultCredits ?? DEFAULT_CREDITS);
    const invoice = createInvoice(invoices, config, merchantAddress, account.id, creditsAmount);
    return reply.status(201).send({
      invoiceId: String(invoice.id),
      merchant: merchantAddress,
      token: config.chain.usdcContract,
      chainId: config.chain.chainId,
      requiredUsdc: usdcForCredits(creditsAmount),
      credits: creditsAmount,
      expiresAt: invoice.expires_at,
    });
  });

  app.post('/v1/capture', async (req) => {
    const { account } = authenticate(req, db);
    const body = req.body;
    const rawUrl = isRecord(body) ? body.url : undefined;
    if (typeof rawUrl !== 'string') throw unprocessable('url is required');
    const normalized = validatedUrl(rawUrl, allowHosts);
    const format = parseFormat(body);
    const options = parseOptions(body);

    const spendCap = config.spendCapCredits;
    if (spendCap !== undefined && credits.spentByAccount(account.id) >= spendCap) {
      const spent = credits.spentByAccount(account.id);
      throw new HttpError(429, 'spend_cap_exceeded', 'per-account spend cap exceeded', {
        payer: account.address,
        spent,
        cap: spendCap,
        reason: `per-account spend cap exceeded: spent ${spent} of ${spendCap} credits`,
      });
    }

    const balanceBefore = accounts.getBalance(account.id);
    if (balanceBefore < CAPTURE_COST_CREDITS) {
      const topUp = createInvoice(invoices, config, merchantAddress, account.id, CAPTURE_COST_CREDITS);
      throw new HttpError(402, 'insufficient_credits', 'insufficient credits', {
        invoiceId: String(topUp.id),
        requiredUsdc: usdcForCredits(CAPTURE_COST_CREDITS),
        balance: balanceBefore,
      });
    }
    if (!credits.recordCharge(account.id)) {
      throw new HttpError(402, 'insufficient_credits', 'insufficient credits', { balance: 0 });
    }

    let result;
    try {
      result = await deps.capture({ url: normalized, format, options });
    } catch (err) {
      credits.grantCredits(account.id, CAPTURE_COST_CREDITS, 'capture_refunded', req.id);
      if (err instanceof CaptureError) throw new HttpError(502, 'capture_failed', err.message);
      throw err;
    }
    const url = storeArtifact(deps.artifacts, config, normalized, result);
    return {
      artifact: { format: result.format, bytes: result.bytes, data: result.buffer.toString('base64'), url },
      creditsCharged: CAPTURE_COST_CREDITS,
      balance: accounts.getBalance(account.id),
    };
  });

  app.get('/v1/ledger', async (req) => {
    const { account } = authenticate(req, db);
    if (account.address.toLowerCase() !== config.merchantAddress.toLowerCase()) {
      throw new HttpError(403, 'forbidden', 'ledger is merchant-only');
    }
    return { summary: revenue.summary(), recent: revenue.recent(50) };
  });

  app.get('/v1/account', async (req) => {
    const { account } = authenticate(req, db);
    return {
      address: account.address,
      balance: account.credits,
      invoices: invoices.listByAccount(account.id).map((inv) => ({
        id: String(inv.id),
        status: inv.status,
        credits: inv.usdc_amount / USDC_UNITS_PER_CREDIT,
        requiredUsdc: inv.usdc_amount / USDC_SCALE,
        createdAt: inv.created_at,
      })),
    };
  });

  // --- Payment webhooks ---

  /**
   * POST /v1/webhooks — Register a payment webhook.
   * Body: { "url": "https://..." }
   * Returns: { "id": 1, "url": "https://...", "events": ["payment.settled"] }
   */
  app.post('/v1/webhooks', async (req, reply) => {
    const { account } = authenticate(req, db);
    const body = req.body;
    const rawUrl = isRecord(body) ? body.url : undefined;
    if (typeof rawUrl !== 'string') throw unprocessable('url is required');
    // Validate URL format
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw unprocessable('invalid url');
    }
    if (parsed.protocol !== 'https:') throw unprocessable('webhook url must be https');
    // Generate a secret for signing
    const secret = generateApiKey();
    const webhooks = makePaymentWebhooksRepo(db);
    const id = webhooks.register(account.id, parsed.origin + parsed.pathname, secret);
    return reply.status(201).send({
      id,
      url: parsed.origin + parsed.pathname,
      events: ['payment.settled'],
      secret, // Only shown on creation — user must store it
    });
  });

  /**
   * GET /v1/webhooks — List payment webhooks for the authenticated account.
   */
  app.get('/v1/webhooks', async (req) => {
    const { account } = authenticate(req, db);
    const webhooks = makePaymentWebhooksRepo(db);
    const rows = webhooks.listByAccount(account.id);
    return {
      webhooks: rows.map((wh) => ({
        id: wh.id,
        url: wh.url,
        events: wh.events.split(','),
        active: wh.active === 1,
        createdAt: wh.created_at,
      })),
    };
  });

  /**
   * DELETE /v1/webhooks/:id — Deactivate a payment webhook.
   */
  app.delete('/v1/webhooks/:id', async (req) => {
    const { account } = authenticate(req, db);
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) throw unprocessable('invalid webhook id');
    const webhooks = makePaymentWebhooksRepo(db);
    const deleted = webhooks.deactivate(id, account.id);
    if (!deleted) throw new HttpError(404, 'not_found', 'webhook not found');
    return { ok: true };
  });
}

function merchantAddressOf(config: WebcapConfig): string {
  if (config.merchantPrivateKey === '') return ZeroAddress;
  return new Wallet(config.merchantPrivateKey).address;
}

/** Mint the 1-credit top-up invoice quoted in a 402 insufficient_credits detail (shared with the jobs submit route). */
export function createInsufficientCreditsInvoice(db: Db, config: WebcapConfig, accountId: number): InvoiceRow {
  const invoices = makeInvoicesRepo(db);
  return createInvoice(invoices, config, merchantAddressOf(config), accountId, CAPTURE_COST_CREDITS);
}

function createInvoice(
  invoices: ReturnType<typeof makeInvoicesRepo>,
  config: WebcapConfig,
  merchantAddress: string,
  accountId: number,
  creditsAmount: number,
): InvoiceRow {
  const id = invoices.create({
    account_id: accountId,
    pack: packForCredits(creditsAmount),
    chain: config.chain.name,
    usdc_contract: config.chain.usdcContract,
    usdc_address: merchantAddress,
    amount_usd: usdcForCredits(creditsAmount),
    usdc_amount: usdcUnitsForCredits(creditsAmount),
    recipient: merchantAddress,
    expires_at: new Date(Date.now() + (config.invoiceTtlMs ?? DEFAULT_INVOICE_TTL_MS)).toISOString(),
  });
  const row = invoices.get(id);
  if (row === undefined) throw new Error(`invoice ${id} vanished after insert`);
  return row;
}

function packForCredits(creditsAmount: number): string {
  for (const [name, pack] of Object.entries(PACKS)) {
    if (pack.credits === creditsAmount) return name;
  }
  return 'custom';
}

function parseCredits(body: unknown, defaultCredits: number): number {
  const raw = isRecord(body) ? body.credits : undefined;
  if (raw === undefined) return defaultCredits;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw unprocessable('credits must be a positive integer');
  }
  return raw;
}
