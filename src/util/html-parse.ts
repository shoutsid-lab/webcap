/**
 * Shared HTML parsing utilities for meta tag extraction and content cleaning.
 *
 * Extracted from capture/og.ts and audit/checks.ts to eliminate duplication.
 */

/**
 * Extract content from a single meta tag matching a property or name.
 * Returns undefined when the tag or content attribute is missing/empty.
 */
export function metaContent(html: string, property: string): string | undefined {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]*>`, 'i'));
  if (tag === null) return undefined;
  const content = tag[0].match(/content\s*=\s*["']([^"']*)["']/i);
  const value = content === null || content[1] === undefined ? undefined : clean(content[1]);
  return value === '' || value === undefined ? undefined : value;
}

/**
 * Extract content from all meta tags matching a property or name.
 * Returns undefined when no matching tags are found.
 */
export function metaAll(html: string, property: string): readonly string[] | undefined {
  const tags = html.match(new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]*>`, 'gi'));
  if (tags === null) return undefined;
  const values: string[] = [];
  for (const tag of tags) {
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (content?.[1] === undefined) continue;
    const value = clean(content[1]);
    if (value !== '') values.push(value);
  }
  return values.length > 0 ? values : undefined;
}

/**
 * Decode common HTML entities and trim whitespace.
 */
export function clean(value: string | undefined): string {
  return (value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}
