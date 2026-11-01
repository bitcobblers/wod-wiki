/**
 * Re-exports canonical frontmatter parser utilities from `@bitcobblers/wod-wiki-core`.
 */
export {
  type ParsedFrontmatter,
  type LinkWidget,
  type TypedTagItem,
  parseFrontmatter,
  parseFrontmatterBody,
  serializeFrontmatter,
  stripFrontmatter,
  getScalar,
  getList,
  parseFrontmatterCategories,
  extractFrontmatterTags,
  extractTypedFrontmatterTags,
  parseFlatProperties,
  parseFrontmatterProps,
} from '@bitcobblers/wod-wiki-core';
