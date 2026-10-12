#!/usr/bin/env bun
// Run: bun apps/playground/src/services/storage/tursoMigration.check.ts
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { createClient } from '@libsql/client';
import { STORE_DEFS } from '@bitcobblers/wod-wiki-storage';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { InMemoryStorage } from './InMemoryStorage';
import { migrateToSql } from './tursoMigration';

globalThis.localStorage = new Window().localStorage;
localStorage.setItem('wodwiki.membership', JSON.stringify({ id: 'default', displayName: 'Serge', createdAt: 5 }));
const dir = await mkdtemp(join(tmpdir(), 'wodwiki-migrate-'));
const source = new InMemoryStorage();
const dest = new SqlStorage(libsqlDatabase(createClient({ url: 'file:' + join(dir, 'check.db') })));
try {
  const rawContent = '```time\n10 Pushups\n```';
  const note = { id: 'n', title: 'My run', createdAt: 100, userId: 'owner', rawContent,
    sourceRevision: 2, blocks: { s: { id: 's', kind: 'wod' as const, dialect: 'time' as const,
      version: 2, sourceRevision: 2, from: 0, to: rawContent.length } } };
  for (const version of [1, 2]) {
    await source.readwrite('block_revisions').put({ noteId: 'n', blockId: 's', version,
      kind: 'wod', dialect: 'time', rawContent: version === 2 ? rawContent : '```time\n5 Pushups\n```', savedAt: version });
  }
  await source.readwrite('notes').put(note);
  const bytes = new Uint8Array([0, 1, 250, 255]);
  await source.readwrite('attachments').put({ id: 'a', noteId: 'n', mimeType: 'application/octet-stream', label: 'GPS', data: bytes.buffer, createdAt: 1, timeSpan: { start: 1, end: 2 } });
  await source.readwrite('meta').put({ key: 'seed:core', value: { schema: 7, version: 41 } });
  await source.readwrite('meta').put({ key: 'wodwiki:notebooks', value: 'stale' });
  const prefs = [{ key: 'wodwiki:notebooks', value: '[{"id":"notebook"}]' }, { key: 'user-calc:mine', value: '{"id":"mine"}' }];

  await dest.readwrite('meta').put({ key: 'precious', value: 'keep' });
  await assert.rejects(migrateToSql(source, dest, prefs), /already holds/);
  assert.deepEqual(await dest.readonly('meta').getAll(), [{ key: 'precious', value: 'keep' }]);
  assert.equal(await dest.readonly('notes').count(), 0);
  await dest.readwrite('meta').clear();
  await migrateToSql(source, dest, prefs);
  for (const { name } of STORE_DEFS) {
    if (name !== 'meta' && name !== 'memberships') {
      assert.deepEqual(await dest.readonly(name).getAll(), await source.readonly(name).getAll(), name);
    }
  }
  assert.deepEqual(await dest.readonly('meta').get('seed:core'), { key: 'seed:core', value: { schema: 7, version: 41 } });
  assert.deepEqual(await dest.readonly('meta').get('wodwiki:notebooks'), prefs[0]);
  assert.deepEqual(await source.readonly('meta').get('wodwiki:notebooks'), { key: 'wodwiki:notebooks', value: 'stale' });
  assert.equal((await dest.readonly('memberships').get('default'))?.displayName, 'Serge');
  const query = await dest.queryDomain({ plan: 'notes', selection: [{ field: 'text', value: 'my run' }] });
  assert.ok(query?.plan === 'notes');
  assert.deepEqual(query.rows.map(row => row.id), ['n']);
  await assert.rejects(migrateToSql(source, dest, prefs), /already holds/);
  assert.deepEqual(new Uint8Array((await dest.readonly('attachments').get('a'))!.data as ArrayBuffer), bytes);
  console.log('turso-migration-check: OK');
} finally {
  await dest.close();
  await rm(dir, { recursive: true, force: true });
}
