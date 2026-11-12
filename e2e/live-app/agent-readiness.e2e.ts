// spec: e2e/specs/journal/agent-readiness.md
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

test.describe('Browser Agent Readiness & WebMCP Journeys', () => {
  test('Scenario 1: static discovery, hydration gates, view-state JSON, and dynamic WebMCP lifecycle', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 800 });

    await app.goto('/journal');

    // Static Layer 4 discovery documents
    const llmsRes = await page.request.get('/llms.txt');
    expect(llmsRes.status()).toBe(200);
    const llmsBody = await llmsRes.text();
    expect(llmsBody).toContain('navigator.modelContext');
    expect(llmsBody).toContain('22 portable domain tools + 9 live React UI/Clock tools');

    const capRes = await page.request.get('/.well-known/agent-capabilities.json');
    expect(capRes.status()).toBe(200);
    const capJson = (await capRes.json()) as {
      domainTools: unknown[];
      uiTools: unknown[];
    };
    expect(capJson.domainTools).toHaveLength(22);
    expect(capJson.uiTools).toHaveLength(9);

    // Layer 2 hydration, landmark busy state, and embedded view-state script
    await expect(page.locator('body')).toHaveAttribute('data-app-hydrated', 'true');
    const main = page.locator('main').first();
    await expect(main).toHaveAttribute('data-agent-status', 'ready');
    await expect(main).toHaveAttribute('aria-busy', 'false');

    const viewState = await page.evaluate(() => {
      const el = document.getElementById('agent-view-state');
      return el ? JSON.parse(el.textContent || '{}') : null;
    });
    expect(viewState).not.toBeNull();
    expect(viewState.route.pathname).toBe('/journal');

    // Layer 1 WebMCP: stream tools mounted on /journal, editor/clock/explorer tools unmounted
    const journalTools = await page.evaluate(() => {
      const mc = (navigator as unknown as { modelContext: { listTools(): Array<{ name: string }> } })
        .modelContext;
      return mc.listTools().map((t) => t.name);
    });
    expect(journalTools).toContain('wod_note_upsert');
    expect(journalTools).toContain('ui_preferences');
    expect(journalTools).toContain('ui_set_stream_query');
    expect(journalTools).not.toContain('ui_set_explorer_query');
    expect(journalTools).not.toContain('ui_editor_draft');
    expect(journalTools).not.toContain('ui_clock_control');

    // Verify ui_preferences reads and toggles theme cleanly
    const prefsOut = await page.evaluate(async () => {
      const mc = (document as unknown as {
        modelContext: {
          getTools(): Promise<Array<{ name: string }>>;
          executeTool(tool: unknown, input: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      const tools = await mc.getTools();
      const prefs = tools.find((t) => t.name === 'ui_preferences');
      if (!prefs) throw new Error('ui_preferences missing');
      return mc.executeTool(prefs, { action: 'set', theme: 'dark' });
    });
    expect(prefsOut).toContain('dark');
    await expect(page.locator('html')).toHaveClass(/dark/);

    // WW-025: single-envelope navigator.modelContext.executeTool({ name, arguments }) also delivers arguments
    const singleEnvelopeOut = await page.evaluate(async () => {
      const mc = (navigator as unknown as {
        modelContext: {
          listTools(): Array<{ name: string; description?: string }>;
          executeTool(envelope: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      const prefs = mc.listTools().find((t) => t.name === 'ui_preferences');
      if (!prefs) throw new Error('ui_preferences missing on navigator.modelContext');
      return mc.executeTool({
        name: 'ui_preferences',
        description: prefs.description ?? '',
        origin: window.location.origin,
        window,
        arguments: { action: 'set', theme: 'light' },
      });
    });
    expect(singleEnvelopeOut).toContain('light');
    await expect(page.locator('html')).toHaveClass(/(^|\s)light(\s|$)/);

    // Switch back to dark via name+args convenience form
    await page.evaluate(async () => {
      const mc = (navigator as unknown as {
        modelContext: {
          executeTool(toolOrName: unknown, input?: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      return mc.executeTool('ui_preferences', { action: 'set', theme: 'dark' });
    });
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
    // Create a workout Note via WebMCP domain tool
    const created = await page.evaluate(async () => {
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
        title: 'Agent WebMCP Workout',
        content: '# Agent WebMCP Workout\n\n```time\n3 Rounds\n  10 Push-ups\n  15 Air Squats\n```',
      });
      return JSON.parse(raw);
    });
    const noteId: string =
      created?.structuredContent?.noteId ??
      created?.noteId ??
      JSON.parse(created?.content?.[0]?.text ?? '{}').noteId;
    expect(noteId).toBeTruthy();

    // Navigate to /note/:noteId via ui_navigate WebMCP UI tool
    await page.evaluate(async (targetPath) => {
      const mc = (document as unknown as {
        modelContext: {
          getTools(): Promise<Array<{ name: string }>>;
          executeTool(tool: unknown, input: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      const tools = await mc.getTools();
      const nav = tools.find((t) => t.name === 'ui_navigate');
      if (!nav) throw new Error('ui_navigate missing');
      await mc.executeTool(nav, { path: targetPath });
    }, `/note/${noteId}`);

    await expect(page).toHaveURL(new RegExp(`/note/${noteId}`));

    // Verify editor WebMCP tools dynamically registered once NoteEditor mounted
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const mc = (
            navigator as unknown as { modelContext: { listTools(): Array<{ name: string }> } }
          ).modelContext;
          return mc.listTools().map((t) => t.name);
        });
      })
      .toEqual(expect.arrayContaining(['ui_editor_draft', 'ui_start_live_workout']));

    // Launch live workout clock via ui_start_live_workout
    await page.evaluate(async () => {
      const mc = (document as unknown as {
        modelContext: {
          getTools(): Promise<Array<{ name: string }>>;
          executeTool(tool: unknown, input: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      const tools = await mc.getTools();
      const startLive = tools.find((t) => t.name === 'ui_start_live_workout');
      if (!startLive) throw new Error('ui_start_live_workout missing');
      await mc.executeTool(startLive, { autoStart: true });
    });

    // Verify ui_clock_control dynamically registers while live workout timer is active
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const mc = (
            navigator as unknown as { modelContext: { listTools(): Array<{ name: string }> } }
          ).modelContext;
          return mc.listTools().map((t) => t.name);
        });
      })
      .toContain('ui_clock_control');

    const clockStatusRaw = await page.evaluate(async () => {
      const mc = (document as unknown as {
        modelContext: {
          getTools(): Promise<Array<{ name: string }>>;
          executeTool(tool: unknown, input: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      const tools = await mc.getTools();
      const clockTool = tools.find((t) => t.name === 'ui_clock_control');
      if (!clockTool) throw new Error('ui_clock_control missing');
      return mc.executeTool(clockTool, { command: 'status' });
    });
    expect(clockStatusRaw).toContain('runId');
    app.assertCleanConsole();
  });

  test('Scenario 2: Tier 2 confirmation modal gates destructive WebMCP tool calls and mobile URL layout sync', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 800 });
    await app.goto('/journal');

    // Create disposable note
    const noteId = await page.evaluate(async () => {
      const mc = (document as unknown as {
        modelContext: {
          getTools(): Promise<Array<{ name: string }>>;
          executeTool(tool: unknown, input: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      const tools = await mc.getTools();
      const upsert = tools.find((t) => t.name === 'wod_note_upsert')!;
      const raw = await mc.executeTool(upsert, {
        title: 'Disposable Tier 2 Note',
        content: '# Disposable Tier 2 Note\n\n```time\n10 Burpees\n```',
      });
      const parsed = JSON.parse(raw);
      return (
        parsed?.structuredContent?.noteId ??
        parsed?.noteId ??
        JSON.parse(parsed?.content?.[0]?.text ?? '{}').noteId
      ) as string;
    });
    expect(noteId).toBeTruthy();

    // 1. Trigger wod_note_delete WITHOUT confirmId -> must open AgentConfirmHost modal
    const deniedPromise = page.evaluate(async (id) => {
      const mc = (document as unknown as {
        modelContext: {
          getTools(): Promise<Array<{ name: string }>>;
          executeTool(tool: unknown, input: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      const tools = await mc.getTools();
      const del = tools.find((t) => t.name === 'wod_note_delete')!;
      try {
        const res = await mc.executeTool(del, { noteId: id });
        return { ok: true, res };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }, noteId);

    const dialog = page.getByTestId(TEST_IDS.AGENT_CONFIRM_DIALOG);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(noteId);

    // Click Deny -> note stays intact
    await page.getByTestId(TEST_IDS.AGENT_CONFIRM_CANCEL).click();
    const deniedOutcome = await deniedPromise;
    expect(
      !deniedOutcome.ok || String(deniedOutcome.res ?? '').includes('declined') || String(deniedOutcome.res ?? '').includes('isError'),
    ).toBe(true);

    // 2. Trigger wod_note_delete again and click Approve Action
    const approvedPromise = page.evaluate(async (id) => {
      const mc = (document as unknown as {
        modelContext: {
          getTools(): Promise<Array<{ name: string }>>;
          executeTool(tool: unknown, input: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      const tools = await mc.getTools();
      const del = tools.find((t) => t.name === 'wod_note_delete')!;
      return mc.executeTool(del, { noteId: id });
    }, noteId);

    await expect(dialog).toBeVisible();
    await page.getByTestId(TEST_IDS.AGENT_CONFIRM_APPROVE).click();
    const approvedRaw = await approvedPromise;
    expect(approvedRaw).toContain('"deleted":true');

    // 3. Mobile 375x812 viewport + ?layout=rows URL state check
    await page.setViewportSize({ width: 375, height: 812 });
    await app.goto('/journal?layout=rows');
    await expect(page).toHaveURL(/layout=rows/);
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready');

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);

    const mainAria = await page.locator('main').first().ariaSnapshot();
    expect(mainAria).toBeTruthy();

    // WW-026: Unknown route preserves <main data-agent-status="ready"> and <nav> landmarks
    await page.goto('/does-not-exist-qa');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.locator('main')).toHaveAttribute('data-agent-status', 'ready');
    expect(await page.locator('nav').count()).toBeGreaterThan(0);
    app.assertCleanConsole();
  });
});
