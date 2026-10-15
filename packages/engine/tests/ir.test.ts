import { describe, it, expect } from 'vitest';
import {
  createIRFile,
  isIRFile,
  buildStatementTree,
  createParser,
  type StatementNode,
} from '../src/index';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runQueryCli } from '@bitcobblers/wod-wiki-tools';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';

describe('IR Envelope and StatementNode', () => {
  it('queries exact Note bodies and actionable maps without reconstruction', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wod-ir-'));
    const path = join(root, 'corpus.json');
    const rawContent = '# Recovery\n\nprose-only-marker\n\n```time\n10 push-up\n```\n';
    try {
      writeFileSync(path, JSON.stringify(createIRFile('corpus', {
        notes: [{ id: 'note-1', title: 'Recovery', createdAt: 1, rawContent, sourceRevision: 1,
          blocks: reconcileNoteBlocks(rawContent, { sourceRevision: 1, createId: () => 'occurrence-1' }) }],
      })));
      const notes = await runQueryCli(':note{text:"prose-only-marker"}', { corpusPath: path });
      expect('notes' in notes.data && notes.data.notes).toHaveLength(1);
      const prose = await runQueryCli(':block{text:"prose-only-marker"}', { corpusPath: path });
      expect('blocks' in prose.data && prose.data.blocks).toHaveLength(0);
      const workout = await runQueryCli(':block{text:"push-up"}', { corpusPath: path });
      expect('blocks' in workout.data && workout.data.blocks).toHaveLength(1);
      writeFileSync(path, JSON.stringify({ segments: [] }));
      await expect(runQueryCli(':note{}', { corpusPath: path })).rejects.toThrow(/Incompatible corpus segments/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects preloaded Sessions whose exact immutable revision is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wod-ir-pin-'));
    const path = join(root, 'corpus.json');
    try {
      writeFileSync(path, JSON.stringify({ results: [{
        id: 'session-1', noteId: 'deleted-note', blockId: 'occurrence-1', blockVersion: 2,
        startTime: 1, endTime: 2, duration: 1, completed: true, createdAt: 2,
      }] }));
      await expect(runQueryCli(':session{}', { corpusPath: path })).rejects.toThrow(/revision is unavailable/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('creates and validates a WodWikiIRFile envelope', () => {
    const ir = createIRFile('parse-tree', { hello: 'world' }, 'test-source', 1234567890);
    expect(ir.$schema).toBe('https://wod-wiki.dev/ir/v1.json');
    expect(ir.kind).toBe('parse-tree');
    expect(ir.generatedAt).toBe(1234567890);
    expect(ir.source).toBe('test-source');
    expect(ir.data).toEqual({ hello: 'world' });

    expect(isIRFile(ir)).toBe(true);
    expect(isIRFile({ foo: 'bar' })).toBe(false);
    expect(isIRFile(null)).toBe(false);
  });

  it('builds StatementNode tree from parsed WhiteboardScript', () => {
    const source = `(21-15-9)\n  Thrusters @95lb\n  Pull-ups`;
    const parser = createParser();
    const script = parser.read(source);

    const tree: StatementNode = buildStatementTree(script);

    expect(tree).toBeDefined();
    expect(tree.id).toBeDefined();
    expect(tree.type).toBeDefined();
    expect(tree.raw).toBeDefined();
    expect(typeof tree.from).toBe('number');
    expect(typeof tree.to).toBe('number');
    expect(Array.isArray(tree.metrics)).toBe(true);
    expect(Array.isArray(tree.children)).toBe(true);
    expect(tree.children.length).toBeGreaterThan(0);
  });
});
