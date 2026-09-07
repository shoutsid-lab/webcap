import type { PageStructure } from '../capture/pipeline.js';
import { metaContent, metaAll, clean } from '../util/html-parse.js';

export interface AuditTitleCheck {
  readonly present: boolean;
  readonly length: number;
  readonly ok: boolean;
}

export interface AuditDescriptionCheck {
  readonly present: boolean;
  readonly length: number;
  readonly ok: boolean;
}

export interface AuditCanonicalCheck {
  readonly present: boolean;
  readonly value: string | undefined;
}

export interface AuditRobotsCheck {
  readonly present: boolean;
  readonly value: string | undefined;
}

export interface AuditSeo {
  readonly title: AuditTitleCheck;
  readonly description: AuditDescriptionCheck;
  readonly h1Count: number;
  readonly h1Ok: boolean;
  readonly canonical: AuditCanonicalCheck;
  readonly robotsMeta: AuditRobotsCheck;
}

export interface AuditOg {
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly image: string | undefined;
  readonly twitterCard: string | undefined;
  readonly twitterSite: string | undefined;
  readonly twitterCreator: string | undefined;
  readonly twitterTitle: string | undefined;
  readonly twitterDescription: string | undefined;
  readonly twitterImage: string | undefined;
  readonly articlePublishedTime: string | undefined;
  readonly articleAuthor: string | undefined;
  readonly articleSection: string | undefined;
  readonly articleTags: readonly string[] | undefined;
  readonly present: {
    readonly title: boolean;
    readonly description: boolean;
    readonly image: boolean;
    readonly twitterCard: boolean;
    readonly twitterSite: boolean;
    readonly twitterCreator: boolean;
    readonly twitterTitle: boolean;
    readonly twitterDescription: boolean;
    readonly twitterImage: boolean;
    readonly articlePublishedTime: boolean;
    readonly articleAuthor: boolean;
    readonly articleSection: boolean;
    readonly articleTags: boolean;
  };
}

export interface AuditLinks {
  readonly total: number;
  readonly internal: number;
  readonly external: number;
  readonly emptyText: number;
  readonly duplicates: number;
  readonly sample: readonly { readonly href: string; readonly text: string }[];
}

export interface AuditResult {
  readonly seo: AuditSeo;
  readonly og: AuditOg;
  readonly links: AuditLinks;
}

export interface ComputeAuditArgs {
  readonly structure: PageStructure;
  readonly html: string;
  readonly pageUrl: string;
  readonly linkSampleLimit?: number;
}

export function computeAudit(args: ComputeAuditArgs): AuditResult {
  const { structure, html, pageUrl } = args;
  const linkSampleLimit = args.linkSampleLimit ?? 20;

  const title = structure.title ?? '';
  const titlePresent = title.trim() !== '';
  const titleLength = title.length;
  const titleOk = titlePresent && titleLength >= 1 && titleLength <= 200;

  const description = structure.description ?? '';
  const descriptionPresent = description.trim() !== '';
  const descriptionLength = description.length;
  const descriptionOk = descriptionPresent && descriptionLength >= 1 && descriptionLength <= 500;

  const h1Count = structure.headings.filter((h) => h.level === 1).length;
  const h1Ok = h1Count >= 1;

  const canonicalValue = canonicalHref(html);
  const robotsValue = metaContent(html, 'robots');

  const ogTitle = metaContent(html, 'og:title');
  const ogDescription = metaContent(html, 'og:description');
  const ogImage = metaContent(html, 'og:image');
  const twitterCard = metaContent(html, 'twitter:card');
  const twitterSite = metaContent(html, 'twitter:site');
  const twitterCreator = metaContent(html, 'twitter:creator');
  const twitterTitle = metaContent(html, 'twitter:title');
  const twitterDescription = metaContent(html, 'twitter:description');
  const twitterImage = metaContent(html, 'twitter:image');
  const articlePublishedTime = metaContent(html, 'article:published_time');
  const articleAuthor = metaContent(html, 'article:author');
  const articleSection = metaContent(html, 'article:section');
  const articleTags = metaAll(html, 'article:tag');

  const links = structure.links;
  const total = links.length;
  const emptyText = links.filter((l) => l.text.trim() === '').length;

  const seen = new Set<string>();
  for (const l of links) {
    seen.add(l.href);
  }
  const duplicates = total - seen.size;

  let baseHost: string | undefined;
  try {
    baseHost = new URL(pageUrl).host;
  } catch {
    baseHost = undefined;
  }

  let internal = 0;
  let external = 0;
  for (const l of links) {
    try {
      const parsed = new URL(l.href, pageUrl);
      if (baseHost !== undefined && parsed.host === baseHost) {
        internal += 1;
      } else {
        external += 1;
      }
    } catch {
      external += 1;
    }
  }

  const sample = links.slice(0, Math.max(0, linkSampleLimit)).map((l) => ({ href: l.href, text: l.text }));

  return {
    seo: {
      title: { present: titlePresent, length: titleLength, ok: titleOk },
      description: { present: descriptionPresent, length: descriptionLength, ok: descriptionOk },
      h1Count,
      h1Ok,
      canonical: { present: canonicalValue !== undefined, value: canonicalValue },
      robotsMeta: { present: robotsValue !== undefined, value: robotsValue },
    },
    og: {
      title: ogTitle,
      description: ogDescription,
      image: ogImage,
      twitterCard,
      twitterSite,
      twitterCreator,
      twitterTitle,
      twitterDescription,
      twitterImage,
      articlePublishedTime,
      articleAuthor,
      articleSection,
      articleTags,
      present: {
        title: ogTitle !== undefined,
        description: ogDescription !== undefined,
        image: ogImage !== undefined,
        twitterCard: twitterCard !== undefined,
        twitterSite: twitterSite !== undefined,
        twitterCreator: twitterCreator !== undefined,
        twitterTitle: twitterTitle !== undefined,
        twitterDescription: twitterDescription !== undefined,
        twitterImage: twitterImage !== undefined,
        articlePublishedTime: articlePublishedTime !== undefined,
        articleAuthor: articleAuthor !== undefined,
        articleSection: articleSection !== undefined,
        articleTags: articleTags !== undefined,
      },
    },
    links: { total, internal, external, emptyText, duplicates, sample },
  };
}

function canonicalHref(html: string): string | undefined {
  const match = html.match(/<link[^>]+rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/i);
  if (match === null) return undefined;
  const href = match[0].match(/href\s*=\s*["']([^"']*)["']/i);
  if (href === null || href[1] === undefined) return undefined;
  const value = clean(href[1]);
  return value === '' ? undefined : value;
}
