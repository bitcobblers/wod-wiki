// spec: e2e/specs/feeds/publication-visibility-and-feed-export.md
import { expect, test } from '../fixtures/playgroundActor';

const NOTE_ID = '01950000-0000-7000-8000-000000000889';
const NOTEBOOK_SLUG = 'coach-program';
const SESSION_PUBLIC = 'sess-fed-03-1';
const SESSION_PRIVATE = 'sess-fed-03-2';
const CONTENT = '# Heavy DT\n\n```time\n(5)\n  12 Deadlifts\n  9 Hang Power Cleans\n  6 Push Jerks\n```\n';

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 375, height: 812 },
]) {
  test(`Publication Visibility ladder walks Private -> Published Note -> Published Note + Data and exports the Feed repository .zip at ${viewport.width}x${viewport.height}`, async ({ app }) => {
    await app.page.setViewportSize(viewport);

    await app.seed.world({
      notes: [{ id: NOTE_ID, title: 'Heavy DT', rawContent: CONTENT, seedOrigin: 'user' }],
      sessions: [
        { id: SESSION_PUBLIC, noteId: NOTE_ID },
        { id: SESSION_PRIVATE, noteId: NOTE_ID },
      ],
    });
    await app.seed.notebook(NOTEBOOK_SLUG, { title: 'Coach Program' });

    // 1. A journal-bound Note with no public Notebook and no public Sessions reads 'Private'
    await app.editor.openNote(NOTE_ID);
    await app.feeds.expectPublicationVisibility('Private');

    // 2. Linking 'notebook/coach-program' and making it public lifts the pill to 'Published Note'
    await app.notebooks.promoteNote([NOTEBOOK_SLUG]);
    await app.notebooks.setNotebookPublic(NOTEBOOK_SLUG, true);
    await app.feeds.expectPublicationVisibility('Published Note');

    // 3. Publishing Session #1 while Session #2 stays private lifts the pill to 'Published Note + Data'
    await app.feeds.setSessionPublic(SESSION_PUBLIC, true);
    await app.feeds.expectPublicationVisibility('Published Note + Data');

    if (viewport.width === 375) {
      const noteOverflow = await app.page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(noteOverflow, 'no horizontal overflow on /note/:noteId at 375px').toBe(false);
    }

    const repo = await app.feeds.exportPortable('feed-repo-zip');
    expect(repo.sessionIds).toContain(SESSION_PUBLIC);
    expect(repo.sessionIds).not.toContain(SESSION_PRIVATE);
    expect(repo.files.some((file) => file.includes(`notebook.${NOTEBOOK_SLUG}`))).toBe(true);

    // Unified /feeds and /notebooks stream surfaces list the published entities
    await app.feeds.openFeeds();
    await expect(app.page).toHaveURL(/\/feeds/);
    await app.notebooks.openLibrary();
    await app.wql.expectStreamContains('Coach Program');

    if (viewport.width === 375) {
      const nbOverflow = await app.page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(nbOverflow, 'no horizontal overflow on /notebooks at 375px').toBe(false);
    }

    app.assertCleanConsole();
  });
}
