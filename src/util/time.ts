/** UTC instant as an ISO-8601 string — the timestamp convention of the db repos (created_at/last_used_at). */
export function nowIso(): string {
  return new Date().toISOString();
}
