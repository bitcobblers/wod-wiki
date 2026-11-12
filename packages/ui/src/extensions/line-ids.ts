import { Decoration, ViewPlugin, ViewUpdate, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

/**
 * Extension that adds ID attributes to line elements in the editor.
 */
export const lineIdsExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.getDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.getDecorations(update.view);
      }
    }

    getDecorations(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>();
      const { doc } = view.state;

      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;
        const trimmed = text.trim();

        let id: string | null = null;

        const headerMatch = text.match(/^(#{1,6})\s+(.*)$/);
        if (headerMatch) {
          let label = headerMatch[2].trim();
          const timeMatch = label.match(/(\d{1,2}:\d{2})/);
          if (timeMatch) {
            const timestamp = timeMatch[1];
            label = label.replace(timestamp, "").replace(/\s+/g, " ").trim();
            if (!label) label = timestamp;
          }
          id = label.toLowerCase().replace(/[^\w]+/g, "-");
        } else if (/^```(time|wod|whiteboard|log)/i.test(trimmed)) {
          id = `workout-line-${i}`;
        }

        if (id && line.from >= view.viewport.from && line.to <= view.viewport.to) {
          builder.add(
            line.from,
            line.from,
            Decoration.line({
              attributes: { id },
            }),
          );
        }
      }

      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
