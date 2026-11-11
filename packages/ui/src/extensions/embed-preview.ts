import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { EditorState, Facet, StateField, RangeSetBuilder } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import { sectionField } from "./section-state";
import { isEditorFocused, setEditorFocused } from "./editor-focus";

export type AttachmentUrlResolver = (
  target: string,
) => Promise<string | null> | string | null;

export const attachmentUrlFacet = Facet.define<
  AttachmentUrlResolver,
  AttachmentUrlResolver | null
>({
  combine: (values) => (values.length > 0 ? values[values.length - 1] : null),
});

const INLINE_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const CODE_SPAN_RE = /`[^`\n]*`/g;

function isDirectImageUrl(target: string): boolean {
  return (
    /^https?:\/\//i.test(target) ||
    target.startsWith("/") ||
    target.startsWith("blob:")
  );
}

class EmbedSpacerWidget extends WidgetType {
  constructor(readonly height: number) {
    super();
  }

  eq(other: EmbedSpacerWidget): boolean {
    return other.height === this.height;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-embed-spacer";
    el.style.height = `${this.height}px`;
    el.style.pointerEvents = "none";
    return el;
  }

  get estimatedHeight(): number {
    return this.height;
  }

  get block(): boolean {
    return true;
  }
}

class InlineImageWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly target: string,
    readonly standalone: boolean,
  ) {
    super();
  }

  eq(other: InlineImageWidget): boolean {
    return (
      this.alt === other.alt &&
      this.target === other.target &&
      this.standalone === other.standalone
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const outer = document.createElement(this.standalone ? "figure" : "span");
    outer.className = this.standalone
      ? "cm-image-embed cm-image-embed-block py-1.5"
      : "cm-image-embed cm-image-embed-inline";

    const card = document.createElement(this.standalone ? "div" : "span");
    card.className = "cm-image-embed-card";

    const img = document.createElement("img");
    img.alt = this.alt || "Embedded image";
    img.loading = "lazy";
    img.className = "cm-image-embed-img";

    const resolver = view.state.facet(attachmentUrlFacet);
    if (isDirectImageUrl(this.target)) {
      img.src = this.target;
    } else if (resolver) {
      Promise.resolve(resolver(this.target))
        .then((resolved) => {
          if (resolved) {
            img.src = resolved;
          } else {
            card.classList.add("cm-image-embed-missing");
          }
        })
        .catch(() => {
          card.classList.add("cm-image-embed-missing");
        });
    } else {
      img.src = this.target;
    }

    card.appendChild(img);

    if (this.alt) {
      const caption = document.createElement(this.standalone ? "figcaption" : "span");
      caption.className = "cm-image-embed-caption";
      caption.textContent = this.alt;
      card.appendChild(caption);
    }

    outer.appendChild(card);
    return outer;
  }

  get block(): boolean {
    return this.standalone;
  }
}

function buildEmbedDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const { sections } = state.field(sectionField);
  const sel = state.selection.main;
  const canRevealRaw = !state.readOnly && isEditorFocused(state);

  for (const section of sections) {
    if (section.type === "embed" && section.embed?.height) {
      const line = state.doc.line(section.startLine);
      decos.push(
        Decoration.widget({
          widget: new EmbedSpacerWidget(section.embed.height),
          side: 1,
        }).range(line.from),
      );
      continue;
    }

    if (section.type !== "markdown" && section.type !== "embed") continue;
    if (section.type === "markdown" && section.subtype === "table") continue;

    for (let l = section.startLine; l <= section.endLine; l++) {
      const line = state.doc.line(l);
      if (line.text.trimStart().startsWith("|")) continue;
      if (canRevealRaw && sel.from <= line.to && sel.to >= line.from) continue;

      const codeSpans: [number, number][] = [];
      let codeMatch: RegExpExecArray | null;
      CODE_SPAN_RE.lastIndex = 0;
      while ((codeMatch = CODE_SPAN_RE.exec(line.text)) !== null) {
        codeSpans.push([codeMatch.index, codeMatch.index + codeMatch[0].length]);
      }

      INLINE_IMAGE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      const matches: { from: number; to: number; alt: string; target: string }[] = [];
      while ((match = INLINE_IMAGE_RE.exec(line.text)) !== null) {
        const idx = match.index;
        if (codeSpans.some(([a, b]) => idx >= a && idx < b)) continue;
        matches.push({
          from: line.from + idx,
          to: line.from + idx + match[0].length,
          alt: match[1],
          target: match[2],
        });
      }

      const trimmed = line.text.trim();
      for (const img of matches) {
        const standalone =
          matches.length === 1 &&
          img.to - img.from === trimmed.length &&
          line.text.slice(img.from - line.from, img.to - line.from) === trimmed;

        decos.push(
          Decoration.replace({
            widget: new InlineImageWidget(img.alt, img.target, standalone),
            block: standalone,
          }).range(standalone ? line.from : img.from, standalone ? line.to : img.to),
        );
      }
    }
  }

  decos.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const d of decos) {
    builder.add(d.from, d.to, d.value);
  }
  return builder.finish();
}

const embedPreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildEmbedDecorations(state);
  },
  update(deco, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(setEditorFocused))
    ) {
      return buildEmbedDecorations(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const embedPreviewTheme = EditorView.baseTheme({
  ".cm-image-embed-block": {
    display: "block",
    margin: "0",
  },
  ".cm-image-embed-inline": {
    display: "inline-block",
    verticalAlign: "middle",
    maxWidth: "240px",
  },
  ".cm-image-embed-card": {
    display: "inline-flex",
    flexDirection: "column",
    maxWidth: "100%",
    borderRadius: "8px",
    border: "1px solid hsl(var(--border))",
    backgroundColor: "hsl(var(--card))",
    overflow: "hidden",
  },
  ".cm-image-embed-img": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "360px",
    objectFit: "contain",
    backgroundColor: "hsl(var(--muted) / 0.3)",
  },
  ".cm-image-embed-caption": {
    padding: "4px 10px",
    fontSize: "11px",
    color: "hsl(var(--muted-foreground))",
    borderTop: "1px solid hsl(var(--border) / 0.7)",
    backgroundColor: "hsl(var(--card))",
  },
  ".cm-image-embed-missing": {
    padding: "8px 12px",
    fontSize: "11px",
    color: "hsl(var(--muted-foreground))",
  },
});

export const embedPreviewDecorations: Extension = [
  embedPreviewField,
  embedPreviewTheme,
];
