import { describe, it, expect } from "bun:test";
import { EditorState } from "@codemirror/state";
import { sectionField } from "@bitcobblers/wod-wiki-ui/extensions";
import {
  cursorFocusExtension,
  getCursorFocusState,
} from "./cursorFocusExtension";
import { MetricType } from "@bitcobblers/wod-wiki-engine";
import { setTagIndex } from "@/services/tags/tagCatalogue";
import { catalogueReload } from "@/app/editor/catalogueReload";

describe("cursorFocusExtension", () => {
  it("assigns token-level metric highlight marks based on parser metrics", () => {
    const doc = [
      "# Repro Note",
      "",
      "```time",
      "Timer: 1:00",
      "10 Pushups",
      "20m Row @2:00/500m",
      "Round x 5:",
      "  rest 1:00",
      "```",
      "",
    ].join("\n");

    const state = EditorState.create({
      doc,
      extensions: [sectionField, cursorFocusExtension],
    });

    const focus = getCursorFocusState(state);
    // Cursor is at doc start (outside workout section)
    expect(focus).toBeNull();

    // Now position cursor inside line "10 Pushups" (around "Pushups")
    const pushupsPos = doc.indexOf("Pushups") + 2;
    const activeState = state.update({
      selection: { anchor: pushupsPos },
    }).state;

    const activeFocus = getCursorFocusState(activeState);
    expect(activeFocus).not.toBeNull();
    expect(activeFocus?.statement).toBeDefined();
    expect(activeFocus?.focusedMetric?.type).toBe(MetricType.Effort);

    // Read decorations directly from StateField to inspect all token mark ranges
    const internalStateField = (cursorFocusExtension as unknown as StateField<unknown>[])[0];
    const decos = activeState.field(internalStateField).decos;

    const markRanges: { from: number; to: number; text: string; cls: string }[] = [];
    const iter = decos.iter();
    while (iter.value) {
      if ((iter.value.spec as unknown as { class?: string }).class) {
        markRanges.push({
          from: iter.from,
          to: iter.to,
          text: doc.slice(iter.from, iter.to),
          cls: (iter.value.spec as unknown as { class: string }).class,
        });
      }
      iter.next();
    }

    // Verify token-level ranges (NOT whole lines!)
    const durationMarks = markRanges.filter((m) => m.cls.includes("duration"));
    expect(durationMarks.some((m) => m.text === "1:00")).toBe(true);
    expect(durationMarks.some((m) => m.text === "2:00")).toBe(true);

    const repMarks = markRanges.filter((m) => m.cls.includes("rep"));
    expect(repMarks.some((m) => m.text === "10")).toBe(true);
    expect(repMarks.some((m) => m.text === "5")).toBe(true);

    const effortMarks = markRanges.filter((m) => m.cls.includes("effort"));
    expect(effortMarks.some((m) => m.text === "Pushups")).toBe(true);
    expect(effortMarks.some((m) => m.text === "Row")).toBe(true);
    expect(effortMarks.some((m) => m.text === "rest")).toBe(true);

    const distanceMarks = markRanges.filter((m) => m.cls.includes("distance"));
    expect(distanceMarks.some((m) => m.text === "20m")).toBe(true);
    expect(distanceMarks.some((m) => m.text === "500m")).toBe(true);

    // Active line tokens ("10 Pushups") should have full-opacity classes, while other lines have -dim classes
    const activePushupsMark = markRanges.find((m) => m.text === "Pushups");
    expect(activePushupsMark?.cls).toBe("cm-metric-underline-effort");

    const activeRepMark = markRanges.find((m) => m.text === "10");
    expect(activeRepMark?.cls).toBe("cm-metric-underline-rep");

    const dimDurationMark = markRanges.find((m) => m.text === "2:00");
    expect(dimDurationMark?.cls).toBe("cm-metric-underline-duration-dim");
  });

  it("marks a tag reference as a hashtag", () => {
    setTagIndex([
      {
        id: "tag-heavy",
        label: "heavy",
        contributions: [{ kind: "metric", type: "intensity", value: "heavy" }],
      },
    ]);

    const doc = ["# Repro Note", "", "```time", "10 Pushups #heavy", "```", ""].join("\n");
    const state = EditorState.create({
      doc,
      extensions: [sectionField, cursorFocusExtension],
    });

    const activeState = state.update({
      selection: { anchor: doc.indexOf("Pushups") + 2 },
    }).state;

    const internalStateField = (cursorFocusExtension as unknown as StateField<unknown>[])[0];
    const decos = activeState.field(internalStateField).decos;

    const markRanges: { from: number; to: number; text: string; cls: string }[] = [];
    const iter = decos.iter();
    while (iter.value) {
      const cls = (iter.value.spec as unknown as { class?: string }).class;
      if (cls) {
        markRanges.push({
          from: iter.from,
          to: iter.to,
          text: doc.slice(iter.from, iter.to),
          cls,
        });
      }
      iter.next();
    }

    // The tag reference is a hashtag, not a metric mark.
    const tagMarks = markRanges.filter((m) => m.cls.includes("tag-reference"));
    expect(tagMarks.some((m) => m.text === "#heavy")).toBe(true);
    expect(tagMarks[0]?.cls).toBe("cm-tag-reference");

    // The metric the tag brought is not marked as a metric of its own kind.
    expect(markRanges.some((m) => m.text === "#heavy" && m.cls.includes("underline"))).toBe(false);
  });

  it("redraws the marks when a catalogue loads", () => {
    // The catalogue lives in async storage: the editor is already on screen
    // when it lands, so the marks have to be redrawn when it does.
    setTagIndex([]);

    const doc = ["# Repro Note", "", "```time", "10 Pushups #heavy", "```", ""].join("\n");
    const state = EditorState.create({
      doc,
      extensions: [sectionField, cursorFocusExtension],
    });

    const marksIn = (s: EditorState) => {
      const field = (cursorFocusExtension as unknown as StateField<unknown>[])[0];
      const decos = s.field(field).decos;
      const out: string[] = [];
      const iter = decos.iter();
      while (iter.value) {
        const cls = (iter.value.spec as unknown as { class?: string }).class;
        if (cls) out.push(cls);
        iter.next();
      }
      return out;
    };

    expect(marksIn(state).some((cls) => cls.includes("tag-reference"))).toBe(false);

    // The catalogue arrives.
    setTagIndex([
      {
        id: "tag-heavy",
        label: "heavy",
        contributions: [{ kind: "metric", type: "intensity", value: "heavy" }],
      },
    ]);
    const reloaded = state.update({ effects: catalogueReload.of(null) }).state;

    expect(marksIn(reloaded).some((cls) => cls.includes("tag-reference"))).toBe(true);
  });

  it('focuses metrics owned by both statements on an inline rounds line', () => {
    const doc = '```time\n5x5 Back Squat @100kg\n```';
    const state = EditorState.create({ doc, extensions: [sectionField, cursorFocusExtension] });
    for (const [token, type] of [['5x5', MetricType.Rounds], ['Back Squat', MetricType.Effort], ['@100kg', MetricType.Resistance]] as const) {
      const focused = getCursorFocusState(state.update({ selection: { anchor: doc.indexOf(token) + 1 } }).state);
      expect(focused?.focusedMetric?.type).toBe(type);
      expect(focused?.statement?.metricMeta.has(focused.focusedMetric!)).toBe(true);
    }
  });

  it("updates focus state when cursor moves between lines", () => {
    const doc = [
      "```time",
      "10 Pushups",
      "20m Row",
      "```",
    ].join("\n");

    const state = EditorState.create({
      doc,
      extensions: [sectionField, cursorFocusExtension],
    });

    const pushupsState = state.update({
      selection: { anchor: doc.indexOf("Pushups") },
    }).state;

    const pushupsFocus = getCursorFocusState(pushupsState);
    expect(pushupsFocus?.statement).toBeDefined();
    expect(pushupsFocus?.focusedMetric?.type).toBe(MetricType.Effort);

    const rowState = state.update({
      selection: { anchor: doc.indexOf("20m") },
    }).state;

    const rowFocus = getCursorFocusState(rowState);
    expect(rowFocus?.statement).toBeDefined();
    expect(rowFocus?.focusedMetric?.type).toBe(MetricType.Distance);
  });
});
