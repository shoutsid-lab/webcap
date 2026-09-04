import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { buildApp } from './server/server.js';
import { capture } from './capture/pipeline.js';
import { closeBrowser } from './capture/browser.js';
import { ogMetadata } from './capture/og.js';
import { getUsdc, makeProvider } from './payment/erc20.js';
import { startPoller, type Poller } from './payment/poller.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.merchantAddress === '') {
    throw new Error('merchant address required: set USDC_MERCHANT_PRIVATE_KEY or WEBCAP_MERCHANT_ADDRESS');
  }

  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = openDb(config.dbPath);
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
  const app = buildApp({
    db,
    config,
    capture,
    og: ogMetadata,
    captureAllowHosts: parseAllowHosts(process.env),
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(
    `webcap listening on :${config.port} chain=${config.chainId} usdc=${config.usdcAddress} merchant=${config.merchantAddress}`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`webcap ${signal} received — shutting down`);
    poller.stop();
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
