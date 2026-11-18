/**
 * WW-051 — Recorded session timing wrong across lifecycle paths — card durations inconsistent with the IDB record; splits never persisted (+00:00/Start rows only) (high)
 *
 * Regression test for the open QA defect WW-051 (session-starttime-lifecycle-wrong).
 * Expected behavior: segment (split) events persist with real time spans — each split has a
 * start/end offset, ends after it starts, and starts later than the previous split — and the
 * duration shown on the /sessions card agrees with the authoritative session duration stored
 * by finishSession in IndexedDB.
 * Current defect: card durations derive from event timeSpan spans (extractRunMetrics) while
 * segment events persist with empty/zero spans, so splits never carry real offsets and card
 * durations disagree with the IDB record on both stop paths (partial card 00:11 vs IDB
 * 123490ms; full-stop card 03:11 vs IDB 177409ms — 13.6s inflation).
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { WOD_DB } from '../helpers/wodwikiDb';
import { startWorkoutFromPlayground } from '../pages/WallClockPage';
import { clearSessions, getSessions } from '../utils/sessionsDb';

interface SegmentSpan {
  started: number;
  ended: number;
}

function toMs(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return Date.parse(String(value));
}

/** Non-structural segment events for one result, with their persisted time spans. */
async function getSegmentSpans(
  page: import('@playwright/test').Page,
  resultId: string,
): Promise<Array<{ sourceBlockKey: string; span: SegmentSpan | null }>> {
  return page.evaluate(
    async ({ dbName, rid }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        if (!db.objectStoreNames.contains('events')) return [];
        const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
          const tx = db.transaction('events', 'readonly');
          const req = tx.objectStore('events').getAll();
          req.onsuccess = () => resolve(req.result as Array<Record<string, unknown>>);
          tx.onerror = () => reject(tx.error);
        });
        return rows
          .filter((r) => r.resultId === rid && r.outputType === 'segment')
          .map((r) => {
            const key = String(r.sourceBlockKey ?? '');
            const ts = r.timeSpan as { started?: unknown; ended?: unknown } | undefined;
            return {
              sourceBlockKey: key,
              span:
                ts && ts.started !== undefined && ts.ended !== undefined
                  ? { started: ts.started as number, ended: ts.ended as number }
                  : null,
              structural:
                key.toLowerCase().startsWith('waiting-to-start') ||
                key.toLowerCase().startsWith('session-root'),
            };
          })
          .filter((r) => !r.structural)
          .map(({ sourceBlockKey, span }) => ({ sourceBlockKey, span }));
      } finally {
        db.close();
      }
    },
    { dbName: WOD_DB, rid: resultId },
  );
}

/** Every mm:ss / h:mm:ss token rendered inside the stream view, as seconds. */
function durationTokens(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    out.push(m[3] !== undefined ? a * 3600 + b * 60 + Number(m[3]) : a * 60 + b);
  }
  return out;
}

test.describe('WW-051 — session timing across lifecycle paths', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ app }) => {
    app.page.on('dialog', (d) => {
      void d.accept();
    });
  });

  test('WW-051: splits persist with real, increasing time spans', async ({ app }) => {
    const { page } = app;
    await app.runtime.useFastClock(20);
    await app.goto('/');
    await clearSessions(page);

    await startWorkoutFromPlayground(page, 'ww051-splits', '```time\n(2)\n  5 Burpees\n  10 Squats\n```');
    await app.runtime.advance(2);
    await app.runtime.stopSession();

    await expect
      .poll(async () => (await getSessions(page)).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const session = (await getSessions(page))[0]!;
    expect(session.id).toBeTruthy();

    const segments = await getSegmentSpans(page, session.id!);
    // The run advanced through at least two movements, so at least two real
    // splits must exist — not just 'Start' rows.
    expect(segments.length).toBeGreaterThanOrEqual(2);
    const spans = segments.map((s) => s.span);
    for (const span of spans) {
      // Defect: spans persist empty/zero, so this is null or a zero-length span.
      expect(span, 'every split persists a real time span').not.toBeNull();
      expect(toMs(span!.ended)).toBeGreaterThan(toMs(span!.started));
    }
    const starts = spans.map((s) => toMs(s!.started));
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]!).toBeGreaterThan(starts[i - 1]!);
    }
  });

  test('WW-051 (path 2): /sessions card duration agrees with the IDB session duration', async ({ app }) => {
    const { page } = app;
    await app.runtime.useFastClock(20);
    await app.goto('/');
    await clearSessions(page);

    await startWorkoutFromPlayground(page, 'ww051-card', '```time\nTimer: 1:00\n10 Burpees\n```');
    // Let the accelerated clock accumulate a real elapsed span, then take the
    // guarded full-stop path (the path the ledger measured 13.6s of inflation on).
    await expect
      .poll(
        async () => {
          const text = await page.getByTestId(TEST_IDS.TIMER_DISPLAY).first().innerText();
          const m = text.match(/(\d{1,2}):(\d{2})/);
          return m ? Number(m[1]) * 60 + Number(m[2]) : 999;
        },
        { timeout: 15_000 },
      )
      .toBeLessThanOrEqual(50);
    await app.runtime.stopSession();

    await expect
      .poll(async () => (await getSessions(page)).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const session = (await getSessions(page))[0]!;
    expect(session.duration).toBeGreaterThan(0);
    const idbSeconds = session.duration! / 1000;

    await app.goto('/sessions');
    // The card's duration is derived from event spans; the authoritative clock
    // is the session row. They must agree within a couple of seconds.
    await expect
      .poll(
        async () => {
          const text = await page.getByTestId(TEST_IDS.STREAM_VIEW).innerText();
          return durationTokens(text).some((s) => Math.abs(s - idbSeconds) <= 3);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});
