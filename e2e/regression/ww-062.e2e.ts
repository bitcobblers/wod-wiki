/**
 * WW-062 — wod_notebook_list advertises notebook URLs as /notebooks/:slug — every link 404s 'Page not found'; real route is /notebook/:slug (low)
 *
 * Regression test for the open QA defect WW-062 (wod-notebook-list-broken-urls).
 * Expected behavior: every URL returned by the wod_notebook_list agent tool
 * points at the canonical notebook route /notebook/:slug and opens the
 * notebook instead of the 404 page.
 * Current defect: notebookTools.ts builds `url` as `${prefix}/notebooks/${slug}`
 * (plural), a route that does not exist, so every advertised link lands on
 * 'Page not found'.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-13-ondemand-163801).
 */
import { test, expect } from '../fixtures/playgroundActor';

interface NotebookListEntry {
  slug?: string;
  url?: string;
}

interface NotebookListResult {
  notebooks?: NotebookListEntry[];
}

test.describe('WW-062 — wod_notebook_list advertises canonical notebook URLs', () => {
  test('WW-062: wod_notebook_list URLs use /notebook/:slug and resolve to the notebook', async ({ app }) => {
    const slug = 'regression-probe-2099';
    await app.seed.notebook(slug, { title: 'Regression Probe 2099' });
    await app.goto('/notebooks');

    // Exercise the domain tool through the browser WebMCP surface, mirroring
    // agent-readiness.e2e.ts's harness for wod_note_upsert.
    const payload = await app.page.evaluate(async () => {
      const mc = (
        document as unknown as {
          modelContext: {
            getTools(): Promise<Array<{ name: string }>>;
            executeTool(tool: unknown, input: Record<string, unknown>): Promise<string>;
          };
        }
      ).modelContext;
      const tools = await mc.getTools();
      const listTool = tools.find((t) => t.name === 'wod_notebook_list');
      if (!listTool) throw new Error('wod_notebook_list missing from WebMCP tools');
      const raw = await mc.executeTool(listTool, {});
      const parsed = JSON.parse(raw) as {
        structuredContent?: NotebookListResult;
        content?: Array<{ text?: string }>;
        notebooks?: NotebookListEntry[];
      };
      const result: NotebookListResult =
        parsed.structuredContent ??
        (parsed.notebooks ? parsed : JSON.parse(parsed.content?.[0]?.text ?? '{}'));
      return result;
    });

    const entry = payload.notebooks?.find((nb) => nb.slug === slug);
    expect(entry, 'wod_notebook_list returns the seeded notebook').toBeTruthy();
    expect(entry!.url, 'tool advertises a URL for the notebook').toBeTruthy();
    const url = entry!.url!;
    expect(url, 'advertised URL must not use the plural /notebooks/ route').not.toContain(
      '/notebooks/',
    );
    expect(url, 'advertised URL uses the canonical /notebook/:slug route').toMatch(
      new RegExp(`/notebook/${slug}$`),
    );

    // And the advertised URL actually opens the notebook, not the 404 page.
    const path = url.startsWith('http') ? new URL(url).pathname : url;
    await app.goto(path);
    await expect(app.page).toHaveURL(new RegExp(`/notebook/${slug}$`));
    await expect(
      app.page.getByRole('heading', { name: 'Page not found' }),
      'advertised URL does not land on Page not found',
    ).toHaveCount(0);
  });
});
