import { ViewPlugin, ViewUpdate, EditorView } from "@codemirror/view";
import { sectionField, type EditorSection } from "./section-state";

export interface SectionRect {
  sectionId: string;
  top: number;
  height: number;
  /** Rendered height of the section's opening (fence) line — hosts the inline command bar. */
  firstLineHeight?: number;
  type: EditorSection["type"];
  subtype?: EditorSection["subtype"];
  widgetName?: string;
}

export type GeometryListener = (rects: SectionRect[], docVersion: number) => void;
class SectionGeometryPlugin {
  rects: SectionRect[] = [];
  docVersion: number = 0;
  private listeners: Set<GeometryListener> = new Set();
  private pendingNotify: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(private view: EditorView) {
    this.measure();
    if (typeof ResizeObserver !== "undefined" && this.view.contentDOM) {
      this.resizeObserver = new ResizeObserver(() => {
        this.view.requestMeasure();
        this.measure();
      });
      this.resizeObserver.observe(this.view.contentDOM);
    }
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      this.docVersion++;
    }
    if (update.docChanged || update.geometryChanged || update.viewportChanged) {
      this.measure();
    }
  }

  addListener(fn: GeometryListener): () => void {
    this.listeners.add(fn);
    fn(this.rects, this.docVersion);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private measure() {
    try {
      const sectionState = this.view.state.field(sectionField, false);
      const sections = sectionState?.sections ?? [];
      const docLength = this.view.state.doc.length;

      this.rects = sections.map((sec) => {
        const from = Math.max(0, Math.min(sec.from, docLength));
        const to = Math.max(0, Math.min(sec.to, docLength));

        let top = 0;
        let bottom = 20;
        let firstLineHeight: number | undefined;

        try {
          const topBlock = this.view.lineBlockAt(from);
          const bottomBlock = this.view.lineBlockAt(to);
          top = topBlock.top;
          firstLineHeight = topBlock.height;
          bottom = bottomBlock.top + bottomBlock.height;
        } catch {
          // lineBlockAt fallback
        }

        const height = Math.max(bottom - top, 20);

        return {
          sectionId: sec.id,
          top,
          height,
          firstLineHeight,
          type: sec.type,
          subtype: sec.subtype,
          widgetName: sec.widgetName,
        };
      });

      this.notify();
    } catch {
      // Best-effort measurement
    }
  }

  private notify() {
    if (typeof requestAnimationFrame === 'function') {
      if (this.pendingNotify !== null) return;
      this.pendingNotify = requestAnimationFrame(() => {
        this.pendingNotify = null;
        for (const listener of this.listeners) {
          listener(this.rects, this.docVersion);
        }
      });
    } else {
      for (const listener of this.listeners) {
        listener(this.rects, this.docVersion);
      }
    }
  }

  destroy() {
    if (this.pendingNotify !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.pendingNotify);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.listeners.clear();
  }
}

export const sectionGeometry = ViewPlugin.fromClass(SectionGeometryPlugin);
