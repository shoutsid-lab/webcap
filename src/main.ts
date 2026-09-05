import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { makeArtifactRepo } from './db/artifacts.js';
import { makeRevenueRepo } from './db/revenue.js';
import { makeWatchRepo } from './watch/store.js';
import { startWatchScheduler, type WatchScheduler } from './watch/scheduler.js';
import { buildApp } from './server/server.js';
import { capture, captureStructured } from './capture/pipeline.js';
import { closeBrowser } from './capture/browser.js';
import { ogMetadata } from './capture/og.js';
import { getUsdc, makeProvider } from './payment/erc20.js';
import { startPoller, type Poller } from './payment/poller.js';
import { buildX402Facilitator } from './x402/facilitator.js';

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
  const poller: Poller = startPoller({
    db,
    config,
    provider,
    usdc,
    merchantAddress: config.merchantAddress,
    intervalMs: config.pollIntervalMs,
  });
  const x402Facilitator = buildX402Facilitator(config);
  const app = buildApp({
    db,
    artifacts,
    config,
    capture,
    captureStructured,
    og: ogMetadata,
    captureAllowHosts: parseAllowHosts(process.env),
    x402Facilitator,
  });
  // The recurring engine: re-runs due watches on an interval; overdue watches
  // (incl. those that went due while the app was down) run on the first pass.
  const watchScheduler: WatchScheduler = startWatchScheduler({
    repo: makeWatchRepo(db),
    pipeline: { capture, captureStructured },
    artifacts,
    revenue: makeRevenueRepo(db),
    config,
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(
    `webcap listening on :${config.port} chain=${config.chainId} usdc=${config.usdcAddress} merchant=${config.merchantAddress}` +
      (config.x402Network === undefined
        ? ' x402=disabled'
        : ` x402=${config.x402Network} payTo=${config.x402PayTo} priceUsdc=${config.x402PriceUsdcUnits} facilitator=${config.x402FacilitatorUrl} cdpAuth=${config.cdpApiKey !== undefined ? 'yes' : 'no'}`),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`webcap ${signal} received — shutting down`);
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
  console.error('webcap failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
