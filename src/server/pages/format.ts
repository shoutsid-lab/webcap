/**
 * Text helpers for the public web surfaces: HTML escaping for
 * input-influenced values, human-readable byte sizes, and the SQLite UTC
 * datetime rendering. Split out of pages.ts as a pure move (no behavior
 * change).
 */

/** Escape a value that is influenced by input (URLs, ids) before HTML embedding. */
export function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Human-readable byte size: "8 B", "12.4 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1_024 ** 3).toFixed(1)} GB`;
}

/** SQLite datetime('now') ("YYYY-MM-DD HH:MM:SS", UTC) -> "YYYY-MM-DD HH:MM UTC". */
export function readableCapturedAt(sqliteUtc: string): string {
  const iso = `${sqliteUtc.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return sqliteUtc;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
