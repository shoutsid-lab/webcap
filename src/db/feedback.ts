/**
 * Feedback persistence: the `feedback` table that backs POST /v1/feedback and
 * the /feedback form page.
 *
 * Why this table exists. webcap's paying customers are autonomous agents, so
 * the feedback channel has to be one an agent can call over HTTP with no
 * account and no human round-trip: POST /v1/feedback, JSON in, 200 out. The
 * human /feedback form posts to the same code path. Both land here.
 *
 * Privacy follows the metrics convention (see src/db/hits.ts): the raw wallet
 * address is never stored, only the sha256 payer hash. The `payer_hash`
 * column is therefore correlatable (was this the wallet that settled a call?)
 * but not de-anonymizing on its own.
 */
import { createHash } from 'node:crypto';
import type { Db } from './index.js';
import { nowIso } from '../util/time.js';

/** The free-form feedback categories accepted by POST /v1/feedback. */
export const FEEDBACK_CATEGORIES = [
  'bug',
  'suggestion',
  'pricing',
  'docs',
  'integration',
  'other',
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** What a caller can submit. `message` is always required; everything else optional. */
export interface FeedbackInput {
  readonly category: FeedbackCategory;
  /** The actual feedback text, trimmed; 8..4000 chars enforced at the route. */
  readonly message: string;
  /** The webcap route the caller was using, e.g. 'POST /v1/x402/capture'. */
  readonly endpoint?: string;
  /** Raw wallet address or API key id of the caller; only the hash is stored. */
  readonly contact?: string;
  /** The caller's raw 0x payment address; only the hash is stored. */
  readonly payer?: string;
}

const ANONYMOUS = 'anonymous';

/** A stable, short hash for an identifier; `anonymous` for absent values. */
export function hashIdent(value: string | undefined): string {
  if (value === undefined || value === '') return ANONYMOUS;
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Insert one feedback row. Strict (not best-effort) on purpose: feedback is a
 * deliberate user/agent action and the route wants to report the stored id.
 * The message is stored verbatim (the /feedback page escapes it on render, and
 * the machine route has no HTML surface of its own). `userAgent` is captured
 * at the route from the request and passed through the caller's identity
 * (forwarded from the MCP transport, so attribution is not lost).
 */
export function insertFeedback(
  db: Db,
  input: FeedbackInput & { readonly userAgent: string },
): { readonly id: number } {
  const info = db
    .prepare<[string, string, string | null, string, string, string, string, string], unknown>(
      'INSERT INTO feedback (category, message, endpoint, payer_hash, user_agent, contact_hash, source, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      input.category,
      input.message,
      input.endpoint ?? null,
      hashIdent(input.payer),
      input.userAgent,
      hashIdent(input.contact),
      'http',
      nowIso(),
    );
  return { id: Number(info.lastInsertRowid) };
}

export interface FeedbackListRow {
  readonly id: number;
  readonly category: string;
  readonly message: string;
  readonly endpoint: string | null;
  readonly payer_hash: string;
  readonly contact_hash: string;
  readonly user_agent: string;
  readonly source: string;
  readonly created_at: string;
}

/** Newest-first feedback, optionally filtered to one category. */
export function listFeedback(db: Db, category?: string, limit = 100): FeedbackListRow[] {
  const bounds = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 100;
  if (category !== undefined && category !== '') {
    return db
      .prepare<[string, number], FeedbackListRow>(
        'SELECT id, category, message, endpoint, payer_hash, contact_hash, user_agent, source, created_at ' +
          'FROM feedback WHERE category = ? ORDER BY id DESC LIMIT ?',
      )
      .all(category, bounds);
  }
  return db
    .prepare<[number], FeedbackListRow>(
      'SELECT id, category, message, endpoint, payer_hash, contact_hash, user_agent, source, created_at ' +
        'FROM feedback ORDER BY id DESC LIMIT ?',
    )
    .all(bounds);
}
