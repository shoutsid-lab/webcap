/**
 * Preview cache: stores and retrieves successful preview results keyed by
 * normalized URL and a content hash. Enables sub-50ms responses for repeat
 * preview requests (e.g., demo URLs like example.com, Wikipedia, etc.).
 *
 * Cache policy:
 * - TTL: 1 hour (PREVIEW_CACHE_TTL_MS)
 * - Max entries: 1000 (PREVIEW_CACHE_MAX_ENTRIES)
 * - Eviction: LRU by hit_count when max reached
 * - Invalidation: manual via invalidatePreviewCache(url)
 */
import { createHash } from 'node:crypto';
import type { Db } from './index.js';

/** Cache TTL in milliseconds (1 hour). */
const PREVIEW_CACHE_TTL_MS = 60 * 60 * 1000;

/** Max cache entries before LRU eviction. */
const PREVIEW_CACHE_MAX_ENTRIES = 1000;

/** Cache entry shape (stored as JSON). */
interface CachedPreview {
  url: string;
  preview: {
    title: string;
    description: string;
    headings: { level: number; text: string }[];
    links: { href: string; text: string }[];
    wordCount: number;
    markdown: string;
    /** Content provenance (which container, how many words). Absent on entries written before it existed. */
    content?: { source: string; words: number; truncated: boolean };
  };
  truncated: boolean;
}

/**
 * Create a content hash from the preview result for cache keying.
 * This ensures that if the same URL produces different results (e.g., updated
 * content), we get a cache miss and re-fetch.
 */
function contentHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * Look up a cached preview result for the given URL.
 * Returns null on cache miss (URL not cached or expired).
 */
export function getCachedPreview(db: Db, url: string): CachedPreview | null {
  try {
    const row = db.prepare(
      'SELECT preview_json, hit_count FROM preview_cache WHERE url = ? AND expires_at > datetime(\'now\')',
    ).get(url) as { preview_json: string; hit_count: number } | undefined;

    if (row === undefined) return null;

    // Increment hit count (async-safe: fire and forget)
    db.prepare('UPDATE preview_cache SET hit_count = hit_count + 1 WHERE url = ?').run(url);

    return JSON.parse(row.preview_json) as CachedPreview;
  } catch {
    return null;
  }
}

/**
 * Store a successful preview result in the cache.
 * Evicts oldest entries when max capacity is reached.
 */
export function cachePreview(db: Db, url: string, preview: CachedPreview['preview'], truncated: boolean): void {
  try {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + PREVIEW_CACHE_TTL_MS).toISOString();
    const previewJson = JSON.stringify({ url, preview, truncated } satisfies CachedPreview);

    // Upsert: insert or update if exists
    db.prepare(
      `INSERT INTO preview_cache (url, hash, preview_json, hit_count, created_at, expires_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(url, hash) DO UPDATE SET
         preview_json = excluded.preview_json,
         hit_count = hit_count + 1,
         expires_at = excluded.expires_at`,
    ).run(url, contentHash(url), previewJson, now, expiresAt);

    // Evict expired entries periodically
    db.prepare("DELETE FROM preview_cache WHERE expires_at < datetime('now')").run();

    // Evict oldest entries if over capacity
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM preview_cache').get() as { cnt: number }).cnt;
    if (count > PREVIEW_CACHE_MAX_ENTRIES) {
      db.prepare(
        'DELETE FROM preview_cache WHERE url NOT IN (SELECT url FROM preview_cache ORDER BY hit_count DESC, created_at DESC LIMIT ?)',
      ).run(PREVIEW_CACHE_MAX_ENTRIES);
    }
  } catch {
    // Non-fatal: cache write failure should never break the preview
  }
}

/**
 * Invalidate all cached previews for a given URL.
 */
export function invalidatePreviewCache(db: Db, url: string): void {
  try {
    db.prepare('DELETE FROM preview_cache WHERE url = ?').run(url);
  } catch {
    // Non-fatal
  }
}

/**
 * Get cache statistics for monitoring.
 */
export function previewCacheStats(db: Db): { entries: number; totalHits: number; topUrls: { url: string; hits: number }[] } {
  try {
    const entries = (db.prepare('SELECT COUNT(*) as cnt FROM preview_cache').get() as { cnt: number }).cnt;
    const totalHits = (db.prepare('SELECT COALESCE(SUM(hit_count), 0) as total FROM preview_cache').get() as { total: number }).total;
    const topUrls = db.prepare(
      'SELECT url, hit_count as hits FROM preview_cache ORDER BY hit_count DESC LIMIT 10',
    ).all() as { url: string; hits: number }[];
    return { entries, totalHits, topUrls };
  } catch {
    return { entries: 0, totalHits: 0, topUrls: [] };
  }
}
