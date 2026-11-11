import { expect, userEvent, waitFor, within } from 'storybook/test';

export type StoryCanvas = ReturnType<typeof within>;

/**
 * Reusable component-level Storybook `play()` helpers operating over isolated
 * domain states (`parameters.domainState`).
 */
export const storyActions = {
  withinStory(canvasElement: HTMLElement): StoryCanvas {
    return within(canvasElement);
  },

  /** Wait until `StoryDomainStateProvider` finishes in-memory hydration. */
  async waitForHydrated(canvasElement: HTMLElement): Promise<StoryCanvas> {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.queryByTestId('story-domain-state-loading')).toBeNull();
    });
    return canvas;
  },

  /** Select a Scoped Property Override target inside `PropertyOverrideSheet`. */
  async selectOverrideScope(canvasOrBody: StoryCanvas, targetNotebookId: string): Promise<void> {
    const targetButton = await canvasOrBody.findByTestId(`override-target-${targetNotebookId}`);
    await userEvent.click(targetButton);
  },

  /** Toggle Notebook membership inside `NotePromotionSheet`. */
  async toggleNotebookPromotion(canvasOrBody: StoryCanvas, notebookId: string): Promise<void> {
    const chip = await canvasOrBody.findByTestId(`promotion-notebook-chip-${notebookId}`);
    const button = chip.querySelector('button') ?? chip;
    await userEvent.click(button);
  },

  /** Toggle public visibility of a user Notebook inside `NotePromotionSheet`. */
  async toggleNotebookPublic(canvasOrBody: StoryCanvas, slugOrNotebookId?: string): Promise<void> {
    const slug = slugOrNotebookId?.replace(/^notebook\//, '');
    const toggle =
      (slug ? canvasOrBody.queryByTestId(`publication-notebook-public-toggle-${slug}`) : null) ??
      (await canvasOrBody.findByTestId('publication-notebook-public-toggle'));
    await userEvent.click(toggle);
  },

  /** Toggle public telemetry opt-in for a recorded Session inside `NotePromotionSheet`. */
  async toggleSessionPublic(canvasOrBody: StoryCanvas, sessionId: string): Promise<void> {
    const toggle = await canvasOrBody.findByTestId(`publication-session-toggle-${sessionId}`);
    await userEvent.click(toggle);
  },

  /** Click a recorded Session row inside `SessionExplorerPage` by Note title or Session ID. */
  async selectSessionRow(canvas: StoryCanvas, titleOrId: string): Promise<void> {
    const byTestId = canvas.queryByTestId(`session-row-${titleOrId}`);
    if (byTestId) {
      await userEvent.click(byTestId);
      return;
    }
    const row = await canvas.findByRole('row', { name: new RegExp(titleOrId, 'i') });
    await userEvent.click(row);
  },
};
