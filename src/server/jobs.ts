import type { FastifyInstance } from 'fastify';
import {
  CAPTURE_COST_CREDITS,
  DEFAULT_WEBHOOK_RETRIES,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  usdcForCredits,
  usdcUnitsForCredits,
  type WebcapConfig,
} from '../config.js';
import type { CaptureFormat } from '../capture/pipeline.js';
import { makeAccountsRepo } from '../db/accounts.js';
import { makeCreditsRepo } from '../db/credits.js';
import type { Db } from '../db/index.js';
import { makeJobsRepo, type CaptureJobRow, type CaptureJobStatus } from '../db/jobs.js';
import { makeRevenueRepo } from '../db/revenue.js';
import { storeArtifact } from '../extract/service.js';
import { nowIso } from '../util/time.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { validateCaptureUrl } from '../util/url.js';
import { checkWebhookUrl, fireSignedWebhook, fireWebhook } from '../watch/webhook.js';
import { authenticate } from './auth.js';
import { createInsufficientCreditsInvoice } from './billing.js';
import { isRecord, parseFormat } from './capture-parse.js';
import { x402Payer } from './x402.js';
import type { AppDeps } from './server.js';

export interface JobPayment {
  readonly payer: string;
  readonly priceUsdcUnits: number;
  readonly creditsUsed?: number;
  readonly costUsdcUnits?: number;
}

export interface JobView {
  readonly jobId: string;
  readonly status: CaptureJobStatus;
  readonly payment: JobPayment;
  readonly result?: { readonly artifactUrl: string };
  readonly error?: string;
}

const pendingWebhookByJob = new Map<string, string>();

export function registerJobRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const jobs = makeJobsRepo(db);
  const accounts = makeAccountsRepo(db);
  const credits = makeCreditsRepo(db);
  const revenue = makeRevenueRepo(db);
  const allowHosts = deps.captureAllowHosts;
  const runner = deps.captureJobRunner ?? makeDefaultCaptureJobRunner(deps);

  app.post('/v1/capture/jobs', async (req, reply) => {
    const body = req.body;
    const rawUrl = isRecord(body) ? body.url : undefined;
    if (typeof rawUrl !== 'string') throw unprocessable('url is required');
    const normalized = validatedJobUrl(rawUrl, allowHosts);
    const format = parseFormat(body);
    const webhookUrl = parseJobWebhook(body);

    let payer: string;
    let priceUsdcUnits: number;
    let creditsUsed: number | null;
    if (config.x402Network !== undefined) {
      payer = x402Payer(req) ?? 'unknown';
      priceUsdcUnits = config.x402PriceUsdcUnits;
      creditsUsed = null;
      const spendCap = config.spendCapUsdcUnits;
      if (spendCap !== undefined) {
        const spent = revenue.spentByPayer(payer);
        if (spent >= spendCap) {
          throw new HttpError(429, 'spend_cap_exceeded', 'per-payer spend cap exceeded', {
            payer,
            spent,
            cap: spendCap,
            reason: `per-payer spend cap exceeded: spent ${spent} of ${spendCap} USDC units`,
          });
        }
      }
    } else {
      const { account } = authenticate(req, db);
      const spendCap = config.spendCapCredits;
      if (spendCap !== undefined) {
        const spent = credits.spentByAccount(account.id);
        if (spent >= spendCap) {
          throw new HttpError(429, 'spend_cap_exceeded', 'per-account spend cap exceeded', {
            payer: account.address,
            spent,
            cap: spendCap,
            reason: `per-account spend cap exceeded: spent ${spent} of ${spendCap} credits`,
          });
        }
      }
      const balanceBefore = accounts.getBalance(account.id);
      if (balanceBefore < CAPTURE_COST_CREDITS) {
        const topUp = createInsufficientCreditsInvoice(db, config, account.id);
        throw new HttpError(402, 'insufficient_credits', 'insufficient credits', {
          invoiceId: String(topUp.id),
          requiredUsdc: usdcForCredits(CAPTURE_COST_CREDITS),
          balance: balanceBefore,
        });
      }
      if (!credits.recordCharge(account.id)) {
        throw new HttpError(402, 'insufficient_credits', 'insufficient credits', { balance: 0 });
      }
      payer = account.address;
      priceUsdcUnits = usdcUnitsForCredits(CAPTURE_COST_CREDITS);
      creditsUsed = CAPTURE_COST_CREDITS;
    }

    const jobId = crypto.randomUUID();
    const now = nowIso();
    jobs.create({
      id: jobId,
      url: normalized,
      format,
      payer,
      priceUsdcUnits,
      creditsUsed,
      costUsdcUnits: config.computeCostUsdcUnitsPerRequest,
      createdAt: now,
      updatedAt: now,
    });
    if (webhookUrl !== undefined) pendingWebhookByJob.set(jobId, webhookUrl);
    runner(jobId).catch(() => undefined);
    return reply.status(202).send({ jobId, status: 'queued' as const });
  });

  app.get('/v1/capture/jobs/:id', async (req) => {
    const rawId = isRecord(req.params) ? req.params.id : undefined;
    if (typeof rawId !== 'string' || rawId === '') throw unprocessable('id is required');
    const row = jobs.get(rawId);
    if (row === null) throw new HttpError(404, 'not_found', 'job not found');
    if (row.status === 'queued') runner(row.id).catch(() => undefined);
    return jobView(row, config);
  });
}

export function makeDefaultCaptureJobRunner(deps: AppDeps): (jobId: string) => Promise<void> {
  return async (jobId: string): Promise<void> => {
    try {
      await driveCaptureJob(deps, deps.db, jobId);
    } catch {
      try {
        makeJobsRepo(deps.db).setStatus(jobId, 'failed', { error: 'capture failed', updatedAt: nowIso() });
      } catch {
        /* best effort: the terminal mark is already attempted above */
      }
    }
  };
}

async function driveCaptureJob(deps: AppDeps, db: Db, jobId: string): Promise<void> {
  const jobs = makeJobsRepo(db);
  const queued = jobs.get(jobId);
  if (queued === null || queued.status !== 'queued') return;
  const webhookUrl = pendingWebhookByJob.get(jobId);
  pendingWebhookByJob.delete(jobId);
  if (!jobs.setStatus(jobId, 'processing', { updatedAt: nowIso() })) return;
  const costUsdcUnits = deps.config.computeCostUsdcUnitsPerRequest;
  try {
    const format: CaptureFormat = queued.format === 'jpeg' || queued.format === 'pdf' ? queued.format : 'png';
    const result = await deps.capture({ url: queued.url, format });
    const artifactUrl = storeArtifact(deps.artifacts, deps.config, queued.url, result);
    jobs.setStatus(jobId, 'completed', { artifactUrl, updatedAt: nowIso() });
    if (queued.credits_used === null) {
      makeRevenueRepo(db).record({
        endpoint: 'capture',
        payer: queued.payer ?? 'unknown',
        revenueUsdcUnits: queued.price_usdc_units ?? deps.config.x402PriceUsdcUnits,
        costUsdcUnits,
      });
    }
    await deliverJobWebhook(deps, webhookUrl, { jobId, status: 'completed', artifactUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'capture failed';
    jobs.setStatus(jobId, 'failed', { error: message, updatedAt: nowIso() });
    if (queued.credits_used !== null && queued.payer !== null && queued.payer !== '') {
      const accountId = makeAccountsRepo(db).findByAddress(queued.payer);
      if (accountId !== undefined) {
        makeCreditsRepo(db).grantCredits(accountId, CAPTURE_COST_CREDITS, 'capture_refunded', jobId);
      }
    }
    await deliverJobWebhook(deps, webhookUrl, { jobId, status: 'failed', error: message });
  }
}

async function deliverJobWebhook(
  deps: AppDeps,
  webhookUrl: string | undefined,
  payload: Record<string, unknown>,
): Promise<void> {
  if (webhookUrl === undefined) return;
  const attempts = deps.config.webhookRetries ?? DEFAULT_WEBHOOK_RETRIES;
  const timeoutMs = deps.config.webhookTimeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  const secret =
    deps.jobSecret ?? (deps.config.merchantPrivateKey !== '' ? deps.config.merchantPrivateKey : undefined);
  if (secret === undefined) {
    await fireWebhook(webhookUrl, payload, attempts, timeoutMs);
    return;
  }
  await fireSignedWebhook(webhookUrl, payload, secret, attempts, timeoutMs);
}

function jobView(row: CaptureJobRow, config: WebcapConfig): JobView {
  const payment: JobPayment = {
    payer: row.payer ?? 'unknown',
    priceUsdcUnits: row.price_usdc_units ?? config.x402PriceUsdcUnits,
    ...(row.credits_used !== null ? { creditsUsed: row.credits_used } : {}),
    ...(row.cost_usdc_units !== null ? { costUsdcUnits: row.cost_usdc_units } : {}),
  };
  return {
    jobId: row.id,
    status: row.status,
    payment,
    ...(row.status === 'completed' && row.artifact_url !== null ? { result: { artifactUrl: row.artifact_url } } : {}),
    ...(row.status === 'failed' ? { error: row.error ?? 'capture failed' } : {}),
  };
}

function validatedJobUrl(raw: string, allowHosts: readonly string[] | undefined): string {
  let normalized: string;
  try {
    normalized = validateCaptureUrl(raw, { allowHosts });
  } catch {
    throw unprocessable('invalid url');
  }
  if (!normalized.startsWith('https://')) throw unprocessable('url must be https');
  return normalized;
}

function parseJobWebhook(body: unknown): string | undefined {
  const raw = isRecord(body) ? body.webhookUrl : undefined;
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw === '') throw unprocessable('webhookUrl must be an https URL');
  const check = checkWebhookUrl(raw);
  if (!check.ok) throw unprocessable('webhookUrl must be an https URL');
  return check.url;
}
