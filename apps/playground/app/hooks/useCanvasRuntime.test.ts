/**
 * useCanvasRuntime.test.ts — consumer-behavior tests for the canvas run wrapper.
 *
 * Pins the consumer-visible contract guide/canvas pages rely on: the editor
 * only opens after the snapshot save succeeds, completion records exactly
 * once, and a failed completion save keeps the timer open with outputs
 * preserved (retry by completing again).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'

import type { ScriptBlock, Sessions } from '@/components/Editor/types'
import type { RecordResultInput, ResultRecorder } from '@/services/resultRecorder'
import type { PlaygroundIntake } from '../services/createPlaygroundPage';
import { useCanvasRuntime } from './useCanvasRuntime'
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import { StorageService } from '@/services/storage/StorageService';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
let persistence = new IndexedDBNotePersistence(new StorageService(new InMemoryStorage()));
mock.module('@/services/persistence', () => ({
  notePersistence: {
    getNote: (...args: Parameters<IndexedDBNotePersistence['getNote']>) => persistence.getNote(...args),
    startSession: (...args: Parameters<IndexedDBNotePersistence['startSession']>) => persistence.startSession(...args),
  },
}));

const toasts: Array<{ title: string }> = []
const snapshotDocs: string[] = []
mock.module('@/hooks/use-toast', () => ({ toast: (args: { title: string }) => { toasts.push(args) } }))

let snapshotCount = 0
let failSnapshot = false
mock.module('../services/createPlaygroundPage', () => ({
  playgroundIntake: {
    snapshotEntry: async (content: string) => {
      if (failSnapshot) {
        failSnapshot = false
        throw new Error('idb full')
      }
      snapshotCount += 1
      snapshotDocs.push(content)
      await persistence.saveNote({ noteId: `note-${snapshotCount}`, rawContent: content, blocks: reconcileNoteBlocks(content, { sourceRevision: 1, createId: () => 'blk-1' }), expectedSourceRevision: 0, metadata: { title: 'Syntax Basics' } });
      return { noteId: `note-${snapshotCount}`, routeId: `playground/snap-${snapshotCount}` }
    },
  } satisfies Pick<PlaygroundIntake, 'snapshotEntry'>,
}))

const recorded: RecordResultInput[] = []
let failRecord = false
mock.module('@/services/resultRecorder', () => ({
  playgroundRecorder: {
    record: async (input: RecordResultInput) => {
      if (failRecord) {
        failRecord = false
        throw new Error('idb full')
      }
      recorded.push(input)
      return input as never
    },
  } satisfies Pick<ResultRecorder, 'record'>,
}))

// Mock factories close over module-scope state — reset it per test or
// counters/arrays leak across cases (bun runs a file's tests in one process).
beforeEach(() => {
  snapshotCount = 0
  persistence = new IndexedDBNotePersistence(new StorageService(new InMemoryStorage()));
  failSnapshot = false
  failRecord = false
  recorded.length = 0
  toasts.length = 0
  snapshotDocs.length = 0
})

const block: ScriptBlock = {
  id: 'blk-1',
  startLine: 1,
  endLine: 3,
  content: 'AMRAP 5:00',
  state: 'idle',
  widgetIds: {},
  version: 1,
  createdAt: 0,
}

const results = (completed: boolean): Sessions => ({
  startTime: 1_000,
  endTime: 61_000,
  duration: 60_000,
  completed,
})

function setup() {
  return renderHook(() =>
    useCanvasRuntime({
      title: 'Syntax Basics',
      getBlock: () => block,
      getContent: () => '# doc\n```time\nAMRAP 5:00\n```',
    }),
  )
}

describe('useCanvasRuntime — startRun', () => {
  it('persists the snapshot BEFORE opening the fullscreen timer', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.startRun()
    })

    expect(snapshotCount).toBe(1)
    expect(result.current.fullscreen).toMatchObject({ kind: 'timer', block: { id: 'blk-1', dialect: 'time' }, results: null });
    expect(result.current.fullscreen?.block).not.toBe(block);
    expect(result.current.run?.noteId).toBe('note-1')
  });

  it('a failed snapshot save opens nothing and toasts', async () => {
    failSnapshot = true
    const { result } = setup()

    await act(async () => {
      await result.current.startRun()
    })

    expect(result.current.fullscreen).toBeNull()
    expect(result.current.run).toBeNull()
    expect(toasts.at(-1)?.title).toBe('Could not save playground workout')
  });
})

describe('useCanvasRuntime — handleWorkoutComplete', () => {
  it('records exactly once and closes the timer with results', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.startRun()
    })

    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        await result.current.handleWorkoutComplete(results(true))
      })
    }

    expect(recorded.length).toBe(1)
    expect(recorded[0].noteId).toBe('note-1')
    expect(result.current.completedResults).toEqual(results(true))
    expect(result.current.fullscreen).toBeNull()
  });

  it('a failed completion save keeps the timer open; a retry then records the original', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.startRun()
    })
    failRecord = true
    const original = results(true)

    await act(async () => {
      await result.current.handleWorkoutComplete(original)
    })
    expect(toasts.at(-1)?.title).toBe('Could not save workout results')
    expect(result.current.fullscreen).not.toBeNull()
    expect(result.current.completedResults).toBeNull()
    expect(result.current.pendingResults?.results).toBe(original)

    // A later caller offering different outputs must not overwrite the
    // captured first snapshot — the ORIGINAL is what gets saved.
    await act(async () => {
      await result.current.handleWorkoutComplete(results(false))
    })
    expect(recorded.length).toBe(1)
    expect(recorded[0].data).toBe(original)
    expect(result.current.fullscreen).toBeNull()
  });
})

describe('useCanvasRuntime — closeRun (stage exit)', () => {
  it('persists an unrecorded partial before closing the stage', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.startRun()
    })
    const partial = results(false)

    await act(async () => {
      await result.current.closeRun({ results: partial })
    })

    expect(recorded.length).toBe(1)
    expect(recorded[0].data.completed).toBe(false)
    expect(result.current.run).toBeNull()
    expect(result.current.fullscreen).toBeNull()
  });

  it('closing after a recorded run never double-records', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.startRun()
    })
    await act(async () => {
      await result.current.handleWorkoutComplete(results(true))
    })

    await act(async () => {
      await result.current.closeRun({ results: results(false) })
    })

    expect(recorded.length).toBe(1)
    expect(result.current.fullscreen).toBeNull()
  });

  it('a failed partial close keeps the stage open; retry then closes', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.startRun()
    })
    failRecord = true

    await act(async () => {
      await result.current.closeRun({ results: results(false) })
    })
    expect(toasts.at(-1)?.title).toBe('Could not save workout results')
    expect(result.current.fullscreen).not.toBeNull()
    expect(result.current.run).not.toBeNull()

    await act(async () => {
      await result.current.closeRun({ results: results(false) })
    })
    expect(recorded.length).toBe(1)
    expect(result.current.fullscreen).toBeNull()
  });
})

describe('useCanvasRuntime — resetRun', () => {
  it('live reset flips externalStop, records the panel partial, chains a fresh snapshot with the captured doc', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.startRun()
    })

    let resetDone = false
    act(() => {
      void result.current.resetRun('# custom reset doc').then(() => { resetDone = true })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.resetRequested).toBe(true)

    // The panel reports its partial via onComplete (externalStop path).
    const partial = results(false)
    await act(async () => {
      await result.current.handleWorkoutComplete(partial)
    })

    expect(recorded.length).toBe(1)
    expect(recorded[0].data.completed).toBe(false)
    expect(snapshotCount).toBe(2)
    // The reset snapshot uses the doc captured at reset time, not a re-read.
    expect(snapshotDocs[1]).toBe('# custom reset doc')
    expect(result.current.run).toBeNull()
    expect(result.current.fullscreen).toBeNull()
    expect(result.current.resetRequested).toBe(false)
    expect(resetDone).toBe(true)
  });

  it('idle reset mints a fresh reset snapshot without a run', async () => {
    const { result } = setup()

    let ok = false
    await act(async () => {
      ok = await result.current.resetRun()
    })

    expect(ok).toBe(true)
    expect(snapshotCount).toBe(1)
    expect(result.current.run).toBeNull()
    expect(result.current.resetRequested).toBe(false)
  });

  it('a failed reset reports false so callers keep the draft untouched', async () => {
    failSnapshot = true
    const { result } = setup()

    let ok = true
    await act(async () => {
      ok = await result.current.resetRun()
    })

    expect(ok).toBe(false)
    expect(snapshotCount).toBe(0)
    expect(toasts.at(-1)?.title).toBe('Could not save workout results')
  });

  it('reset with unsaved pending outputs retries the capture and never overwrites it', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.startRun()
    })
    failRecord = true
    const partial = results(false)
    await act(async () => {
      await result.current.handleWorkoutComplete(partial)
    })
    expect(result.current.pendingResults?.results).toBe(partial)

    // Reset now retries the retained capture (not fresh empty outputs) — and
    // the retried save succeeds, chaining the reset snapshot.
    await act(async () => {
      await result.current.resetRun('# reset doc')
    })

    expect(recorded.length).toBe(1)
    expect(recorded[0].data).toBe(partial)
    expect(snapshotCount).toBe(2)
    expect(snapshotDocs[1]).toBe('# reset doc')
    expect(result.current.run).toBeNull()
  });
})
