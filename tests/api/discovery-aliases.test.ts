import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApiFixture, makeApiFixture, type ApiFixture } from './fixture.js';

describe('lost-agent handling: POST / and the agents.json alias', () => {
  let fx: ApiFixture;
  beforeAll(() => {
    fx = makeApiFixture();
  });
  afterAll(async () => {
    await closeApiFixture(fx);
  });

  it('POST / answers 405 in the error envelope with a pointer to the machine catalog', async () => {
    const res = await fx.app.inject({ method: 'POST', url: '/', payload: { url: 'https://example.com/' } });
    expect(res.statusCode).toBe(405);
    const json = res.json() as { error: { code: string; message: string; detail?: Record<string, unknown> } };
    expect(json.error.code).toBe('method_not_allowed');
    expect(String(json.error.detail?.service ?? '')).toContain('/v1/x402/service');
  });

  it('GET /.well-known/agents.json serves the agent card (byte-identical alias)', async () => {
    const card = await fx.app.inject({ method: 'GET', url: '/.well-known/agent-card.json' });
    const alias = await fx.app.inject({ method: 'GET', url: '/.well-known/agents.json' });
    expect(alias.statusCode).toBe(200);
    expect(alias.body).toBe(card.body);
  });
});
