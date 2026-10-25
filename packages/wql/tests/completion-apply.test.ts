// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  autocompletion,
  acceptCompletion,
  completionStatus,
  currentCompletions,
  setSelectedCompletion,
  startCompletion,
} from '@codemirror/autocomplete';
import { wqlCompletionSource } from '../src/language';
import { parseQuery } from '../src/wql';

// jsdom lacks ResizeObserver, which the CM viewport/tooltip measurement expects.
class ResizeObserverStub { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver ??= ResizeObserverStub;
// jsdom's Range has no layout geometry; CM measures it for tooltip placement.
const ZERO_RECT: DOMRect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ZERO_RECT };
const EMPTY_RECTS: DOMRectList = { length: 0, item: () => null, *[Symbol.iterator]() {} };
Range.prototype.getClientRects ??= () => EMPTY_RECTS;
Range.prototype.getBoundingClientRect ??= () => ZERO_RECT;

const EFFORTS = ['thruster'];

/** Real editor wired exactly like production `wql()` — the source override plus
 *  autocompletion; interactionDelay 0 so an immediate acceptCompletion is honored. */
function makeView(doc: string): EditorView {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new EditorView({
    parent: container,
    state: EditorState.create({
      doc,
      extensions: [
        autocompletion({
          override: [wqlCompletionSource({ effortNames: () => EFFORTS })],
          interactionDelay: 0,
        }),
      ],
    }),
  });
}

/** Explicitly start completion at the end of the doc and return what is offered. */
async function openCompletions(view: EditorView, pos = view.state.doc.length): Promise<string[]> {
  view.dispatch({ selection: { anchor: pos } });
  startCompletion(view);
  await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'));
  return currentCompletions(view.state).map((o) => o.label);
}

/** Select the named option through the real completion state and accept it. */
async function accept(view: EditorView, label: string, pos?: number): Promise<void> {
  const offered = await openCompletions(view, pos);
  const index = offered.indexOf(label);
  if (index < 0) throw new Error(`'${label}' not offered; got [${offered.join(', ')}]`);
  view.dispatch({ effects: setSelectedCompletion(index) });
  expect(acceptCompletion(view)).toBe(true);
}

/** Simulate typing text at the end of the doc. */
function type(view: EditorView, text: string): void {
  const end = view.state.doc.length;
  view.dispatch({ changes: { from: end, insert: text }, selection: { anchor: end + text.length } });
}

afterEach(() => {
  for (const el of [...document.body.children]) el.remove();
});

describe('wqlCompletionSource — apply and parse', () => {
  it('offers no construct that applies into a parser conflict, and every offered suffix applies to a parser-valid query', async () => {
    // After a complete by-group the duplicate by {} must be gone; the window
    // keyword that IS offered must build a parse-clean query when finished.
    const byView = makeView(':note by {session} ');
    expect(await openCompletions(byView)).toEqual(['last', 'from', '|']);
    await accept(byView, 'last');
    await accept(byView, '4w');
    expect(byView.state.doc.toString()).toBe(':note by {session} last 4w');
    expect(parseQuery(byView.state.doc.toString()).error).toBeUndefined();
    byView.destroy();

    // Duplicate .rollup suppressed; the offered by {} applies into a valid group.
    const rollupView = makeView('sum:tis{}.rollup(4w) ');
    expect(await openCompletions(rollupView)).toEqual(['by {}', 'last', 'from']);
    await accept(rollupView, 'by {}');
    expect(rollupView.state.doc.toString()).toBe('sum:tis{}.rollup(4w) by ');
    type(rollupView, '{');
    await accept(rollupView, 'day');
    type(rollupView, 'session}');
    const byDoc = rollupView.state.doc.toString();
    expect(byDoc).toBe('sum:tis{}.rollup(4w) by {day, session}');
    expect(parseQuery(byDoc).error).toBeUndefined();
    rollupView.destroy();

    // Window consumed: both window keywords suppressed; rollup still offered.
    const windowView = makeView(':note last 4w ');
    expect(await openCompletions(windowView)).toEqual(['by {}', '|']);
    windowView.destroy();
  });

  it('the offered .rollup() applies and its period completes to a parse-valid aggregate', async () => {
    const view = makeView('sum:tis by {day} ');
    expect(await openCompletions(view)).toEqual(['.rollup()', 'last', 'from']);
    await accept(view, '.rollup()');
    expect(view.state.doc.toString()).toBe('sum:tis by {day} .rollup(');
    await accept(view, '4w');
    type(view, ')');
    const doc = view.state.doc.toString();
    expect(doc).toBe('sum:tis by {day} .rollup(4w)');
    const parsed = parseQuery(doc);
    expect(parsed.error).toBeUndefined();
    view.destroy();
  });

  it('the offered from chain applies through to the end date into a parse-valid range', async () => {
    const view = makeView(':note by {session} ');
    await accept(view, 'from');
    expect(view.state.doc.toString()).toBe(':note by {session} from ');
    await accept(view, '2026-01-01');
    await accept(view, 'to');
    await accept(view, '2026-03-31');
    const doc = view.state.doc.toString();
    expect(doc).toBe(':note by {session} from 2026-01-01 to 2026-03-31');
    expect(parseQuery(doc).error).toBeUndefined();
    view.destroy();
  });

  it('does not duplicate a separator already after the cursor', async () => {
    const view = makeView(':note las ');
    await accept(view, 'last', ':note las'.length);
    expect(view.state.doc.toString()).toBe(':note last ');
    type(view, '4w');
    expect(parseQuery(view.state.doc.toString()).error).toBeUndefined();
    view.destroy();
  });

  it('accepting an offered filter key chains its colon and the value completes parse-valid', async () => {
    const view = makeView(':note{so');
    await accept(view, 'source');
    expect(view.state.doc.toString()).toBe(':note{source:');
    await accept(view, 'journal');
    type(view, '}');
    const doc = view.state.doc.toString();
    expect(doc).toBe(':note{source:journal}');
    const parsed = parseQuery(doc);
    expect(parsed.error).toBeUndefined();
    expect(JSON.stringify(parsed)).toContain('journal');
    view.destroy();
  });
});
