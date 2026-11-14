import type { Page } from '@playwright/test';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { advanceUntilReview } from '../pages/WallClockPage';

interface StoredApiNote {
  id: string;
  title: string;
  rawContent: string;
  sourceRevision: number;
  blocks: Record<string, { id: string; kind: string; version: number }>;
}

interface StoredApiSession {
  id: string;
  noteId: string;
  blockId: string;
  blockVersion: number;
  completed?: boolean;
  status?: string;
  duration: number;
}

interface StoredSeedMeta {
  key: string;
  seedVersion?: number;
}

async function createJournalNoteViaUi(page: Page, markdown: string, expectedHeading: string): Promise<string> {
  await page.getByTestId('new-entry-primary').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/note\/[0-9a-f-]+\?edit=1$/);

  const noteId = new URL(page.url()).pathname.replace(/^\/note\//, '');
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(markdown);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('heading', { name: expectedHeading, level: 1 })).toBeVisible({ timeout: 15_000 });
  return noteId;
}

async function fetchJsonFromApi<T>(page: Page, apiPath: string): Promise<{ status: number; body: T | null }> {
  return page.evaluate(async (targetPath) => {
    const response = await fetch(targetPath, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return { status: response.status, body: null };
    }
    const data = (await response.json()) as T;
    return { status: response.status, body: data };
  }, apiPath);
}

test.describe('Hosted VITE_STORAGE=api + wod server SQLite lifecycle', () => {
  let pageErrors: string[] = [];
  let unexpectedConsoleErrors: string[] = [];
  let unexpectedHttpErrors: string[] = [];

  test.beforeEach(async ({ app }) => {
    pageErrors = [];
    unexpectedConsoleErrors = [];
    unexpectedHttpErrors = [];

    app.page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    app.page.on('response', (res) => {
      const status = res.status();
      if (status < 400) return;
      const pathname = new URL(res.url()).pathname;
      // ApiStorage encodes absent-row `store.get(key) -> undefined` as HTTP 404
      // on `GET /api/v1/:store/get`. Any static/seed 404 or any 5xx is a bug.
      const isExpectedAbsentKeyLookup =
        status === 404 && res.request().method() === 'GET' && /^\/api\/v1\/[^/]+\/get$/.test(pathname);
      if (!isExpectedAbsentKeyLookup) {
        unexpectedHttpErrors.push(`${res.request().method()} ${pathname} -> ${status}`);
      }
    });

    app.page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (text === 'Failed to load resource: the server responded with a status of 404 (Not Found)') {
        return;
      }
      unexpectedConsoleErrors.push(text);
    });

    // Keep the hosted SQLite E2E suite 100% hermetic: disable optional remote
    // GitHub Pages sample feeds while letting `/seed/core/manifest.json` sync
    // from the local `wod server` into SQLite.
    await app.page.addInitScript(() => {
      window.localStorage.setItem(
        'wodwiki.seedSubscriptions',
        JSON.stringify({ 'samples-movement': false, 'samples-results': false }),
      );
    });
  });

  function assertCleanHostedSession(): void {
    expect(pageErrors, `Uncaught pageerror(s):\n${pageErrors.join('\n')}`).toEqual([]);
    expect(unexpectedHttpErrors, `Unexpected HTTP >=400 response(s):\n${unexpectedHttpErrors.join('\n')}`).toEqual([]);
    expect(unexpectedConsoleErrors, `Unexpected console.error(s):\n${unexpectedConsoleErrors.join('\n')}`).toEqual([]);
  }

  test('Scenario 1: boots /journal & /notebooks against hosted SQLite server, settles seed sync, and answers 200 on /api/health', async ({
    app,
  }) => {
    const healthRes = await app.page.request.get('/api/health');
    expect(healthRes.status()).toBe(200);
    expect(await healthRes.json()).toEqual({ ok: true, driver: 'sqlite' });

    const manifestRes = await app.page.request.get('/seed/core/manifest.json');
    expect(manifestRes.status()).toBe(200);
    const manifestJson = (await manifestRes.json()) as { chunks?: unknown[] };
    expect(Array.isArray(manifestJson.chunks)).toBe(true);
    expect((manifestJson.chunks ?? []).length).toBeGreaterThan(0);

    await app.goto('/journal');
    await expect(app.page.locator('html')).toHaveAttribute('data-feed-state', 'ready');
    await expect(app.page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });
    await expect(app.page.getByTestId(TEST_IDS.STREAM_VIEW)).toBeVisible();

    const coreMetaKey = encodeURIComponent(JSON.stringify('seed:core'));
    await expect
      .poll(
        async () => {
          const res = await fetchJsonFromApi<StoredSeedMeta>(app.page, `/api/v1/meta/get?key=${coreMetaKey}`);
          return res.status === 200 ? (res.body?.seedVersion ?? 0) : 0;
        },
        { timeout: 30_000, message: 'core seed checkpoint must commit into SQLite via /api/v1' },
      )
      .toBeGreaterThan(0);

    await app.goto('/notebooks');
    await expect(app.page.locator('html')).toHaveAttribute('data-feed-state', 'ready');
    await expect(app.page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });
    await expect(app.page.getByTestId(TEST_IDS.STREAM_VIEW)).toBeVisible();
    await expect(app.page.getByTestId(TEST_IDS.NOTEBOOKS_CREATE_BUTTON)).toBeVisible();

    assertCleanHostedSession();
  });

  test('Scenario 2: creates & edits a workout Note in browser UI, persists to SQLite via /api/v1, and survives page.reload()', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/journal');
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });

    const stamp = Date.now();
    const noteTitle = `SQLite API Benchmark ${stamp}`;
    const initialMarkdown = [
      `# ${noteTitle}`,
      '',
      'Hosted SQLite persistence check.',
      '',
      '```time',
      'Timer: 5:00',
      '10 Kettlebell Swings 24kg',
      '```',
      '',
    ].join('\n');

    const noteId = await createJournalNoteViaUi(page, initialMarkdown, noteTitle);
    const encodedKey = encodeURIComponent(JSON.stringify(noteId));

    await expect
      .poll(
        async () => {
          const res = await fetchJsonFromApi<StoredApiNote>(page, `/api/v1/notes/get?key=${encodedKey}`);
          return res.body?.rawContent ?? '';
        },
        { timeout: 15_000, message: 'initial workout Note must persist in SQLite' },
      )
      .toContain('10 Kettlebell Swings 24kg');

    // Perform a second edit in CodeMirror and verify SQLite revision + reload durability
    await app.editor.typeLine('Finisher: 20 Goblet Squats');
    await page.keyboard.press('ControlOrMeta+s');

    await expect
      .poll(
        async () => {
          const res = await fetchJsonFromApi<StoredApiNote>(page, `/api/v1/notes/get?key=${encodedKey}`);
          return {
            status: res.status,
            hasEdit: res.body?.rawContent.includes('Finisher: 20 Goblet Squats') ?? false,
            blockCount: Object.keys(res.body?.blocks ?? {}).length,
          };
        },
        { timeout: 15_000, message: 'edited Markdown and parsed wod block must commit to SQLite' },
      )
      .toEqual({ status: 200, hasEdit: true, blockCount: 1 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: noteTitle, level: 1 })).toBeVisible();

    const reloadedDoc = await app.editor.readDocument();
    expect(reloadedDoc).toContain(noteTitle);
    expect(reloadedDoc).toContain('10 Kettlebell Swings 24kg');
    expect(reloadedDoc).toContain('Finisher: 20 Goblet Squats');

    assertCleanHostedSession();
  });

  test('Scenario 3: executes WQL against SQLite-backed notes and completes a workout Session that persists across page.reload()', async ({
    app,
  }) => {
    test.setTimeout(90_000);
    const { page } = app;
    await app.runtime.useFastClock(20);

    await app.goto('/journal');
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });

    const stamp = Date.now();
    const targetToken = `sqlitewql${stamp}`;
    const workoutTitle = `Hosted WQL Target ${targetToken}`;
    const distractorTitle = `Hosted Distractor Note ${stamp}`;

    const workoutMarkdown = [
      `# ${workoutTitle}`,
      '',
      '```time',
      'Timer: 0:06',
      '5 Burpees',
      '```',
      '',
    ].join('\n');

    const workoutNoteId = await createJournalNoteViaUi(page, workoutMarkdown, workoutTitle);
    const encodedWorkoutKey = encodeURIComponent(JSON.stringify(workoutNoteId));
    await expect
      .poll(
        async () => (await fetchJsonFromApi<StoredApiNote>(page, `/api/v1/notes/get?key=${encodedWorkoutKey}`)).status,
        { timeout: 15_000 },
      )
      .toBe(200);

    await app.goto('/journal');
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });
    const distractorNoteId = await createJournalNoteViaUi(
      page,
      `# ${distractorTitle}\n\nEasy recovery walk.\n`,
      distractorTitle,
    );
    const encodedDistractorKey = encodeURIComponent(JSON.stringify(distractorNoteId));
    await expect
      .poll(
        async () =>
          (await fetchJsonFromApi<StoredApiNote>(page, `/api/v1/notes/get?key=${encodedDistractorKey}`)).status,
        { timeout: 15_000 },
      )
      .toBe(200);

    // 1. Execute WQL query in the browser against SQLite-backed notes
    await app.goto('/journal');
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });
    await app.wql.fillStreamQueryBar(`:note{text:${targetToken}}`);
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 15_000,
    });
    await app.wql.expectStreamContains(workoutTitle);
    await app.wql.expectStreamExcludes(distractorTitle);

    // 2. Open the workout Note and run/complete a Session into SQLite
    await app.goto(`/note/${workoutNoteId}`);
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });

    const startBtn = page
      .locator(`[data-testid="${TEST_IDS.EDITOR_START_WORKOUT}"], button[aria-label*="Run" i], button:has-text("Run")`)
      .first();
    await expect(startBtn).toBeVisible({ timeout: 15_000 });
    await startBtn.click();

    await advanceUntilReview(page);
    await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();

    let persistedSession: StoredApiSession | undefined;
    await expect
      .poll(
        async () => {
          const res = await fetchJsonFromApi<StoredApiSession[]>(page, '/api/v1/sessions/all');
          persistedSession = (res.body ?? []).find((s) => s.noteId === workoutNoteId);
          return Boolean(persistedSession);
        },
        { timeout: 15_000, message: 'completed Session must persist to SQLite /api/v1/sessions' },
      )
      .toBe(true);

    expect(persistedSession).toBeDefined();
    expect(persistedSession?.completed).toBe(true);
    expect(persistedSession?.blockVersion).toBeGreaterThanOrEqual(1);

    const sessionId = persistedSession!.id;
    const encodedSessionKey = encodeURIComponent(JSON.stringify(sessionId));

    // 3. Reload the browser and verify the Session survives both in SQLite and in /results/:id UI
    await app.goto(`/results/${sessionId}`);
    await expect(page.getByText('Session not found.')).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect(page.getByText('Session not found.')).toHaveCount(0);

    const sessionAfterReload = await fetchJsonFromApi<StoredApiSession>(
      page,
      `/api/v1/sessions/get?key=${encodedSessionKey}`,
    );
    expect(sessionAfterReload.status).toBe(200);
    expect(sessionAfterReload.body?.id).toBe(sessionId);
    expect(sessionAfterReload.body?.noteId).toBe(workoutNoteId);
    expect(sessionAfterReload.body?.completed).toBe(true);

    assertCleanHostedSession();
  });
});
