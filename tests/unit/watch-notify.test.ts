import { describe, expect, it } from 'vitest';
import {
  buildDiscordPayload,
  buildSlackPayload,
  formatAlertPayload,
  type WatchAlert,
} from '../../src/watch/webhook.js';

const ALERT: WatchAlert = {
  watchId: 'w1',
  url: 'https://example.com/',
  mode: 'extract',
  diffSummary: 'title',
  at: '2026-06-01T01:00:00.000Z',
  artifactUrl: null,
  extract: { title: 'Example Domain (edited)' },
};

const LEGACY: Record<string, unknown> = {
  watchId: 'w1',
  url: 'https://example.com/',
  mode: 'extract',
  changed: true,
  diffSummary: 'title',
  at: '2026-06-01T01:00:00.000Z',
  extract: { title: 'Example Domain (edited)' },
};

describe('buildSlackPayload (Block Kit)', () => {
  it('shapes a Block Kit message carrying the watch identity + diff', () => {
    const payload = buildSlackPayload(ALERT);
    expect(typeof payload['text']).toBe('string');
    expect(String(payload['text'])).toContain('w1');
    const blocks = payload['blocks'] as Array<Record<string, unknown>>;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block['type']).toBe('section');
    const joined = JSON.stringify(blocks);
    expect(joined).toContain('https://example.com/');
    expect(joined).toContain('title');
  });

  it('mentions the artifact URL for capture-mode alerts', () => {
    const payload = buildSlackPayload({
      ...ALERT,
      mode: 'capture',
      diffSummary: 'artifact',
      artifactUrl: 'http://localhost:8080/v1/artifacts/abc',
      extract: null,
    });
    expect(JSON.stringify(payload)).toContain('http://localhost:8080/v1/artifacts/abc');
  });
});

describe('buildDiscordPayload (embeds)', () => {
  it('shapes a single-rich-embed message carrying the watch identity + diff', () => {
    const payload = buildDiscordPayload(ALERT);
    const embeds = payload['embeds'] as Array<Record<string, unknown>>;
    expect(Array.isArray(embeds)).toBe(true);
    expect(embeds).toHaveLength(1);
    const embed = embeds[0] as Record<string, unknown>;
    expect(String(embed['title'])).toContain('w1');
    expect(String(embed['description'])).toContain('https://example.com/');
    const fields = embed['fields'] as Array<Record<string, unknown>>;
    expect(fields.some((f) => f['name'] === 'Diff' && String(f['value']).includes('title'))).toBe(true);
    expect(embed['timestamp']).toBe('2026-06-01T01:00:00.000Z');
  });

  it('adds an artifact field for capture-mode alerts, omits it otherwise', () => {
    const withArtifact = buildDiscordPayload({
      ...ALERT,
      mode: 'capture',
      diffSummary: 'artifact',
      artifactUrl: 'http://localhost:8080/v1/artifacts/abc',
      extract: null,
    });
    const fields = (withArtifact['embeds'] as Array<Record<string, unknown>>)[0]?.['fields'] as Array<
      Record<string, unknown>
    >;
    expect(fields.some((f) => String(f['value']).includes('/v1/artifacts/abc'))).toBe(true);

    const withoutArtifact = buildDiscordPayload(ALERT);
    const plainFields = (withoutArtifact['embeds'] as Array<Record<string, unknown>>)[0]?.['fields'] as Array<
      Record<string, unknown>
    >;
    expect(plainFields.some((f) => String(f['value']).includes('/v1/artifacts'))).toBe(false);
  });
});

describe('formatAlertPayload (channel dispatch)', () => {
  it('generic is a passthrough of the legacy payload (byte-identical shape)', () => {
    expect(formatAlertPayload('generic', ALERT, LEGACY)).toBe(LEGACY);
  });

  it('slack dispatches to the Block Kit formatter', () => {
    expect(formatAlertPayload('slack', ALERT, LEGACY)).toEqual(buildSlackPayload(ALERT));
  });

  it('discord dispatches to the embed formatter', () => {
    expect(formatAlertPayload('discord', ALERT, LEGACY)).toEqual(buildDiscordPayload(ALERT));
  });
});
