import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { compileSeedRow, seedNoteIdSync } from '../../packages/tools/src/seedbuild/compiler';
import { WOD_DB, seedCompletedSessions, seedNote } from '../helpers/wodwikiDb';
import { gotoFeedSurface, waitForFeedReady } from '../helpers/feedReadiness';

const PEER_FEED_URL = 'https://peer.example.org/kettlebell-feed/';
const PEER_NOTE_PATH = 'markdown/notebooks/kettlebell-club/day-1.md';
const PEER_NOTE_MD = '---\ntitle: KB Day 1\ndate: 2026-11-01\n---\n\n# KB Day 1\n\n```time\n100 Kettlebell Swings\n```\n';

function buildPeerFeedArtifacts() {
  const row = compileSeedRow(PEER_NOTE_PATH, PEER_NOTE_MD, {
    noteTitle: 'KB Day 1',
    routeId: 'kettlebell-club/day-1',
    sourceId: 'notebook:kettlebell-club/day-1',
    createdAt: Date.parse('2026-11-01T12:00:00Z'),
  });
  const uuid = seedNoteIdSync(PEER_NOTE_PATH);
  row.uuid = uuid;
  row.commit = 'abc1234';
  row.version = 1;

  const recordJson = JSON.stringify(row, null, 2);
  const recordSha = createHash('sha256').update(recordJson).digest('hex');
  const recordRelPath = PEER_NOTE_PATH.replace(/\.md$/, '.json');

  const chunkJson = JSON.stringify([row]);
  const chunkSha = createHash('sha256').update(chunkJson).digest('hex');
  const chunkPath = `chunks/notebook.kettlebell-club.${chunkSha.slice(0, 8)}.json`;

  const indexPath = 'indexes/notebooks/notebook.kettlebell-club.json';
  const notebookSummary = {
    notebookId: 'notebook.kettlebell-club',
    label: 'Kettlebell Club',
    category: 'kettlebell-club',
    indexPath,
    version: 1,
    commit: 'abc1234',
    builtAt: '2026-11-10T00:00:00.000Z',
    sha256: chunkSha,
    bytes: Buffer.byteLength(chunkJson),
    count: 1,
  };
  const notebookIndex = {
    ...notebookSummary,
    records: [
      {
        uuid,
        path: PEER_NOTE_PATH,
        recordPath: recordRelPath,
        commit: 'abc1234',
        version: 1,
        sha256: recordSha,
        title: 'KB Day 1',
        date: Date.parse('2026-11-01T12:00:00Z'),
      },
    ],
  };

  const manifest = {
    name: 'Peer Kettlebell Feed',
    description: 'Distributed community kettlebell workouts',
    schema: 9,
    version: 1,
    builtAt: '2026-11-10T00:00:00.000Z',
    chunks: [
      {
        id: 'notebook.kettlebell-club',
        path: chunkPath,
        sha256: chunkSha,
        bytes: Buffer.byteLength(chunkJson),
        count: 1,
      },
    ],
    notebooks: [notebookSummary],
  };

  return { manifest, notebookIndex, row, recordRelPath, indexPath };
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 375, height: 812 },
]) {
  test(`PublicationPill transitions (Private → Published Note → Published Note + Data), Feed Repo Export, and unified /feeds & /notebooks at ${viewport.width}px`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.setViewportSize(viewport);
    await gotoFeedSurface(page, '/');

    // 1. Seed a user-owned notebook landing + a workout note + a completed session
    const noteId = '01950000-0000-7000-8000-000000000888';
    await page.evaluate(async ({ dbName }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['notes'], 'readwrite');
          tx.objectStore('notes').put({
            id: 'notebook/coach-program',
            title: 'Coach Program',
            rawContent: '---\ndescription: "Coach benchmarks"\nicon: "🏋️"\n---\n\n# Coach Program\n',
            sourceRevision: 1,
            blocks: {},
            createdAt: Date.now(),
            notebookId: 'notebook/coach-program',
            seedOrigin: 'user',
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, { dbName: WOD_DB });

    await seedNote(
      page,
      noteId,
      '# Heavy DT\n\n```time\n(5)\n  12 Deadlifts\n  9 Hang Power Cleans\n  6 Push Jerks\n```\n',
      { title: 'Heavy DT' },
    );

    // Assign note to notebook/coach-program
    await page.evaluate(async ({ dbName, noteId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['notes'], 'readwrite');
          const store = tx.objectStore('notes');
          const req = store.get(noteId);
          req.onsuccess = () => {
            if (req.result) {
              store.put({ ...req.result, notebookId: 'notebook/coach-program', seedOrigin: 'user' });
            }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, { dbName: WOD_DB, noteId });

    await seedCompletedSessions(page, noteId, [
      { id: 'sess-dt-1', createdAt: Date.now(), duration: 360_000 },
    ]);

    // 2. Open Note and verify PublicationPill transitions
    await gotoFeedSurface(page, `/note/${noteId}`);
    const pill = page.getByTestId('publication-pill');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('data-visibility', 'Private');

    await pill.click();
    const nbToggle = page.getByTestId('publication-notebook-public-toggle');
    await expect(nbToggle).toBeVisible();
    await nbToggle.check();
    await expect(pill).toHaveAttribute('data-visibility', 'Published Note');

    const sessToggle = page.getByTestId('publication-session-toggle-sess-dt-1');
    await expect(sessToggle).toBeVisible();
    await sessToggle.check();
    await expect(pill).toHaveAttribute('data-visibility', 'Published Note + Data');
    await expect(pill).toContainText('Published Note + Data (1)');

    // 3. Export wod-wiki-feed-repository.zip directly from IndexedDB via PublicationPill
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('publication-export-repo-zip-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('wod-wiki-feed-repository.zip');

    // 4. Verify /feeds (:feed{}) and /notebooks (:notebook{}) render through unified QueriableStreamView
    await gotoFeedSurface(page, '/feeds');
    const feedsStream = page.getByTestId('queriable-stream-view');
    await expect(feedsStream).toBeVisible();
    await expect(feedsStream.getByText('My Published Feed').first()).toBeVisible();

    await gotoFeedSurface(page, '/notebooks');
    const nbStream = page.getByTestId('queriable-stream-view');
    await expect(nbStream).toBeVisible();
    await expect(nbStream.getByText('Coach Program').first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
}

test('zero-import remote notebook preview & single-note clone from registered peer Feed', async ({ page }) => {
  const peer = buildPeerFeedArtifacts();
  const corsHeaders = { 'access-control-allow-origin': '*' };
  await page.route(`${PEER_FEED_URL}manifest.json`, (route) => route.fulfill({ json: peer.manifest, headers: corsHeaders }));
  await page.route(`${PEER_FEED_URL}${peer.indexPath}`, (route) => route.fulfill({ json: peer.notebookIndex, headers: corsHeaders }));
  await page.route(`${PEER_FEED_URL}${peer.recordRelPath}`, (route) => route.fulfill({ json: peer.row, headers: corsHeaders }));

  await page.goto(`/subscribe?source=${encodeURIComponent(PEER_FEED_URL)}`);
  await waitForFeedReady(page);

  const banner = page.getByTestId('unknown-feed-intake-banner');
  await expect(banner).toBeVisible();
  // Register only — do NOT import chunks!
  await banner.getByRole('button', { name: /Register only/i }).click();
  await expect(page).toHaveURL(/\/notebooks\?q=:notebook\{feed:peer-kettlebell-feed/);

  // Navigate to the unsubscribed remote notebook preview and verify zero-import listing + Clone
  await gotoFeedSurface(page, '/notebook/kettlebell-club?feed=peer-kettlebell-feed');
  await expect(page.getByTestId('remote-notebook-preview-banner')).toBeVisible();
  const stream = page.getByTestId('queriable-stream-view');
  await expect(stream.getByText('KB Day 1').first()).toBeVisible();

  const cloneBtn = stream.locator('[data-testid^="row-clone-remote-"]').first();
  await expect(cloneBtn).toBeVisible();
  await cloneBtn.click();
  await expect(page.getByText(/Cloned "KB Day 1"/i).first()).toBeVisible();
});
