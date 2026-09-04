import { describe, expect, it } from 'vitest';
import { loadConfig, PACKS, getPack } from '../../src/config.js';

const LOCAL_CONTRACT = `0x${'11'.repeat(20)}`;
const localEnv: NodeJS.ProcessEnv = { WEBCAP_CHAIN: 'local', LOCAL_USDC_CONTRACT: LOCAL_CONTRACT };

describe('config: chain map', () => {
  it('base-sepolia resolves with the sepolia RPC, chainId 84532 and sepolia USDC', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia' });
    expect(cfg.chain.rpcUrl).toBe('https://sepolia.base.org');
    expect(cfg.chain.chainId).toBe(84532);
    expect(cfg.chain.usdcContract).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(cfg.chain.explorer).toBe('https://sepolia.basescan.org');
  });

  it('base resolves with the mainnet RPC, chainId 8453 and mainnet USDC', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base' });
    expect(cfg.chain.rpcUrl).toBe('https://mainnet.base.org');
    expect(cfg.chain.chainId).toBe(8453);
    expect(cfg.chain.usdcContract).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(cfg.chain.explorer).toBe('https://basescan.org');
  });

  it('local resolves with 127.0.0.1:8545, chainId 31337 and the env USDC contract', () => {
    const cfg = loadConfig(localEnv);
    expect(cfg.chain.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(cfg.chain.chainId).toBe(31337);
    expect(cfg.chain.usdcContract).toBe(LOCAL_CONTRACT);
    expect(cfg.chain.explorer).toBe('');
  });

  it('unknown chain throws', () => {
    expect(() => loadConfig({ WEBCAP_CHAIN: 'ethereum' })).toThrow(/unknown WEBCAP_CHAIN/);
  });

  it('local without LOCAL_USDC_CONTRACT throws', () => {
    expect(() => loadConfig({ WEBCAP_CHAIN: 'local' })).toThrow(/LOCAL_USDC_CONTRACT/);
  });

  it('applies env overrides and defaults for port, poll interval and db path', () => {
    const cfg = loadConfig({ ...localEnv, WEBCAP_PORT: '9999', POLL_INTERVAL_MS: '250', WEBCAP_DB: '/tmp/x.db' });
    expect(cfg.port).toBe(9999);
    expect(cfg.pollIntervalMs).toBe(250);
    expect(cfg.dbPath).toBe('/tmp/x.db');
    const defaults = loadConfig(localEnv);
    expect(defaults.port).toBe(8080);
    expect(defaults.pollIntervalMs).toBe(30_000);
    expect(defaults.dbPath).toBe('data/webcap.db');
  });
});

describe('config: credit packs', () => {
  it('packs carry the exact credit/usd/usdc numbers', () => {
    expect(PACKS.starter).toEqual({ credits: 100, usd: 0.5, usdc: 500_000 });
    expect(PACKS.pro).toEqual({ credits: 1000, usd: 3.0, usdc: 3_000_000 });
    expect(PACKS.max).toEqual({ credits: 10_000, usd: 12.0, usdc: 12_000_000 });
  });

  it('getPack resolves known packs and unknown pack throws', () => {
    expect(getPack('starter').credits).toBe(100);
    expect(getPack('pro').usdc).toBe(3_000_000);
    expect(getPack('max').credits).toBe(10_000);
    expect(() => getPack('gold')).toThrow(/unknown pack/);
  });
});
