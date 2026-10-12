import { describe, expect, it } from 'bun:test';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { IndexedDBNotePersistence } from '@/services/persistence';
import { StorageService } from '@/services/storage/StorageService';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { captureRun } from './runCapture';
import { createResultRecorder } from './resultRecorder';
import type { ScriptBlock } from '@/components/Editor/types';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

const rawContent = '# Run\n```time:crossfit\n10 Pushups\n```\n';
const block: ScriptBlock = { id: 'workout', content: 'wrong mutable body', dialect: 'log', sport: 'running', statements: [], startLine: 1, endLine: 3, version: 99, state: 'idle', createdAt: 0, widgetIds: {} };

describe('pinned runtime capture', () => {
  it('commits source, saved revision and Session before returning frozen workout input', async () => {
    const storage = new StorageService(new InMemoryStorage());
    const persistence = new IndexedDBNotePersistence(storage);
    const blocks = reconcileNoteBlocks(rawContent, { sourceRevision: 1, createId: () => 'workout' });
    const run = await captureRun({ noteId: 'note', rawContent, blocks, expectedSourceRevision: 0, metadata: { title: 'Run' } }, block, 'run', undefined, persistence);
    expect(run.block.content).toContain('10 Pushups');
    expect(run.block.dialect).toBe('time');
    expect(run.block.sport).toBe('crossfit');
    expect(run.block).not.toBe(block);
    expect(await storage.getSessionById('run')).toMatchObject({ noteId: 'note', blockId: 'workout', blockVersion: 1 });
    expect(await storage.getBlockRevision('note', 'workout', 1)).toMatchObject({ rawContent: '```time:crossfit\n10 Pushups\n```' });
    const changedSource = rawContent.replace('10 Pushups', '20 Pushups');
    await persistence.saveNote({ noteId: 'note', rawContent: changedSource, blocks: run.note.blocks, expectedSourceRevision: run.note.sourceRevision });
    expect((await storage.getBlockHistory('note', 'workout')).map(row => row.version)).toEqual([1, 2]);
    await persistence.deleteNote('note');
    const recorder = createResultRecorder(persistence);
    const finished = await recorder.record({ resultId: 'run', noteId: 'note', blockId: 'workout', data: {
      startTime: 1, endTime: 60_001, duration: 60_000, completed: true,
      logs: [{ id: 1, outputType: 'segment', timeSpan: { started: 1, ended: 60_001 },
        metrics: [{ type: MetricType.Rep, value: 10, image: '10', origin: 'runtime' },
          { type: MetricType.Effort, value: 'Pushups', image: 'Pushups', origin: 'parser' },
          { type: MetricType.Elapsed, value: 60_000, origin: 'runtime' }],
        sourceBlockKey: 'block-1', stackLevel: 0 }],
    }, createdAt: 60_001 });
    expect(finished.blockVersion).toBe(1);
    expect(run.block.content).toContain('10 Pushups');
    expect(await storage.getBlockRevision('note', 'workout', 1)).toBeDefined();
    await persistence.rederiveResultAnalytics('run');
    const replayed = await storage.getEventsByResult('run');
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed.every(row => row.blockId === 'workout' && row.blockVersion === 1)).toBe(true);
    expect(replayed.filter(row => row.outputType === 'segment').flatMap(row => row.metrics).some(metric => metric.type === MetricType.Rep && metric.value === 10)).toBe(true);
    expect(await storage.getNote('note')).toBeUndefined();
    const replayedIds = replayed.map(row => row.id).sort();
    await persistence.rederiveResultAnalytics('run');
    expect((await storage.getEventsByResult('run')).map(row => row.id).sort()).toEqual(replayedIds);
  });

  it('rejects stale capture without creating a Session and keeps the caller draft', async () => {
    const storage = new StorageService(new InMemoryStorage());
    const persistence = new IndexedDBNotePersistence(storage);
    const blocks = reconcileNoteBlocks(rawContent, { sourceRevision: 1, createId: () => 'workout' });
    await persistence.saveNote({ noteId: 'note', rawContent, blocks, expectedSourceRevision: 0, metadata: { title: 'Run' } });
    const draft = rawContent.replace('10', '20');
    await expect(captureRun({ noteId: 'note', rawContent: draft, blocks, expectedSourceRevision: 0 }, block, 'failed', undefined, persistence)).rejects.toThrow();
    expect(await storage.getSessionById('failed')).toBeUndefined();
    expect(draft).toContain('20 Pushups');
    expect(await storage.getEventsByResult('failed')).toEqual([]);
  });
});
