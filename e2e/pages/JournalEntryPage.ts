import { Page, expect } from '@playwright/test';
import { BaseNotePage } from './BaseNotePage';
import { deleteNoteByRouteId, getNoteContentByRouteId } from '../helpers/wodwikiDb';

/**
 * JournalEntryPage — Page Object for /journal/:date
 *
 * Extends BaseNotePage for the shared note editor surface.
 * Adds journal-specific navigation (gotoJournalList) and
 * IndexedDB helpers for persistence testing.
 */
export class JournalEntryPage extends BaseNotePage {
  readonly page: Page;

  constructor(page: Page) {
    super(page);
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  url(date: string) {
    return `/day/${date}`;
  }

  async goto(date: string) {
    await this.page.goto(this.url(date), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await this.waitForLoad();
  }

  async gotoJournalList() {
    // SPA nav only — a hard goto kills the last keystroke's in-flight IDB write
    // (#1066). The date page always renders the "‹ Journal" back button.
    const back = this.page.locator('nav[aria-label="Journal navigation"] button').first();
    const datePath = new URL(this.page.url()).pathname;
    await expect(back).toBeVisible();
    await back.click();
    await this.page.waitForURL((url) => url.pathname !== datePath, { timeout: 10_000 });
  }

  // ── IndexedDB helpers ─────────────────────────────────────────────────────

  /** Delete a journal entry from wodwiki-db (resets to template on next load). */
  async clearStoredEntry(date: string) {
    await deleteNoteByRouteId(this.page, `journal/${date}`);
  }

  /** Read raw content from wodwiki-db (bypasses React — confirms the actual persisted value). */
  async storedContent(date: string): Promise<string | null> {
    return getNoteContentByRouteId(this.page, `journal/${date}`);
  }
}
