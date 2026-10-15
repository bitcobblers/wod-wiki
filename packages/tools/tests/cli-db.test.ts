/**
 * Database-backed CLI behavior: parse/run persistence, db-sourced queries,
 * seed import (fixture), and reset.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { cliMain } from '../src/index';
import { csvToEquipmentLabels, csvToSessionRows, sessionToCsv } from '@bitcobblers/wod-wiki-engine';
import { loadSql, openCliDb } from '../src/cli/db';
import type { Session } from '@bitcobblers/wod-wiki-storage';
import { persistNote, startRun, persistRun } from '../src/cli/persist';
import { parseDocumentSections, mapNoteBlockChanges } from '@bitcobblers/wod-wiki-core';
import { runExecution } from '../src/cli/run';
import { tmpdir } from 'node:os';
import { generateSeed } from '../src/seedbuild/compiler';
import { createClient } from '@libsql/client';

const TEMP_SCRIPT_FILE = join(process.cwd(), 'temp-db-test-workout.md');
const TEMP_DB_FILE = join(process.cwd(), 'temp-db-test-wodwiki.db');

const FENCED_WORKOUT = '# Morning\n\n```time\n(3)\n- 5 pull-up\n- 10 push-up\n```\n';

afterEach(() => {
  if (existsSync(TEMP_SCRIPT_FILE)) unlinkSync(TEMP_SCRIPT_FILE);
  if (existsSync(TEMP_DB_FILE)) unlinkSync(TEMP_DB_FILE);
});

describe('wod CLI database behavior', () => {
  it('parse stores whole source and sparse blocks; identical parse appends no revisions', async () => {
    writeFileSync(TEMP_SCRIPT_FILE, FENCED_WORKOUT, 'utf-8');
    expect(await cliMain(['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], { stdout: () => {} })).toBe(0);
    const db = await openCliDb(TEMP_DB_FILE);
    try {
      const notes = await db.storage.readonly('notes').getAll();
      expect(notes).toHaveLength(1);
      expect(notes[0].rawContent).toBe(FENCED_WORKOUT);
      expect(Object.values(notes[0].blocks)).toHaveLength(1);
      expect(await db.storage.readonly('block_index').getAll()).toHaveLength(1);
      expect(await db.storage.readonly('block_efforts').count()).toBeGreaterThan(0);
      const before = await db.storage.readonly('block_revisions').getAll();
      expect(before).toHaveLength(1);
      await persistNote(db, { source: FENCED_WORKOUT, sourceLabel: TEMP_SCRIPT_FILE });
      expect(await db.storage.readonly('notes').getAll()).toEqual(notes);
      expect(await db.storage.readonly('block_revisions').getAll()).toEqual(before);
    } finally {
      await db.close();
    }
  });

  it('keeps duplicate occurrences separate and preserves Note metadata on bulk replacement', async () => {
    const db = await openCliDb(TEMP_DB_FILE);
    const source = '```time\n10 push-up\n```\n\n```time\n10 push-up\n```\n';
    try {
      const first = await persistNote(db, { source, sourceLabel: TEMP_SCRIPT_FILE });
      const ids = Object.keys(first.note.blocks);
      expect(new Set(ids).size).toBe(2);
      await db.storage.readwrite('notes').put({
        ...first.note, catalog: 'training', sourceId: 'user-notebook',
        sourcePath: 'authored/workout.md', tags: ['retained'], seedOrigin: 'user',
      });
      const replaced = await persistNote(db, { source: source.replaceAll('10 push-up', '12 push-up'), sourceLabel: TEMP_SCRIPT_FILE });
      expect(replaced.note.catalog).toBe('training');
      expect(replaced.note.sourceId).toBe('user-notebook');
      expect(replaced.note.sourcePath).toBe('authored/workout.md');
      expect(replaced.note.tags).toEqual(['retained']);
      expect(replaced.note.seedOrigin).toBe('user');
      expect(Object.keys(replaced.note.blocks).every((id) => !ids.includes(id))).toBe(true);
      const revisions = await db.storage.readonly('block_revisions').getAllFromIndex('by-note', first.noteId);
      expect(revisions).toHaveLength(4);
      expect(await db.storage.readonly('block_index').count()).toBe(2);
    } finally {
      await db.close();
    }
  });

  it('saved unrun versions, revert and prose edits use occurrence history without effort churn', async () => {
    const db = await openCliDb(TEMP_DB_FILE);
    try {
      const first = await persistNote(db, { source: FENCED_WORKOUT, sourceLabel: TEMP_SCRIPT_FILE, now: 1 });
      const id = Object.keys(first.note.blocks)[0];
      const from = FENCED_WORKOUT.indexOf('(3)') + 1;
      const edited = FENCED_WORKOUT.replace('(3)', '(5)');
      const second = await persistNote(db, {
        source: edited, sourceLabel: TEMP_SCRIPT_FILE, now: 2,
        blocks: mapNoteBlockChanges(first.note.blocks, [{ from, to: from + 1, insert: '5' }]),
      });
      expect(second.note.blocks[id].version).toBe(2);
      const third = await persistNote(db, {
        source: FENCED_WORKOUT, sourceLabel: TEMP_SCRIPT_FILE, now: 3,
        blocks: mapNoteBlockChanges(second.note.blocks, [{ from, to: from + 1, insert: '3' }]),
      });
      expect(third.note.blocks[id].version).toBe(3);
      const links = await db.storage.readonly('block_efforts').getAll();
      const prose = 'Recovery 😀\n\n';
      const fourth = await persistNote(db, {
        source: prose + FENCED_WORKOUT, sourceLabel: TEMP_SCRIPT_FILE, now: 4,
        blocks: mapNoteBlockChanges(third.note.blocks, [{ from: 0, to: 0, insert: prose }]),
      });
      expect(fourth.note.blocks[id].version).toBe(3);
      expect(await db.storage.readonly('block_efforts').getAll()).toEqual(links);
      const history = await db.storage.readonly('block_revisions').getAllFromIndex('by-block', [first.noteId, id]);
      expect(history.map((row) => [row.version, row.savedAt])).toEqual([[1, 1], [2, 2], [3, 3]]);
      expect(await db.storage.readonly('sessions').count()).toBe(0);
      await expect(persistNote(db, {
        source: edited, sourceLabel: TEMP_SCRIPT_FILE, expectedSourceRevision: 1,
      })).rejects.toThrow(/Stale/);
      expect(await db.storage.readonly('notes').get(first.noteId)).toEqual(fourth.note);
    } finally {
      await db.close();
    }
  });

  it('captures a Session before execution and completes against its pin after source deletion', async () => {
    const db = await openCliDb(TEMP_DB_FILE);
    try {
      const started = await startRun(db, { source: FENCED_WORKOUT, sourceLabel: TEMP_SCRIPT_FILE }, 1000);
      expect(await db.storage.readonly('sessions').get(started.session.id)).toEqual(started.session);
      expect(started.session.status).toBe('in-progress');
      const body = parseDocumentSections(started.revision.rawContent)[0].scriptBlock!.content;
      await persistNote(db, { source: '# Removed workout\n', sourceLabel: TEMP_SCRIPT_FILE });
      await db.storage.readwrite('notes').delete(started.session.noteId);
      const execution = await runExecution(body, { startTime: started.session.startTime, sport: started.revision.sport, dialect: started.revision.dialect });
      const completed = await persistRun(db, started, execution.data);
      expect(completed.session.blockId).toBe(started.session.blockId);
      expect(completed.session.blockVersion).toBe(started.session.blockVersion);
      expect(completed.session.completed).toBe(true);
      const retained = await db.storage.readonly('block_revisions').get([started.session.noteId, started.session.blockId, started.session.blockVersion]);
      expect(retained).toEqual(started.revision);
      expect((await db.storage.readonly('events').getAll()).every((row) => row.blockId === started.session.blockId && row.blockVersion === started.session.blockVersion)).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('failed run capture rolls back source, projections and saved revisions together', async () => {
    const db = await openCliDb(TEMP_DB_FILE);
    try {
      await expect(startRun(db, { source: '# Prose only\n', sourceLabel: TEMP_SCRIPT_FILE })).rejects.toThrow(/no actionable workout/);
      expect(await db.storage.readonly('notes').count()).toBe(0);
      expect(await db.storage.readonly('block_index').count()).toBe(0);
      expect(await db.storage.readonly('block_revisions').count()).toBe(0);
      expect(await db.storage.readonly('sessions').count()).toBe(0);
    } finally {
      await db.close();
    }
  });

  it('incompatible schema startup fails without wiping existing rows', async () => {
    const db = await openCliDb(TEMP_DB_FILE);
    const saved = await persistNote(db, { source: FENCED_WORKOUT, sourceLabel: TEMP_SCRIPT_FILE });
    await db.db.exec('UPDATE "_wodwiki_schema" SET "value" = ? WHERE "key" = ?', [JSON.stringify({ version: 28 }), 'schema']);
    await db.close();
    await expect(openCliDb(TEMP_DB_FILE)).rejects.toThrow(/recreation required/);
    expect(existsSync(TEMP_DB_FILE)).toBe(true);
    const sql = await loadSql();
    const raw = sql.libsqlDatabase(createClient({ url: `file:${TEMP_DB_FILE}` }));
    try {
      expect(await sql.getRow(raw, sql.storeDefinition('notes'), saved.noteId)).toEqual(saved.note);
      expect(await sql.listRows(raw, sql.storeDefinition('block_revisions'))).toHaveLength(1);
    } finally {
      await raw.close();
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
      expect(sessions[0].blockId).toBeDefined();
      expect(sessions[0].blockVersion).toBe(1);
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

  it('seed imports freshly compiled source and queries classify the corpus', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wod-cli-seed-'));
    try {
      mkdirSync(join(root, 'markdown/collections/test'), { recursive: true });
      writeFileSync(join(root, 'markdown/collections/test/fran.md'), '---\ntitle: Fran\n---\n\n```time\n(21-15-9)\n  Thrusters @95lb\n  Pull-ups\n```\n', 'utf-8');
      mkdirSync(join(root, 'markdown/efforts'), { recursive: true });
      writeFileSync(join(root, 'markdown/efforts/thruster.md'), '---\nid: effort-thruster\nslug: thruster\nlabel: Thruster\naliases:\n  - Thrusters\nbaseAttributes:\n  met: 8.5\n---\n', 'utf-8');
      const built = generateSeed({ corpusRoot: root, version: 1, outDir: join(root, 'dist') });
      expect(await cliMain(['seed', '--db', TEMP_DB_FILE, '--source', built.outDir], { stdout: () => {} })).toBe(0);
      const imported = await openCliDb(TEMP_DB_FILE);
      try {
        const links = await imported.storage.readonly('block_efforts').getAllFromIndex('by-effort', 'thruster');
        expect(links).toHaveLength(1);
        const block = await imported.storage.readonly('block_index').get(`${links[0].noteId}:${links[0].blockId}`);
        expect(block?.rawContent).toContain('Thrusters @95lb');
      } finally {
        await imported.close();
      }
      let notes = '';
      expect(await cliMain(['query', ':note{text:"Fran"}', '--db', TEMP_DB_FILE], {
        stdout: (text) => { notes += text; },
      })).toBe(0);
      expect(JSON.parse(notes).data.stages.matched).toBe(1);
      let blocks = '';
      expect(await cliMain(['query', ':block{effort:"thruster"}', '--db', TEMP_DB_FILE], {
        stdout: (text) => { blocks += text; },
      })).toBe(0);
      expect(JSON.parse(blocks).data.stages.matched).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
    try {
      let latestOut = '';
      await cliMain(['download', 'note', noteId, '--db', TEMP_DB_FILE, '-o', '-'], {
        stdout: (t) => { latestOut += t; },
      });
      expect(latestOut).toContain('5 Rounds');
      expect(latestOut).not.toContain('3 Rounds');

      const history = await db.storage.readonly('block_revisions').getAllFromIndex('by-note', noteId);
      expect(history.some((row) => row.rawContent.includes('3 Rounds'))).toBe(true);
      expect(history.some((row) => row.rawContent.includes('5 Rounds'))).toBe(true);
      let error = '';
      expect(await cliMain(['download', 'note', noteId, '--at', '1', '--db', TEMP_DB_FILE], {
        stdout: () => {}, stderr: (text) => { error += text; },
      })).toBe(1);
      expect(error).toContain('Unknown option --at');
    } finally {
      await db.close();
    }
    if (existsSync(exportFile)) unlinkSync(exportFile);
  });

  it('Session CSV import requires exact revisions and round-trips once available', async () => {
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

    const sourceDb = await openCliDb(TEMP_DB_FILE);
    const revisions = await sourceDb.storage.readonly('block_revisions').getAll();
    try {
      const originalEvents = await sourceDb.storage.readonly('events').getAll();
      expect(await cliMain(['import', 'session', csvFile, '--db', TEMP_DB_FILE], { stdout: () => {} })).toBe(0);
      expect(await sourceDb.storage.readonly('events').getAll()).toEqual(originalEvents);
      expect(await sourceDb.storage.readonly('sessions').count()).toBe(1);
      const csv = readFileSync(csvFile, 'utf-8');
      const changed = csvToSessionRows(csv);
      changed.events[0].outputType = 'conflicting-output';
      writeFileSync(csvFile, sessionToCsv(changed.session, changed.events), 'utf-8');
      let conflict = '';
      expect(await cliMain(['import', 'session', csvFile, '--db', TEMP_DB_FILE], {
        stdout: () => {}, stderr: (text) => { conflict += text; },
      })).toBe(1);
      expect(conflict).toContain('Event identity conflicts');
      expect(await sourceDb.storage.readonly('events').getAll()).toEqual(originalEvents);
      writeFileSync(csvFile, csv, 'utf-8');
    } finally {
      await sourceDb.close();
    }
    const CLEAN_DB = join(process.cwd(), 'temp-db-test-clean.db');
    if (existsSync(CLEAN_DB)) unlinkSync(CLEAN_DB);
    try {
      let error = '';
      expect(await cliMain(['import', 'session', csvFile, '--db', CLEAN_DB], {
        stdout: () => {}, stderr: (text) => { error += text; },
      })).toBe(1);
      expect(error).toContain('revision is unavailable');
      const target = await openCliDb(CLEAN_DB);
      try {
        expect(await target.storage.readonly('notes').count()).toBe(0);
        expect(await target.storage.readonly('sessions').count()).toBe(0);
        await target.storage.readwrite('block_revisions').putMany(revisions);
      } finally {
        await target.close();
      }
      expect(await cliMain(['import', 'session', csvFile, '--db', CLEAN_DB], { stdout: () => {} })).toBe(0);

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

  it('parse materializes frontmatter tags, including typed equipment', async () => {
    const TAGGED = [
      '---',
      'title: Tagged Workout',
      'tags: [benchmark]',
      'equipment:',
      '  - pull-up bar',
      '---',
      '',
      '```time',
      '3 Rounds',
      '- 5 pull-up',
      '```',
      '',
    ].join('\n');
    writeFileSync(TEMP_SCRIPT_FILE, TAGGED, 'utf-8');
    let parseOut = '';
    const code = await cliMain(['parse', TEMP_SCRIPT_FILE, '--db', TEMP_DB_FILE], {
      stdout: (t) => { parseOut += t; },
    });
    expect(code).toBe(0);
    expect(parseOut).toContain('2 tags');

    // Typed tag filter: the note plane resolves equipment through the tag graph.
    let noteTagOut = '';
    const blockCode = await cliMain(['query', ':note{equipment:"pull-up bar"}', '--db', TEMP_DB_FILE, '--format', 'json'], {
      stdout: (t) => { noteTagOut += t; },
    });
    expect(blockCode).toBe(0);
    expect(JSON.parse(noteTagOut).data.stages.matched).toBe(1);

    // General tag surfaces on the note plane.
    let noteOut = '';
    await cliMain(['query', ':note{tags:"benchmark"}', '--db', TEMP_DB_FILE, '--format', 'json'], {
      stdout: (t) => { noteOut += t; },
    });
    expect(JSON.parse(noteOut).data.stages.matched).toBe(1);
  });

  it('import effort round-trips through download effort', async () => {
    const effortFile = join(process.cwd(), 'temp-db-test-effort.md');
    writeFileSync(effortFile, [
      '---',
      'id: 33333333-3333-4333-8333-333333333333',
      'slug: zercher-squat',
      'label: Zercher Squat',
      'aliases:',
      '  - zercher',
      'baseAttributes:',
      '  met: 8.5',
      '  discipline: weightlifting',
      '---',
      '',
      'A squat holding the bar in the crook of the elbows.',
    ].join('\n'), 'utf-8');
    const impCode = await cliMain(['import', 'effort', effortFile, '--db', TEMP_DB_FILE], { stdout: () => {} });
    expect(impCode).toBe(0);

    let out = '';
    const qCode = await cliMain(['query', ':effort{text:"Zercher"}', '--db', TEMP_DB_FILE, '--format', 'json'], {
      stdout: (t) => { out += t; },
    });
    expect(qCode).toBe(0);
    expect(JSON.parse(out).data.stages.matched).toBe(1);

    const exportFile = join(process.cwd(), 'temp-db-test-effort-export.md');
    const dlCode = await cliMain(['download', 'effort', 'zercher-squat', '--db', TEMP_DB_FILE, '-o', exportFile], {
      stdout: () => {},
    });
    expect(dlCode).toBe(0);
    const reimported = readFileSync(exportFile, 'utf-8');
    expect(reimported).toContain('slug: zercher-squat');
    expect(reimported).toContain('met: 8.5');
    if (existsSync(exportFile)) unlinkSync(exportFile);
    if (existsSync(effortFile)) unlinkSync(effortFile);
  });

  it('import equipment creates typed tags; download equipment round-trips', async () => {
    const csvFile = join(process.cwd(), 'temp-db-test-equipment.csv');
    writeFileSync(csvFile, 'label\nbarbell\nkettlebell\n', 'utf-8');
    const impCode = await cliMain(['import', 'equipment', csvFile, '--db', TEMP_DB_FILE], {
      stdout: () => {},
    });
    expect(impCode).toBe(0);

    const exportFile = join(process.cwd(), 'temp-db-test-equipment-export.csv');
    const dlCode = await cliMain(['download', 'equipment', 'unused', '--db', TEMP_DB_FILE, '-o', exportFile], {
      stdout: () => {},
    });
    expect(dlCode).toBe(0);
    expect(csvToEquipmentLabels(readFileSync(exportFile, 'utf-8'))).toEqual(['barbell', 'kettlebell']);

    // Re-import is idempotent (0 new).
    let again = '';
    await cliMain(['import', 'equipment', csvFile, '--db', TEMP_DB_FILE], {
      stdout: (t) => { again += t; },
    });
    expect(again).toContain('(0 new)');

    if (existsSync(csvFile)) unlinkSync(csvFile);
    if (existsSync(exportFile)) unlinkSync(exportFile);
  });
});
