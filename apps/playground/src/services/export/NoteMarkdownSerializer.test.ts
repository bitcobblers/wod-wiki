import { describe, it, expect } from 'bun:test';
import { noteToMarkdown } from './NoteMarkdownSerializer';
import { frozenNow } from '@bitcobblers/wod-wiki-engine';
import type { HistoryRecord } from '@/types/history';

describe('noteToMarkdown', () => {
    const fixedDate = new Date('2025-06-01T12:00:00.000Z');
    const clock = frozenNow(fixedDate);
    const ts = fixedDate.getTime();

    const baseEntry = (overrides: Partial<HistoryRecord> = {}): HistoryRecord => ({
        id: 'entry-1',
        title: 'Test Entry',
        createdAt: ts,
        updatedAt: ts,
        targetDate: ts,
        rawContent: 'Some workout content.',
        tags: ['tag1', 'tag2'],
        schemaVersion: 1,
        ...overrides,
    });

    it('serializes a basic entry to markdown with all sections', () => {
        const entry = baseEntry();
        const md = noteToMarkdown(entry, clock);
        expect(md).toContain('# Test Entry');
        expect(md).toContain('## Metadata');
        expect(md).toContain('- **ID**: entry-1');
        expect(md).toContain(`- **Created**: ${fixedDate.toISOString()}`);
        expect(md).toContain(`- **Updated**: ${fixedDate.toISOString()}`);
        expect(md).toContain(`- **Target Date**: ${fixedDate.toISOString()}`);
        expect(md).toContain('- **Tags**: tag1, tag2');
        expect(md).toContain('## Content');
        expect(md).toContain('Some workout content.');
    });

    it('includes Cloned From line when sourceId is present', () => {
        const entry = baseEntry({ sourceId: 'template-abc' });
        const md = noteToMarkdown(entry, clock);
        expect(md).toContain('- **Cloned From**: template-abc');
    });

    it('omits Cloned To metadata', () => {
        const entry = baseEntry({ sourceId: 'orig-456' });
        const md = noteToMarkdown(entry, clock);
        expect(md).not.toContain('- **Cloned To**');
    });

    it('shows None when entry has no tags', () => {
        const entry = baseEntry({ tags: [] });
        const md = noteToMarkdown(entry, clock);
        expect(md).toContain('- **Tags**: None');
    });

    it('round-trips key fields through markdown', () => {
        const entry = baseEntry({
            title: 'Round Trip Test',
            id: 'rt-123',
            sourceId: 'orig-456',
            rawContent: 'Original content here.',
        });
        const md = noteToMarkdown(entry, clock);
        expect(md).toContain('# Round Trip Test');
        expect(md).toContain('- **ID**: rt-123');
        expect(md).toContain('- **Cloned From**: orig-456');
        expect(md).toContain('Original content here.');
    });
});
