import { Page, Locator, expect } from '@playwright/test';
import { getNoteContentByRouteId } from '../helpers/wodwikiDb';
import type { EditorView } from '@codemirror/view';

/**
 * BaseNotePage — shared Page Object for all Note Workspace routes.
 *
 * Covers the common surface shared by every page that mounts NoteEditor
 * inside JournalPageShell:
 *   /journal/:id, /playground/:id, /workout/:cat/:name, /note/:cat/:name
 *
 * Subclasses provide route-specific goto(...) signatures and any extra
 * selectors/assertions.
 */
export abstract class BaseNotePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  /** Route-specific entry point — implemented by subclass. */
  abstract goto(...args: any[]): Promise<void>;

  /** Wait until the editor surface is present and React has settled. */
  async waitForLoad() {
    await this.awaitEditorReady();
  }

  // ── Readiness signals (replaces fixed waitForTimeout settle-waits) ──────

  /**
   * Editor surface attached; bounded fail-fast, no fixed settle sleep.
   * Note routes default to read-mode markdown (#1008) — the NoteEditor
   * mounts behind the Edit toggle, so enter it when present.
   */
  async awaitEditorReady(): Promise<void> {
    const editToggle = this.page.getByRole('button', { name: 'Edit', exact: true });
    try {
      await editToggle.click({ timeout: 2_000 });
    } catch {
      // No toggle (editor already mounted, or a route without one).
    }
    await this.editor().waitFor({ state: 'attached', timeout: 10_000 });
  }

  /**
   * Wait until at least one compiled block marker renders — a wod block's
   * run control or a widget section. Replaces "let blocks parse" sleeps.
   */
  async awaitBlocksParsed(): Promise<void> {
    await this.page
      .locator('[data-testid="editor-start-workout"], [data-widget-section-id]')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });
  }

  /**
   * Poll IndexedDB until the note's reconstructed content is readable and
   * (when `expected` is given) contains it. Replaces "let React + IDB load"
   * sleeps after edits.
   */
  async awaitNotePersisted(routeId: string, expected?: string): Promise<void> {
    await expect
      .poll(
        async () => {
          const content = await getNoteContentByRouteId(this.page, routeId);
          if (content === null) return null;
          return expected === undefined || content.includes(expected) ? content : null;
        },
        { timeout: 10_000 },
      )
      .not.toBeNull();
  }

  /**
   * Wait until a runtime flow reaches its terminal review route — the
   * signal version of "let the runtime accumulate logs".
   */
  async awaitRuntimeIdle(): Promise<void> {
    await this.page.waitForURL(/\/review\//, { timeout: 10_000 });
  }

  // ── Editor ───────────────────────────────────────────────────────────────

  /** The main CodeMirror contenteditable surface. */
  editor(): Locator {
    return this.page.locator('.cm-content[contenteditable="true"]').first();
  }

  /** Alias for waitForLoad() — semantically clearer in editor-centric tests. */
  async waitForEditor() {
    await this.waitForLoad();
  }

  /** Return the editor's current innerText. */
  async editorText(): Promise<string> {
    return this.editor().innerText();
  }

  private async codeMirrorView() {
    return this.page.evaluateHandle((): EditorView => {
      const host = document.querySelector('.cm-note-editor') as
        | (HTMLElement & { __codemirrorView?: EditorView })
        | null;
      if (!host?.__codemirrorView) throw new Error('CodeMirror view was not exposed for test automation');
      return host.__codemirrorView;
    });
  }

  /** Clear a test marker and place the caret at its position. */
  async replaceEditorMarker(marker: string): Promise<void> {
    const handle = await this.codeMirrorView();
    try {
      await handle.evaluate((view, text) => {
        const from = view.state.doc.toString().indexOf(text);
        if (from < 0) throw new Error(`Missing editor marker: ${text}`);
        view.dispatch({
          changes: { from, to: from + text.length, insert: '' },
          selection: { anchor: from },
        });
        view.focus();
      }, marker);
    } finally {
      await handle.dispose();
    }
  }

  /** Read the exact document, including syntax hidden by decorations. */
  async editorDoc(): Promise<string> {
    const handle = await this.codeMirrorView();
    try {
      return await handle.evaluate((view) => view.state.doc.toString());
    } finally {
      await handle.dispose();
    }
  }

  /** Append text at the end of the editor. */
  async typeInEditor(text: string) {
    const ed = this.editor();
    await ed.click();
    await this.page.keyboard.press('End');
    await this.page.keyboard.type(text);
  }

  /** Replace the entire editor contents. */
  async replaceEditorContent(text: string) {
    const ed = this.editor();
    await ed.click();
    await this.page.keyboard.press('Control+a');
    await this.page.keyboard.type(text);
  }

  // ── Page chrome ──────────────────────────────────────────────────────────

  /** Primary page heading (sticky header title). */
  title(): Locator {
    return this.page.locator('h1').first();
  }

  // ── Workout actions ──────────────────────────────────────────────────────

  /** Click the "Run" button that appears inside the editor overlay. */
  async startWorkoutFromEditor() {
    const startBtn = this.page
      .locator('[data-testid="editor-start-workout"]')
      .first();
    await startBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await startBtn.click();
  }

  /** Open the actions dropdown (vertical ellipsis in the sticky header). */
  async openActionsMenu() {
    const trigger = this.page
      .locator('div.flex.items-center.gap-2.shrink-0 button, div.flex.items-center.gap-4 button')
      .last();
    await trigger.click();
    await this.page.waitForTimeout(300);
  }

  // ── Assertions ───────────────────────────────────────────────────────────

  async expectEditorContains(text: string) {
    await expect(this.editor()).toContainText(text, { timeout: 5_000 });
  }

  async expectTitleContains(text: string) {
    await expect(this.title()).toContainText(text, { timeout: 5_000 });
  }
}
