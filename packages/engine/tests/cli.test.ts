import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { cliMain, dialectRegistry, unregisterLanguagePack } from '../src/index';
import * as execution from '../src/cli/run';
import { cliNoteSource } from '../src/cli/runner';
import { openCliDb } from '../src/cli/db';
import { persistNote } from '../src/cli/persist';
import { parseDocumentSections } from '@bitcobblers/wod-wiki-core';

const FIXTURE_PATH = join(__dirname, '../../wql/fixtures/corpus/crossfit-multi-week.json');
const TEMP_SCRIPT_FILE = join(process.cwd(), 'temp-test-workout.txt');
const TEMP_OUTPUT_FILE = join(process.cwd(), 'temp-test-out.json');
const TEMP_DEBUG_FILE = join(process.cwd(), 'wod-parse-debug.json');
const TEMP_PACK_FILE = join(process.cwd(), 'temp-test-pack.mjs');
const TEMP_DB_FILE = join(process.cwd(), 'temp-test-wodwiki.db');

describe('wod CLI runner', () => {
  beforeEach(() => {
    writeFileSync(TEMP_SCRIPT_FILE, '(21-15-9)\n  Thrusters @95lb\n  Pull-ups', 'utf-8');
  });

  afterEach(() => {
    if (existsSync(TEMP_SCRIPT_FILE)) unlinkSync(TEMP_SCRIPT_FILE);
    if (existsSync(TEMP_OUTPUT_FILE)) unlinkSync(TEMP_OUTPUT_FILE);
    if (existsSync(TEMP_DEBUG_FILE)) unlinkSync(TEMP_DEBUG_FILE);
    if (existsSync(TEMP_PACK_FILE)) unlinkSync(TEMP_PACK_FILE);
    if (existsSync(TEMP_DB_FILE)) unlinkSync(TEMP_DB_FILE);
    unregisterLanguagePack('cli-dynamic-pack');
    dialectRegistry.unregister('cli-dynamic-dialect');
  });

  it('prints help and version with exit code 0', async () => {
    let out = '';
    const codeHelp = await cliMain(['--help'], { stdout: (t) => { out += t; } });
    expect(codeHelp).toBe(0);
    expect(out).toContain('wod CLI');
    expect(out).toContain('wod seed');
    expect(out).toContain('wod reset');

    let verOut = '';
    const codeVer = await cliMain(['--version'], { stdout: (t) => { verOut += t; } });
    expect(codeVer).toBe(0);
    expect(verOut).toContain('wod v');
  });

  describe('wod parse', () => {
    it('parses workout file, persists a note, and prints a summary (exit code 0)', async () => {
      let stdout = '';
      const code = await cliMain(['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], {
        stdout: (t) => { stdout += t; },
      });

      expect(code).toBe(0);
      expect(stdout).toContain('[wod parse] note');
      expect(stdout).toContain('blocks');
      expect(existsSync(TEMP_DB_FILE)).toBe(true);
    });

    it('parses from stdin ("-") and persists (exit code 0)', async () => {
      let stdout = '';
      const code = await cliMain(['parse', '-', '--db', TEMP_DB_FILE], {
        stdout: (t) => { stdout += t; },
        readStdinFn: async () => '5 RFT:\n  10 Box Jumps',
      });

      expect(code).toBe(0);
      expect(stdout).toContain('[wod parse] note');
    });

    it('writes the parse-tree IR via --debug (default file name)', async () => {
      const code = await cliMain(['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE, '--debug'], {
        stdout: () => {},
      });
      expect(code).toBe(0);
      expect(existsSync(TEMP_DEBUG_FILE)).toBe(true);
      const parsed = JSON.parse(readFileSync(TEMP_DEBUG_FILE, 'utf-8'));
      expect(parsed.$schema).toBe('https://wod-wiki.dev/ir/v1.json');
      expect(parsed.kind).toBe('parse-tree');
      expect(parsed.data).toBeDefined();
    });

    it('writes the parse-tree IR via --debug=<name>', async () => {
      const custom = join(process.cwd(), 'temp-custom-debug.json');
      const code = await cliMain(
        ['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE, `--debug=${custom}`],
        { stdout: () => {} },
      );
      expect(code).toBe(0);
      expect(existsSync(custom)).toBe(true);
      if (existsSync(custom)) unlinkSync(custom);
    });

    it('formats parse tree as table and csv when -o is given', async () => {
      const tableFile = join(process.cwd(), 'temp-table-out.txt');
      const codeTable = await cliMain(
        ['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE, '--format', 'table', '-o', tableFile],
        { stdout: () => {} },
      );
      expect(codeTable).toBe(0);
      expect(readFileSync(tableFile, 'utf-8')).toContain('Parse Tree');
      if (existsSync(tableFile)) unlinkSync(tableFile);

      const csvFile = join(process.cwd(), 'temp-csv-out.csv');
      const codeCsv = await cliMain(
        ['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE, '--format', 'csv', '-o', csvFile],
        { stdout: () => {} },
      );
      expect(codeCsv).toBe(0);
      expect(readFileSync(csvFile, 'utf-8')).toContain('id,type,from,to,raw,metrics,hints');
      if (existsSync(csvFile)) unlinkSync(csvFile);
    });

    it('writes output to file via -o flag', async () => {
      const code = await cliMain(['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE, '-o', TEMP_OUTPUT_FILE]);
      expect(code).toBe(0);
      expect(existsSync(TEMP_OUTPUT_FILE)).toBe(true);
      const content = JSON.parse(readFileSync(TEMP_OUTPUT_FILE, 'utf-8'));
      expect(content.kind).toBe('parse-tree');
    });

    it('returns exit code 1 when input file is missing', async () => {
      let stderr = '';
      const code = await cliMain(['parse', 'non-existent-file-12345.txt'], {
        stderr: (t) => { stderr += t; },
      });
      expect(code).toBe(1);
      expect(stderr).toContain('File not found');
    });
  });

  describe('wod run', () => {
    it('commits the pin before execution and freezes the original bare body during concurrent edit', async () => {
      const source = readFileSync(TEMP_SCRIPT_FILE, 'utf-8');
      const execute = execution.runExecution;
      const spy = vi.spyOn(execution, 'runExecution').mockImplementation(async (body, options) => {
        expect(body).toBe(source);
        const db = await openCliDb(TEMP_DB_FILE);
        try {
          const sessions = await db.storage.readonly('sessions').getAll();
          expect(sessions).toHaveLength(1);
          expect(sessions[0].status).toBe('in-progress');
          const revision = await db.storage.readonly('block_revisions').get([sessions[0].noteId, sessions[0].blockId, sessions[0].blockVersion]);
          expect(revision).toBeDefined();
          expect(revision!.rawContent).toBe(cliNoteSource(source, TEMP_SCRIPT_FILE).slice(0, -1));
          await persistNote(db, { source: '# Replaced while running\n', sourceLabel: TEMP_SCRIPT_FILE });
        } finally {
          await db.close();
        }
        return execute(body, options);
      });
      try {
        expect(await cliMain(['run', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], { stdout: () => {} })).toBe(0);
        expect(spy).toHaveBeenCalledOnce();
      } finally {
        spy.mockRestore();
      }
    });

    it('wraps bare content with a longer fence without changing body bytes', () => {
      const source = '10 push-up\r\n``` in body 😀\r\n';
      const wrapped = cliNoteSource(source, '-', 'crossfit');
      expect(wrapped.startsWith('````time:crossfit\n')).toBe(true);
      expect(parseDocumentSections(wrapped)[0].scriptBlock!.content.slice(0, -1)).toBe(source);
      expect(cliNoteSource('# Plain prose\r\n', 'note.md')).toBe('# Plain prose\r\n');
    });
    it('executes workout script, records a session, and prints a summary (exit code 0)', async () => {
      let stdout = '';
      const code = await cliMain(['run', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], {
        stdout: (t) => { stdout += t; },
      });

      expect(code).toBe(0);
      expect(stdout).toContain('[wod run] session');
      expect(stdout).toContain('events');
      expect(stdout).toContain('summaries');
      expect(existsSync(TEMP_DB_FILE)).toBe(true);
    });

    it('emits execution-log IR via --debug', async () => {
      const debugFile = join(process.cwd(), 'wod-run-debug.json');
      const code = await cliMain(['run', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE, '--debug'], {
        stdout: () => {},
      });
      expect(code).toBe(0);
      expect(existsSync(debugFile)).toBe(true);
      const ir = JSON.parse(readFileSync(debugFile, 'utf-8'));
      expect(ir.kind).toBe('execution-log');
      expect(ir.data.results).toBeDefined();
      expect(ir.data.results.completed).toBe(true);
      if (existsSync(debugFile)) unlinkSync(debugFile);
    });

    it('formats run output as table and csv when -o is given', async () => {
      const tableFile = join(process.cwd(), 'temp-run-table.txt');
      const codeTable = await cliMain(
        ['run', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE, '--format', 'table', '-o', tableFile],
        { stdout: () => {} },
      );
      expect(codeTable).toBe(0);
      expect(readFileSync(tableFile, 'utf-8')).toContain('Workout Execution Results:');
      if (existsSync(tableFile)) unlinkSync(tableFile);

      const csvFile = join(process.cwd(), 'temp-run.csv');
      const codeCsv = await cliMain(
        ['run', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE, '--format', 'csv', '-o', csvFile],
        { stdout: () => {} },
      );
      expect(codeCsv).toBe(0);
      expect(readFileSync(csvFile, 'utf-8')).toContain('id,outputType,started,ended');
      if (existsSync(csvFile)) unlinkSync(csvFile);
    });
  });

  describe('wod query', () => {
    it('evaluates WQL against --corpus and returns query-result IR (exit code 0)', async () => {
      let stdout = '';
      const code = await cliMain(
        ['query', 'sum:totalVolume{} by {week}', '--corpus', FIXTURE_PATH, '--format', 'json'],
        { stdout: (t) => { stdout += t; } },
      );

      expect(code).toBe(0);
      const ir = JSON.parse(stdout);
      expect(ir.$schema).toBe('https://wod-wiki.dev/ir/v1.json');
      expect(ir.kind).toBe('query-result');
      expect(ir.data.series.length).toBe(1);
      // Ticket 13: mixed lb+rep totalVolume facts are an incompatible-units
      // diagnostic — no silently pooled points.
      expect(ir.data.series[0].error).toContain('Incompatible units');
      expect(ir.data.series[0].points.length).toBe(0);
    });

    it('evaluates WQL against --stdin-facts (exit code 0)', async () => {
      const sampleFacts = [
        {
          id: 'f1',
          timestamp: 1783357200000,
          metricKey: 'totalVolume',
          type: 'totalVolume',
          value: 1000,
          grain: 'summary',
        },
      ];

      let stdout = '';
      const code = await cliMain(
        ['query', 'sum:totalVolume{}', '--stdin-facts', '--format', 'json'],
        {
          stdout: (t) => { stdout += t; },
          readStdinFn: async () => JSON.stringify(sampleFacts),
        },
      );

      expect(code).toBe(0);
      const ir = JSON.parse(stdout);
      expect(ir.kind).toBe('query-result');
      expect(ir.data.series[0].points[0].value).toBe(1000);
    });

    it('evaluates rows query against --stdin-log (exit code 0)', async () => {
      const sampleLog = {
        results: {
          startTime: 1783357200000,
          endTime: 1783357260000,
          duration: 60000,
          completed: true,
        },
        statements: [
          {
            id: 1,
            outputType: 'segment',
            timeSpan: { started: 1783357200000, ended: 1783357260000 },
            metrics: [{ type: 'round', value: 1 }],
            sourceBlockKey: 'test-block',
            stackLevel: 1,
          },
        ],
      };

      let stdout = '';
      const code = await cliMain(
        ['query', ':session{result:stdin-result-1}', '--stdin-log', '--format', 'json'],
        {
          stdout: (t) => { stdout += t; },
          readStdinFn: async () => JSON.stringify(sampleLog),
        },
      );

      expect(code).toBe(0);
      const ir = JSON.parse(stdout);
      expect(ir.kind).toBe('rows-result');
      expect(ir.data.runs.length).toBe(1);
    });

    it('evaluates a colon pipeline through the QueryService path (exit code 0)', async () => {
      const sampleLog = {
        results: {
          startTime: 1783357200000,
          endTime: 1783357260000,
          duration: 60000,
          completed: true,
        },
        statements: [
          {
            id: 1,
            outputType: 'segment',
            timeSpan: { started: 1783357200000, ended: 1783357260000 },
            metrics: [{ type: 'round', value: 1 }],
            sourceBlockKey: 'test-block',
            stackLevel: 1,
          },
        ],
      };

      let stdout = '';
      const code = await cliMain(
        ['query', ':session{result:stdin-result-1} | :count{metric:round} | :value{}', '--stdin-log', '--format', 'json'],
        {
          stdout: (t) => { stdout += t; },
          readStdinFn: async () => JSON.stringify(sampleLog),
        },
      );

      expect(code).toBe(0);
      const ir = JSON.parse(stdout);
      expect(ir.kind).toBe('pipeline-result');
      // One segment statement carries round:1 — the count over it is 1.
      expect(ir.data.parsed.family).toBe('pipeline');
      expect(ir.data.series[0].points[0].value).toBe(1);
    });

    it('returns exit code 1 when no dataset and no database exist', async () => {
      const previousEnv = process.env.WOD_WIKI_DB;
      process.env.WOD_WIKI_DB = join(process.cwd(), 'definitely-missing-wodwiki.db');
      try {
        let stderr = '';
        const code = await cliMain(['query', 'sum:totalVolume{}'], {
          stderr: (t) => { stderr += t; },
        });
        expect(code).toBe(1);
        expect(stderr).toContain('No input dataset');
      } finally {
        if (previousEnv === undefined) delete process.env.WOD_WIKI_DB;
        else process.env.WOD_WIKI_DB = previousEnv;
      }
    });

    it('returns exit code 2 on malformed WQL query syntax error', async () => {
      let stderr = '';
      const code = await cliMain(
        ['query', 'invalid query clause ???', '--corpus', FIXTURE_PATH],
        { stderr: (t) => { stderr += t; } },
      );
      expect(code).toBe(2);
      expect(stderr).toContain('WQL Syntax Error');
    });
  });

  describe('--pack dynamic loading', () => {
    it('dynamically loads a Language Pack module and registers it', async () => {
      writeFileSync(
        TEMP_PACK_FILE,
        `
export default {
  identity: { id: 'cli-dynamic-pack', name: 'CLI Dynamic Pack' },
  lang: {
    analyzer: class CliDynamicDialect {
      id = 'cli-dynamic-dialect';
      name = 'CLI Dynamic Dialect';
      priority = 20;
      analyze(statement) {
        if (/thrusters/i.test(statement.meta?.raw ?? '')) {
          return { metrics: [{ type: 'hint', value: 'pack.thruster_found', image: 'pack.thruster_found', origin: 'dialect' }] };
        }
        return {};
      }
    }
  }
};
`,
        'utf-8',
      );

      const debugFile = join(process.cwd(), 'wod-parse-debug.json');
      const code = await cliMain(
        ['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE, '--pack', TEMP_PACK_FILE, '--debug'],
        { stdout: () => {} },
      );

      expect(code).toBe(0);
      const ir = JSON.parse(readFileSync(debugFile, 'utf-8'));
      const hints = JSON.stringify(ir);
      expect(hints).toContain('pack.thruster_found');
      if (existsSync(debugFile)) unlinkSync(debugFile);
    });

    it('returns exit code 3 when Language Pack fails to load', async () => {
      let stderr = '';
      const code = await cliMain(
        ['parse', TEMP_SCRIPT_FILE, '--pack', './non-existent-pack-file-999.mjs'],
        { stderr: (t) => { stderr += t; } },
      );
      expect(code).toBe(3);
      expect(stderr).toContain('Failed to load Language Pack');
    });
  });
});
