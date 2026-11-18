/**
 * WW-086 — Subscribe on /feeds shows no pending/disabled state during the ~6-8s feed sync — identical enabled button invites double-submits (low)
 *
 * Regression test for the open QA defect WW-086 (subscribe-no-pending-state).
 * Expected behavior: while a Subscribe-triggered feed sync is in flight, the
 * Subscribe control shows a visible pending state (busy label/spinner) and is
 * disabled, so the user can see work is happening and cannot submit twice.
 * Current defect: the Subscribe button (SyncSection.tsx:130) keeps its plain
 * "Subscribe" label with no spinner for the whole sync; unlike the Sync
 * button, nothing on the control itself signals the in-flight state.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-17-nightly-052156).
 */
import { createHash } from 'node:crypto';
import { test, expect } from '../fixtures/playgroundActor';
import { compileSeedRow, seedNoteIdSync } from '../../packages/tools/src/seedbuild/compiler';

const MANAGE_URL = 'https://manage.example.org/library/';
const MANAGE_REPO = 'https://github.com/example/manage-library';
const MANAGE_SOURCE = {
  id: 'manage-library',
  label: 'Manage Library',
  url: MANAGE_URL,
  repositoryUrl: MANAGE_REPO,
};

const NOTE_PATH = 'markdown/notebooks/demo-catalog/session-1.md';
const NOTE_BODY = '---\ntags: [demo]\n---\n# Demo Session\n\n```time\n10 Push-ups\n```\n';
// Hold the chunk download open so the subscribe sync stays in flight long
// enough to observe the button's state mid-sync (the live sync takes ~6-8s).
const CHUNK_DELAY_MS = 8_000;

function buildSlowChunk() {
  const rows = [compileSeedRow(NOTE_PATH, NOTE_BODY)];
  const json = JSON.stringify(rows);
  const chunkPath = 'chunks/notebook.demo.json';
  return {
    chunkPath,
    rows,
    noteUuid: seedNoteIdSync(NOTE_PATH),
    entry: {
      id: 'notebook.demo',
      path: chunkPath,
      sha256: createHash('sha256').update(json).digest('hex'),
      bytes: new TextEncoder().encode(json).length,
      count: rows.length,
    },
  };
}

test.describe('WW-086 — Subscribe pending state during feed sync', () => {
  test('WW-086: the Subscribe button is disabled and shows a busy label while its sync is in flight', async ({
    app,
  }) => {
    test.setTimeout(90_000);
    const { page } = app;
    const chunk = buildSlowChunk();

    await page.addInitScript((src) => {
      localStorage.setItem('wodwiki.seedSources', JSON.stringify([src]));
    }, MANAGE_SOURCE);

    await page.context().route(`${MANAGE_URL}manifest.json`, (route) =>
      route.fulfill({
        json: {
          schema: 9,
          version: 42,
          builtAt: '2026-10-15T00:00:00.000Z',
          name: MANAGE_SOURCE.label,
          description: 'Seeded e2e catalog',
          repositoryUrl: MANAGE_REPO,
          chunks: [chunk.entry],
        },
      }),
    );
    await page.context().route(`${MANAGE_URL}${chunk.chunkPath}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
      await route.fulfill({ json: chunk.rows });
    });

    await app.goto('/settings/sync');
    await page.getByRole('checkbox', { name: 'Subscribed only' }).setChecked(false);
    const row = page.getByTestId('feed-source-manage-library');
    const subscribeBtn = row.getByTestId('feed-subscribe-manage-library');
    await expect(subscribeBtn).toBeEnabled({ timeout: 15_000 });

    await subscribeBtn.click();

    // Mid-sync (the chunk download is still being held open): the control
    // must be impossible to submit again…
    await expect(subscribeBtn).toBeDisabled({ timeout: 5_000 });
    // …and must visibly say it is working, the way the Sync button does.
    await expect(subscribeBtn).toContainText(/subscribing|syncing|importing/i, { timeout: 5_000 });

    // The sync does complete once the chunk lands.
    await expect(row.getByTestId('feed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
  });
});
