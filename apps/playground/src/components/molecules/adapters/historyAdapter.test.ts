import React from 'react';
import { describe, expect, it } from 'bun:test';
import {
  BeakerIcon,
  BookOpenIcon,
} from '@heroicons/react/24/outline';
import { historyEntryToListItem } from './historyAdapter';
import type { HistoryRecord } from '@/types/history';

const baseEntry: HistoryRecord = {
  id: 'entry-1',
  title: '',
  createdAt: new Date('2026-04-27T14:30:22.481Z').getTime(),
  updatedAt: new Date('2026-04-27T14:30:22.481Z').getTime(),
  targetDate: new Date('2026-04-27T14:30:22.481Z').getTime(),
  rawContent: '',
  tags: [],
  schemaVersion: 1,
};

function expectedPlaygroundLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `Playground – ${dateStr} ${timeStr}`;
}

function iconType(item: ReturnType<typeof historyEntryToListItem>) {
  return (item.icon as React.ReactElement).type;
}

describe('historyEntryToListItem', () => {
  it('uses a formatted timestamp label and playground icon for untitled playground entries', () => {
    const item = historyEntryToListItem({
      ...baseEntry,
      type: 'playground',
    });

    expect(item.label).toBe(expectedPlaygroundLabel(baseEntry.createdAt));
    expect(iconType(item)).toBe(BeakerIcon);
  });

  it('keeps the existing untitled workout fallback and note icon for notes', () => {
    const item = historyEntryToListItem({
      ...baseEntry,
      type: 'note',
    });

    expect(item.label).toBe('Untitled workout');
    expect(iconType(item)).toBe(BookOpenIcon);
  });

  it('preserves short and long custom titles regardless of type', () => {
    const shortTitle = 'Fran';
    const longTitle = 'Very Long Workout Title That Requires Text Truncation When Displayed in Lists';

    const itemShort = historyEntryToListItem({
      ...baseEntry,
      type: 'playground',
      title: shortTitle,
    });
    expect(itemShort.label).toBe(shortTitle);
    expect(iconType(itemShort)).toBe(BeakerIcon);

    const itemLong = historyEntryToListItem({
      ...baseEntry,
      type: 'note',
      title: longTitle,
    });
    expect(itemLong.label).toBe(longTitle);
    expect(iconType(itemLong)).toBe(BookOpenIcon);
  });
});
