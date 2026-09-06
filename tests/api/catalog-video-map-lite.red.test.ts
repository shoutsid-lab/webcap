import { describe, expect, it } from 'vitest';
import { closeApiFixture, makeApiFixture } from './fixture.js';

interface PaidEntry {
  readonly path: string;
  readonly usdc: number;
}

interface WellKnownView {
  readonly endpoints: readonly PaidEntry[];
}

interface AgentCardView {
  readonly skills: ReadonlyArray<{ readonly id: string }>;
}

interface FrontDoorView {
  readonly endpoints: { readonly paid: readonly PaidEntry[] };
}

describe('catalog discovery: video + map-lite surfaces (RED)', () => {
  it('sitemap.xml lists /v1/x402/video + /v1/x402/map-lite', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/sitemap.xml' });
      expect(res.statusCode).toBe(200);
      const base = fx.config.publicBaseUrl.replace(/^http:\/\//, 'https://');
      expect(res.payload).toContain(`<loc>${base}/v1/x402/video</loc>`);
      expect(res.payload).toContain(`<loc>${base}/v1/x402/map-lite</loc>`);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('x402 well-known endpoints include video + map-lite with config-derived prices', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/.well-known/x402' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as WellKnownView;
      const paths = body.endpoints.map((e) => e.path);
      expect(paths).toContain('POST /v1/x402/video');
      expect(paths).toContain('POST /v1/x402/map-lite');
      const video = body.endpoints.find((e) => e.path === 'POST /v1/x402/video');
      const mapLite = body.endpoints.find((e) => e.path === 'POST /v1/x402/map-lite');
      expect(video?.usdc).toBe(fx.config.x402VideoPriceUsdcUnits / 1_000_000);
      expect(mapLite?.usdc).toBe(fx.config.x402AuditPriceUsdcUnits / 1_000_000);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('agent card skills include video + map-lite', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/.well-known/agent-card.json' });
      expect(res.statusCode).toBe(200);
      const card = res.json() as AgentCardView;
      const ids = card.skills.map((s) => s.id);
      expect(ids).toContain('video');
      expect(ids).toContain('map-lite');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('JSON front-door paid includes /v1/x402/video + /v1/x402/map-lite with config-derived prices', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/', headers: { accept: 'application/json' } });
      expect(res.statusCode).toBe(200);
      const body = res.json() as FrontDoorView;
      const paths = body.endpoints.paid.map((e) => e.path);
      expect(paths).toContain('POST /v1/x402/video');
      expect(paths).toContain('POST /v1/x402/map-lite');
      const video = body.endpoints.paid.find((e) => e.path === 'POST /v1/x402/video');
      const mapLite = body.endpoints.paid.find((e) => e.path === 'POST /v1/x402/map-lite');
      expect(video?.usdc).toBe(fx.config.x402VideoPriceUsdcUnits / 1_000_000);
      expect(mapLite?.usdc).toBe(fx.config.x402AuditPriceUsdcUnits / 1_000_000);
    } finally {
      await closeApiFixture(fx);
    }
  });
});
