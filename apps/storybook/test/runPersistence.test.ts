/**
 * Unit checks for the workbench run persistence seam (node, fully mocked
 * storage plane): fence→block mapping, upsert revision handling, and the
 * finish payload shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDocumentSections } from '@bitcobblers/wod-wiki-core';
import type { IOutputStatement } from '@bitcobblers/wod-wiki-engine';

vi.mock('@/services/storage', () => ({
  storageService: { getNote: vi.fn() },
  whenStorageReady: vi.fn(async () => {}),
}));
vi.mock('@/services/content/IndexedDBContentProvider', () => mockContentProvider);
vi.mock('@/services/runCapture', () => ({ captureRun: vi.fn() }));
vi.mock('@/services/resultRecorder', () => ({
  playgroundRecorder: { record: vi.fn() },
}));
// The app-typed converter drags the whole editor type graph; stub the function.
vi.mock('@/components/Editor/types', () => ({
  toStoredOutputStatement: (output: IOutputStatement) => ({ id: output.id }),
}));

import { storageService } from '@/services/storage';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import { captureRun } from '@/services/runCapture';
import { playgroundRecorder } from '@/services/resultRecorder';
import { completeWorkbenchRun, prepareWorkbenchRun, workbenchRunNoteId } from '../src/workbench/runPersistence';

const TWO_FENCE_NOTE = [
  '# Double',
  '',
  '```time',
  '3 Rounds',
  '  10 Pull-ups',
  '```',
  '',
  '```log:rowing',
  '5:00',
  '```',
].join('\n');

interface FakeWodBlock {
  id: string;
  kind: 'wod';
  version: number;
  sourceRevision: number;
  from: number;
  to: number;
}

/** Mirrors reconcileNoteBlocks: persisted wod blocks share fence spans. */
function fakeSavedEntry(rawContent: string) {
  const blocks: Record<string, FakeWodBlock> = {};
  parseDocumentSections(rawContent)
    .filter((section) => section.type === 'time' || section.type === 'log')
    .forEach((section, i) => {
      blocks[`wod-${i}`] = { id: `wod-${i}`, kind: 'wod', version: 3, sourceRevision: 5, from: section.from, to: section.to };
    });
  return {
    id: 'note-1',
    title: 'T',
    createdAt: 1,
    updatedAt: 1,
    targetDate: 1,
    rawContent,
    blocks,
    tags: [] as string[],
    sourceRevision: 5,
    schemaVersion: 1,
  };
}

const mockContentProvider = vi.hoisted(() => {
  const saveEntry = vi.fn();
  return { saveEntry, IndexedDBContentProvider: class { saveEntry = saveEntry; } };
});

const saveEntryMock = mockContentProvider.saveEntry;
const getNoteMock = vi.mocked(storageService).getNote;
const captureRunMock = vi.mocked(captureRun);
const recordMock = playgroundRecorder.record;

describe('workbenchRunNoteId', () => {
  it('is stable and filesystem-safe', () => {
    expect(workbenchRunNoteId('Playground -- Empty_Workbench!')).toBe('workbench-playground-empty-workbench');
    expect(workbenchRunNoteId('a/b\\c')).toBe('workbench-a-b-c');
    expect(workbenchRunNoteId('playground--empty-workbench')).toBe(workbenchRunNoteId('playground--empty-workbench'));
  });
});

describe('prepareWorkbenchRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNoteMock.mockResolvedValue(null);
    saveEntryMock.mockImplementation(async (entry: { rawContent: string }) => fakeSavedEntry(entry.rawContent));
    captureRunMock.mockResolvedValue({} as never);
  });

  it('pins the Nth fence to the Nth persisted wod block', async () => {
    const ctx = { noteId: 'note-1', title: 'T', rawContent: TWO_FENCE_NOTE };
    const first = await prepareWorkbenchRun(ctx, 0);
    expect(first.blockId).toBe('wod-0');
    const second = await prepareWorkbenchRun(ctx, 1);
    expect(second.blockId).toBe('wod-1');
    expect(captureRunMock).toHaveBeenCalledTimes(2);
    expect(captureRunMock.mock.calls[0][1]).toMatchObject({ id: 'wod-0', content: '3 Rounds\n  10 Pull-ups\n' });
    expect(captureRunMock.mock.calls[1][1]).toMatchObject({ id: 'wod-1', content: '5:00\n' });
    expect(captureRunMock.mock.calls[0][3]).toBe('playground');
  });

  it('passes the existing source revision on update and omits it on create', async () => {
    const ctx = { noteId: 'note-1', title: 'T', rawContent: TWO_FENCE_NOTE };
    getNoteMock.mockResolvedValue({ id: 'note-1', title: 'T', rawContent: '', blocks: {}, sourceRevision: 7, createdAt: 1 });
    await prepareWorkbenchRun(ctx, 0);
    expect(saveEntryMock.mock.calls[0][0]).toMatchObject({ id: 'note-1', type: 'playground', sourceRevision: 7 });
    getNoteMock.mockResolvedValue(null);
    await prepareWorkbenchRun(ctx, 0);
    expect('sourceRevision' in saveEntryMock.mock.calls[1][0]).toBe(false);
  });

  it('rejects an out-of-range fence index', async () => {
    await expect(prepareWorkbenchRun({ noteId: 'n', title: 'T', rawContent: TWO_FENCE_NOTE }, 5)).rejects.toThrow(/fence 6/i);
  });
});

describe('completeWorkbenchRun', () => {
  it('finalises the session with converted outputs', async () => {
    vi.clearAllMocks();
    recordMock.mockResolvedValue({} as never);
    await completeWorkbenchRun(
      { noteId: 'note-1', blockId: 'wod-0', resultId: 'r-1', startedAt: 1 },
      [{ id: 11 } as IOutputStatement, { id: 12 } as unknown as IOutputStatement],
      true,
      { startTime: 100, endTime: 250, duration: 150 },
    );
    expect(recordMock).toHaveBeenCalledWith({
      blockId: 'wod-0',
      noteId: 'note-1',
      resultId: 'r-1',
      data: { startTime: 100, endTime: 250, duration: 150, completed: true, logs: [{ id: 11 }, { id: 12 }] },
      createdAt: 250,
      origin: 'playground',
    });
  });
});
