// spec: e2e/specs/properties/efforts-catalog-and-alias-lifecycle.md
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

function buildCustomEffortYaml(slug: string, label: string, body: string): string {
  return [
    '---',
    `id: effort-user-${slug}`,
    `slug: ${slug}`,
    `label: "${label}"`,
    'aliases:',
    `  - ${slug}`,
    'baseAttributes:',
    '  met: 7.5',
    '  discipline: strength',
    '  intensityTier: moderate',
    'registrySource: user',
    '---',
    body,
    '',
  ].join('\n');
}

test.describe('PRP-01 — Efforts Catalog & Alias Lifecycle', () => {
  test('Scenario 1: filters /efforts across text, discipline, and origin WQL predicates and opens detail', async ({
    app,
  }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await app.seed.bundledEfforts();

    const efforts = await app.properties.openEffort();
    await efforts.waitForCatalogLoaded();

    await expect(app.page.getByTestId(TEST_IDS.STREAM_QUERY_BAR)).toBeVisible();
    await expect(efforts.createCustomButton()).toBeVisible();
    await expect(efforts.effortRow('burpee')).toBeVisible();
    await expect(efforts.effortRow('rowing')).toBeVisible();
    await expect.poll(() => efforts.effortRows().count(), { timeout: 15_000 }).toBeGreaterThan(10);

    // Text filter matches the burpee family while excluding unrelated movements
    await app.wql.fillStreamQueryBar(':effort{text:burpee}');
    await expect(efforts.effortRow('burpee')).toBeVisible();
    await expect(efforts.effortRow('burpee-pull-up')).toBeVisible();
    await expect(efforts.effortRow('rowing')).toHaveCount(0);

    // Discipline filter isolates kettlebell movements
    await app.wql.fillStreamQueryBar(':effort{discipline:kettlebell}');
    await expect(efforts.effortRow('kettlebell-swing')).toBeVisible();
    await expect(efforts.effortRow('burpee')).toHaveCount(0);

    // Unmatched query renders explicit stream empty state
    await app.wql.fillStreamQueryBar(':effort{text:xyznonexistent}');
    await expect(efforts.emptyState()).toBeVisible();
    await expect(app.page.getByText(/No efforts match/i)).toBeVisible();

    // Bundled origin filter restores bundled movements and navigates on row click
    await app.wql.fillStreamQueryBar(':effort{origin:bundled}');
    await expect(efforts.effortRow('rowing')).toBeVisible();
    await efforts.clickEffortRow('burpee');
    await expect(app.page).toHaveURL(/\/effort\/burpee$/);
    await expect(efforts.detailLabel()).toHaveText('Burpee');

    app.assertCleanConsole();
  });

  test('Scenario 2: bundled Effort detail renders frontmatter Metrics, alias chips, and seeded Markdown prose', async ({
    app,
  }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await app.seed.bundledEfforts();

    const rowing = await app.properties.openEffort('rowing');
    await expect(rowing.detailRoot()).toBeVisible();
    await expect(rowing.detailLabel()).toHaveText('Rowing');
    await expect(rowing.detailSource()).toHaveText('Bundled');
    await expect(rowing.cloneButton()).toBeVisible();
    await expect(rowing.editButton()).toHaveCount(0);

    const rowingProps = rowing.frontmatterProperties();
    await expect(rowingProps).toBeVisible();
    await rowingProps.getByRole('button', { name: 'Show property details' }).click();
    await expect(rowingProps.getByLabel('Value for slug')).toHaveValue('rowing');
    await expect
      .poll(async () => Number(await rowingProps.getByLabel('Value for metrics.met').inputValue()))
      .toBe(7);
    await expect(rowingProps.getByLabel('Value for intensityTier')).toHaveValue('high');

    const aliases = rowingProps.getByLabel('Value for aliases').locator('..');
    await expect(aliases.getByLabel('Value for aliases')).toBeVisible();
    await expect(aliases.getByRole('button', { name: 'Remove row', exact: true })).toBeVisible();
    await expect(aliases.getByRole('button', { name: 'Remove rower', exact: true })).toBeVisible();
    await expect(aliases.getByRole('button', { name: 'Remove concept2 row', exact: true })).toBeVisible();
    await expect(aliases.getByRole('link', { name: 'Open Rowing page' }).first()).toBeVisible();

    // Bundled Markdown prose renders in the Note editor on /effort/burpee
    const burpee = await app.properties.openEffort('burpee');
    await expect(burpee.detailLabel()).toHaveText('Burpee');
    await expect(burpee.notebookEditor()).toContainText(
      'Burpees are a full-body conditioning effort that combine a squat, plank, and jump.',
    );
    await expect(burpee.notebookEditor()).toContainText(
      'Use this bundled note to seed markdown-backed effort detail content in the UI.',
    );

    app.assertCleanConsole();
  });

  test('Scenario 3: explicit Clone and inline edit on bundled Efforts persist Custom copies without mutating bundled sources', async ({
    app,
  }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await app.seed.bundledEfforts();

    // 1. Explicit Clone on /effort/burpee + inline property autosave
    const burpee = await app.properties.openEffort('burpee');
    await expect(burpee.detailRoot()).toBeVisible();
    await burpee.cloneButton().click();
    await expect(app.page).toHaveURL(/\/effort\/burpee-custom$/);
    await expect(burpee.detailSource()).toContainText('Custom');

    await burpee.frontmatterProperties().getByRole('button', { name: 'Show property details' }).click();
    const labelInput = burpee.frontmatterProperties().getByLabel('Value for label');
    await labelInput.fill('Burpee training notes');
    await labelInput.press('Tab');

    await expect
      .poll(() => app.editor.readStoredContent('effort/burpee-custom'), { timeout: 15_000 })
      .toContain('Burpee training notes');

    await app.page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect(burpee.detailLabel()).toHaveText('Burpee training notes');
    await expect(burpee.notebookEditor()).toContainText('full-body conditioning');

    await app.properties.openEffort('burpee');
    await expect(burpee.detailLabel()).toHaveText('Burpee');
    await expect(burpee.detailSource()).toContainText('Bundled');

    // 2. Direct inline edit on bundled /effort/thruster auto-clones without conflict
    const thruster = await app.properties.openEffort('thruster');
    await expect(thruster.detailRoot()).toBeVisible();
    await thruster.frontmatterProperties().getByRole('button', { name: 'Show property details' }).click();
    const metInput = thruster.frontmatterProperties().getByLabel('Value for metrics.met');
    await metInput.fill('9');
    await metInput.press('Enter');

    await expect(app.page).toHaveURL(/\/effort\/thruster-custom$/, { timeout: 15_000 });
    await expect(app.page.getByText(/Save failed|changed since it was loaded/i)).toHaveCount(0);
    await expect
      .poll(() => app.editor.readStoredContent('effort/thruster-custom'), { timeout: 15_000 })
      .toContain('met: 9');

    await app.page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect(thruster.detailSource()).toContainText('Custom');
    await thruster.frontmatterProperties().getByRole('button', { name: 'Show property details' }).click();
    await expect(thruster.frontmatterProperties().getByLabel('Value for metrics.met')).toHaveValue('9');

    await app.properties.openEffort('thruster');
    await expect(thruster.detailSource()).toContainText('Bundled');
    await thruster.frontmatterProperties().getByRole('button', { name: 'Show property details' }).click();
    await expect(thruster.frontmatterProperties().getByLabel('Value for metrics.met')).toHaveValue('8');

    // 3. :effort{origin:user} lists the user-defined Custom Efforts and excludes bundled rows
    await app.wql.queryStream('/efforts', ':effort{origin:user}');
    await app.wql.expectStreamContains('Burpee training notes');
    await expect(thruster.effortRow('rowing')).toHaveCount(0);

    app.assertCleanConsole();
  });

  test('Scenario 4: creates a Custom Effort from not-found create mode and links an unknown slug as a resolving alias', async ({
    app,
  }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    const suffix = Date.now().toString().slice(-6);
    const createdSlug = `sled-drive-${suffix}`;
    const aliasSlug = `prowler-sprint-${suffix}`;

    // 1. Unknown /effort/:slug -> Create Effort Page -> Edit YAML -> Create Effort -> survives reload
    const missingForCreate = await app.properties.openEffort(createdSlug);
    await expect(missingForCreate.detailNotFound()).toBeVisible();
    await expect(app.page.getByRole('button', { name: 'Back to library' })).toBeVisible();
    await app.page.getByTestId(TEST_IDS.EFFORT_NOT_FOUND_CREATE_BTN).click();
    await expect(app.page).toHaveURL(new RegExp(`/effort/${createdSlug}\\?mode=create$`));

    await app.page.getByRole('button', { name: 'Edit YAML' }).click();
    await expect(app.page.locator('.cm-content').first()).toContainText('registrySource');
    await app.editor.replaceDocument(
      buildCustomEffortYaml(createdSlug, 'Sled Drive QA', 'Heavy horizontal sled drive.'),
    );
    await app.page.getByTestId('effort-create-btn').click();

    await expect(app.page).toHaveURL(new RegExp(`/effort/${createdSlug}$`), { timeout: 15_000 });
    await expect(app.page.getByTestId(TEST_IDS.EFFORT_DETAIL_LABEL)).toHaveText('Sled Drive QA');
    await expect(app.page.getByTestId(TEST_IDS.EFFORT_DETAIL_SOURCE)).toContainText('Custom');
    await expect
      .poll(() => app.editor.readStoredContent(`effort/${createdSlug}`), { timeout: 15_000 })
      .toContain('Heavy horizontal sled drive.');

    await app.page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect(app.page.getByTestId(TEST_IDS.EFFORT_DETAIL_LABEL)).toHaveText('Sled Drive QA');
    await expect(app.page.getByTestId(TEST_IDS.EFFORT_DETAIL_NOTEBOOK_EDITOR)).toContainText(
      'Heavy horizontal sled drive.',
    );

    // 2. From hydrated /efforts, transition in-app to unknown /effort/:aliasSlug -> Link as Alias
    const catalog = await app.properties.openEffort();
    await catalog.waitForCatalogLoaded();
    await app.wql.expectStreamContains('Sled Drive QA');

    await app.page.evaluate((path) => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `/effort/${aliasSlug}`);

    await expect(catalog.detailNotFound()).toBeVisible();
    await app.page.getByTestId(TEST_IDS.EFFORT_NOT_FOUND_ALIAS_BTN).click();
    const aliasSelect = app.page.getByTestId(TEST_IDS.EFFORT_NOT_FOUND_ALIAS_SELECT);
    await expect(aliasSelect).toBeVisible();
    await aliasSelect.selectOption(createdSlug);
    await app.page.getByTestId(TEST_IDS.EFFORT_NOT_FOUND_ALIAS_CONFIRM).click();

    await expect(app.page).toHaveURL(new RegExp(`/effort/${createdSlug}$`), { timeout: 15_000 });
    await expect(catalog.detailLabel()).toHaveText('Sled Drive QA');

    // Full reload/navigation to the alias slug now resolves directly to the canonical Effort
    const resolvedViaAlias = await app.properties.openEffort(aliasSlug);
    await expect(resolvedViaAlias.detailNotFound()).toHaveCount(0);
    await expect(resolvedViaAlias.detailLabel()).toHaveText('Sled Drive QA');

    app.assertCleanConsole();
  });

  // Tracked UI gap (#719): EffortDetailPage autosaves inline edits on Custom Efforts,
  // but does not yet expose a Delete action (`EFFORT_DETAIL_DELETE_BTN`) on /effort/:slug.
  test.fixme(
    'deleting a Custom Effort from the detail surface removes it and returns to /efforts (#719)',
    async ({ app }) => {
      const slug = `delete-me-${Date.now().toString().slice(-6)}`;
      await app.goto('/effort/new?mode=create');
      await app.page.getByRole('button', { name: 'Edit YAML' }).click();
      await app.editor.replaceDocument(buildCustomEffortYaml(slug, 'Delete Me QA', 'Temporary custom effort.'));
      await app.page.getByTestId('effort-create-btn').click();
      await expect(app.page).toHaveURL(new RegExp(`/effort/${slug}$`));

      await expect(app.page.getByTestId(TEST_IDS.EFFORT_DETAIL_DELETE_BTN)).toBeVisible();
      await app.page.getByTestId(TEST_IDS.EFFORT_DETAIL_DELETE_BTN).click();
      await expect(app.page).toHaveURL('/efforts');
      await app.wql.expectStreamExcludes('Delete Me QA');
      app.assertCleanConsole();
    },
  );
});
