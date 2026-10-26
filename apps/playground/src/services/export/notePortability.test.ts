import { describe, it, expect } from 'bun:test';
import { noteToMarkdown } from './NoteMarkdownSerializer';
import { parseMarkdownToEntry } from './NoteMarkdownDeserializer';
import { frozenNow } from '@bitcobblers/wod-wiki-engine';
import type { HistoryRecord } from '@/types/history';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';

/**
 * Round-trip test for the note portability surface.
 *
 * Exports a HistoryRecord to markdown via `noteToMarkdown`, then parses it back
 * via `parseMarkdownToEntry`. The round-trip MUST preserve the fields a user
 * relies on for note identity and chronological order:
 *
 *   - title, rawContent, tags (the visible content)
 *   - targetDate (the primary sort key)
 *   - id (so re-imported notes deduplicate rather than create duplicates)
 *   - createdAt / updatedAt (the immutable creation timestamp + last-edit)
 *   - sourceId (the note this one was created from)
 *   - clonedIds are no longer persisted; reverse links are derived from sourceId
 *
 */
describe('notePortability round-trip', () => {
    const fixedDate = new Date('2025-06-01T12:00:00.000Z');
    const ts = fixedDate.getTime();
    const clock = frozenNow(fixedDate);

    const baseEntry = (overrides: Partial<HistoryRecord> = {}): HistoryRecord => ({
        id: 'roundtrip-1',
        title: 'Round Trip Entry',
        createdAt: ts,
        updatedAt: ts + 60_000,
        targetDate: ts,
        rawContent: '5 Rounds\n- 10 Thrusters\n- 10 Pull-ups',
        tags: ['crossfit', 'benchmark'],
        schemaVersion: 1,
        ...overrides,
    });

    it('round-trips title, content, and tags', () => {
        const entry = baseEntry();
        const md = noteToMarkdown(entry, clock);
        const recovered = parseMarkdownToEntry(md, clock);

        expect(recovered).not.toBeNull();
        expect(recovered!.title).toBe(entry.title);
        expect(recovered!.rawContent).toBe(entry.rawContent);
        expect(recovered!.tags).toEqual(entry.tags);
    });

    it('round-trips targetDate verbatim', () => {
        const entry = baseEntry();
        const md = noteToMarkdown(entry, clock);
        const recovered = parseMarkdownToEntry(md, clock);

        expect(recovered).not.toBeNull();
        expect(recovered!.targetDate).toBe(entry.targetDate);
    });

    it('round-trips sourceId', () => {
        const entry = baseEntry({
            sourceId: 'template-orig',
        });
        const md = noteToMarkdown(entry, clock);
        const recovered = parseMarkdownToEntry(md, clock);

        expect(recovered).not.toBeNull();
        expect(recovered!.sourceId).toBe('template-orig');
    });


    /**
     * Read an unknown-typed field from a parsed entry, narrowing with `in`.
     * Avoids asserting an inline shape on the recovered value.
     */
    function fieldOf(recovered: object | null, key: string): unknown {
        if (recovered && key in recovered) {
            // After `in` narrowing the access is checked — TS infers unknown.
            return (recovered as Record<string, unknown>)[key];
        }
        return undefined;
    }

    it('round-trips id (so re-imported notes deduplicate, not duplicate)', () => {
        const entry = baseEntry({ id: 'preserve-me-42' });
        const md = noteToMarkdown(entry, clock);
        const recovered = parseMarkdownToEntry(md, clock);

        expect(fieldOf(recovered, 'id')).toBe('preserve-me-42');
    });

    it('round-trips createdAt (the immutable creation timestamp)', () => {
        const entry = baseEntry({ createdAt: ts });
        const md = noteToMarkdown(entry, clock);
        const recovered = parseMarkdownToEntry(md, clock);

        expect(fieldOf(recovered, 'createdAt')).toBe(ts);
    });

    it('round-trips updatedAt (the last-edit timestamp)', () => {
        const entry = baseEntry({ updatedAt: ts + 120_000 });
        const md = noteToMarkdown(entry, clock);
        const recovered = parseMarkdownToEntry(md, clock);

        expect(fieldOf(recovered, 'updatedAt')).toBe(ts + 120_000);
    });

    it('preserves exact whitespace, UTF-16 locations and occurrence IDs', () => {
        const rawContent = '\uFEFF  \r\n```time\r\n10 Pushups  \r\n```\r\n\r\n';
        const blocks = reconcileNoteBlocks(rawContent, { sourceRevision: 4, createId: () => 'occurrence' });
        const entry = baseEntry({ rawContent, blocks, sourceRevision: 4 });
        const recovered = parseMarkdownToEntry(noteToMarkdown(entry, clock), clock);
        expect(recovered?.rawContent).toBe(rawContent);
        expect(recovered?.blocks).toEqual(blocks);
        expect(recovered?.sourceRevision).toBe(4);
    });

    it('round-trips registered widget occurrence maps', () => {
        const rawContent = '```widget:attention\n{"headline":"Tip"}\n```';
        const blocks = reconcileNoteBlocks(rawContent, { sourceRevision: 2 });
        const recovered = parseMarkdownToEntry(noteToMarkdown(baseEntry({ rawContent, blocks, sourceRevision: 2 }), clock), clock);
        expect(recovered?.blocks).toEqual(blocks);
    });
});
