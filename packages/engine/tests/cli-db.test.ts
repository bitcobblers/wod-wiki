/**
 * Database-backed CLI behavior: parse/run persistence, db-sourced queries,
 * seed import (fixture), and reset.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { cliMain } from '../src/index';
import { loadSql, openCliDb } from '../src/cli/db';
import type { NoteSegment, Session } from '@bitcobblers/wod-wiki-storage';

const TEMP_SCRIPT_FILE = join(process.cwd(), 'temp-db-test-workout.md');
const TEMP_DB_FILE = join(process.cwd(), 'temp-db-test-wodwiki.db');
const SEED_FIXTURE_DIR = join(__dirname, 'fixtures', 'seed-mini');

const FENCED_WORKOUT = '# Morning\n\n```time\n3 Rounds\n- 5 pull-up\n- 10 push-up\n```\n';

afterEach(() => {
  if (existsSync(TEMP_SCRIPT_FILE)) unlinkSync(TEMP_SCRIPT_FILE);
  if (existsSync(TEMP_DB_FILE)) unlinkSync(TEMP_DB_FILE);
});

describe('wod CLI database behavior', () => {
  it('parse persists a note with segments and block rows; re-parse versions old segments', async () => {
    writeFileSync(TEMP_SCRIPT_FILE, FENCED_WORKOUT, 'utf-8');
    const code = await cliMain(['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], { stdout: () => {} });
    expect(code).toBe(0);

    const db = await openCliDb(TEMP_DB_FILE);
    const sql = await loadSql();
    try {
      const segments = (await sql.listRows(db.db, sql.storeDefinition('segments'))) as NoteSegment[];
      expect(segments.length).toBeGreaterThan(0);
      expect(segments.some((s) => s.dataType === 'wod')).toBe(true);
      expect(segments.every((s) => s.isHistory !== true)).toBe(true);

      const blocks = await sql.listRows(db.db, sql.storeDefinition('block_index'));
      expect(blocks.length).toBe(segments.length);

      const blockEfforts = await sql.listRows(db.db, sql.storeDefinition('block_efforts'));
      expect(blockEfforts.length).toBeGreaterThan(0);
    } finally {
      await db.close();
    }

    // Re-parse: same note, old segments become history, versions bump.
    const second = await cliMain(['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], { stdout: () => {} });
    expect(second).toBe(0);

    const db2 = await openCliDb(TEMP_DB_FILE);
    try {
      const sql2 = await loadSql();
      const segments = (await sql2.listRows(db2.db, sql2.storeDefinition('segments'))) as NoteSegment[];
      const wodSegments = segments.filter((s) => s.dataType === 'wod');
      expect(wodSegments.some((s) => s.isHistory === true)).toBe(true);
      expect(Math.max(...wodSegments.map((s) => s.version))).toBe(2);

      // Block index follows the latest versions — one row per current segment.
      const blocks = await sql2.listRows(db2.db, sql2.storeDefinition('block_index'));
      expect(blocks.length).toBe(new Set(segments.filter((s) => s.isHistory !== true).map((s) => s.id)).size);
    } finally {
      await db2.close();
    }
  });

  it('run records a session + events; query reads them back from the database', async () => {
    writeFileSync(TEMP_SCRIPT_FILE, FENCED_WORKOUT, 'utf-8');
    const runCode = await cliMain(['run', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], { stdout: () => {} });
    expect(runCode).toBe(0);

    const db = await openCliDb(TEMP_DB_FILE);
    const sql = await loadSql();
    let noteId = '';
    try {
      const sessions = (await sql.listRows(db.db, sql.storeDefinition('sessions'))) as Session[];
      expect(sessions.length).toBe(1);
      expect(sessions[0].completed).toBe(true);
      expect(sessions[0].origin).toBe('journal');
      expect(sessions[0].segmentId).toBeDefined();
      noteId = sessions[0].noteId;

      const events = await sql.listRows(db.db, sql.storeDefinition('events'));
      expect(events.length).toBeGreaterThan(0);
    } finally {
      await db.close();
    }

    // Default query mode reads the database.
    let stdout = '';
    const queryCode = await cliMain(['query', 'sum:rep{} by {effort}', '--db', TEMP_DB_FILE, '--format', 'json'], {
      stdout: (t) => { stdout += t; },
    });
    expect(queryCode).toBe(0);
    const ir = JSON.parse(stdout);
    expect(ir.kind).toBe('query-result');
    expect(ir.data.series.length).toBeGreaterThan(0);

    // Content find against the same note.
    let findOut = '';
    const findCode = await cliMain(['query', ':note{}', '--db', TEMP_DB_FILE, '--format', 'json'], {
      stdout: (t) => { findOut += t; },
    });
    expect(findCode).toBe(0);
    const find = JSON.parse(findOut);
    expect(find.data.notes.some((n: { id: string }) => n.id === noteId)).toBe(true);
  });

  it('seed imports a compiled source directory; queries classify the corpus', async () => {
    const seedCode = await cliMain(['seed', '--db', TEMP_DB_FILE, '--source', SEED_FIXTURE_DIR], {
      stdout: () => {},
    });
    expect(seedCode).toBe(0);

    let findOut = '';
    const noteCode = await cliMain(['query', ':note{text:"Fran"}', '--db', TEMP_DB_FILE, '--format', 'json'], {
      stdout: (t) => { findOut += t; },
    });
    expect(noteCode).toBe(0);
    const find = JSON.parse(findOut);
    expect(find.data.stages.matched).toBe(1);

    let blockOut = '';
    const blockCode = await cliMain(['query', ':block{effort:"thruster"}', '--db', TEMP_DB_FILE, '--format', 'json'], {
      stdout: (t) => { blockOut += t; },
    });
    expect(blockCode).toBe(0);
    const blocks = JSON.parse(blockOut);
    expect(blocks.data.stages.matched).toBe(1);
  });

  it('reset deletes the database file; resetting a missing file is a no-op', async () => {
    writeFileSync(TEMP_SCRIPT_FILE, FENCED_WORKOUT, 'utf-8');
    await cliMain(['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], { stdout: () => {} });
    expect(existsSync(TEMP_DB_FILE)).toBe(true);

    let out = '';
    const code = await cliMain(['reset', '--db', TEMP_DB_FILE], { stdout: (t) => { out += t; } });
    expect(code).toBe(0);
    expect(existsSync(TEMP_DB_FILE)).toBe(false);
    expect(out).toContain('removed');

    let out2 = '';
    const code2 = await cliMain(['reset', '--db', TEMP_DB_FILE], { stdout: (t) => { out2 += t; } });
    expect(code2).toBe(0);
    expect(out2).toContain('nothing to reset');
  });

  it('download note → edit → parse round-trips into the same note with versioned history', async () => {
    // Frontmatter-bearing source keeps segment positions stable across the
    // export → edit → re-import cycle (segment ids are positional).
    const FENCED_WITH_FRONTMATTER = '---\ntitle: Morning\nsport: crossfit\n---\n\n# Morning\n\n```time\n3 Rounds\n- 5 pull-up\n- 10 push-up\n```\n';
    writeFileSync(TEMP_SCRIPT_FILE, FENCED_WITH_FRONTMATTER, 'utf-8');
    let parseOut = '';
    await cliMain(['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], { stdout: (t) => { parseOut += t; } });
    const noteId = /\[wod parse\] note ([0-9a-f-]+)/.exec(parseOut)![1];

    const exportFile = join(process.cwd(), 'temp-db-test-export.md');
    let dlOut = '';
    const dlCode = await cliMain(['download', 'note', noteId, '--db', TEMP_DB_FILE, '-o', exportFile], {
      stdout: (t) => { dlOut += t; },
    });
    expect(dlCode).toBe(0);

    let exported = readFileSync(exportFile, 'utf-8');
    expect(exported).toContain(`wod-note-id: ${noteId}`);
    expect(exported).toContain('3 Rounds');

    // Edit and re-import: must update the SAME note (stamped identity).
    exported = exported.replace('3 Rounds', '5 Rounds');
    writeFileSync(TEMP_SCRIPT_FILE, exported, 'utf-8');
    let reparseOut = '';
    await cliMain(['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], { stdout: (t) => { reparseOut += t; } });
    expect(reparseOut).toContain(`note ${noteId}`);
    expect(reparseOut).toContain('(updated)');

    const db = await openCliDb(TEMP_DB_FILE);
    const sql = await loadSql();
    try {
      // Version 1 composes the original; latest composes the edit.
      const segments = (await sql.listRows(db.db, sql.storeDefinition('segments'))) as NoteSegment[];
      expect(segments.some((s) => s.noteId === noteId && s.version === 2)).toBe(true);

      let latestOut = '';
      await cliMain(['download', 'note', noteId, '--db', TEMP_DB_FILE, '-o', '-'], {
        stdout: (t) => { latestOut += t; },
      });
      expect(latestOut).toContain('5 Rounds');

      let v1Out = '';
      await cliMain(['download', 'note', noteId, '--at', '1', '--db', TEMP_DB_FILE, '-o', '-'], {
        stdout: (t) => { v1Out += t; },
      });
      expect(v1Out).toContain('3 Rounds');
      expect(v1Out).not.toContain('5 Rounds');
    } finally {
      await db.close();
    }
    if (existsSync(exportFile)) unlinkSync(exportFile);
  });

  it('download session → import into a clean db reproduces queryable metrics', async () => {
    writeFileSync(TEMP_SCRIPT_FILE, FENCED_WORKOUT, 'utf-8');
    let runOut = '';
    await cliMain(['run', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], { stdout: (t) => { runOut += t; } });
    const resultId = /\[wod run\] session ([0-9a-f-]+)/.exec(runOut)![1];

    const csvFile = join(process.cwd(), 'temp-db-test-session.csv');
    const dlCode = await cliMain(['download', 'session', resultId, '--db', TEMP_DB_FILE, '-o', csvFile], {
      stdout: () => {},
    });
    expect(dlCode).toBe(0);
    expect(existsSync(csvFile)).toBe(true);

    const sumQuery = 'sum:rep{} by {effort}';
    let srcOut = '';
    await cliMain(['query', sumQuery, '--db', TEMP_DB_FILE, '--format', 'json'], {
      stdout: (t) => { srcOut += t; },
    });

    // Clean target: only the imported CSV.
    const CLEAN_DB = join(process.cwd(), 'temp-db-test-clean.db');
    if (existsSync(CLEAN_DB)) unlinkSync(CLEAN_DB);
    try {
      let impOut = '';
      const impCode = await cliMain(['import', 'session', csvFile, '--db', CLEAN_DB], {
        stdout: (t) => { impOut += t; },
      });
      expect(impCode).toBe(0);
      expect(impOut).toContain(resultId);
      expect(impOut).toContain('stub note created');

      let dstOut = '';
      await cliMain(['query', sumQuery, '--db', CLEAN_DB, '--format', 'json'], {
        stdout: (t) => { dstOut += t; },
      });
      expect(JSON.parse(dstOut).data.series).toEqual(JSON.parse(srcOut).data.series);

      // Re-import is idempotent.
      const impAgain = await cliMain(['import', 'session', csvFile, '--db', CLEAN_DB], {
        stdout: () => {},
      });
      expect(impAgain).toBe(0);
      let dstOut2 = '';
      await cliMain(['query', sumQuery, '--db', CLEAN_DB, '--format', 'json'], {
        stdout: (t) => { dstOut2 += t; },
      });
      expect(JSON.parse(dstOut2).data.series).toEqual(JSON.parse(srcOut).data.series);
    } finally {
      if (existsSync(CLEAN_DB)) unlinkSync(CLEAN_DB);
      if (existsSync(csvFile)) unlinkSync(csvFile);
    }
  });

  it('download reports a helpful error for unknown ids', async () => {
    let errOut = '';
    const code = await cliMain(['download', 'note', 'no-such-note', '--db', TEMP_DB_FILE], {
      stdout: () => {},
      stderr: (t) => { errOut += t; },
    });
    expect(code).toBe(1);
    expect(errOut).toContain('Note not found');
  });
});
