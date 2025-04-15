import { RuntimeEvent, ITimerRuntime, IRuntimeAction, StatementNode } from "@/core/timer.types";
import { EventHandler } from "@/core/runtime/EventHandler";

/**
 * SaveHandler: Handles 'save' events by generating a Markdown (.md) file from the current workout script
 * and triggering a browser download. Integrates with the Runtime event/action system.
 *
 * SOLID: Single responsibility (file generation), open for extension (different formats),
 * easy to test and maintain.
 */
export class SaveHandler extends EventHandler {
  protected eventType: string = 'save';

  protected handleEvent(event: RuntimeEvent, stack: StatementNode[], runtime: ITimerRuntime): IRuntimeAction[] {
    // 1. Get the workout script or data to be saved (assume event.script or runtime.scriptText)
    const scriptText = `${runtime.code}\n\n${runtime.trace?.history.join('\n')}`;
    // 2. Generate a filename with timestamp
    const date = new Date();
    const iso = date.toISOString().replace(/[:.]/g, '-');
    const filename = `wod-wiki-workout-${iso}.md`;
    // 3. Trigger download (browser only)
    triggerMarkdownDownload(scriptText, filename);
    // 4. Optionally, return a UI action or notification
    return [];
  }
}

/**
 * Utility to trigger a Markdown file download in the browser.
 * @param content Markdown content
 * @param filename Name of the file to save as
 */
function triggerMarkdownDownload(content: string, filename: string) {
  // Create a blob and anchor element
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}
