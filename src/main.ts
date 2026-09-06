import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ARTIFACT_SWEEP_INTERVAL_MS, DEFAULT_ARTIFACT_RETENTION_DAYS, loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { makeArtifactRepo, runRetentionSweep } from './db/artifacts.js';
import { makeRevenueRepo } from './db/revenue.js';
import { makeWatchRepo } from './watch/store.js';
import { startWatchScheduler, type WatchScheduler } from './watch/scheduler.js';
import { buildApp } from './server/server.js';
import { defaultLoggingOptions } from './server/logging.js';
import { capture, captureStructured, type CaptureRequest } from './capture/pipeline.js';
import { closeBrowser } from './capture/browser.js';
import { ogMetadata } from './capture/og.js';
import { getUsdc, makeProvider } from './payment/erc20.js';
import { startPoller, type Poller } from './payment/poller.js';
import { buildX402Facilitator } from './x402/facilitator.js';
import { consoleServiceLogger, pinoServiceLogger, type ServiceLogger } from './util/logger.js';

// Plain console until the app exists; the pino-backed logger takes over once
// buildApp succeeds (a boot failure before that still reports via console).
let log: ServiceLogger = consoleServiceLogger();

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.merchantAddress === '') {
    throw new Error('merchant address required: set USDC_MERCHANT_PRIVATE_KEY or WEBCAP_MERCHANT_ADDRESS');
  }

  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = openDb(config.dbPath);
  const artifacts = makeArtifactRepo(db);
  const provider = makeProvider(config.rpcUrl);
  const usdc = getUsdc(provider, config.usdcAddress);
  const x402Facilitator = buildX402Facilitator(config);
  // Shared by the route + watch-scheduler wiring so both honor WEBCAP_CAPTURE_TIMEOUT_*.
  const captureTimeouts = { defaultMs: config.captureTimeoutMs, capMs: config.captureTimeoutCapMs };
  const captureWithTimeouts = (req: CaptureRequest) => capture(req, captureTimeouts);
  const captureStructuredWithTimeouts = (req: CaptureRequest) => captureStructured(req, captureTimeouts);
  const ogWithTimeouts = (req: { readonly url: string }) => ogMetadata(req, captureTimeouts);
  const app = buildApp({
    db,
    artifacts,
    config,
    capture: captureWithTimeouts,
    captureStructured: captureStructuredWithTimeouts,
    og: ogWithTimeouts,
    captureAllowHosts: parseAllowHosts(process.env),
    x402Facilitator,
    loggerOptions: defaultLoggingOptions(),
  });
  log = pinoServiceLogger(app.log);
  const poller: Poller = startPoller({
    db,
    config,
    provider,
    usdc,
    merchantAddress: config.merchantAddress,
    intervalMs: config.pollIntervalMs,
    logger: log,
  });
  // The recurring engine: re-runs due watches on an interval; overdue watches
  // (incl. those that went due while the app was down) run on the first pass.
  const watchScheduler: WatchScheduler = startWatchScheduler({
    repo: makeWatchRepo(db),
    pipeline: { capture: captureWithTimeouts, captureStructured: captureStructuredWithTimeouts },
    artifacts,
    revenue: makeRevenueRepo(db),
    config,
    logger: log,
  });
  // Opt-in artifact retention (WEBCAP_ARTIFACT_RETENTION_DAYS > 0): purge on
  // the fixed 6-hourly interval; retention 0 (default) schedules nothing.
  const retentionDays = config.artifactRetentionDays ?? DEFAULT_ARTIFACT_RETENTION_DAYS;
  let sweepTimer: ReturnType<typeof setInterval> | undefined;
  if (retentionDays > 0) {
    sweepTimer = setInterval(() => {
      try {
        const swept = runRetentionSweep(artifacts, Date.now(), retentionDays);
        if (swept > 0) log.info('webcap artifact retention sweep', { swept, retentionDays });
      } catch (err) {
        log.error('webcap artifact retention sweep failed:', err);
      }
    }, ARTIFACT_SWEEP_INTERVAL_MS);
    // The server sockets keep the process alive; the sweep must not.
    sweepTimer.unref();
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info(
    `webcap listening on :${config.port} chain=${config.chainId} usdc=${config.usdcAddress} merchant=${config.merchantAddress}` +
      (config.x402Network === undefined
        ? ' x402=disabled'
        : ` x402=${config.x402Network} payTo=${config.x402PayTo} priceUsdc=${config.x402PriceUsdcUnits} facilitator=${config.x402FacilitatorUrl} cdpAuth=${config.cdpApiKey !== undefined ? 'yes' : 'no'}`),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`webcap ${signal} received — shutting down`);
    if (sweepTimer !== undefined) clearInterval(sweepTimer);
    poller.stop();
    watchScheduler.stop();
    await closeBrowser();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function parseAllowHosts(env: NodeJS.ProcessEnv): string[] | undefined {
  const raw = env.WEBCAP_CAPTURE_ALLOW_HOSTS;
  if (raw === undefined || raw.trim() === '') return undefined;
  return raw.split(',').map((host) => host.trim()).filter((host) => host !== '');
}

main().catch((err: unknown) => {
  log.error(`webcap failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
