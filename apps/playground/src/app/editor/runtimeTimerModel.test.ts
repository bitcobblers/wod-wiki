import { describe, expect, it } from 'bun:test';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import {
  MetricContainer,
  MetricType,
  promoteNoteToNotebooks,
  saveScopedPropertyOverride,
} from '@bitcobblers/wod-wiki-engine';
import type { ScriptBlock } from '@/components/Editor/types';
import { IndexedDBNotePersistence } from '@/services/persistence';
import { captureRun } from '@/services/runCapture';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { StorageService } from '@/services/storage/StorageService';
import { createRuntimeForBlock, prepareRuntimeBlock } from './runtimeTimerModel';

function makeBlock(content: string): ScriptBlock {
  return {
    id: 'blk-wizard-test',
    content,
    dialect: 'time',
    startLine: 0,
    endLine: content.split('\n').length,
    version: 1,
    state: 'idle',
    widgetIds: {},
    createdAt: Date.now(),
  };
}

describe('runtimeTimerModel — Pre-Run Wizard choice/target preservation', () => {
  it('preserves mutated statement metrics on a prepared block instead of re-parsing at start', () => {
    const rawBlock = makeBlock('5 Back Squat ? lb');
    const prepared = prepareRuntimeBlock(rawBlock);
    expect(prepared.statements.length).toBeGreaterThan(0);

    // Simulate <CollectionWizard> resolving the `? lb` placeholder to 225 lb
    // on `prepared.statements[0]` prior to clicking Start.
    const stmt = prepared.statements[0]!;
    stmt.metrics = MetricContainer.from([
      ...stmt.metrics.filter((m) => m.type !== MetricType.Resistance),
      {
        type: MetricType.Resistance,
        origin: 'user',
        value: { amount: 225, unit: 'lb' },
        image: '225 lb',
      },
    ]);

    const rt = createRuntimeForBlock(prepared);
    expect(rt).not.toBeNull();
    const compiledStmt = rt!.script.statements[0]!;
    const resistance = compiledStmt.metrics.find((m) => m.type === MetricType.Resistance);
    expect(resistance?.origin).toBe('user');
    expect(resistance?.value).toEqual({ amount: 225, unit: 'lb' });
    rt?.dispose();
  });

  it('still parses an unprepared raw block when createRuntimeForBlock is called directly', () => {
    const rawBlock = makeBlock('21 Thrusters 95 lb');
    const rt = createRuntimeForBlock(rawBlock);
    expect(rt).not.toBeNull();
    expect(rt!.script.statements.length).toBe(1);
    rt?.dispose();
  });

  it('threads Notebook-scoped Effort overrides from captureRun through prepareRuntimeBlock into runtime analytics', async () => {
    const storage = new StorageService(new InMemoryStorage());
    const persistence = new IndexedDBNotePersistence(storage);
    const rawMd = '# KB Swings\n```time\n20 Kettlebell Swing\n```\n';

    await storage.storage.readwrite('efforts').put({
      id: 'effort-kettlebell-swing',
      slug: 'kettlebell-swing',
      label: 'Kettlebell Swing',
      aliases: ['kettlebell swings', 'kb swing'],
      baseAttributes: { met: 9.8, discipline: 'kettlebell' },
      registrySource: 'bundled',
    });

    await storage.storage.readwrite('notes').put({
      id: 'notebook/kb-club',
      title: 'KB Club',
      rawContent: '---\ntype: notebook\nslug: kb-club\n---\n# KB Club\n',
      sourceRevision: 1,
      blocks: {},
      createdAt: 1_700_000_000_000,
      seedOrigin: 'user',
    });

    await saveScopedPropertyOverride(storage.storage, {
      targetNotebookId: 'notebook/kb-club',
      kind: 'effort',
      slug: 'kettlebell-swing',
      title: 'Kettlebell Swing',
      rawContent: [
        '---',
        'id: effort-override-kb-club-kettlebell-swing',
        'slug: kettlebell-swing',
        'label: Kettlebell Swing',
        'baseAttributes:',
        '  met: 30',
        '  discipline: kettlebell',
        '---',
        '# Heavy KB Club Swing',
      ].join('\n'),
    });

    const scopedBlocks = reconcileNoteBlocks(rawMd, { sourceRevision: 1, createId: () => 'wod-scoped' });
    await persistence.saveNote({
      noteId: 'note-scoped',
      rawContent: rawMd,
      blocks: scopedBlocks,
      expectedSourceRevision: 0,
      metadata: { title: 'Scoped KB Swings' },
    });
    await promoteNoteToNotebooks(storage.storage, {
      noteId: 'note-scoped',
      notebookIds: ['notebook/kb-club'],
    });
    const scopedNote = (await storage.getNote('note-scoped'))!;
    const scopedCapture = await captureRun(
      {
        noteId: scopedNote.id,
        rawContent: scopedNote.rawContent,
        blocks: scopedNote.blocks,
        expectedSourceRevision: scopedNote.sourceRevision,
      },
      { ...makeBlock('20 Kettlebell Swing'), id: 'wod-scoped' },
      'session-scoped',
      'journal',
      persistence,
    );
    const scopedPrepared = prepareRuntimeBlock(scopedCapture.block);
    const scopedRt = createRuntimeForBlock(scopedPrepared, scopedNote.rawContent)!;
    const scopedResolved = scopedRt.analyticsContext?.effortResolver?.resolveEffort('kettlebell-swing');
    expect(scopedResolved?.effort.baseAttributes.met).toBe(30);
    scopedRt.dispose();

    const unscopedBlocks = reconcileNoteBlocks(rawMd, { sourceRevision: 1, createId: () => 'wod-unscoped' });
    const unscopedCapture = await captureRun(
      {
        noteId: 'note-unscoped',
        rawContent: rawMd,
        blocks: unscopedBlocks,
        expectedSourceRevision: 0,
        metadata: { title: 'Unscoped KB Swings' },
      },
      { ...makeBlock('20 Kettlebell Swing'), id: 'wod-unscoped' },
      'session-unscoped',
      'journal',
      persistence,
    );
    const unscopedPrepared = prepareRuntimeBlock(unscopedCapture.block);
    const unscopedRt = createRuntimeForBlock(unscopedPrepared, rawMd)!;
    const unscopedResolved = unscopedRt.analyticsContext?.effortResolver?.resolveEffort('kettlebell-swing');
    expect(unscopedResolved?.effort.baseAttributes.met).toBe(9.8);
    unscopedRt.dispose();
  });
});
