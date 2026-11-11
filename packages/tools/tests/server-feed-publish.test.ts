import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openCliDb } from '../src/cli/db';
import { createHandler } from '../src/server/app';
import { reconcileNoteBlocks, setNotebookPublic, setSessionPublic } from '@bitcobblers/wod-wiki-engine';

describe('wod server live Feed publishing & /feed/* serving', () => {
  it('publishes public notebooks & opted-in sessions to /feed/*, tracks dirty status, and preserves SPA routes', async () => {
    const tmpRoot = join(process.cwd(), 'temp-server-feed-test');
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(join(tmpRoot, 'dist'), { recursive: true });
    writeFileSync(join(tmpRoot, 'dist', 'index.html'), '<!doctype html><title>SPA</title>', 'utf8');

    const dbPath = join(tmpRoot, 'server.db');
    const feedDir = join(tmpRoot, 'published-feed');
    const cliDb = await openCliDb(dbPath, { initialize: true });

    try {
      const handler = createHandler(cliDb.db, {
        playgroundDist: join(tmpRoot, 'dist'),
        feedDir,
      });

      // 1. Initial status: no public content
      const status0Res = await handler(new Request('http://localhost:3000/api/v1/feed/status'));
      expect(status0Res.status).toBe(200);
      const status0 = await status0Res.json() as { hasPublicContent: boolean; dirty: boolean };
      expect(status0.hasPublicContent).toBe(false);
      expect(status0.dirty).toBe(false);

      // 2. Create a public notebook + note + 1 public session & 1 private session
      await setNotebookPublic(cliDb.storage, 'notebook/kettlebell', true);
      const raw = '# Simple & Sinister\n\n```time\n100 Kettlebell Swings\n10 Turkish Get-ups\n```\n';
      const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 });
      const b = Object.values(blocks)[0]!;
      const noteId = '01950000-0000-7000-8000-000000000123';

      await cliDb.storage.transaction(['notes', 'block_revisions', 'sessions'], 'readwrite', async (tx) => {
        await tx.readwrite('notes').put({
          id: noteId,
          title: 'Simple & Sinister',
          rawContent: raw,
          sourceRevision: 1,
          blocks,
          date: Date.parse('2026-11-10T12:00:00Z'),
          createdAt: 1000,
          notebookId: 'notebook/kettlebell',
          seedOrigin: 'user',
        });
        await tx.readwrite('block_revisions').put({
          noteId,
          blockId: b.id,
          version: 1,
          kind: 'wod',
          rawContent: raw.slice(b.from, b.to),
          savedAt: 1000,
          dialect: 'time',
        });
        await tx.readwrite('sessions').putMany([
          {
            id: 'sess-shared',
            noteId,
            blockId: b.id,
            blockVersion: 1,
            blockContentId: 'cid-ss',
            status: 'completed',
            startTime: 2000,
            endTime: 3000,
            duration: 1000,
            completed: true,
            createdAt: 3000,
          },
          {
            id: 'sess-hidden',
            noteId,
            blockId: b.id,
            blockVersion: 1,
            blockContentId: 'cid-ss',
            status: 'completed',
            startTime: 4000,
            endTime: 5000,
            duration: 1000,
            completed: true,
            createdAt: 5000,
          },
        ]);
      });
      await setSessionPublic(cliDb.storage, 'sess-shared', true);

      // 3. Status shows unpublished changes before snapshot publish
      const statusDirtyRes = await handler(new Request('http://localhost:3000/api/v1/feed/status'));
      const statusDirty = await statusDirtyRes.json() as { dirty: boolean; publicNotebooks: number; publicSessions: number };
      expect(statusDirty.dirty).toBe(true);
      expect(statusDirty.publicNotebooks).toBe(1);
      expect(statusDirty.publicSessions).toBe(1);

      // 4. POST /api/v1/feed/publish compiles snapshot
      const pubRes = await handler(
        new Request('http://localhost:3000/api/v1/feed/publish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Coach KB Feed' }),
        }),
      );
      expect(pubRes.status).toBe(200);
      const pubBody = await pubRes.json() as { totalNotes: number; totalPublicSessions: number; feedUrl: string };
      expect(pubBody.totalNotes).toBe(1);
      expect(pubBody.totalPublicSessions).toBe(1);
      expect(pubBody.feedUrl).toBe('http://localhost:3000/feed/');

      // 5. GET /feed/manifest.json serves CORS-enabled valid SeedManifest
      const manifestRes = await handler(new Request('http://localhost:3000/feed/manifest.json'));
      expect(manifestRes.status).toBe(200);
      expect(manifestRes.headers.get('access-control-allow-origin')).toBe('*');
      const manifest = await manifestRes.json() as { name: string; version: number; notebooks: Array<{ notebookId: string }> };
      expect(manifest.name).toBe('Coach KB Feed');
      expect(manifest.version).toBe(1);
      expect(manifest.notebooks[0]?.notebookId).toBe('notebook.kettlebell');

      // 6. GET /feed/ serves landing HTML with QR script
      const landingRes = await handler(new Request('http://localhost:3000/feed/'));
      expect(landingRes.status).toBe(200);
      const landingHtml = await landingRes.text();
      expect(landingHtml).toContain('Coach KB Feed');
      expect(landingHtml).toContain('Subscribe to Whole Feed');

      // 7. SPA route /feed/sport-crossfit still falls through to SPA shell without collision!
      const spaRes = await handler(new Request('http://localhost:3000/feed/sport-crossfit'));
      expect(spaRes.status).toBe(200);
      expect(await spaRes.text()).toContain('<title>SPA</title>');

      // 8. Status is now clean (dirty === false)
      const statusCleanRes = await handler(new Request('http://localhost:3000/api/v1/feed/status'));
      const statusClean = await statusCleanRes.json() as { dirty: boolean; publishedVersion: number };
      expect(statusClean.dirty).toBe(false);
      expect(statusClean.publishedVersion).toBe(1);
    } finally {
      await cliDb.close();
      if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
