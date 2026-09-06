/**
 * Change-alert webhook delivery for watch runs: the fire-time SSRF guard
 * (checkWebhookUrl) and the delivery loop (fireWebhook). Extracted from
 * scheduler.ts with behavior unchanged; the skip counter semantics
 * (stats().webhooksSkipped) live in the scheduler, which calls the guard.
 */
import { validateCaptureUrl } from '../util/url.js';

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
