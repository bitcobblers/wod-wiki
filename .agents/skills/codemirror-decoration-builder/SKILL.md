---
name: codemirror-decoration-builder
description: A specialized guide for building CodeMirror 6 (CM6) decorations to create a unified Markdown and WhiteboardScript editing experience. Use this when implementing block-level previews, syntax feedback, or structural visualizations in the editor.
---

# CodeMirror 6 Decoration Builder

This skill provides a procedural framework for implementing complex document visualizations using the CodeMirror 6 (CM6) decoration system.

## Core Decoration Types

Identify the appropriate decoration type based on the desired UI behavior:

| UI Behavior | CM6 Decoration Type | Use Case |
| :--- | :--- | :--- |
| **Block-level Preview** | `Decoration.replace` | Replace unfocused WhiteboardScript or Markdown blocks with a rendered preview widget. |
| **Syntax Feedback** | `Decoration.mark` | Apply CSS classes (e.g., underlines) to text ranges for errors or highlights. |
| **Line Highlighting** | `Decoration.line` | Style the entire background or border of a line (e.g., active block highlight). |
| **Inlay Hints / Emojis** | `Decoration.widget` | Insert non-editable DOM elements (e.g., metric emojis, gutter buttons) at specific positions. |

## Implementation Workflows

### 1. Block-Level Preview (`Decoration.replace`)
To implement a "preview-on-blur, edit-on-focus" behavior:

1.  **Define a Widget**: Extend `WidgetType` to render your React component or HTML.
    ```typescript
    class PreviewWidget extends WidgetType {
      constructor(readonly content: string) { super(); }
      toDOM() {
        const div = document.createElement("div");
        div.className = "cm-block-preview";
        // Render preview (e.g., via React.render or innerHTML)
        return div;
      }
      eq(other: PreviewWidget) { return this.content === other.content; }
    }
    ```
2.  **Monitor Selection**: In a `ViewPlugin` or `StateField`, check if the `view.state.selection.main` is within the block range.
3.  **Apply Decoration**: If the selection is *outside* the range, add `Decoration.replace({ widget: new PreviewWidget(...) })` to the range.

### 2. Syntax Feedback & Linting (`Decoration.mark`)
To highlight errors directly in the text:

1.  **Map Errors to Ranges**: Run the WhiteboardScript parser to get a list of error ranges.
2.  **Create Marks**:
    ```typescript
    const errorMark = Decoration.mark({
      class: "cm-error-underline",
      attributes: { title: "Invalid metric syntax" }
    });
    ```
3.  **Build DecorationSet**: Use `RangeSetBuilder` to efficiently assemble the marks.

### 3. Structural Visualization (`Decoration.line` & `Decoration.widget`)
To show parent-child relationships and indentation:

- **Indentation Guides**: Apply `Decoration.line({ class: "cm-indent-level-1" })`.
- **Relationship Markers**: Use `Decoration.widget({ side: -1, widget: new BracketWidget() })` at the start of a block to show logical grouping.

## Best Practices
- **Efficiency**: Always use `RangeSetBuilder` for building large sets of decorations.
- **State Fields vs. View Plugins**: Use `StateField` for decorations that depend only on document content (e.g., linting); use `ViewPlugin` for decorations that depend on viewport or focus/selection state (e.g., block preview).
- **Widget Equality**: Implement `eq()` in `WidgetType` to prevent unnecessary DOM re-renders.
- **Side Property**: Use `side: -1` for widgets that should stay to the left of the cursor and `side: 1` for those to the right.
