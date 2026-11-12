import { Facet } from "@codemirror/state";

/**
 * Optional Amazon Associates tag injected into outbound Amazon retail links
 * rendered by editor link pills, tables, and Ctrl+Click navigation.
 * When unset or empty, link URLs are left untouched.
 */
export const affiliateTagFacet = Facet.define<string | null | undefined, string | null>({
  combine(values) {
    for (let i = values.length - 1; i >= 0; i--) {
      const trimmed = values[i]?.trim();
      if (trimmed) return trimmed;
    }
    return null;
  },
});

const AMAZON_RETAIL_HOST_RE = /^(?:www\.|smile\.|m\.)?amazon\.[a-z]{2,3}(?:\.[a-z]{2})?$/i;

/**
 * Returns `true` for Amazon retail hostnames (e.g. `amazon.com`,
 * `www.amazon.co.uk`, `smile.amazon.de`), excluding shortlink domains
 * (`amzn.to`, `a.co`) and non-retail subdomains (`aws.amazon.com`).
 */
export function isAmazonRetailHost(hostname: string): boolean {
  return AMAZON_RETAIL_HOST_RE.test(hostname);
}

/**
 * Injects or replaces the Amazon Associates `tag` query parameter on outbound
 * Amazon retail URLs when `associateTag` is non-empty.
 *
 * Shortlinks (e.g. `amzn.to`) and non-Amazon URLs are returned unchanged.
 * Never mutates the underlying Markdown source.
 */
export function applyAmazonAffiliateTag(
  url: string,
  associateTag?: string | null,
): string {
  const tag = associateTag?.trim();
  if (!tag || !/^https?:\/\//i.test(url)) return url;

  try {
    const parsed = new URL(url);
    if (!isAmazonRetailHost(parsed.hostname)) return url;
    parsed.searchParams.set("tag", tag);
    return parsed.toString();
  } catch {
    return url;
  }
}
