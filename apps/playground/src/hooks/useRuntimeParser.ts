/**
 * useRuntimeParser — Public hook boundary for parser access.
 *
 * Re-exports lightweight parser utilities so that components in
 * `src/components/` never need to import directly from `src/parser/`.
 *
 * For compiler/factory access, use `useRuntimeFactory` from
 * `@/hooks/useRuntimeFactory`.
 */

import { useMemo } from 'react';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import { createReferenceIndex } from '@bitcobblers/wod-wiki-lang';
import type { WhiteboardScript } from '@bitcobblers/wod-wiki-engine';
import type { ReferenceCatalog, ReferenceResolutionDefaults } from '@bitcobblers/wod-wiki-lang';

// ── Parser exports ────────────────────────────────────────────────────────
export { createParser } from '@bitcobblers/wod-wiki-engine';
export { MdTimerRuntime } from '@bitcobblers/wod-wiki-engine';
export { whiteboardScriptLanguage } from '@bitcobblers/wod-wiki-engine';
export { extractStatements } from '@bitcobblers/wod-wiki-engine';
export { createReferenceIndex, extractStatementRefs, slugifyRefLabel } from '@bitcobblers/wod-wiki-lang';
export type { ReferenceCatalog, ReferenceIndex, ReferenceResolutionDefaults, ResolvedReferences } from '@bitcobblers/wod-wiki-lang';

// ── React hook ────────────────────────────────────────────────────────────

export interface UseRuntimeParserReturn {
  /** Parse a Whiteboard script string into an IScript */
  parse: (text: string, sport?: string) => WhiteboardScript;
}

/**
 * Hook that provides a stable parse helper for React components.
 *
 * Pass a hydrated reference catalog (efforts + equipment from storage) to
 * resolve canonical effort/equipment references at parse time; the index is
 * built once per catalog, not per parse.
 *
 * For compiler/factory operations use `useRuntimeFactory()` instead.
 *
 * @example
 * ```tsx
 * const { parse } = useRuntimeParser(catalog, defaults);
 * const script = parse(editorContent);
 * ```
 */
export function useRuntimeParser(
  catalog?: ReferenceCatalog,
  defaults?: ReferenceResolutionDefaults,
): UseRuntimeParserReturn {
  return useMemo(() => {
    const parser = createParser({
      references: catalog ? createReferenceIndex(catalog) : undefined,
      defaults,
    });
    return {
      parse: (text: string, sport?: string) => parser.read(text, sport),
    };
  }, [catalog, defaults]);
}
