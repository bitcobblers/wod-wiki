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
  getEquipmentBySlug,
  listTagsByType,
} from './db';
import { loadCliEnvironment, resolveDatabaseConfig, type CliDatabaseConfig } from './config';
import { runDbCommand, type DbAdminDeps } from './dbAdmin';
// Type-only: erased at build time, keeps the Bun-only server module out of the
// browser/Node import graph (runCliServer itself is lazily imported).
import type { CliServerOptions } from './server';
import { persistNote, startRun, persistRun, persistSessionBundle, persistDefinitionNote, persistTypedTags } from './persist';
import { defaultSeedDirs, importSeedDir } from './seed';
import { publishNotebookSeed } from './publish';
import {
  composeNoteMarkdown,
  csvToEquipmentLabels,
  csvToSessionRows,
  effortToMarkdown,
  equipmentToMarkdown,
  equipmentToCsv,
  extractNoteIdentity,
  extractTypedTags,
  sessionToCsv,
} from '@bitcobblers/wod-wiki-engine';
import {
  formatParseOutput,
  formatExecutionOutput,
  formatQueryOutput,
  type OutputFormat,
} from './formatters';

import { parseDocumentSections } from '@bitcobblers/wod-wiki-core';
import type { ExecutionLog, WodWikiIRFile } from '@bitcobblers/wod-wiki-engine';
import { VERSION } from '../version';

/** Bare CLI scripts become authored Markdown at the persistence boundary. */
export function cliNoteSource(source: string, label: string, sport?: string): string {
  if (/\.(?:md|markdown)$/i.test(label) || parseDocumentSections(source).some((section) => section.scriptBlock)) return source;
  let length = 3;
  for (const match of source.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}time${sport ? `:${sport}` : ''}\n${source}\n${fence}\n`;
}

export interface CliParsedArgs {
  subcommand?: 'parse' | 'run' | 'query' | 'download' | 'export' | 'import' | 'publish' | 'build' | 'seed' | 'reset' | 'init' | 'db' | 'server' | 'serve' | 'playground' | 'init-feed' | 'skills' | 'help' | 'version';
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
  /** Explicit version number for published seed manifests (--seed-version). */
  seedVersion?: number;
  /** SQLite database path (--db). Defaults to WOD_WIKI_DB or ./wodwiki.db. */
  db?: string;
  /** Backend driver override (--db-driver): sqlite | postgres | turso. */
  dbDriver?: string;
  /** `wod db`: action (create|backup|restore|migrate|delete|pair) is the
   *  first positional (parsed.target) and the database name the second. */
  group?: string;
  dbName?: string;
  yes?: string;
  writersRetired?: boolean;
  allowEmpty?: boolean;
  writeEnv?: boolean;
  force?: boolean;
  /** PostgreSQL connection URL (--database-url) or component flags below. */
  databaseUrl?: string;
  postgresHost?: string;
  postgresPort?: string;
  postgresUser?: string;
  postgresPassword?: string;
  postgresDatabase?: string;
  postgresSsl?: string;
  /** Turso/libSQL target (--turso-url) plus its auth token. */
  tursoUrl?: string;
  tursoAuthToken?: string;
  /** Explicit environment file (--env-file); a missing file is an error. */
  envFile?: string;
  /** Hosting bind address/port and prebuilt frontend directory (server/playground). */
  host?: string;
  port?: string;
  dist?: string;
  /** IR debug output: undefined = off, '' = default file name, otherwise the file name. */
  debug?: string;
  /** Extra seed source directories for `wod seed` (repeatable). */
  sources: string[];
  /** `wod build`: scaffold markdown stubs for newly discovered efforts. */
  scaffold?: boolean;
  /** `wod build`: content repo root (alias for the positional directory). */
  dir?: string;
}

/**
 * Property flags that take a value in both `--flag value` and `--flag=value`
 * forms. Missing, empty, or flag-like (`--…`) values are parse errors.
 */
/** The CliParsedArgs properties settable through VALUE_FLAGS — all `string | undefined`. */
type CliValueFlagArgs = Pick<
  CliParsedArgs,
  | 'db'
  | 'dbDriver'
  | 'group'
  | 'dbName'
  | 'yes'
  | 'databaseUrl'
  | 'postgresHost'
  | 'postgresPort'
  | 'postgresUser'
  | 'postgresPassword'
  | 'postgresDatabase'
  | 'postgresSsl'
  | 'tursoUrl'
  | 'tursoAuthToken'
  | 'envFile'
  | 'host'
  | 'port'
  | 'dist'
>;

const VALUE_FLAGS: ReadonlyArray<readonly [flag: string, key: keyof CliValueFlagArgs]> = [
  ['--db', 'db'],
  ['--db-driver', 'dbDriver'],
  ['--group', 'group'],
  ['--name', 'dbName'],
  ['--yes', 'yes'],
  ['--database-url', 'databaseUrl'],
  ['--postgres-host', 'postgresHost'],
  ['--postgres-port', 'postgresPort'],
  ['--postgres-user', 'postgresUser'],
  ['--postgres-password', 'postgresPassword'],
  ['--postgres-database', 'postgresDatabase'],
  ['--postgres-ssl', 'postgresSsl'],
  ['--turso-url', 'tursoUrl'],
  ['--turso-auth-token', 'tursoAuthToken'],
  ['--env-file', 'envFile'],
  ['--host', 'host'],
  ['--port', 'port'],
  ['--dist', 'dist'],
];

function readValueFlag(args: string[], i: number, flag: string): { value: string; next: number } {
  const inline = args[i].startsWith(`${flag}=`);
  if (inline) {
    const value = args[i].slice(flag.length + 1);
    if (!value) throw new Error(`Missing value for ${flag}`);
    return { value, next: i + 1 };
  }
  const value = args[i + 1];
  if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return { value, next: i + 2 };
}

export function parseCliArgs(args: string[]): CliParsedArgs {
  const result: CliParsedArgs = {
    format: 'json',
    packs: [],
    sources: [],
  };
  const valueArgs: CliValueFlagArgs = result;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--at' || arg.startsWith('--at=')) throw new Error('Unknown option --at; whole Note exports have no as-of version');

    const valueFlag = VALUE_FLAGS.find(([flag]) => arg === flag || arg.startsWith(`${flag}=`));
    if (valueFlag) {
      const [flag, key] = valueFlag;
      const { value, next } = readValueFlag(args, i, flag);
      valueArgs[key] = value;
      i = next;
      continue;
    }

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
    } else if (arg === '--writers-retired') {
      result.writersRetired = true;
      i++;
    } else if (arg === '--allow-empty') {
      result.allowEmpty = true;
      i++;
    } else if (arg === '--write-env') {
      result.writeEnv = true;
      i++;
    } else if (arg === '--force') {
      result.force = true;
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
    } else if (arg === '--seed-version') {
      const v = Number(args[++i]);
      if (Number.isSafeInteger(v) && v >= 0) result.seedVersion = v;
      i++;
    } else if (arg.startsWith('--seed-version=')) {
      const v = Number(arg.slice('--seed-version='.length));
      if (Number.isSafeInteger(v) && v >= 0) result.seedVersion = v;
      i++;
    } else if (!result.subcommand) {
      if (arg === 'parse' || arg === 'run' || arg === 'query' || arg === 'download' || arg === 'export' || arg === 'import' || arg === 'publish' || arg === 'build' || arg === 'seed' || arg === 'reset' || arg === 'init' || arg === 'db' || arg === 'server' || arg === 'serve' || arg === 'playground' || arg === 'init-feed' || arg === 'skills' || arg === 'help' || arg === 'version') {
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

  for (const [flag, value] of [['--port', result.port], ['--postgres-port', result.postgresPort]] as const) {
    if (value !== undefined && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)) {
      throw new Error(`Invalid value for ${flag}: "${value}" is not a TCP port (1-65535)`);
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
  wod export <note|playground|session|effort|equipment> <id> [options]
  wod download <note|playground|session|effort|equipment> <id> [options]
  wod import <note|playground|session|effort|equipment> <file> [options]
  wod publish [feed] [options]
  wod build [dir] [options]
  wod init-feed <name>
                      Scaffold a new feed repository (package.json, example
                      collection, GitHub Actions Pages workflow). Refuses an
                      existing destination.
  wod skills <list | install> [options]
                      Agent skills bundled with this CLI — the Whiteboard
                      Script extraction rules an agent needs to parse and write
                      correct workouts. install copies them to
                      <dir>/.agents/skills/ (no network); they are also
                      publishable via npx skills add bitcobblers/wod-wiki.
  wod skills install [--dir <path>] [--force]
  wod seed [options]
  wod reset [options]
  wod init            Initialize the configured database (idempotent)
  wod db <action> [name] [options]
                      Turso database lifecycle (management credentials from
                      the environment only: TURSO_API_TOKEN + TURSO_ORGANIZATION;
                      never flags, never printed):
  wod db create [--name <db>] --group <g> -o <pairing-file>
                      Provision a fresh empty target (default name
                      wod-wiki-v<schema>) and write its pairing file.
  wod db backup <source> [--name <copy>] --writers-retired -o <file>
  wod db restore <source> [--name <copy>] --writers-retired -o <file>
                      Native whole-database copy (Control API seed); verified
                      row- and binary-identical before any token is minted.
                      Backups receive read-only archive credentials. Restore
                      copies are writable only at the current schema;
                      older-schema copies stay read-only until migrated.
  wod db migrate <source> [--name <target>] --writers-retired -o <file>
                      Logical conversion to a fresh current-schema target via
                      the shared IndexedDB adapter. The target stays
                      unpairable (constructing marker) until replay, pin and
                      source-immutability checks pass; the source is retained.
  wod db delete <name> --yes <name>
                      Delete a database — --yes must repeat the exact name.
  wod db pair <name> [--allow-empty] -o <file> [--write-env]
                      Mint a database-scoped token and write the pairing file
                      for the browser Data settings (0600, exclusive create;
                      --force replaces atomically). Refuses foreign, legacy,
                      newer and unvalidated targets. --write-env opt-in
                      appends DB_DRIVER/TURSO_* to the .env atomically and
                      refuses to replace existing database settings.

DB OPTIONS (for 'wod db'):
  --name <db>         Explicit target/copy database name
  --group <g>         Turso group for 'create' (must exist); fallback target
                      group when the API does not report one
  --writers-retired   Acknowledge all writers on the source were stopped
                      before backup/restore/migrate read it
  --allow-empty       'pair' a deliberately empty bootstrap target
  --write-env         Opt-in .env output (atomic, refuses replacement)
  --force             Replace an existing pairing file (stays 0600)
  -o, --output <file> Pairing file path — REQUIRED for credential-issuing
                      actions; credentials are never printed to stdout

  wod server [options]
                      Serve the app (HTTP API + packaged frontend; alias: serve)
  wod playground [options]
                      Serve the local playground (browser IndexedDB build)

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
  export note <id>   Export the note's authored markdown to <id>.md.
                     (alias: export playground, download note).
                     The frontmatter identity stamp allows re-import.
                     Frontmatter tags (general + typed equipment/quality/…)
                     are materialized into the tag graph on parse/import.
  export session <id>
                     Write the session's generated metrics (event + summary
                     rows, one CSV row per metric) to <id>.csv. Import back
                     with 'wod import session'. (alias: download session).
  export effort <slug>
                     Write the effort registry row as corpus-style markdown
                     to <slug>.md. Import back with 'wod import effort'.
  export equipment   Write every equipment tag as a one-column CSV to
                     equipment.csv. Import back with 'wod import equipment'.
  download …         Accepted alias for 'wod export'.
  import note <file> Re-import exported note markdown (alias: import playground;
                     same as parse with the stamped identity).
  import session <file>
                     Import a session + its events from a downloaded CSV.
                     The exact saved block revision must already exist.
  import effort <file>
                     Upsert an effort registry row from corpus-style markdown.
  import equipment <file>
                     Create/upgrade equipment tags (CSV, one label per row).
  publish [feed]      Publish feed notes from the database into a configured
                     seed directory (manifest.json, chunks/, report.html)
                     compatible with 'wod seed --source <dir>'. Override target
                     with -o/--out/--output (defaults to ./dist/seed/<feed>).
  build [dir]         Compile a seed corpus: validate every .md under
                     <dir>/markdown (parity gate + dashboard format gate) and
                     write manifest.json + content-hashed chunks/ +
                     report.html to <dir>/dist with source/maps/projections bundled
                     (override with -o/--output). Version stamps derive from
                     <dir>'s git history (full checkout required).

BUILD OPTIONS (for 'build'):
  --scaffold          Also scaffold markdown/efforts/discovered/*.md stubs for
                      workout effort labels missing from the registry.

INPUT SOURCING (for 'query'; without these, the database is queried):
  -c, --corpus <path> Load historical corpus dataset from a versioned JSON file
  --stdin-log         Read kind: 'execution-log' JSON payload from stdin
  --stdin-facts       Read raw kind: 'fact-set' JSON payload from stdin

DATABASE (init / parse / run / query / download / import / seed / reset / server):
  Pick one backend; explicit flags win over the process environment, the
  process environment wins over .env files. Run 'wod init' once first: it
  creates the SQLite file + schema, creates the PostgreSQL database when
  your role is authorized to (otherwise use an existing/provisioned one),
  or installs the schema in your provisioned Turso database — idempotently,
  preserving existing notes. 'wod server' refuses an uninitialized database.
  --db <path>                Local SQLite database file (default: $WOD_WIKI_DB
                      or ./wodwiki.db). Passing --db always selects SQLite,
                      even when the environment names a remote backend.
                      Created on demand by parse/run/seed.
  --db-driver <name>         Backend driver: sqlite (default), postgres, or
                      turso ($DB_DRIVER)
  --database-url <url>       Database connection URL ($DATABASE_URL); accepts
                      PostgreSQL, local SQLite, and remote libSQL URLs.
  --postgres-host <host>     PostgreSQL host ($POSTGRES_HOST)
  --postgres-port <port>     PostgreSQL port ($POSTGRES_PORT)
  --postgres-user <user>     PostgreSQL user ($POSTGRES_USER)
  --postgres-password <pw>   PostgreSQL password ($POSTGRES_PASSWORD)
  --postgres-database <db>   PostgreSQL database name ($POSTGRES_DATABASE)
  --postgres-ssl <mode>      PostgreSQL SSL mode, e.g. disable/prefer/require
                      ($POSTGRES_SSL)
  --turso-url <url>          Turso/libSQL database URL (libsql://…). The
                      hosted database must already exist (provisioned on
                      Turso); only its schema is installed.
  --turso-auth-token <token> Turso authentication token (never printed)
  --env-file <path>          Load variables from this file; a missing file is
                      an error. Without it: ./.env when present, otherwise
                      the workspace-root .env. Credentials are never logged.

HOSTING (for 'server' / 'playground'; supported on Node and Bun):
  server               HTTP API over the configured database plus the frontend
                       packaged inside the tools module. Requires an
                       initialized database. ('serve' is an accepted alias.)
  playground           Serves the playground app backed by browser IndexedDB;
                       the configured database is not touched.
  --host <host>        Bind address (default 127.0.0.1, $HOST)
  --port <port>        TCP port (default 3000, $PORT)
  --dist <dir>         Serve this prebuilt frontend directory instead of the
                       packaged one ($PLAYGROUND_DIST); must already contain
                       index.html.

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

ENVIRONMENT (flags > process env > .env):
  WOD_WIKI_DB, SQLITE_PATH          SQLite file path
  DB_DRIVER                         sqlite | postgres | turso
  DATABASE_URL                      PostgreSQL connection URL
  POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER,
  POSTGRES_PASSWORD, POSTGRES_DATABASE, POSTGRES_SSL
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, LIBSQL_AUTH_TOKEN
  TURSO_API_TOKEN, TURSO_ORGANIZATION  wod db management credentials (env only)
  HOST, PORT, PLAYGROUND_DIST       server / playground defaults

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
    /** Test seam for `wod db`: injectable fetch/URL mapping for the Turso
     * management client (production resolves the real network). */
    dbDeps?: DbAdminDeps;
  } = {},
): Promise<number> {
  const writeOut = io.stdout ?? ((t: string) => process.stdout.write(t + '\n'));
  const writeErr = io.stderr ?? ((t: string) => process.stderr.write(t + '\n'));
  const getStdin = io.readStdinFn ?? readStdin;

  // Lazy environment/config: .env parsing and backend resolution run only for
  // database-backed commands and hosting — never for --corpus/--stdin dataset
  // queries, build, or playground, so a malformed remote config cannot break them.
  // loadCliEnvironment returns file values only; process env must overlay them
  // (bun --no-env-file keeps .env loading solely in this loader).
  let envLoaded: Record<string, string | undefined> | undefined;
  const cliEnv = () => (envLoaded ??= { ...loadCliEnvironment(parsed.envFile), ...process.env });
  let dbResolved: CliDatabaseConfig | undefined;
  const cliDb = () => (dbResolved ??= resolveDatabaseConfig(parsed, cliEnv()));

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
    if (parsed.subcommand === 'init-feed') {
      if (!parsed.target) {
        writeErr('[wod init-feed] Error: Missing feed name (a single new directory name)');
        return 1;
      }
      // Browser-boundary: dynamic import keeps node:fs usage out of the browser graph.
      const { scaffoldFeed } = await import('./scaffoldFeed');
      try {
        const result = scaffoldFeed(parsed.target);
        writeOut(`[wod init-feed] Created ${result.dir} (${result.files.length} files)`);
        writeOut(`Next: cd ${parsed.target} && bun install && bunx wod build . --output dist`);
        writeOut(`Agents: wod skills install --dir ${parsed.target}  (Whiteboard Script extraction rules → .agents/skills/)`);
        return 0;
      } catch (error) {
        writeErr(`[wod init-feed] ${(error as Error).message}`);
        return 1;
      }
    }

    if (parsed.subcommand === 'skills') {
      const action = parsed.target ?? 'list';
      // Dynamic import: skills.ts touches node:fs, which must stay out of the
      // browser bundle graph (same reason as ./scaffoldFeed above).
      const { bundledSkillsRoot, installSkills, listBundledSkills } = await import('./skills');
      try {
        if (action === 'list') {
          const root = bundledSkillsRoot();
          if (!root) {
            writeErr('[wod skills] No bundled skills found next to this CLI');
            return 1;
          }
          const skills = listBundledSkills(root);
          for (const skill of skills) writeOut(`${skill.name} — ${skill.description}`);
          writeOut(`[wod skills] ${skills.length} skill(s) from ${root}`);
          return 0;
        }
        if (action === 'install') {
          const result = installSkills({ dir: parsed.dir, force: parsed.force === true });
          for (const name of result.installed) writeOut(`[wod skills] installed ${name} → ${nodePath().join(result.target, name)}`);
          for (const name of result.skipped) writeOut(`[wod skills] ${name} already installed (use --force to replace)`);
          writeOut(`[wod skills] ${result.installed.length} installed, ${result.skipped.length} kept — source ${result.root}`);
          if (result.installed.length === 0 && result.skipped.length === 0) {
            writeErr('[wod skills] No bundled skills found');
            return 1;
          }
          writeOut('[wod skills] Agents read .agents/skills/; use `npx skills add bitcobblers/wod-wiki` for per-agent links.');
          return 0;
        }
        writeErr(`[wod skills] Unknown action '${action}' (expected: list | install)`);
        return 1;
      } catch (error) {
        writeErr(`[wod skills] ${(error as Error).message}`);
        return 1;
      }
    }

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
      const db = await openCliDb(cliDb());
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
      const db = await openCliDb(cliDb());
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
        const config = cliDb();
        if (config.kind === 'sqlite' && !nodeFs().existsSync(config.path)) {
          writeErr(
            `[wod query] No input dataset and no database at ${config.path}. ` +
            'Specify --corpus <file>, --stdin-log, --stdin-facts, or run `wod seed` first.',
          );
          return 1;
        }
        const db = await openCliDb(config, config.kind === 'sqlite' ? undefined : { initialize: false });
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

    if (parsed.subcommand === 'download' || parsed.subcommand === 'export') {
      const verb = parsed.subcommand;
      const kind = parsed.target;
      const id = parsed.target2;
      const DOWNLOAD_KINDS = ['note', 'playground', 'session', 'effort', 'equipment'];
      if ((!id && kind !== 'equipment') || !DOWNLOAD_KINDS.includes(kind ?? '')) {
        writeErr(`[wod ${verb}] Usage: wod ${verb} <note|playground|session|effort|equipment> <id> [-o <path>]`);
        return 1;
      }
      const targetId = id as string;
      const db = await openCliDb(cliDb());
      try {
        if (kind === 'note' || kind === 'playground') {
          const bundle = await getNoteBundle(db.db, targetId);
          if (!bundle.note) {
            writeErr(`[wod ${verb}] Note not found in ${db.path}: ${id}`);
            return 1;
          }
          const markdown = composeNoteMarkdown(bundle.note);
          const target = parsed.output && parsed.output !== '-' ? parsed.output : `${id}.md`;
          if (parsed.output === '-') {
            writeOut(markdown);
          } else {
            nodeFs().writeFileSync(target, markdown, 'utf-8');
          }
          if (parsed.output !== '-') writeOut(`[wod ${verb}] ${kind} ${id} → ${target}`);
        } else if (kind === 'session') {
          const bundle = await getSessionBundle(db.db, targetId);
          if (!bundle) {
            writeErr(`[wod ${verb}] Session not found in ${db.path}: ${id}`);
            return 1;
          }
          const csv = sessionToCsv(bundle.session, bundle.events);
          const target = parsed.output && parsed.output !== '-' ? parsed.output : `${id}.csv`;
          if (parsed.output === '-') {
            writeOut(csv);
          } else {
            nodeFs().writeFileSync(target, csv, 'utf-8');
          }
          if (parsed.output !== '-') writeOut(`[wod ${verb}] session ${id} → ${target} (${bundle.events.length} events)`);
        } else if (kind === 'effort') {
          const effort = await getEffortBySlug(db.db, targetId);
          if (!effort) {
            writeErr(`[wod ${verb}] Effort not found in ${db.path}: ${id}`);
            return 1;
          }
          // Lossless first: the owning definition note keeps the authored
          // document verbatim; reconstruct only when no owner note exists.
          const ownerNoteId = typeof effort.ownerNoteId === 'string' ? effort.ownerNoteId : `effort/${effort.slug}`;
          const owner = await db.storage.readonly('notes').get(ownerNoteId);
          const markdown = owner?.rawContent ?? effortToMarkdown(effort as Parameters<typeof effortToMarkdown>[0]);
          const target = parsed.output && parsed.output !== '-' ? parsed.output : `${id}.md`;
          if (parsed.output === '-') {
            writeOut(markdown);
          } else {
            nodeFs().writeFileSync(target, markdown, 'utf-8');
          }
          writeOut(`[wod ${verb}] effort ${id} → ${target}`);
        } else {
          // equipment definition (when slug matches a stored definition) or whole-catalog CSV.
          const equipment = id ? await getEquipmentBySlug(db.db, targetId) : undefined;
          if (equipment) {
            const ownerNoteId = typeof equipment.ownerNoteId === 'string' ? equipment.ownerNoteId : `equipment/${equipment.slug}`;
            const owner = await db.storage.readonly('notes').get(ownerNoteId);
            const markdown = owner?.rawContent ?? equipmentToMarkdown(equipment as Parameters<typeof equipmentToMarkdown>[0]);
            const target = parsed.output && parsed.output !== '-' ? parsed.output : `${id}.md`;
            if (parsed.output === '-') {
              writeOut(markdown);
            } else {
              nodeFs().writeFileSync(target, markdown, 'utf-8');
            }
            writeOut(`[wod ${verb}] equipment ${id} → ${target}`);
          } else {
            const labels = (await listTagsByType(db.db, 'equipment')).map((t) => t.label).sort();
            const csv = equipmentToCsv(labels);
            const target = parsed.output && parsed.output !== '-' ? parsed.output : 'equipment.csv';
            if (parsed.output === '-') {
              writeOut(csv);
            } else {
              nodeFs().writeFileSync(target, csv, 'utf-8');
            }
            writeOut(`[wod ${verb}] equipment → ${target} (${labels.length} labels)`);
          }
        }
      } finally {
        await db.close();
      }
      return 0;
    }

    if (parsed.subcommand === 'import') {
      const kind = parsed.target;
      const file = parsed.target2;
      const IMPORT_KINDS = ['note', 'playground', 'session', 'effort', 'equipment'];
      if (!file || !IMPORT_KINDS.includes(kind ?? '')) {
        writeErr('[wod import] Usage: wod import <note|playground|session|effort|equipment> <file>');
        return 1;
      }
      const fs = nodeFs();
      if (!fs.existsSync(file)) {
        writeErr(`[wod import] File not found: ${file}`);
        return 1;
      }
      if (kind === 'note' || kind === 'playground') {
        const source = fs.readFileSync(file, 'utf-8');
        const identity = extractNoteIdentity(source);
        const tags = extractTypedTags(source);
        const db = await openCliDb(cliDb());
        try {
          const persisted = await persistNote(db, {
            source,
            sourceLabel: file,
            noteId: identity?.noteId,
            title: identity?.title,
            tags,
          });
          writeOut(
            `[wod import] ${kind} ${persisted.noteId}${persisted.created ? '' : ' (updated)'}` +
            ` — ${persisted.blocks} blocks${persisted.tags > 0 ? `, ${persisted.tags} tags` : ''} → ${db.path}`,
          );
        } finally {
          await db.close();
        }
        return 0;
      }
      if (kind === 'effort') {
        const source = fs.readFileSync(file, 'utf-8');
        const db = await openCliDb(cliDb());
        try {
          const result = await persistDefinitionNote(db, 'effort', source);
          writeOut(`[wod import] effort ${result.slug}${result.createdNote ? '' : ' (updated)'} — note ${result.noteId} → ${db.path}`);
        } finally {
          await db.close();
        }
        return 0;
      }
      if (kind === 'equipment' && /\.md$/i.test(file)) {
        const source = fs.readFileSync(file, 'utf-8');
        const db = await openCliDb(cliDb());
        try {
          const result = await persistDefinitionNote(db, 'equipment', source);
          writeOut(`[wod import] equipment ${result.slug}${result.createdNote ? '' : ' (updated)'} — note ${result.noteId} → ${db.path}`);
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
        const db = await openCliDb(cliDb());
        try {
          const added = await persistTypedTags(db, labels, 'equipment');
          writeOut(`[wod import] equipment — ${labels.length} labels (${added} new) → ${db.path}`);
        } finally {
          await db.close();
        }
        return 0;
      }
      const { session, events } = csvToSessionRows(fs.readFileSync(file, 'utf-8'));
      const db = await openCliDb(cliDb());
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

    if (parsed.subcommand === 'publish') {
      const isDir = (s?: string) => Boolean(s && (s.startsWith('.') || s.startsWith('/') || s.includes('/') || s.includes('\\')));
      const notebook = isDir(parsed.target) ? undefined : parsed.target;
      const targetDir = isDir(parsed.target) ? parsed.target : parsed.target2;
      const outDir = parsed.output ?? targetDir ?? (notebook ? `./dist/seed/${notebook}` : './dist/seed');

      const db = await openCliDb(cliDb());
      try {
        const result = await publishNotebookSeed(db, {
          notebook,
          outDir,
          version: parsed.seedVersion,
        });
        writeOut(
          `[wod publish] published ${result.notebooks.join(', ')} (${result.totalNotes} notes) ` +
          `→ ${result.outDir} (manifest schema v${result.manifest.schema}, version ${result.manifest.version})`,
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
      const { generateSeed } = await import('../seedbuild/compiler');
      try {
        const result = generateSeed({
          corpusRoot: root,
          ...(parsed.output ? { outDir: nodePath().resolve(cwd, parsed.output) } : {}),
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
      const db = await openCliDb(cliDb());
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
      const config = cliDb();
      if (config.kind !== 'sqlite') {
        // Never unlink a remote backend; the message names only the driver
        // kind so URLs/tokens can never leak through reset output.
        writeErr(
          `[wod reset] refusing to reset the configured ${config.kind} database — ` +
          'reset only removes a local SQLite file. Clear remote databases through their provider.',
        );
        return 1;
      }
      const target = config.path;
      if (nodeFs().existsSync(target)) {
        nodeFs().unlinkSync(target);
        writeOut(`[wod reset] removed ${target}`);
      } else {
        writeOut(`[wod reset] nothing to reset — ${target} does not exist`);
      }
      return 0;
    }

    if (parsed.subcommand === 'init') {
      // Idempotent: opens and initializes the chosen backend. SQLite gets the
      // file + schema; PostgreSQL may create the target database when the
      // role authorizes it; Turso gets schema installed in the provisioned DB.
      const db = await openCliDb(cliDb(), { create: true });
      try {
        writeOut(`[wod init] database ready at ${db.path}`);
      } finally {
        await db.close();
      }
      return 0;
    }

    if (parsed.subcommand === 'db') {
      // Turso lifecycle: management credentials come from the environment
      // tier only; the action is the first positional, the database name the
      // second. Errors print credential-free and exit 1.
      try {
        await runDbCommand({
          action: parsed.target,
          name: parsed.target2,
          dbName: parsed.dbName,
          group: parsed.group,
          yes: parsed.yes,
          output: parsed.output,
          writeEnv: parsed.writeEnv === true,
          writersRetired: parsed.writersRetired === true,
          allowEmpty: parsed.allowEmpty === true,
          force: parsed.force === true,
          envFile: parsed.envFile,
          env: cliEnv(),
        }, { stdout: writeOut, stderr: writeErr }, io.dbDeps);
        return 0;
      } catch (error) {
        writeErr(error instanceof Error ? error.message : String(error));
        return 1;
      }
    }

    if (parsed.subcommand === 'server' || parsed.subcommand === 'serve' || parsed.subcommand === 'playground') {
      // 'server' is canonical; 'serve' is an accepted alias for the same branch.
      const mode = parsed.subcommand === 'playground' ? 'playground' as const : 'server' as const;
      // Lazy import: Bun-only server module must stay out of Node/browser graphs.
      const { runCliServer } = await import('./server');
      const options: CliServerOptions = { env: cliEnv() };
      if (mode === 'server') options.database = cliDb();
      if (parsed.host !== undefined) options.host = parsed.host;
      if (parsed.port !== undefined) options.port = parsed.port;
      if (parsed.dist !== undefined) options.dist = parsed.dist;
      await runCliServer(mode, options, writeOut);
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
