/** Mid-flight legacy migration (ticket 08): the retired `catalog:` filter
 * narrows exactly like `notebook:` — rewrite it so legacy stored default
 * queries, readme embeds, and prose links keep their scope instead of
 * running unscoped. Handles positive and negated forms (`!catalog:x`) and
 * quoted values (`catalog:"x y"`). The parse layer drops unknown keys, so
 * this rewrites the text before parsing rather than round-tripping the
 * AST. Final removal of the spelling is ticket 12. */
export function migrateLegacyCatalogFilter(wql: string): string {
  return wql.replace(/(^|[{,\s!])catalog:("[^"]*"|[\w][\w/-]*)/g, '$1notebook:$2');
}
