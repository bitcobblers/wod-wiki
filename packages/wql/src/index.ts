/**
 * @bitcobblers/wod-wiki-wql
 * Whiteboard Query Language (WQL) parser, AST, QueryService, vocabulary, and dashboard model.
 */

// 1. Vocabulary
export * from './vocabulary';
export * from './capabilities';

// 2. Grammar & Parser
export { parser as wqlParser } from './grammar/wql.parser';
export * as wqlTerms from './grammar/wql.parser.terms';

// 3. WQL parser, AST, and suffixes
export * from './wql';
export * from './wqlSuffix';
export * from './serialize';

// 4. Disciplines
export * from './disciplines';

// 5. CodeMirror Language Support
export * from './language';

// 6. Units
export * from './units';

// 6b. Calendar — civil time arithmetic over execution contexts (ticket 12)
export * from './calendar';

// 6c. Field catalog consumer interface (ticket 15)
export * from './catalog';

// 6d. Query documents + runner (ticket 17)
export * from './document';
export * from './documentRunner';
export {
  QueryDocumentRunner as SharedQueryDocumentRunner,
  substituteTokens as substituteTokensRaw,
  consumesRollupFacts,
  PageSourceRegistry,
  type QueryDocumentRunnerHost,
  type SharedRunnerOptions,
  type PageSourceEntry,
} from './queryDocumentRunner';

// 7. Event derivation
export * from './derivation';

// 8. Stores & QueryService
export * from './stores';
export * from './QueryService';

// 9. Dashboard Model, Parser, Scaffold & Frontmatter
export * from './dashboard';

// 10. Version info
export * from './version';
