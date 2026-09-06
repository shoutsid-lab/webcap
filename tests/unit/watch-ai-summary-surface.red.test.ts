import { describe, expect, it } from 'vitest';
import {
  buildDiscordPayload,
  buildSlackPayload,
  formatAlertPayload,
  type WatchAlert,
} from '../../src/watch/webhook.js';
import { closeApiFixture, makeApiFixture } from '../api/fixture.js';

const SUMMARY = 'Price dropped 10% with strong momentum';
const LONG_SUMMARY = `x:${'y'.repeat(2000)}`;

function alertWithSummary(summary: string | null): WatchAlert {
  return {
    watchId: 'w1',
    url: 'https://example.com/',
    mode: 'extract',
    diffSummary: 'title',
    at: '2026-06-01T01:00:00.000Z',
    artifactUrl: null,
    extract: { title: 'Example Domain (edited)' },
    summary,
  } as WatchAlert;
}

describe('watch ai_summary payload surfacing (RED)', () => {
  it('generic carries the summary', () => {
    const legacy: Record<string, unknown> = {
      watchId: 'w1',
      url: 'https://example.com/',
      mode: 'extract',
      changed: true,
      diffSummary: 'title',
      at: '2026-06-01T01:00:00.000Z',
    };
    const out = formatAlertPayload('generic', alertWithSummary(SUMMARY), legacy);
    expect(JSON.stringify(out)).toContain(SUMMARY);
  });

  it('slack carries the summary', () => {
    expect(JSON.stringify(buildSlackPayload(alertWithSummary(SUMMARY)))).toContain(SUMMARY);
  });

  it('discord carries the summary', () => {
    expect(JSON.stringify(buildDiscordPayload(alertWithSummary(SUMMARY)))).toContain(SUMMARY);
  });

  it('WatchRunView carries aiSummary', async () => {
    const fx = makeApiFixture();
    try {
      const created = await fx.app.inject({
        method: 'POST',
        url: '/v1/watches',
        payload: { url: 'https://example.com/', every: '1h', mode: 'capture' },
      });
      expect(created.statusCode).toBe(201);
      const { id } = created.json() as { id: string };
      const { makeWatchRepo } = await import('../../src/watch/store.js');
      const repo = makeWatchRepo(fx.db);
      repo.recordRun({
        watchId: id,
        status: 'ok',
        artifactUrl: null,
        extractJson: null,
        changed: true,
        diffSummary: 'title',
        aiSummary: SUMMARY,
        webhook: null,
        error: null,
        createdAt: new Date().toISOString(),
      });
      const res = await fx.app.inject({ method: 'GET', url: `/v1/watches/${id}` });
      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(res.json())).toContain(SUMMARY);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('null summary is omitted, never false-cached', () => {
    const alert = alertWithSummary(null);
    for (const payload of [buildSlackPayload(alert), buildDiscordPayload(alert)]) {
      const text = JSON.stringify(payload);
      expect(text).not.toContain('"false"');
      expect(text).not.toContain('"null"');
      expect(text).not.toContain('AI unevaluated');
    }
    const legacy: Record<string, unknown> = { watchId: 'w1' };
    const generic = formatAlertPayload('generic', alert, legacy);
    expect(JSON.stringify(generic)).not.toContain('"false"');
    expect(JSON.stringify(generic)).not.toContain('AI unevaluated');
  });

  it('long summaries are truncated with a cap', () => {
    for (const payload of [
      buildSlackPayload(alertWithSummary(LONG_SUMMARY)),
      buildDiscordPayload(alertWithSummary(LONG_SUMMARY)),
      formatAlertPayload('generic', alertWithSummary(LONG_SUMMARY), { watchId: 'w1' }),
    ]) {
      const text = JSON.stringify(payload);
      expect(text).not.toContain(LONG_SUMMARY);
      expect(text).toContain('y'.repeat(10));
    }
  });
});
