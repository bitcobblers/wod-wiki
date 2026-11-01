import { afterEach, describe, expect, it, mock } from 'bun:test';
/**
 * Executor wiring regression: the ```query:table blocks NoteEditor renders
 * (queryBlockPreview) must execute against the app's QueryService singleton.
 * The UI package is store-free — it only renders what the injected executor
 * returns — so without the wiring every query block spins "Loading rows…"
 * forever, including the table auto-inserted on workout completion (#944).
 * This locks the seam: runRows is called with the block's parsed query and
 * the result renders; a late result save (onResultSaved notification) re-runs.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const runFind = mock(async (parsed: { filters: { key: string; values: { value: string }[] }[] }) => ({
  parsed,
  runs: [],
  notes: [],
  blocks: [],
}));

mock.module('@/services/queryService', () => ({
  queryService: {
    runFind,
    runQuery: async () => ({ parsed: {}, series: [] }),
  },
}));

import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { notifyResultSaved } from '@/services/resultRecorder';

// CM6 measures via the jsdom window — same polyfills as the completion suite.
(window as any).requestAnimationFrame ??= (cb: FrameRequestCallback) => setTimeout(cb, 0);
(window as any).cancelAnimationFrame ??= (id: number) => clearTimeout(id);
const zeroRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
(window.Range.prototype as any).getClientRects ??= () => [];
(window.Range.prototype as any).getBoundingClientRect ??= () => zeroRect;
(window.Element.prototype as any).getClientRects ??= () => [];

const DOC = 'Intro prose.\n\n```query:table\n:session{result:abc-123}\n```\n';

afterEach(() => cleanup());

describe('NoteEditor query block executor wiring', () => {
  it('executes rows blocks instead of spinning "Loading rows…" forever', async () => {
    render(<NoteEditor value={DOC} onChange={() => {}} noteId="journal/2026-08-02" />);

    // The block rendered (cursor sits outside it) and actually executed:
    // the resolved empty result paints RowsTable's empty state.
    expect(await screen.findByText('No workout logs matched this rows query.')).toBeDefined();
    expect(screen.queryByText('Loading rows…')).toBeNull();

    // The executor saw the block's result scope.
    await waitFor(() => expect(runFind).toHaveBeenCalled());
    const parsed = runFind.mock.calls[0][0] as { filters: { key: string; values: { value: string }[] }[] };
    const scope = parsed.filters.find((f) => f.key === 'result');
    expect(scope?.values[0]?.value).toBe('abc-123');
  });

  it('re-runs the query when a workout result is saved', async () => {
    render(<NoteEditor value={DOC} onChange={() => {}} noteId="journal/2026-08-02" />);
    await screen.findByText('No workout logs matched this rows query.');

    runFind.mock.calls.length = 0;
    notifyResultSaved({ id: 'r1' } as never);
    await waitFor(() => expect(runFind).toHaveBeenCalled());
  });

  it('reconciles mismatched or empty initial blocks without throwing Incomplete actionable block map', () => {
    const docWithTimer = '# My Note\n\n```time\n10:00\n```\n';
    expect(() => {
      render(
        <NoteEditor
          value={docWithTimer}
          noteBlocks={{}}
          sourceRevision={1}
          onChange={() => {}}
        />,
      );
    }).not.toThrow();
    expect(screen.getByRole('textbox')).toBeDefined();
  });
});
