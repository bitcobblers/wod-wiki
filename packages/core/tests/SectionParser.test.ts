import { describe, expect, it } from 'vitest';
import {
  parseDocumentSections, buildRawContent, calculateTotalLines, detectScriptBlocks,
  reconcileNoteBlocks, validateNoteBlocks, mapNoteBlockChanges, blockContentId,
} from '../src';

const workout = '```time\n5:00 Run\n```';

describe('core actionable source and occurrence identity', () => {
  it('keeps presentation sections transient and recognizes sparse actionables', () => {
    const source = '# Title\n\n' + workout + '\n\n```query:table\n:block{}\n```\n\n```widget:attention\ntext\n```\n\n[Video](https://youtu.be/abc)';
    const sections = parseDocumentSections(source);
    expect(sections[0].type).toBe('title');
    expect(Object.values(reconcileNoteBlocks(source, { sourceRevision: 1 })).map(block => block.kind)).toEqual(['wod', 'query', 'widget', 'embed']);
    expect(buildRawContent(sections)).toBe(source);
    expect(calculateTotalLines(sections)).toBe(source.split('\n').length);
  });

  it('slices exact CRLF and astral UTF-16 authored history without trailing separators', () => {
    const source = '# 🏋️\r\n\r\n  ````log:running  \r\n😀 5:00 Run\r\n  `````  \r\n\r\nAfter';
    const section = parseDocumentSections(source).find(section => section.scriptBlock)!;
    expect(section.from).toBe(source.indexOf('  ````'));
    expect(section.rawContent).toBe('  ````log:running  \r\n😀 5:00 Run\r\n  `````  ');
    expect(source.slice(section.from, section.to)).toBe(section.rawContent);
    expect(source.slice(section.contentFrom, section.contentTo)).toBe('😀 5:00 Run\r\n');
    expect(section.scriptBlock!.content).toBe('😀 5:00 Run\r\n');
    expect(section.contentId).toBe(blockContentId(section.scriptBlock!.content));
    expect(buildRawContent(parseDocumentSections(source))).toBe(source);
    const blocks = reconcileNoteBlocks(source, { sourceRevision: 3 });
    expect(() => validateNoteBlocks(source, blocks, 3)).not.toThrow();
  });

  it('leaves unknown, malformed and unclosed fences recoverable but non-actionable', () => {
    for (const source of ['```time:oops:extra\nRun\n```', '```time\nRun', '```widget:unknown\ntext\n```', '```js\n' + workout + '\n```', '```time unexpected\nRun\n```']) {
      expect(Object.keys(reconcileNoteBlocks(source, { sourceRevision: 1 }))).toHaveLength(0);
      expect(buildRawContent(parseDocumentSections(source))).toBe(source);
    }
    expect(Object.keys(reconcileNoteBlocks('```widget:attention\ntext\n```', { sourceRevision: 1, registeredWidgets: [] }))).toHaveLength(0);
  });

  it('keeps inline prose links as prose and standalone interactive embeds sparse', () => {
    const prose = 'See [Video](https://youtu.be/abc) for details.\n\nInvalid [link](javascript:alert)';
    expect(Object.keys(reconcileNoteBlocks(prose, { sourceRevision: 1 }))).toHaveLength(0);
    const source = '  [Video](https://youtu.be/abc)  \r\n\r\n![Photo](/images/workout.png)\r\n';
    const blocks = Object.values(reconcileNoteBlocks(source, { sourceRevision: 1 }));
    expect(blocks.map(block => block.kind)).toEqual(['embed', 'embed']);
    expect(source.slice(blocks[0].from, blocks[0].to)).toBe('  [Video](https://youtu.be/abc)  ');
    expect(buildRawContent(parseDocumentSections(source))).toBe(source);
  });

  it('does not recognize workouts nested in generic fences and uses one detector', () => {
    expect(detectScriptBlocks('````js\n' + workout + '\n````')).toEqual([]);
    expect(detectScriptBlocks('````time:running\n' + '```\nRun\n````')[0].content).toBe('```\nRun\n');
  });

  it('gives duplicate and copied occurrences independent IDs', () => {
    const source = workout + '\n\n' + workout;
    const saved = reconcileNoteBlocks(source, { sourceRevision: 1 });
    const originals = Object.values(saved);
    expect(originals[0].id).not.toBe(originals[1].id);
    const insertion = workout + '\n\n';
    const lineage = mapNoteBlockChanges(saved, [{ from: 0, to: 0, insert: insertion }]);
    const copied = Object.values(reconcileNoteBlocks(insertion + source, { sourceRevision: 1, blocks: lineage }));
    expect(copied[1].id).toBe(originals[0].id);
    expect(copied[2].id).toBe(originals[1].id);
    expect(copied[0].id).not.toBe(originals[0].id);
    expect(copied[0].id).not.toBe(originals[1].id);
  });

  it('maps prose and in-place edits without advancing saved-state versions', () => {
    const saved = reconcileNoteBlocks(workout, { sourceRevision: 2 });
    const original = Object.values(saved)[0];
    original.version = 4;
    const prefix = '# New prose 😀\r\n\r\n';
    const shifted = reconcileNoteBlocks(prefix + workout, { sourceRevision: 2, blocks: mapNoteBlockChanges(saved, [{ from: 0, to: 0, insert: prefix }]) });
    expect(shifted[original.id].from).toBe(prefix.length);
    expect(shifted[original.id].version).toBe(4);
    const position = workout.indexOf('5:00');
    const edited = reconcileNoteBlocks(workout.replace('5:00', '6:00'), { sourceRevision: 2, blocks: mapNoteBlockChanges(saved, [{ from: position, to: position + 4, insert: '6:00' }]) });
    expect(edited[original.id].version).toBe(4);
    const reverted = reconcileNoteBlocks(workout, { sourceRevision: 2, blocks: mapNoteBlockChanges(edited, [{ from: position, to: position + 4, insert: '5:00' }]) });
    expect(reverted[original.id]).toEqual(original);
  });

  it('never infers whole-replacement identity from equal source or fingerprints', () => {
    const source = workout + '\n\n' + workout;
    const saved = reconcileNoteBlocks(source, { sourceRevision: 1 });
    const replaced = reconcileNoteBlocks(source, { sourceRevision: 1, blocks: mapNoteBlockChanges(saved, [{ from: 0, to: source.length, insert: source }]) });
    for (const id of Object.keys(replaced)) expect(saved[id]).toBeUndefined();
  });

  it('restores persisted occurrence IDs on reopen and rejects malformed maps', () => {
    const source = workout + '\n\n' + workout;
    const saved = reconcileNoteBlocks(source, { sourceRevision: 2 });
    expect(reconcileNoteBlocks(source, { sourceRevision: 2, blocks: saved })).toEqual(saved);
    const block = Object.values(saved)[0];
    expect(() => validateNoteBlocks(source, { ...saved, [block.id]: { ...block, to: block.to + 1 } }, 2)).toThrow();
    expect(() => validateNoteBlocks(source, saved, 3)).toThrow();
    expect(() => validateNoteBlocks(source, {}, 2)).toThrow();
    expect(() => validateNoteBlocks(source, { ...saved, wrong: block }, 2)).toThrow();
  });
});
