import assert from 'node:assert/strict';
import { createClient, type InStatement, type ResultSet } from '@libsql/client';
import { SqlStorage, libsqlDatabase, type LibsqlClient } from '../../../../../packages/storage/src/sql';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { feedFixture } from './feedFixture';
import { IndexedDBFeedImportStorage } from './FeedImportStorage';
import { FeedImporter, seedNoteId } from './FeedImporter';

interface Counters {
  executeCalls: number; batchCalls: number; batchStatements: number;
  begins: number; commits: number; rollbacks: number;
  selects: number; returnedRows: number; affectedRows: number; notePointReads: number;
}
const blank = (): Counters => ({ executeCalls: 0, batchCalls: 0, batchStatements: 0, begins: 0, commits: 0, rollbacks: 0, selects: 0, returnedRows: 0, affectedRows: 0, notePointReads: 0 });
let counters = blank();
let armed = false;
function record(statement: InStatement, result: ResultSet) {
  if (!armed) return;
  const sql = typeof statement === 'string' ? statement : statement.sql;
  if (/^\s*SELECT\b/i.test(sql)) {
    counters.selects++;
    counters.returnedRows += result.rows.length;
    if (/FROM\s+"notes"\s+WHERE\s+"k0"\s*=\s*\?\s*$/i.test(sql)) counters.notePointReads++;
  }
  counters.affectedRows += result.rowsAffected;
}

const raw = createClient({ url: 'file::memory:' });
const measured: LibsqlClient = {
  execute: async (statement: InStatement) => {
    if (armed) counters.executeCalls++;
    const result = await raw.execute(statement);
    record(statement, result);
    return result;
  },
  transaction: async (mode) => {
    if (armed) counters.begins++;
    const tx = await raw.transaction(mode);
    const execute = tx.execute.bind(tx), batch = tx.batch.bind(tx), commit = tx.commit.bind(tx), rollback = tx.rollback.bind(tx);
    tx.execute = async (statement: InStatement) => {
      if (armed) counters.executeCalls++;
      const result = await execute(statement);
      record(statement, result);
      return result;
    };
    tx.batch = async (statements) => {
      if (armed) { counters.batchCalls++; counters.batchStatements += statements.length; }
      const results = await batch(statements);
      for (const [i, result] of results.entries()) record(statements[i], result);
      return results;
    };
    tx.commit = async () => { if (armed) counters.commits++; await commit(); };
    tx.rollback = async () => { if (armed) counters.rollbacks++; await rollback(); };
    return tx;
  },
  close: () => raw.close(),
};
const storage = new SqlStorage(libsqlDatabase(measured));
await storage.ready();
const importerStorage = new IndexedDBFeedImportStorage(storage);
const rows = Array.from({ length: 100 }, (_, i) => compileSeedRow(`markdown/collections/measurement/n${i}.md`, `---\ntags: [strength]\n---\n# Note ${i}\n\n\`\`\`time\n10 Push-ups\n\`\`\`\n`));
const measurements: Array<{ scenario: string; counters: Counters }> = [];
async function measure(scenario: string, input: typeof rows, version: number) {
  counters = blank(); armed = true;
  await new FeedImporter(importerStorage, feedFixture(input, version, 'collection.measurement'), 'measurement').applyAll();
  armed = false;
  measurements.push({ scenario, counters: { ...counters } });
}
try {
  await measure('Initial import', rows, 1);
  assert.equal(await storage.readonly('notes').count(), 100);
  assert.equal(await storage.readonly('block_revisions').count(), 100);
  const links = await storage.readonly('note_tags').getAll();
  await measure('Unchanged manifest', rows, 1);
  assert.equal(measurements[1].counters.affectedRows, 0);
  const changed = rows.map((row, i) => i === 0 ? compileSeedRow(row.path, row.content.replace('10 Push-ups', '12 Push-ups')) : row);
  await measure('One row changed in 100-row chunk plus manifest metadata', changed, 2);
  assert.equal(await storage.readonly('block_revisions').count(), 101);
  assert.deepEqual(await storage.readonly('note_tags').getAll(), links);
  const id = await seedNoteId(rows[0].path);
  const note = await storage.readonly('notes').get(id);
  assert.equal(note?.sourceRevision, 2);
  assert.equal(Object.values(note!.blocks)[0].version, 2);
  await measure('Repeated changed manifest converges', changed, 2);
  assert.equal(measurements[3].counters.affectedRows, 0);
  console.log(JSON.stringify({ method: 'Actual FeedImporter + IndexedDBFeedImportStorage + SqlStorage + instrumented local libsql client. Execute and native transaction.batch calls counted separately. BEGIN/COMMIT/ROLLBACK reported separately. Data statements, SELECTs, returned rows and affected rows counted, not HTTP requests, latency or billing. Initialization and assertions excluded.', fixture: { notes: 100, tag: 'strength', actionablePerNote: 1 }, measurements: measurements.map(({ scenario, counters }) => ({ scenario, ...counters, driverCallsIncludingControl: counters.executeCalls + counters.batchCalls + counters.begins + counters.commits + counters.rollbacks })) }, null, 2));
} finally {
  await storage.close();
}
