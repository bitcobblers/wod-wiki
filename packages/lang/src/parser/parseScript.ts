import { WhiteboardScript } from './WhiteboardScript';
import { extractStatements, extractStatementsRaw } from './lezer-mapper';
import type { ReferenceIndex, ReferenceResolutionDefaults } from '../effort-registry/reference-resolution';
import { createReferenceIndex } from '../effort-registry/reference-resolution';
import type { TagIndex } from '../tags/TagCatalog';
import { parser } from '../grammar/parser';

export interface ParseOptions {
  dialect?: string;
  sport?: string;
  strict?: boolean;
  withoutDialects?: boolean;
  /** Shared reference index (createReferenceIndex output) — canonical effort/equipment refs at parse time. */
  references?: ReferenceIndex;
  /** Note-level `metrics.*` defaults applied by the resolver. */
  defaults?: ReferenceResolutionDefaults;
  /** Tags a script can reference with `#{tag-slug}`. */
  tags?: TagIndex;
}

/**
 * Parses Whiteboard Script source directly into a WhiteboardScript AST
 * with 0 DOM / EditorState dependencies.
 *
 * @param inputText Raw Whiteboard Script text.
 * @param options Parse options including dialect/sport fence suffix and strictness.
 */
export function parseScript(inputText: string, options: ParseOptions = {}): WhiteboardScript {
  if (!inputText || !inputText.trim()) {
    return new WhiteboardScript(inputText, [], []);
  }

  try {
    const doc = inputText.endsWith('\n') ? inputText : inputText + '\n';
    const tree = parser.parse(doc);
    const sport = options.sport ?? options.dialect;
    // A tag index is usable on its own — it needs an index only to resolve
    // effort/equipment references, which an empty catalog satisfies.
    const references = (options.references || options.tags)
      ? {
        index: options.references ?? createReferenceIndex({ efforts: [], equipment: [] }),
        defaults: options.defaults,
        tags: options.tags,
      }
      : undefined;
    const statements = options.withoutDialects
      ? extractStatementsRaw(inputText, tree, references)
      : extractStatements(inputText, tree, sport, references);

    return new WhiteboardScript(inputText, statements, []);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown parse error';
    return new WhiteboardScript(inputText, [], [{ message: msg }]);
  }
}
