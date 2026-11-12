import { applyAmazonAffiliateTag } from '@bitcobblers/wod-wiki-ui';

declare const __ASSOCIATE_TAG__: string | undefined;

export const ASSOCIATE_TAG: string | null =
  typeof __ASSOCIATE_TAG__ !== 'undefined' && __ASSOCIATE_TAG__.trim()
    ? __ASSOCIATE_TAG__.trim()
    : null;

/**
 * Injects or replaces the build-time Amazon Associates `tag` parameter on
 * outbound Amazon retail URLs when `ASSOCIATE_TAG` is configured.
 */
export function withAffiliateTag(url: string): string {
  return applyAmazonAffiliateTag(url, ASSOCIATE_TAG);
}
