import { afterEach, describe, expect, it, mock } from 'bun:test';
/**
 * #944 — write-on-completion: when NoteEditor's runtime completes a workout,
 * the note gains a ```query:table fence carrying `rows:{result:<id>}` directly
 * after the workout block, stacking newest-first across re-runs; the same id
 * is threaded to onCompleteWorkout so persistence records the result the
 * table references.
 *
 * FullscreenTimer is mocked at the seam MarkdownCanvasPage.test uses — the
 * CM6 document, sectionField, and the completion handler stay real.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ScriptBlock, Sessions } from '@/components/Editor/types';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import { StorageService } from '@/services/storage/StorageService';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
let persistence = new IndexedDBNotePersistence(new StorageService(new InMemoryStorage()));

const sampleResults: Sessions = {
  completed: true,
  startTime: 1_700_000_000_000,
  endTime: 1_700_000_005_000,
  duration: 5_000,
  logs: [],
  metrics: [],
} as unknown as Sessions;

// The mock mimics the real overlay's retry seam: it keeps the last reported
// payload and can re-send the SAME report (same block id + results object),
// which is how FullscreenTimer drives the same-id Retry save.
let lastReport: { blockId: string; results: Sessions } | null = null;

mock.module('@/components/organisms/review/FullscreenTimer', () => ({
  FullscreenTimer: (props: {
    block: ScriptBlock;
    onCompleteWorkout: (blockId: string, results: Sessions) => void | Promise<unknown>;
  }) => (
    <>
      <button
        data-testid="complete-workout"
        onClick={() => {
          lastReport = { blockId: props.block.id, results: sampleResults };
          void Promise.resolve(props.onCompleteWorkout(lastReport.blockId, lastReport.results)).catch(() => {});
        }}
      >
        complete
      </button>
      <button
        data-testid="retry-workout"
        onClick={() => {
          if (lastReport) void Promise.resolve(props.onCompleteWorkout(lastReport.blockId, lastReport.results)).catch(() => {});
        }}
      >
        retry
      </button>
    </>
  ),
}));


// Lives in the playground tree on purpose: `bun test ./src` shares one module
// registry per process and sibling suites stub '@/services/analytics/query'
// without runRows, which crashes the QueryBlockView this test mounts. The
// playground suite runs each file in its own process (tests/run-isolated.ts),
// so the real query module loads cleanly here.

import { NoteEditor } from '@/components/organisms/editor/NoteEditor';

// CM6 measures via the jsdom window, not globalThis — polyfill both.
(window as any).requestAnimationFrame ??= (cb: FrameRequestCallback) => setTimeout(cb, 0);
(window as any).cancelAnimationFrame ??= (id: number) => clearTimeout(id);
// scrollIntoView schedules a CM6 measure pass, which reads text rects jsdom
// doesn't implement.
const zeroRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
(window.Range.prototype as any).getClientRects ??= () => [];
(window.Range.prototype as any).getBoundingClientRect ??= () => zeroRect;
(window.Element.prototype as any).getClientRects ??= () => [];

const DOC = 'Intro prose.\n\n```time\n5s\n```\n\nTrailing notes.';

afterEach(() => { cleanup(); persistence = new IndexedDBNotePersistence(new StorageService(new InMemoryStorage())); });

function renderEditor(onChange: (value: string) => void, value = DOC) {
  const onCompleteWorkout = mock((_blockId: string, _results: Sessions | undefined, _resultId?: string): void => {});
  render(
    <NoteEditor
      value={value}
      onChange={onChange}
      noteId="journal/2026-08-02"
      notePersistence={persistence}
      sourceRevision={0}
      onCompleteWorkout={onCompleteWorkout}
    />,
  );
  return { onCompleteWorkout };
}

async function completeOneRun() {
  // Open the timer via the block's Run command, then complete it.
  const runButton = await screen.findByText('Run');
  fireEvent.click(runButton);
  const completeButton = await screen.findByTestId('complete-workout');
  fireEvent.click(completeButton);
}

describe('NoteEditor write-on-completion (#944)', () => {
  it('inserts a query:table rows block after the workout block and threads the result id', async () => {
    let latestValue = DOC;
    const onChange = (value: string) => { latestValue = value; };
    const { onCompleteWorkout } = renderEditor(onChange);

    await completeOneRun();

    await waitFor(() => expect(latestValue).toContain('```query:table'));
    const match = /:session\{result:([0-9a-f-]+)\}/.exec(latestValue);
    expect(match).not.toBeNull();
    expect(latestValue).toContain(
      '```time\n5s\n```\n\n```query:table\n:session{result:' + match![1] + '}\n```\n\nTrailing notes.',
    );
    // The table references the id persistence is told to record.
    expect(onCompleteWorkout).toHaveBeenCalledTimes(1);
    expect(onCompleteWorkout.mock.calls[0][2]).toBe(match![1]);
    // The completed block's identity rides along so persistence records the
    // result against the right block without relying on session selection.
    const runBlock = onCompleteWorkout.mock.calls[0][3] as { id: string; contentId?: string } | undefined;
    expect(runBlock).toBeDefined();
    expect(runBlock!.contentId).toBeTruthy();
    expect(runBlock!.id).toBe(onCompleteWorkout.mock.calls[0][0]);
  });

  it('stacks a re-run newest-first between the workout block and the prior table', async () => {
    let latestValue = DOC;
    const onChange = (value: string) => { latestValue = value; };
    const { onCompleteWorkout } = renderEditor(onChange);

    await completeOneRun();
    await waitFor(() => expect(latestValue).toContain('```query:table'));
    const firstId = /:session\{result:([0-9a-f-]+)\}/.exec(latestValue)![1];

    await completeOneRun();
    await waitFor(() => {
      const ids = [...latestValue.matchAll(/:session\{result:([0-9a-f-]+)\}/g)].map(m => m[1]);
      expect(ids.length).toBe(2);
    });
    const ids = [...latestValue.matchAll(/:session\{result:([0-9a-f-]+)\}/g)].map(m => m[1]);
    expect(ids[1]).toBe(firstId);
    expect(ids[0]).not.toBe(firstId);
    expect(onCompleteWorkout).toHaveBeenCalledTimes(2);
    expect(onCompleteWorkout.mock.calls[1][2]).toBe(ids[0]);
  });

  it('same-report retry after a failed save reuses the result id and never stacks a second table', async () => {
    let latestValue = DOC;
    const onChange = (value: string) => { latestValue = value; };
    let calls = 0;
    // First save rejects (persistence failure), the retry resolves — the
    // exact sequence the overlay's Retry button drives against one payload.
    const onCompleteWorkout = mock(
      (_blockId: string, _results?: Sessions, _resultId?: string): Promise<unknown> => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('write failed')) : Promise.resolve();
      },
    );
    lastReport = null;
    render(
      <NoteEditor
        value={DOC}
        onChange={onChange}
        noteId="journal/2026-08-02"
        notePersistence={persistence}
        sourceRevision={0}
        onCompleteWorkout={onCompleteWorkout}
      />,
    );

    await completeOneRun();
    await waitFor(() => expect(latestValue).toContain('```query:table'));
    const resultId = /:session\{result:([0-9a-f-]+)\}/.exec(latestValue)![1];
    expect(calls).toBe(1);
    expect(onCompleteWorkout.mock.calls[0][2]).toBe(resultId);

    // Retry with the SAME payload: identical id threaded again, still exactly
    // one query:table for the result.
    fireEvent.click(screen.getByTestId('retry-workout'));
    await waitFor(() => expect(calls).toBe(2));
    expect(onCompleteWorkout.mock.calls[1][2]).toBe(resultId);
    expect([...latestValue.matchAll(/:session\{result:([0-9a-f-]+)\}/g)]).toHaveLength(1);

    fireEvent.click(screen.getByTestId('retry-workout'));
    const settled = Promise.withResolvers<void>();
    setTimeout(settled.resolve, 0);
    await settled.promise;
    expect(calls).toBe(2);
    expect([...latestValue.matchAll(/:session\{result:([0-9a-f-]+)\}/g)]).toHaveLength(1);
  });
});
