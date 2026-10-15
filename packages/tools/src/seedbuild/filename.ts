/**
 * fileToDisplayName — port of wod-wiki's
 * apps/playground/src/repositories/groupings.ts (display-name derivation
 * only). Block-index rows carry the same note titles the app renders, so
 * titles must derive identically on both sides.
 */

/** Lowercased mid-title words — "and", "of", "70.3"-style fragments read wrong capped. */
const FILE_TITLE_STOP_WORDS: Record<string, true> = {
  and: true, or: true, of: true, for: true, to: true, in: true, on: true,
  at: true, by: true, with: true, the: true, a: true, an: true,
};

/**
 * Parse a filename into a display name.
 * "simple-and-sinister.md" -> "Simple and Sinister"
 */
export function fileToDisplayName(filename: string): string {
  const base = filename.replace(/\.md$/, '');
  if (base.toUpperCase() === 'README') return 'Overview';
  // Strip leading "day-01-" prefixes if present, then humanise
  const cleaned = base.replace(/^day-\d+-/, '');
  const tokens = cleaned.split(/[-_]/);
  const titled: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const next = tokens[i + 1];
    const after = tokens[i + 2];
    const prev = tokens[i - 1];
    // Race distances keep their dot: a lone 1-2-digit pair ("70-3" -> "70.3").
    // Longer numeric runs are dates (2009-12-01) or rep ladders (5-3-1) —
    // only an isolated pair between words is a distance.
    if (
      /^\d{1,2}$/.test(token) && /^\d{1,2}$/.test(next ?? '')
      && !/^\d+$/.test(prev ?? '') && !/^\d+$/.test(after ?? '')
    ) {
      titled.push(`${token}.${next}`);
      i++;
      continue;
    }
    if (titled.length > 0 && FILE_TITLE_STOP_WORDS[token.toLowerCase()]) {
      titled.push(token.toLowerCase());
      continue;
    }
    titled.push(token.charAt(0).toUpperCase() + token.slice(1));
  }
  return titled.join(' ');
}
