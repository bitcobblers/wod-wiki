/**
 * WW-057 — :session{text:fran} reports '0 applied, 1 ignored' yet empties the result list to 0 of 0 — ignore advisory contradicts actual filtering (medium)
 *
 * Regression test for the open QA defect WW-057 (session-text-ignored-empties-results).
 * Expected behavior: 'text:' is not a supported session-plane key, so the
 * advisory ('the filter is not applied') must be true — the session list keeps
 * every session, exactly as if the clause were absent.
 * Current defect: the unsupported key lands in normalizedFactFilters and
 * matchesFilters narrows the session result to zero, while the advisory and
 * the '0 applied, 1 ignored' strip claim the filter was not applied.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-16-smoke-023730).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

const NOTE_ID = '01950000-0000-7000-8000-000000000570';
const NOTE_CONTENT =
  '# WW-057 Session Probe\n\n```time\n5:00 AMRAP\n  5 Kettlebell Swings\n  5 Burpees\n```\n';

test.describe('WW-057 — ignored session-plane filter must not narrow results', () => {
  test('WW-057: :session{text:fran} keeps all sessions while reporting the clause as ignored', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    // Seed a two-session world directly: the live corpus has sessions=0
    // (WW-056), which is why this defect was not cleanly retestable there.
    await app.seed.world({
      propertyNotes: [
        { kind: 'effort', slug: 'kettlebell-swing', label: 'Kettlebell Swing' },
        { kind: 'effort', slug: 'burpee', label: 'Burpee' },
      ],
      notes: [{ id: NOTE_ID, title: 'WW-057 Session Probe', rawContent: NOTE_CONTENT }],
      sessions: [
        {
          id: 'sess-ww-057-a',
          noteId: NOTE_ID,
          startedAt: Date.parse('2026-11-16T12:00:00Z'),
          completedAt: Date.parse('2026-11-16T12:05:00Z'),
          durationMs: 300_000,
          events: [
            {
              grain: 'event',
              outputType: 'segment',
              effortSlug: 'kettlebell-swing',
              metrics: [
                { type: 'effort', value: 'kettlebell-swing', origin: 'parser' },
                { type: 'tis', value: 300, unit: 's' },
              ],
            },
          ],
        },
        {
          id: 'sess-ww-057-b',
          noteId: NOTE_ID,
          startedAt: Date.parse('2026-11-17T12:00:00Z'),
          completedAt: Date.parse('2026-11-17T12:05:00Z'),
          durationMs: 300_000,
          events: [
            {
              grain: 'event',
              outputType: 'segment',
              effortSlug: 'burpee',
              metrics: [
                { type: 'effort', value: 'burpee', origin: 'parser' },
                { type: 'tis', value: 300, unit: 's' },
              ],
            },
          ],
        },
      ],
    });

    await app.wql.queryStream('/sessions', ':session{text:fran}');

    const status = page.getByTestId('stream-query-status');
    await expect(status).toBeVisible({ timeout: 15_000 });

    // The advisory half of the contract: the clause is reported as ignored.
    await expect(page.getByTestId('stream-query-filters')).toHaveText('0 applied, 1 ignored', {
      timeout: 15_000,
    });
    await expect(status).toContainText("ignores 'text:'");
    await expect(status).toContainText('the filter is not applied');

    // The behavioral half: "not applied" must mean the full list survives.
    // While the defect is open the counts read '0 of 2' (the list is emptied).
    await expect(page.getByTestId('stream-query-counts')).toHaveText('2 of 2', {
      timeout: 15_000,
    });
    await expect(page.getByTestId(TEST_IDS.STREAM_VIEW)).not.toContainText('No sessions found');
  });
});
