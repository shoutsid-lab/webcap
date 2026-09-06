/**
 * Change-alert webhook delivery for watch runs: the fire-time SSRF guard
 * (checkWebhookUrl) and the delivery loop (fireWebhook). Extracted from
 * scheduler.ts with behavior unchanged; the skip counter semantics
 * (stats().webhooksSkipped) live in the scheduler, which calls the guard.
 */
import { createHmac } from 'node:crypto';
import { validateCaptureUrl } from '../util/url.js';
import type { WatchChannel } from './conditions.js';

export type { WatchChannel } from './conditions.js';

/** The resolved fields of one changed run, shared by every channel formatter. */
export interface WatchAlert {
  readonly watchId: string;
  readonly url: string;
  readonly mode: string;
  readonly diffSummary: string | null;
  readonly at: string;
  readonly artifactUrl: string | null;
  readonly extract: unknown;
  /** Nullable AI summary (watch_runs.ai_summary); absent/null renders as omitted. */
  readonly summary?: string | null;
}

/** Payload cap for the rendered AI summary; longer text truncates with an ellipsis. */
export const MAX_AI_SUMMARY_CHARS = 500;

/**
 * Normalize a nullable AI summary for rendering: blank (null/undefined/empty)
 * maps to null (the surface omits it — never the strings "false"/"null");
 * over-cap text truncates with an ellipsis.
 */
export function truncateAiSummary(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.length <= MAX_AI_SUMMARY_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_AI_SUMMARY_CHARS - 1)}…`;
}

/**
 * Slack Block Kit rendering of a change alert: a fallback `text` plus
 * section blocks carrying the watch identity, diff summary, and run time.
 */
export function buildSlackPayload(alert: WatchAlert): Record<string, unknown> {
  const headline = `Watch ${alert.watchId} changed (${alert.mode})`;
  const summary = truncateAiSummary(alert.summary);
  const detail = `*Diff:* ${alert.diffSummary ?? 'n/a'}\n*At:* ${alert.at}${
    alert.artifactUrl !== null ? `\n*Artifact:* ${alert.artifactUrl}` : ''
  }${summary !== null ? `\n*AI summary:* ${summary}` : ''}`;
  return {
    text: `${headline}: ${alert.url}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${headline}*\n${alert.url}` } },
      { type: 'section', text: { type: 'mrkdwn', text: detail } },
    ],
  };
}

/**
 * Discord rendering of a change alert: one rich embed with the watch
 * identity, diff field, run timestamp, and optional artifact field.
 */
export function buildDiscordPayload(alert: WatchAlert): Record<string, unknown> {
  const fields: Array<Record<string, unknown>> = [
    { name: 'Diff', value: alert.diffSummary ?? 'n/a', inline: false },
  ];
  const summary = truncateAiSummary(alert.summary);
  if (summary !== null) fields.push({ name: 'AI summary', value: summary, inline: false });
  if (alert.artifactUrl !== null) fields.push({ name: 'Artifact', value: alert.artifactUrl, inline: false });
  return {
    embeds: [
      {
        title: `Watch ${alert.watchId} changed`,
        description: `${alert.url} (${alert.mode})`,
        fields,
        timestamp: alert.at,
      },
    ],
  };
}

/**
 * Channel dispatch over the legacy generic payload: 'generic' passes the
 * payload through untouched (byte-identical legacy behavior); 'slack' and
 * 'discord' render the same alert through their native formatters.
 */
export function formatAlertPayload(
  channel: WatchChannel,
  alert: WatchAlert,
  legacy: Record<string, unknown>,
): Record<string, unknown> {
  switch (channel) {
    case 'slack':
      return buildSlackPayload(alert);
    case 'discord':
      return buildDiscordPayload(alert);
    case 'generic': {
      const summary = truncateAiSummary(alert.summary);
      if (summary === null) return legacy;
      return { ...legacy, aiSummary: summary };
    }
  }
}

/** Fire-time verdict for a stored webhook URL (see checkWebhookUrl). */
export type WebhookUrlCheck =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Fire-time SSRF guard for a stored webhook URL. Write-time validation
 * (src/server/watches.ts) enforces the same rule, but the stored row is
 * re-checked before any request leaves the process: a row may predate the
 * write-time guard or have been written out-of-band. Composed rule: the
 * capture-target host policy (validateCaptureUrl — no private/loopback/
 * link-local hosts, http/https schemes only) AND the https:// requirement.
 * Purely parse-level (validateCaptureUrl does no DNS), so fire-time cost is
 * negligible for a rarely fired webhook.
 */
export function checkWebhookUrl(raw: string): WebhookUrlCheck {
  let normalized: string;
  try {
    normalized = validateCaptureUrl(raw);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (!normalized.startsWith('https://')) {
    return { ok: false, reason: 'webhook must be https' };
  }
  return { ok: true, url: normalized };
}

/**
 * Compute the webhook delivery signature for a raw request body:
 * `sha256=<hex>` where hex = hmac_sha256(secret, rawBody). Strings are
 * encoded as UTF-8; Buffers are used byte-identical. Matches the
 * receiver-side verifier in tests/api/signed-artifacts.test.ts exactly.
 */
export function signWebhookBody(rawBody: string | Buffer, secret: string): string {
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/**
 * Signed delivery: same retries/timeout contract as fireWebhook (up to
 * `attempts` attempts, one `timeoutMs` budget each, never throws), but the
 * POST also carries `x-hub-signature-256: signWebhookBody(body, secret)`
 * computed over the exact raw bytes sent. Added additively; fireWebhook
 * below is byte-identical legacy behavior.
 */
export async function fireSignedWebhook(
  url: string,
  payload: Record<string, unknown>,
  secret: string,
  attempts: number,
  timeoutMs: number,
): Promise<string> {
  const body = JSON.stringify(payload);
  const signature = signWebhookBody(body, secret);
  let lastFailure: string | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let failure: string | undefined;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 200 && res.status < 300) return `ok: HTTP ${res.status}`;
      failure = `HTTP ${res.status}`;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    lastFailure = failure;
  }
  return `failed: ${lastFailure ?? 'unknown error'}`;
}

/**
 * Deliver a change alert: POST the payload with up to `attempts` attempts
 * (one `timeoutMs` budget each). Never throws — the outcome ("ok: HTTP 200" or
 * "failed: …") is returned and stored on the run record. Callers must pass a
 * URL that passed checkWebhookUrl (fire-time SSRF guard).
 */
export async function fireWebhook(
  url: string,
  payload: Record<string, unknown>,
  attempts: number,
  timeoutMs: number,
): Promise<string> {
  const body = JSON.stringify(payload);
  let lastFailure: string | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let failure: string | undefined;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 200 && res.status < 300) return `ok: HTTP ${res.status}`;
      failure = `HTTP ${res.status}`;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    lastFailure = failure;
  }
  return `failed: ${lastFailure ?? 'unknown error'}`;
}
