// spec: e2e/specs/feeds/portable-codecs-and-backup-restore.md
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { serializeNoteBundleToJsonl } from '../../packages/core/src/portability/note-jsonl';
import { buildDomainWorld, resetTestingVocabulary } from '../../packages/core/src/testing';
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';
import { WOD_DB, clearResults, deleteNoteByRouteId, getResults } from '../helpers/wodwikiDb';

const ZIP_NOTE_ID = '01950000-0000-7000-8000-000000000941';
const ZIP_NOTE_TITLE = 'FED04 Vault Kettlebell Benchmark';
const ZIP_SESSION_ID = 'sess-fed04-vault-1';
const ZIP_NOTE_CONTENT = [
  `# ${ZIP_NOTE_TITLE}`,
  '',
  '```time',
  '(3)',
  '  15 Kettlebell Swings 24kg',
  '```',
  '',
].join('\n');

const JSONL_NOTE_ID = '01950000-0000-7000-8000-000000000942';
const JSONL_NOTE_TITLE = 'FED04 Standalone Jsonl Relay';
const JSONL_SESSION_ID = 'sess-fed04-jsonl-2';
const JSONL_NOTE_CONTENT = [
  `# ${JSONL_NOTE_TITLE}`,
  '',
  '```time',
  '5:00 AMRAP',
  '  10 Burpees',
  '```',
  '',
].join('\n');

async function purgeNoteHistoryAndEvents(page: Page, noteId: string): Promise<void> {
  await deleteNoteByRouteId(page, noteId);
  await clearResults(page, noteId);
  await page.evaluate(
    async ({ dbName, targetNoteId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['block_revisions', 'events'], 'readwrite');
          const revStore = tx.objectStore('block_revisions');
          const revReq = revStore.openCursor();
          revReq.onsuccess = () => {
            const cursor = revReq.result;
            if (cursor) {
              const val = cursor.value as { noteId?: string };
              if (val.noteId === targetNoteId) cursor.delete();
              cursor.continue();
            }
          };

          const evStore = tx.objectStore('events');
          const evReq = evStore.openCursor();
          evReq.onsuccess = () => {
            const cursor = evReq.result;
            if (cursor) {
              const val = cursor.value as { noteId?: string };
              if (val.noteId === targetNoteId) cursor.delete();
              cursor.continue();
            }
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { dbName: WOD_DB, targetNoteId: noteId },
  );
}

function buildStandaloneJsonlBundle(): string {
  resetTestingVocabulary();
  const world = buildDomainWorld({
    propertyNotes: [{ kind: 'effort', slug: 'burpee', label: 'Burpee' }],
    notes: [
      {
        id: JSONL_NOTE_ID,
        title: JSONL_NOTE_TITLE,
        rawContent: JSONL_NOTE_CONTENT,
        seedOrigin: 'user',
      },
    ],
    sessions: [
      {
        id: JSONL_SESSION_ID,
        noteId: JSONL_NOTE_ID,
        events: [
          {
            grain: 'event',
            outputType: 'segment',
            effortSlug: 'burpee',
            metrics: [
              { type: 'effort', value: 'burpee', origin: 'parser' },
              { type: 'tis', value: 45, unit: 's', ...{ metadata: { canonicalKey: 'tis' } } },
            ],
          },
        ],
      },
    ],
  });

  const note = world.notes.find((n) => n.id === JSONL_NOTE_ID)!;
  const session = world.sessions[0]!;
  const events = world.events.map((ev) => ({
    ...ev,
    ...(session.blockContentId ? { blockContentId: session.blockContentId } : {}),
  }));

  return (
    serializeNoteBundleToJsonl({
      note: {
        id: note.id,
        title: note.title,
        createdAt: note.createdAt,
        updatedAt: note.createdAt,
        targetDate: note.date ?? note.createdAt,
        rawContent: note.rawContent,
        sourceRevision: note.sourceRevision,
        blocks: note.blocks,
        type: note.type,
      },
      revisions: world.revisions,
      sessions: [session],
      events,
    }) + '\n'
  );
}

test.describe('FED-04 — Portable Codecs & Backup Restore', () => {
  test('Scenario 1: Valid .zip round-trip export/upload and standalone .jsonl upload on /load restore Notes and Sessions', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    const zipBlockContentId =
      buildDomainWorld({
        notes: [{ id: ZIP_NOTE_ID, title: ZIP_NOTE_TITLE, rawContent: ZIP_NOTE_CONTENT }],
      }).blockIndex.find((row) => row.dataType === 'wod')?.blockContentId ?? '';

    await app.seed.world({
      propertyNotes: [
        { kind: 'effort', slug: 'kettlebell-swing', label: 'Kettlebell Swing' },
        { kind: 'effort', slug: 'burpee', label: 'Burpee' },
      ],
      notes: [
        {
          id: ZIP_NOTE_ID,
          title: ZIP_NOTE_TITLE,
          rawContent: ZIP_NOTE_CONTENT,
          seedOrigin: 'user',
        },
      ],
      sessions: [
        {
          id: ZIP_SESSION_ID,
          noteId: ZIP_NOTE_ID,
          events: [
            {
              blockContentId: zipBlockContentId,
              grain: 'event',
              outputType: 'segment',
              effortSlug: 'kettlebell-swing',
              metrics: [
                { type: 'effort', value: 'kettlebell-swing', origin: 'parser' },
                { type: 'tis', value: 68, unit: 's', ...{ metadata: { canonicalKey: 'tis' } } },
              ],
            },
          ],
        },
      ],
    });

    try {
      // 1. Export portable .zip (.md + .jsonl) via /settings/storage and isolate our Note pair
      await app.goto('/settings/storage');
      const exportBtn = page.getByTestId('data-export-notes-jsonl');
      await expect(exportBtn).toBeVisible();

      const downloadPromise = page.waitForEvent('download');
      await exportBtn.click();
      const download = await downloadPromise;
      const downloadPath = await download.path();
      if (!downloadPath) {
        throw new Error('Expected Playwright download path for portable .zip export');
      }

      const fullZip = await JSZip.loadAsync(readFileSync(downloadPath));
      const mdEntry = fullZip.file(`${ZIP_NOTE_ID}.md`);
      const jsonlEntry = fullZip.file(`${ZIP_NOTE_ID}.jsonl`);
      expect(mdEntry, 'exported .zip contains Note .md').toBeTruthy();
      expect(jsonlEntry, 'exported .zip contains Session telemetry .jsonl').toBeTruthy();

      const focusedZip = new JSZip();
      focusedZip.file(`${ZIP_NOTE_ID}.md`, await mdEntry!.async('uint8array'));
      focusedZip.file(`${ZIP_NOTE_ID}.jsonl`, await jsonlEntry!.async('uint8array'));
      const portableZipBuffer = await focusedZip.generateAsync({ type: 'nodebuffer' });

      // Purge Note, BlockRevisions, Sessions, and EventRecords so /load restores from zero
      await purgeNoteHistoryAndEvents(page, ZIP_NOTE_ID);
      expect(await app.editor.readStoredContent(ZIP_NOTE_ID)).toBeNull();
      expect(await getResults(page, ZIP_NOTE_ID)).toHaveLength(0);

      // Upload the portable .zip on /load
      await app.goto('/load');
      await expect(page.getByTestId(TEST_IDS.LOAD_ZIP_INTAKE)).toBeVisible();
      await page.getByTestId(TEST_IDS.BUNDLE_FILE_INPUT).setInputFiles({
        name: 'fed04-vault-backup.zip',
        mimeType: 'application/zip',
        buffer: portableZipBuffer,
      });

      await expect(page).toHaveURL(/\/(?:\?.*)?$/);
      await app.feeds.waitForReady();

      // Verify IndexedDB + UI restoration for the .zip Note and Session across reload
      await app.journal.expectNotePersisted(ZIP_NOTE_ID, ZIP_NOTE_TITLE);
      const restoredZipSessions = await getResults(page, ZIP_NOTE_ID);
      expect(restoredZipSessions).toHaveLength(1);

      await app.editor.openNote(ZIP_NOTE_ID);
      await expect(page.getByRole('textbox', { name: 'Note editor' })).toContainText(
        ZIP_NOTE_TITLE,
      );

      await app.goto(`/results/${ZIP_SESSION_ID}`);
      const zipResultsTable = page.getByTestId(TEST_IDS.PROPERTY_TABLE);
      await expect(zipResultsTable).toBeVisible();
      await expect(zipResultsTable.locator('tbody')).toContainText(/kettlebell[\s-]swing/i);

      await page.reload();
      await app.feeds.waitForReady();
      await expect(page.getByTestId(TEST_IDS.PROPERTY_TABLE).locator('tbody')).toContainText(
        /kettlebell[\s-]swing/i,
      );

      // 2. Upload standalone .jsonl bundle on /load and verify Note + Session restore
      const jsonlPayload = buildStandaloneJsonlBundle();
      await app.goto('/load');
      await expect(page.getByTestId(TEST_IDS.LOAD_ZIP_INTAKE)).toBeVisible();
      await page.getByTestId(TEST_IDS.BUNDLE_FILE_INPUT).setInputFiles({
        name: 'fed04-standalone-relay.jsonl',
        mimeType: 'application/x-ndjson',
        buffer: Buffer.from(jsonlPayload, 'utf8'),
      });

      await expect(page).toHaveURL(/\/(?:\?.*)?$/);
      await app.feeds.waitForReady();

      await app.journal.expectNotePersisted(JSONL_NOTE_ID, JSONL_NOTE_TITLE);
      const restoredJsonlSessions = await getResults(page, JSONL_NOTE_ID);
      expect(restoredJsonlSessions).toHaveLength(1);

      await app.editor.openNote(JSONL_NOTE_ID);
      await expect(page.getByRole('textbox', { name: 'Note editor' })).toContainText(
        JSONL_NOTE_TITLE,
      );

      await app.goto(`/results/${JSONL_SESSION_ID}`);
      const jsonlResultsTable = page.getByTestId(TEST_IDS.PROPERTY_TABLE);
      await expect(jsonlResultsTable).toBeVisible();
      await expect(jsonlResultsTable.locator('tbody')).toContainText(/burpee/i);

      app.assertCleanConsole();
    } finally {
      await purgeNoteHistoryAndEvents(page, ZIP_NOTE_ID);
      await purgeNoteHistoryAndEvents(page, JSONL_NOTE_ID);
    }
  });

  test('Scenario 2: Corrupt .zip upload on /load surfaces TEST_IDS.BUNDLE_IMPORT_ERROR with zero pageerrors on desktop and 375x812', async ({
    app,
  }) => {
    const { page } = app;
    const corruptArchive = {
      name: 'corrupt-archive.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('not-a-valid-zip-archive', 'utf8'),
    };

    // 1. Desktop 1280x900 corrupt archive gate
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.goto('/load');
    await expect(page.getByTestId(TEST_IDS.LOAD_ZIP_INTAKE)).toBeVisible();

    await page.getByTestId(TEST_IDS.BUNDLE_FILE_INPUT).setInputFiles(corruptArchive);

    const errorAlert = page.getByTestId(TEST_IDS.BUNDLE_IMPORT_ERROR);
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toHaveAttribute('role', 'alert');
    await expect(errorAlert).toContainText(/zip|end of central directory|corrupt|valid/i);
    await expect(page).toHaveURL(/\/load$/);
    await expect(page.getByTestId(TEST_IDS.LOAD_ZIP_INTAKE)).toBeVisible();

    // 2. Mobile 375x812 corrupt archive + overflow gate
    await page.setViewportSize({ width: 375, height: 812 });
    await app.goto('/load');
    await expect(page.getByTestId(TEST_IDS.LOAD_ZIP_INTAKE)).toBeVisible();

    await page.getByTestId(TEST_IDS.BUNDLE_FILE_INPUT).setInputFiles(corruptArchive);
    await expect(page.getByTestId(TEST_IDS.BUNDLE_IMPORT_ERROR)).toBeVisible();
    await expect(page).toHaveURL(/\/load$/);

    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(mobileOverflow, 'no horizontal overflow on /load error state at 375x812').toBe(false);

    app.assertCleanConsole();
  });
});
