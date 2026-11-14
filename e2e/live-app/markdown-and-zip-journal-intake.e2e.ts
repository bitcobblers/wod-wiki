// spec: e2e/specs/journal/markdown-and-zip-journal-intake.md
import { gzipSync } from 'node:zlib';
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId } from '../helpers/wodwikiDb';

const JOURNAL_TARGET_DATE = '2099-08-19';
const JOURNAL_ZIP_TITLE = 'JRN05 Harbor Sprint';
const JOURNAL_ZIP_MARKDOWN = [
  `# ${JOURNAL_ZIP_TITLE}`,
  '',
  '```time',
  '(3)',
  '  400m Run',
  '  15 Burpees',
  '```',
  '',
].join('\n');

const SCRATCHPAD_ZIP_TITLE = 'JRN05 Scratchpad Tempo';
const SCRATCHPAD_ZIP_MARKDOWN = [
  `# ${SCRATCHPAD_ZIP_TITLE}`,
  '',
  '```time',
  '10:00 AMRAP',
  '  10 Push-Ups',
  '  15 Air Squats',
  '```',
  '',
].join('\n');

const PORTABLE_MD_NOTE_ID = '01950000-0000-7000-8000-000000000805';
const PORTABLE_MD_DATE = '2099-08-20';
const PORTABLE_MD_TITLE = 'JRN05 Portable Markdown Entry';
const PORTABLE_MD_FILE = [
  '---',
  `wod-note-id: ${PORTABLE_MD_NOTE_ID}`,
  `title: ${PORTABLE_MD_TITLE}`,
  `date: ${PORTABLE_MD_DATE}`,
  'notebook: journal',
  '---',
  '',
  `# ${PORTABLE_MD_TITLE}`,
  '',
  '```time',
  '(4)',
  '  8 Front Squats 60kg',
  '  12 Box Jumps',
  '```',
  '',
].join('\n');

function encodeZipParam(markdown: string): string {
  return gzipSync(Buffer.from(markdown, 'utf8')).toString('base64url');
}

test.describe('JRN-05 — Markdown & Zip Journal Intake', () => {
  test('Scenario 1: /load/journal/:date?zip= and /load?zip= decode compressed Markdown and persist dated Journal Notes across reload', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.wql.setStreamLayout('/journal', 'cards');

    let createdJournalNoteId: string | undefined;
    let createdPlaygroundRouteId: string | undefined;

    try {
      // 1. Import dated journal entry via /load/journal/:date?zip=<encoded>
      const encodedJournal = encodeZipParam(JOURNAL_ZIP_MARKDOWN);
      await page.goto(`/load/journal/${JOURNAL_TARGET_DATE}?zip=${encodedJournal}`);
      await expect(page).toHaveURL(/\/note\/[0-9a-f-]+/i);
      await app.feeds.waitForReady();

      const noteMatch = page.url().match(/\/note\/([0-9a-f-]+)/i);
      createdJournalNoteId = noteMatch?.[1];
      expect(createdJournalNoteId).toBeTruthy();

      await expect(page.getByRole('textbox', { name: 'Note editor' })).toContainText(
        JOURNAL_ZIP_TITLE,
      );

      // 2. Verify dated entry resolves on /day/:date across reload and in /journal stream
      await app.journal.openDate(JOURNAL_TARGET_DATE);
      await expect(page.getByRole('textbox', { name: 'Note editor' })).toContainText(
        JOURNAL_ZIP_TITLE,
      );

      await page.reload();
      await app.feeds.waitForReady();
      await expect(page.getByRole('textbox', { name: 'Note editor' })).toContainText(
        JOURNAL_ZIP_TITLE,
      );

      await app.wql.queryStream(
        '/journal',
        ':note{notebook:journal,text:"JRN05 Harbor Sprint"} from 2099-08-01 to 2099-08-31',
      );
      await expect(page.getByRole('heading', { name: JOURNAL_TARGET_DATE })).toBeVisible();

      await page.reload();
      await app.feeds.waitForReady();
      await expect(page.getByRole('heading', { name: JOURNAL_TARGET_DATE })).toBeVisible();

      // 3. Verify /load?zip=<encoded> decodes into /playground/:id without auto-running a timer
      const encodedScratchpad = encodeZipParam(SCRATCHPAD_ZIP_MARKDOWN);
      await page.goto(`/load?zip=${encodedScratchpad}`);
      await expect(page).toHaveURL(/\/playground\/[^/?#]+/);
      await app.feeds.waitForReady();

      const pgMatch = page.url().match(/\/playground\/([^/?#]+)/);
      if (pgMatch?.[1]) {
        createdPlaygroundRouteId = `playground/${decodeURIComponent(pgMatch[1])}`;
      }

      await expect(page.getByRole('textbox', { name: 'Note editor' })).toContainText(
        SCRATCHPAD_ZIP_TITLE,
      );
      await expect(page.getByTestId(TEST_IDS.TIMER_FULLSCREEN_OVERLAY)).toBeHidden();

      app.assertCleanConsole();
    } finally {
      await app.journal.clearDate(JOURNAL_TARGET_DATE);
      if (createdJournalNoteId) {
        await deleteNoteByRouteId(page, createdJournalNoteId);
      }
      if (createdPlaygroundRouteId) {
        await deleteNoteByRouteId(page, createdPlaygroundRouteId);
      }
    }
  });

  test('Scenario 2: /load/journal upload fallback imports Markdown on mobile 375x812 without overflow and persists across reload', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 375, height: 812 });
    await app.wql.setStreamLayout('/journal', 'cards');

    try {
      // 1. Open /load/journal without ?zip= on mobile 375x812
      await app.goto('/load/journal');
      await expect(
        page.getByRole('heading', { name: 'This import link is missing its bundle' }),
      ).toBeVisible();

      const uploadInput = page.getByTestId('journal-zip-upload');
      await expect(uploadInput).toBeVisible();

      const intakeOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(intakeOverflow, 'no horizontal overflow on /load/journal at 375x812').toBe(false);

      // Upload canonical frontmatter Markdown file directly
      await uploadInput.setInputFiles({
        name: 'jrn05-portable-entry.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(PORTABLE_MD_FILE, 'utf8'),
      });

      await expect(page).toHaveURL(/^https?:\/\/[^/]+\/journal(?:\?.*)?$/);
      await app.feeds.waitForReady();

      // 2. Verify imported entry in /journal at 375x812 and on /note/:noteId across reload
      await app.wql.queryStream('/journal', ':note{text:"JRN05 Portable Markdown Entry"}');
      await expect(page.getByRole('heading', { name: PORTABLE_MD_TITLE })).toBeVisible();

      const journalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(journalOverflow, 'no horizontal overflow on /journal at 375x812').toBe(false);

      await app.editor.openNote(PORTABLE_MD_NOTE_ID);
      await expect(page.getByRole('textbox', { name: 'Note editor' })).toContainText(
        PORTABLE_MD_TITLE,
      );

      await page.reload();
      await app.feeds.waitForReady();
      await expect(page.getByRole('textbox', { name: 'Note editor' })).toContainText(
        PORTABLE_MD_TITLE,
      );
      await app.journal.expectNotePersisted(PORTABLE_MD_NOTE_ID, PORTABLE_MD_TITLE);

      app.assertCleanConsole();
    } finally {
      await deleteNoteByRouteId(page, PORTABLE_MD_NOTE_ID);
    }
  });
});
