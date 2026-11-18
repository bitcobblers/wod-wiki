/**
 * WW-049 — wod_note_delete without confirmId never resolves — promise pends indefinitely on a silent human-only 'Confirm Agent Action' modal (no timeout, no confirmation-required error) (medium)
 *
 * Regression test for the open QA defect WW-049 (wod-note-delete-unconfirmed-hang).
 * Expected behavior: an agent calling wod_note_delete without a confirmId gets a
 * prompt, bounded outcome — the call settles with a confirmation-required error
 * (the engine already has AgentConfirmationRequiredError for the declined path)
 * instead of pending forever when no human is present to work the modal, and the
 * note is left untouched.
 * Current defect: requireDestructiveConfirmation awaits ctx.confirmDestructive,
 * which in the browser opens the 'Confirm Agent Action' modal and pends until a
 * human clicks; with no human in the loop the tool promise never resolves and
 * the caller gets neither a timeout nor a confirmation-required error.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-13-ondemand-163801).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

const SETTLE_BUDGET_MS = 15_000;

interface ToolOutcome {
  ok: boolean;
  res?: string;
  error?: string;
}

test.describe('WW-049 — wod_note_delete without confirmId', () => {
  test('WW-049: wod_note_delete without confirmId settles promptly with a confirmation-required outcome instead of pending indefinitely', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 800 });
    await app.goto('/journal');

    // Create a disposable note through the same WebMCP surface an agent uses.
    const noteId = await page.evaluate(async () => {
      const mc = (document as unknown as {
        modelContext: {
          getTools(): Promise<Array<{ name: string }>>;
          executeTool(tool: unknown, input: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      const tools = await mc.getTools();
      const upsert = tools.find((t) => t.name === 'wod_note_upsert');
      if (!upsert) throw new Error('wod_note_upsert missing');
      const raw = await mc.executeTool(upsert, {
        title: 'WW049 Disposable Note',
        content: '# WW049 Disposable Note\n\n```time\n10 Burpees\n```',
      });
      const parsed = JSON.parse(raw) as {
        structuredContent?: { noteId?: string };
        noteId?: string;
        content?: Array<{ text?: string }>;
      };
      return (parsed?.structuredContent?.noteId ??
        parsed?.noteId ??
        (JSON.parse(parsed?.content?.[0]?.text ?? '{}') as { noteId?: string }).noteId) as string;
    });
    expect(noteId).toBeTruthy();

    // Call wod_note_delete WITHOUT confirmId and without touching any modal.
    const deletePromise: Promise<ToolOutcome> = page.evaluate(async (id) => {
      const mc = (document as unknown as {
        modelContext: {
          getTools(): Promise<Array<{ name: string }>>;
          executeTool(tool: unknown, input: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      const tools = await mc.getTools();
      const del = tools.find((t) => t.name === 'wod_note_delete');
      if (!del) throw new Error('wod_note_delete missing');
      try {
        const res = await mc.executeTool(del, { noteId: id });
        return { ok: true, res };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }, noteId);
    // If the call pends forever (the defect), swallow its late settlement so
    // teardown does not surface an unhandled rejection after the failure.
    void deletePromise.catch(() => {});

    const outcome = await Promise.race([
      deletePromise.then((value) => ({ settled: true as const, value })),
      new Promise<{ settled: false }>((resolve) =>
        setTimeout(() => resolve({ settled: false as const }), SETTLE_BUDGET_MS),
      ),
    ]);

    try {
      expect(
        outcome.settled,
        `wod_note_delete without confirmId did not settle within ${SETTLE_BUDGET_MS}ms — the promise pends indefinitely on the human-only confirmation modal`,
      ).toBe(true);
      if (outcome.settled) {
        expect(
          JSON.stringify(outcome.value),
          'the settled outcome must say that confirmation is required',
        ).toMatch(/confirm/i);
      }
      // An unconfirmed call must never delete the note.
      await expect
        .poll(() => app.editor.readStoredContent(noteId), { timeout: 10_000 })
        .toContain('WW049 Disposable Note');
    } finally {
      // Release any still-open confirmation modal, then remove the disposable
      // note through the confirmId fast path (confirmId === noteId).
      const cancel = page.getByTestId(TEST_IDS.AGENT_CONFIRM_CANCEL);
      if (await cancel.isVisible().catch(() => false)) {
        await cancel.click().catch(() => {});
      }
      await page
        .evaluate(async (id) => {
          const mc = (document as unknown as {
            modelContext: {
              getTools(): Promise<Array<{ name: string }>>;
              executeTool(tool: unknown, input: Record<string, unknown>): Promise<string>;
            };
          }).modelContext;
          const tools = await mc.getTools();
          const del = tools.find((t) => t.name === 'wod_note_delete');
          if (del) await mc.executeTool(del, { noteId: id, confirmId: id });
        }, noteId)
        .catch(() => {});
    }
  });
});
