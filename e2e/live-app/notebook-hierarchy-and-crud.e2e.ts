// spec: e2e/specs/notebooks/notebook-hierarchy-and-crud.md
import { test, expect } from '../fixtures/playgroundActor';

// Distinct far-future names so scenarios never collide with real notebooks.
const NB_CRUD = 'Alpine Club 2099';
const NB_CRUD_RENAMED = 'Alpine Collective 2099';
const NB_WQL = 'Coastal Runs 2099';

test.describe('Notebook hierarchy and CRUD — /notebooks', () => {
  test.beforeEach(async ({ app }) => {
    // The feed layout is the surface under test. Layout persists per route in
    // localStorage (default cards) — pin it before every load.
    await app.wql.setStreamLayout('/notebooks', 'feed');
  });

  test('the library always shows the built-in notebooks', async ({ app }) => {
    await app.notebooks.openLibrary();

    for (const builtIn of ['Defaults', 'Custom', 'Efforts', 'Equipment', 'Dashboards']) {
      await app.wql.expectStreamContains(builtIn);
    }
    app.assertCleanConsole();
  });

  test('a user notebook supports create, rename, and delete', async ({ app }) => {
    await app.notebooks.openLibrary();
    await app.notebooks.create(NB_CRUD);
    await expect(app.page).toHaveURL(/\/notebook\//);

    await app.notebooks.openLibrary();
    // A rename keeps the slug — the slug is the notebook's identity.
    await app.notebooks.rename('alpine-club-2099', NB_CRUD_RENAMED);
    await app.wql.expectStreamContains(NB_CRUD_RENAMED);

    await app.notebooks.delete('alpine-club-2099');
    await app.wql.expectStreamExcludes(NB_CRUD_RENAMED);
    app.assertCleanConsole();
  });

  test('the :notebook{} plane narrows by slug', async ({ app }) => {
    await app.notebooks.openLibrary();
    await app.notebooks.create(NB_WQL); // a fresh notebook ships one landing note

    await app.wql.queryStream('/notebooks', ':notebook{notebook:coastal-runs-2099}');
    await app.wql.expectStreamContains(NB_WQL);
    // Notes from other notebooks must not leak into the narrowed plane.
    await app.wql.expectStreamExcludes('My Workout');

    // Negation narrows the same note shape — the Coastal landing note drops out.
    await app.wql.queryStream('/notebooks', ':notebook{!notebook:coastal-runs-2099}');
    await app.wql.expectStreamExcludes(NB_WQL);
    await app.wql.expectStreamContains('My Workout');

    await app.notebooks.openLibrary();
    await app.notebooks.delete('coastal-runs-2099');
    app.assertCleanConsole();
  });
});
