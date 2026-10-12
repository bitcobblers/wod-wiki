/**
 * Unified `wod` CLI Runner
 *
 * Implements CLI command routing, argument parsing, pipe handling,
 * and exit code conventions per wayfinder #962 and issue #967.
 *
 * Exit Codes:
 *   0 - OK / Success (including empty query results)
 *   1 - Runtime error (file missing, bad arguments, execution error)
 *   2 - Parse / Syntax error (invalid Whiteboard Script or malformed WQL)
 *   3 - Pack load error (failed to import or register --pack)
 */

function getFs() {
  if (typeof globalThis.process?.versions?.node === 'undefined' && typeof (globalThis as { Bun?: unknown }).Bun === 'undefined') {
    throw new Error('File system operations are only supported in Node / Bun environments');
  }
  // eslint-disable-next-line no-restricted-syntax -- lazy CJS require keeps node builtins out of browser bundles
  return require('fs');
}
import { loadLanguagePack, PackLoadError } from './loader';
import { runParse, ParseSyntaxError } from './parse';
import { runExecution } from './run';
import { runQueryCli, WqlSyntaxError } from './query';
import {
  openCliDb,
  resolveDbPath,
  nodeFs,
  nodePath,
  sqliteEventStore,
  sqliteNoteStore,
  sqliteBlockStore,
  sqliteEffortStore,
  sqliteIndexStore,
  getNoteBundle,
  getSessionBundle,
  getEffortBySlug,
  listTagsByType,
} from './db';
import { persistNote, startRun, persistRun, persistSessionBundle, persistEffort, persistTypedTags } from './persist';
import { defaultSeedDirs, importSeedDir } from './seed';
import {
  composeNoteMarkdown,
  csvToEquipmentLabels,
  csvToSessionRows,
  effortToMarkdown,
  equipmentToCsv,
  extractNoteIdentity,
  extractTypedTags,
  markdownToEffort,
  sessionToCsv,
} from '../exchange';
import {
  formatParseOutput,
  formatExecutionOutput,
  formatQueryOutput,
  type OutputFormat,
} from './formatters';

import { parseDocumentSections } from '@bitcobblers/wod-wiki-core';
import type { ExecutionLog, WodWikiIRFile } from '../ir';
const VERSION = '0.6.0';

/** Bare CLI scripts become authored Markdown at the persistence boundary. */
export function cliNoteSource(source: string, label: string, sport?: string): string {
  if (/\.(?:md|markdown)$/i.test(label) || parseDocumentSections(source).some((section) => section.scriptBlock)) return source;
  let length = 3;
  for (const match of source.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}time${sport ? `:${sport}` : ''}\n${source}\n${fence}\n`;
}

export interface CliParsedArgs {
  subcommand?: 'parse' | 'run' | 'query' | 'download' | 'import' | 'build' | 'seed' | 'reset' | 'help' | 'version';
  target?: string;
  /** Second positional: the id (download) or file (import) after the kind. */
  target2?: string;
  corpus?: string;
  stdinLog?: boolean;
  stdinFacts?: boolean;
  format: OutputFormat;
  output?: string;
  packs: string[];
  sport?: string;
  unit?: string;
  help?: boolean;
  version?: boolean;
  /** SQLite database path (--db). Defaults to WOD_WIKI_DB or ./wodwiki.db. */
  db?: string;
  /** IR debug output: undefined = off, '' = default file name, otherwise the file name. */
  debug?: string;
  /** Extra seed source directories for `wod seed` (repeatable). */
  sources: string[];
  /** `wod build`: scaffold markdown stubs for newly discovered efforts. */
  scaffold?: boolean;
  /** `wod build`: extra template markdown file compiled as the `template` chunk. */
  template?: string;
  /** `wod build`: content repo root (alias for the positional directory). */
  dir?: string;
}

export function parseCliArgs(args: string[]): CliParsedArgs {
  const result: CliParsedArgs = {
    format: 'json',
    packs: [],
    sources: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--at' || arg.startsWith('--at=')) throw new Error('Unknown option --at; whole Note exports have no as-of version');

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      i++;
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
      i++;
    } else if (arg === '--corpus' || arg === '-c') {
      result.corpus = args[++i];
      i++;
    } else if (arg === '--stdin-log') {
      result.stdinLog = true;
      i++;
    } else if (arg === '--stdin-facts') {
      result.stdinFacts = true;
      i++;
    } else if (arg === '--format') {
      const fmt = args[++i] as OutputFormat;
      if (fmt === 'json' || fmt === 'table' || fmt === 'csv') {
        result.format = fmt;
      }
      i++;
    } else if (arg.startsWith('--format=')) {
      const fmt = arg.slice('--format='.length) as OutputFormat;
      if (fmt === 'json' || fmt === 'table' || fmt === 'csv') {
        result.format = fmt;
      }
      i++;
    } else if (arg === '-o' || arg === '--output') {
      result.output = args[++i];
      i++;
    } else if (arg.startsWith('--output=')) {
      result.output = arg.slice('--output='.length);
      i++;
    } else if (arg === '--pack') {
      const packSpec = args[++i];
      if (packSpec) result.packs.push(packSpec);
      i++;
    } else if (arg.startsWith('--pack=')) {
      result.packs.push(arg.slice('--pack='.length));
      i++;
    } else if (arg === '--sport') {
      result.sport = args[++i];
      i++;
    } else if (arg === '--unit') {
      result.unit = args[++i];
      i++;
    } else if (arg === '--db') {
      result.db = args[++i];
      i++;
    } else if (arg.startsWith('--db=')) {
      result.db = arg.slice('--db='.length);
      i++;
    } else if (arg === '--debug') {
      // Bare flag never consumes the next arg — use --debug=<name> for a custom file.
      result.debug = '';
      i++;
    } else if (arg.startsWith('--debug=')) {
      result.debug = arg.slice('--debug='.length);
      i++;
    } else if (arg === '--source') {
      const source = args[++i];
      if (source) result.sources.push(source);
      i++;
    } else if (arg.startsWith('--source=')) {
      result.sources.push(arg.slice('--source='.length));
      i++;
    } else if (arg === '--scaffold') {
      result.scaffold = true;
      i++;
    } else if (arg === '--template') {
      result.template = args[++i];
      i++;
    } else if (arg.startsWith('--template=')) {
      result.template = arg.slice('--template='.length);
      i++;
    } else if (arg === '--out') {
      result.output = args[++i];
      i++;
    } else if (arg.startsWith('--out=')) {
      result.output = arg.slice('--out='.length);
      i++;
    } else if (arg === '--dir') {
      result.dir = args[++i];
      i++;
    } else if (arg.startsWith('--dir=')) {
      result.dir = arg.slice('--dir='.length);
      i++;
    } else if (!result.subcommand) {
      if (arg === 'parse' || arg === 'run' || arg === 'query' || arg === 'download' || arg === 'import' || arg === 'build' || arg === 'seed' || arg === 'reset' || arg === 'help' || arg === 'version') {
        result.subcommand = arg;
      } else {
        result.target = arg;
      }
      i++;
    } else if (!result.target) {
      result.target = arg;
      i++;
    } else if (!result.target2) {
      result.target2 = arg;
      i++;
    } else {
      i++;
    }
  }

  return result;
}

/**
 * Recover the Bun `Bun.stdin.text()` reader when running under Bun. The Bun
 * global is not part of the ambient lib shape; `in`/`typeof` narrowing proves
 * the access chain at runtime before the single unchecked cast.
 */
function readBunStdinText(): (() => Promise<string>) | undefined {
  const g: unknown = globalThis;
  if (g && typeof g === 'object' && 'Bun' in g) {
    const bun = g.Bun;
    if (bun && typeof bun === 'object' && 'stdin' in bun) {
      const stdin = bun.stdin;
      if (stdin && typeof stdin === 'object' && 'text' in stdin) {
        const text = stdin.text;
        if (typeof text === 'function') return text as () => Promise<string>;
      }
    }
  }
  return undefined;
}

export async function readStdin(): Promise<string> {
  const bunText = readBunStdinText();
  if (bunText) return bunText();
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    process.stdin.on('error', (err) => {
      reject(err);
    });
  });
}

function getUsageText(): string {
  return `
wod CLI — Headless Whiteboard Language & WQL Engine runner (v${VERSION})

USAGE:
  wod parse <file | -> [options]
  wod run <file | -> [options]
  wod query '<wql-string>' [options]
  wod download <note|session|effort|equipment> <id> [options]
  wod import <note|session|effort|equipment> <file> [options]
  wod build [dir] [options]
  wod seed [options]
  wod reset [options]

SUBCOMMANDS:
  parse <file | ->    Parse Whiteboard Script, create a note in the database
                     (whole source + saved revisions + sparse block index), optionally emit parse-tree IR.
                     Markdown carrying a 'wod-note-id' frontmatter stamp
                     (see download) imports back into that same note.
  run <file | ->      Execute the script state machine, record a session +
                     event/summary rows in the database, optionally emit
                     execution-log IR
  query '<wql>'       Evaluate WQL against the database (or an explicit
                     dataset) and emit QueryResult / RowsQueryResult IR
  download note <id>  Export the note's authored markdown to <id>.md.
                     The frontmatter identity stamp allows re-import.
                     Frontmatter tags (general + typed equipment/quality/…)
                     are materialized into the tag graph on parse/import.
  download session <id>
                     Write the session's generated metrics (event + summary
                     rows, one CSV row per metric) to <id>.csv. Import back
                     with 'wod import session'.
  download effort <slug>
                     Write the effort registry row as corpus-style markdown
                     (frontmatter id/slug/label/aliases/baseAttributes + body)
                     to <slug>.md. Import back with 'wod import effort'.
  download equipment
                     Write every equipment tag as a one-column CSV to
                     equipment.csv. Import back with 'wod import equipment'.
  import note <file>  Re-import exported note markdown (same as parse with
                     the stamped identity).
  import session <file>
                     Import a session + its events from a downloaded CSV.
                     The exact saved block revision must already exist.
  import effort <file>
                     Upsert an effort registry row from corpus-style markdown.
  import equipment <file>
                     Create/upgrade equipment tags (CSV, one label per row).
  build [dir]         Compile a seed corpus: validate every .md under
                     <dir>/markdown (parity gate + dashboard format gate) and
                     write manifest.json + content-hashed chunks/ +
                     report.html to <dir>/dist with source/maps/projections bundled
                     (override with -o/--output). Version stamps derive from
                     <dir>'s git history (full checkout required).

BUILD OPTIONS (for 'build'):
  --scaffold          Also scaffold markdown/efforts/discovered/*.md stubs for
                      workout effort labels missing from the registry.
  --template <file>   Compile an extra markdown file as the 'template' chunk
                      (the host's playground intake template).

INPUT SOURCING (for 'query'; without these, the database is queried):
  -c, --corpus <path> Load historical corpus dataset from a versioned JSON file
  --stdin-log         Read kind: 'execution-log' JSON payload from stdin
  --stdin-facts       Read raw kind: 'fact-set' JSON payload from stdin

DATABASE (parse / run / query / download / import / seed / reset):
  --db <path>         SQLite database file (default: $WOD_WIKI_DB or
                      ./wodwiki.db). Created on demand by parse/run/seed.

SEED SOURCING (for 'seed'):
  --source <dir>      Extra compiled seed directory (manifest.json + chunks);
                      repeatable. Defaults to the bundled core + community
                      artifacts under apps/playground/public/seed.

OPTIONS:
  --format <fmt>      Output format: json (default), table, csv
  -o, --output <path> Write the IR payload (or download) to a path instead of
                      the default; '-' writes to stdout
  --debug[=name]      Also write the IR payload to <name> (default
                      wod-<subcommand>-debug.json); without it, parse/run
                      print a one-line summary of what was persisted
  --pack <module>     Dynamically load and register a Language Pack (repeatable)
  --sport <sport>     Target sport fence dialect (e.g. climbing, crossfit)
  --unit <unit>       Preferred display unit for queries (e.g. lb, kg)
  -h, --help          Show help message
  -v, --version       Show version number

EXIT CODES:
  0 - OK / Success
  1 - General / Runtime error
  2 - Parse / Syntax error
  3 - Language Pack load error
`;
}

function printUsage(writer?: (text: string) => void): void {
  const text = getUsageText();
  if (writer) {
    writer(text);
  } else {
    // CLI stdout output channel (not a debugging statement).
    process.stdout.write(text.endsWith('\n') ? text : text + '\n');
  }
}

/**
 * Main CLI entry point. Returns numeric exit code.
 */
export async function cliMain(
  argv: string[] = process.argv.slice(2),
  io: {
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
    readStdinFn?: () => Promise<string>;
  } = {},
): Promise<number> {
  const writeOut = io.stdout ?? ((t: string) => process.stdout.write(t + '\n'));
  const writeErr = io.stderr ?? ((t: string) => process.stderr.write(t + '\n'));
  const getStdin = io.readStdinFn ?? readStdin;

  let parsed: CliParsedArgs;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    writeErr(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (parsed.version || parsed.subcommand === 'version') {
    writeOut(`wod v${VERSION}`);
    return 0;
  }

  if (parsed.help || parsed.subcommand === 'help') {
    printUsage(writeOut);
    return 0;
  }

  if (!parsed.subcommand) {
    printUsage(writeErr);
    return 1;
  }
  // 1. Load any requested Language Packs (Exit code 3 on failure)
  for (const packSpec of parsed.packs) {
    try {
      await loadLanguagePack(packSpec);
    } catch (err) {
      if (err instanceof PackLoadError) {
        writeErr(err.message);
      } else {
        writeErr(`[wod] Language pack load error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return 3;
    }
  }

  // Output destination helper
  const deliverOutput = (formattedText: string) => {
    if (parsed.output && parsed.output !== '-') {
      getFs().writeFileSync(parsed.output, formattedText, 'utf-8');
    } else {
      writeOut(formattedText);
    }
  };

  // --debug[=name]: undefined = off, '' = default file name, else custom name.
  const debugTarget = (subcommand: string): string | undefined =>
    parsed.debug === undefined ? undefined : parsed.debug || `wod-${subcommand}-debug.json`;

  const writeDebugFile = (subcommand: string, ir: unknown) => {
    const target = debugTarget(subcommand);
    if (target !== undefined) {
      getFs().writeFileSync(target, JSON.stringify(ir, null, 2) + '\n', 'utf-8');
    }
  };

  // 2. Dispatch subcommands
  try {
    if (parsed.subcommand === 'parse') {
      if (!parsed.target) {
        writeErr('[wod parse] Error: Missing input file or "-" for stdin');
        return 1;
      }

      let source: string;
      if (parsed.target === '-') {
        source = await getStdin();
      } else {
        const fs = getFs();
        if (!fs.existsSync(parsed.target)) {
          writeErr(`[wod parse] File not found: ${parsed.target}`);
          return 1;
        }
        source = fs.readFileSync(parsed.target, 'utf-8');
      }

      const noteSource = cliNoteSource(source, parsed.target, parsed.sport);
      const ir = runParse(source, { sport: parsed.sport, sourceLabel: `cli:wod parse ${parsed.target}` });
      const identity = extractNoteIdentity(source);
      const tags = extractTypedTags(source);
      const db = await openCliDb(parsed.db);
      try {
        const persisted = await persistNote(db, {
          source: noteSource,
          sourceLabel: parsed.target,
          noteId: identity?.noteId,
          title: identity?.title,
          tags,
        });
        writeOut(
          `[wod parse] note ${persisted.noteId}${persisted.created ? '' : ' (updated)'}` +
          ` — ${persisted.blocks} blocks, ${persisted.efforts} efforts` +
          `${persisted.tags > 0 ? `, ${persisted.tags} tags` : ''} → ${db.path}`,
        );
      } finally {
        await db.close();
      }
      if (parsed.output) {
        const pretty = Boolean(process.stdout.isTTY);
        deliverOutput(formatParseOutput(ir, parsed.format, pretty));
      }
      writeDebugFile('parse', ir);
      return 0;
    }

    if (parsed.subcommand === 'run') {
      if (!parsed.target) {
        writeErr('[wod run] Error: Missing input file or "-" for stdin');
        return 1;
      }

      let source: string;
      if (parsed.target === '-') {
        source = await getStdin();
      } else {
        const fs = getFs();
        if (!fs.existsSync(parsed.target)) {
          writeErr(`[wod run] File not found: ${parsed.target}`);
          return 1;
        }
        source = fs.readFileSync(parsed.target, 'utf-8');
      }

      const identity = extractNoteIdentity(source);
      const db = await openCliDb(parsed.db);
      let ir: WodWikiIRFile<ExecutionLog>;
      try {
        const started = await startRun(db, {
          source: cliNoteSource(source, parsed.target, parsed.sport),
          sourceLabel: parsed.target,
          noteId: identity?.noteId,
          title: identity?.title,
          tags: extractTypedTags(source),
        });
        const section = parseDocumentSections(started.revision.rawContent).find((row) => row.scriptBlock);
        if (!section?.scriptBlock) throw new Error('[wod run] Captured workout source cannot be parsed');
        const bare = !/\.(?:md|markdown)$/i.test(parsed.target) && !parseDocumentSections(source).some((row) => row.scriptBlock);
        const frozenBody = bare ? section.scriptBlock.content.slice(0, -1) : section.scriptBlock.content;
        ir = await runExecution(frozenBody, {
          sport: started.revision.sport,
          dialect: started.revision.dialect,
          blockId: started.session.blockId,
          blockVersion: started.session.blockVersion,
          startTime: started.session.startTime,
          sourceLabel: `cli:wod run ${parsed.target}`,
        });
        const persisted = await persistRun(db, started, ir.data);
        writeOut(
          `[wod run] session ${persisted.resultId} — ${persisted.events} events, ` +
          `${persisted.summaries} summaries on note ${persisted.noteId} → ${db.path}`,
        );
      } finally {
        await db.close();
      }
      if (parsed.output) {
        const pretty = Boolean(process.stdout.isTTY);
        deliverOutput(formatExecutionOutput(ir, parsed.format, pretty));
      }
      writeDebugFile('run', ir);
      return 0;
    }

    if (parsed.subcommand === 'query') {
      if (!parsed.target) {
        writeErr('[wod query] Error: Missing WQL query argument');
        return 1;
      }

      const useDb = !parsed.corpus && !parsed.stdinLog && !parsed.stdinFacts;
      let stdinLogContent: string | undefined;
      let stdinFactsContent: string | undefined;

      if (parsed.stdinLog) {
        stdinLogContent = await getStdin();
      } else if (parsed.stdinFacts) {
        stdinFactsContent = await getStdin();
      }

      let ir;
      if (useDb) {
        const dbPath = resolveDbPath(parsed.db);
        if (!nodeFs().existsSync(dbPath)) {
          writeErr(
            `[wod query] No input dataset and no database at ${dbPath}. ` +
            'Specify --corpus <file>, --stdin-log, --stdin-facts, or run `wod seed` first.',
          );
          return 1;
        }
        const db = await openCliDb(parsed.db);
        try {
          ir = await runQueryCli(parsed.target, {
            preferredUnit: parsed.unit,
            sourceLabel: `cli:wod query "${parsed.target}"`,
            stores: {
              eventStore: sqliteEventStore(db.db),
              noteStore: sqliteNoteStore(db.db),
              blockStore: sqliteBlockStore(db.db),
              effortStore: sqliteEffortStore(db.db),
              blockEffortsStore: sqliteIndexStore(db.db, 'block_efforts'),
              tagsStore: sqliteIndexStore(db.db, 'tags'),
              noteTagsStore: sqliteIndexStore(db.db, 'note_tags'),
            },
          });
        } finally {
          await db.close();
        }
      } else {
        if (!parsed.corpus && !stdinLogContent && !stdinFactsContent) {
          writeErr('[wod query] Error: Query requires input data. Specify --corpus <file>, --stdin-log, or --stdin-facts.');
          return 1;
        }
        ir = await runQueryCli(parsed.target, {
          corpusPath: parsed.corpus,
          stdinLog: stdinLogContent,
          stdinFacts: stdinFactsContent,
          preferredUnit: parsed.unit,
          sourceLabel: `cli:wod query "${parsed.target}"`,
        });
      }

      const pretty = !parsed.output && Boolean(process.stdout.isTTY);
      const formatted = formatQueryOutput(ir, parsed.format, pretty);
      deliverOutput(formatted);
      writeDebugFile('query', ir);
      return 0;
    }

    if (parsed.subcommand === 'download') {
      const kind = parsed.target;
      const id = parsed.target2;
      const DOWNLOAD_KINDS = ['note', 'session', 'effort', 'equipment'];
      if ((!id && kind !== 'equipment') || !DOWNLOAD_KINDS.includes(kind ?? '')) {
        writeErr('[wod download] Usage: wod download <note|session|effort|equipment> <id> [-o <path>]');
        return 1;
      }
      const targetId = id as string;
      const db = await openCliDb(parsed.db);
      try {
        if (kind === 'note') {
          const bundle = await getNoteBundle(db.db, targetId);
          if (!bundle.note) {
            writeErr(`[wod download] Note not found in ${db.path}: ${id}`);
            return 1;
          }
          const markdown = composeNoteMarkdown(bundle.note);
          const target = parsed.output && parsed.output !== '-' ? parsed.output : `${id}.md`;
          if (parsed.output === '-') {
            writeOut(markdown);
          } else {
            nodeFs().writeFileSync(target, markdown, 'utf-8');
          }
          if (parsed.output !== '-') writeOut(`[wod download] note ${id} → ${target}`);
        } else if (kind === 'session') {
          const bundle = await getSessionBundle(db.db, targetId);
          if (!bundle) {
            writeErr(`[wod download] Session not found in ${db.path}: ${id}`);
            return 1;
          }
          const csv = sessionToCsv(bundle.session, bundle.events);
          const target = parsed.output && parsed.output !== '-' ? parsed.output : `${id}.csv`;
          if (parsed.output === '-') {
            writeOut(csv);
          } else {
            nodeFs().writeFileSync(target, csv, 'utf-8');
          }
          if (parsed.output !== '-') writeOut(`[wod download] session ${id} → ${target} (${bundle.events.length} events)`);
        } else if (kind === 'effort') {
          const effort = await getEffortBySlug(db.db, targetId);
          if (!effort) {
            writeErr(`[wod download] Effort not found in ${db.path}: ${id}`);
            return 1;
          }
          const markdown = effortToMarkdown(effort as Parameters<typeof effortToMarkdown>[0]);
          const target = parsed.output && parsed.output !== '-' ? parsed.output : `${id}.md`;
          if (parsed.output === '-') {
            writeOut(markdown);
          } else {
            nodeFs().writeFileSync(target, markdown, 'utf-8');
          }
          writeOut(`[wod download] effort ${id} → ${target}`);
        } else {
          // equipment — id is unused; export the whole catalog.
          const labels = (await listTagsByType(db.db, 'equipment')).map((t) => t.label).sort();
          const csv = equipmentToCsv(labels);
          const target = parsed.output && parsed.output !== '-' ? parsed.output : 'equipment.csv';
          if (parsed.output === '-') {
            writeOut(csv);
          } else {
            nodeFs().writeFileSync(target, csv, 'utf-8');
          }
          writeOut(`[wod download] equipment → ${target} (${labels.length} labels)`);
        }
      } finally {
        await db.close();
      }
      return 0;
    }

    if (parsed.subcommand === 'import') {
      const kind = parsed.target;
      const file = parsed.target2;
      const IMPORT_KINDS = ['note', 'session', 'effort', 'equipment'];
      if (!file || !IMPORT_KINDS.includes(kind ?? '')) {
        writeErr('[wod import] Usage: wod import <note|session|effort|equipment> <file>');
        return 1;
      }
      const fs = nodeFs();
      if (!fs.existsSync(file)) {
        writeErr(`[wod import] File not found: ${file}`);
        return 1;
      }
      if (kind === 'note') {
        const source = fs.readFileSync(file, 'utf-8');
        const identity = extractNoteIdentity(source);
        const tags = extractTypedTags(source);
        const db = await openCliDb(parsed.db);
        try {
          const persisted = await persistNote(db, {
            source,
            sourceLabel: file,
            noteId: identity?.noteId,
            title: identity?.title,
            tags,
          });
          writeOut(
            `[wod import] note ${persisted.noteId}${persisted.created ? '' : ' (updated)'}` +
            ` — ${persisted.blocks} blocks${persisted.tags > 0 ? `, ${persisted.tags} tags` : ''} → ${db.path}`,
          );
        } finally {
          await db.close();
        }
        return 0;
      }
      if (kind === 'effort') {
        const effort = markdownToEffort(fs.readFileSync(file, 'utf-8'));
        if (!effort) {
          writeErr(`[wod import] Unparseable effort file (need frontmatter id/slug/label + numeric baseAttributes.met): ${file}`);
          return 1;
        }
        const db = await openCliDb(parsed.db);
        try {
          await persistEffort(db, { ...effort, registrySource: 'user' });
          writeOut(`[wod import] effort ${effort.slug} — ${effort.label} → ${db.path}`);
        } finally {
          await db.close();
        }
        return 0;
      }
      if (kind === 'equipment') {
        const labels = csvToEquipmentLabels(fs.readFileSync(file, 'utf-8'));
        if (labels.length === 0) {
          writeErr(`[wod import] No equipment labels found in ${file}`);
          return 1;
        }
        const db = await openCliDb(parsed.db);
        try {
          const added = await persistTypedTags(db, labels, 'equipment');
          writeOut(`[wod import] equipment — ${labels.length} labels (${added} new) → ${db.path}`);
        } finally {
          await db.close();
        }
        return 0;
      }
      const { session, events } = csvToSessionRows(fs.readFileSync(file, 'utf-8'));
      const db = await openCliDb(parsed.db);
      try {
        const result = await persistSessionBundle(db, session, events);
        writeOut(
          `[wod import] session ${session.id} — ${result.events} events → ${db.path}`,
        );
      } finally {
        await db.close();
      }
      return 0;
    }

    if (parsed.subcommand === 'build') {
      const cwd = process.cwd();
      const root = nodePath().resolve(cwd, parsed.dir ?? parsed.target ?? '.');
      if (!nodeFs().existsSync(nodePath().resolve(root, 'markdown'))) {
        writeErr(`[wod build] No markdown/ corpus under ${root} — run from the content repo root (or pass its directory).`);
        return 1;
      }
      // Browser-boundary: dynamic import keeps node:crypto and child_process out of the browser graph.
      const { generateSeed } = await import('./seedbuild/compiler');
      try {
        const result = generateSeed({
          corpusRoot: root,
          ...(parsed.output ? { outDir: nodePath().resolve(cwd, parsed.output) } : {}),
          ...(parsed.template ? { templateFile: nodePath().resolve(cwd, parsed.template) } : {}),
          scaffoldDiscoveredEfforts: parsed.scaffold === true,
        });
        const kb = (n: number): string => `${(n / 1024).toFixed(0)} KB`;
        const totalBytes = result.manifest.chunks.reduce((s, c) => s + c.bytes, 0);
        writeOut(`[wod build] schema v${result.manifest.schema} version ${result.manifest.version} (${result.manifest.versionLabel}) → ${result.outDir}`);
        for (const c of result.manifest.chunks) {
          writeOut(`  ${c.id.padEnd(48)} ${String(c.count).padStart(4)} files  ${kb(c.bytes).padStart(8)}`);
        }
        writeOut(`[wod build] ${result.manifest.chunks.length} chunks, ${result.totalFiles} files, ${kb(totalBytes)} total — scan ${result.passMs.scan}ms, block-index ${result.passMs.blockIndex}ms, block-efforts ${result.passMs.blockEfforts}ms, write ${result.passMs.write}ms`);
        return 0;
      } catch (error) {
        writeErr(`[wod build] ${(error as Error).message}`);
        return 1;
      }
    }

    if (parsed.subcommand === 'seed') {
      const dirs = parsed.sources.length > 0
        ? parsed.sources.map((s) => nodePath().resolve(process.cwd(), s))
        : defaultSeedDirs(process.cwd());
      if (dirs.length === 0) {
        writeErr(
          '[wod seed] No seed sources found. Run `bun scripts/sync-seed.ts` to build the bundled ' +
          'artifacts, or pass --source <dir> pointing at a compiled seed directory (manifest.json + chunks).',
        );
        return 1;
      }
      const db = await openCliDb(parsed.db);
      try {
        for (const dir of dirs) {
          const summary = await importSeedDir(db, dir, '');
          writeOut(
            `[wod seed] ${summary.sourceId}: v${summary.version} — ${summary.notes} notes, ` +
            `${summary.efforts} efforts, ${summary.blocks} blocks, ${summary.blockEfforts} block-efforts ` +
            `(${summary.deleted} deleted, ${summary.skippedUserOwned} user-owned skipped) → ${db.path}`,
          );
        }
      } finally {
        await db.close();
      }
      return 0;
    }

    if (parsed.subcommand === 'reset') {
      const target = resolveDbPath(parsed.db);
      if (nodeFs().existsSync(target)) {
        nodeFs().unlinkSync(target);
        writeOut(`[wod reset] removed ${target}`);
      } else {
        writeOut(`[wod reset] nothing to reset — ${target} does not exist`);
      }
      return 0;
    }

    writeErr(`[wod] Unknown subcommand "${parsed.subcommand}"`);
    return 1;
  } catch (error) {
    if (error instanceof ParseSyntaxError || error instanceof WqlSyntaxError) {
      writeErr(error.message);
      return 2;
    }
    if (error instanceof PackLoadError) {
      writeErr(error.message);
      return 3;
    }
    writeErr(`[wod] Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
