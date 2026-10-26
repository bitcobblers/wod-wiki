import React from 'react';
import {
  BeakerIcon,
  BookOpenIcon,
} from '@heroicons/react/24/outline';
import { formatPlaygroundTimestampLabel } from '@/lib/playgroundDisplay';
import type { HistoryRecord } from '@/types/history';
import type { IListItem } from '../types';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return secs > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${mins}:00`;
}

function getLabel(entry: HistoryRecord): string {
  if (entry.title) return entry.title;
  if (entry.type === 'playground') return formatPlaygroundTimestampLabel(entry.createdAt);
  return 'Untitled workout';
}

function getIcon(entry: HistoryRecord): React.ReactNode {
  if (entry.type === 'playground') {
    return React.createElement(BeakerIcon, { className: 'w-4 h-4' });
  }
  return React.createElement(BookOpenIcon, { className: 'w-4 h-4' });
}

export function historyEntryToListItem(entry: HistoryRecord): IListItem<HistoryRecord> {
  const duration = entry.results?.duration;
  const durationStr = duration ? formatDuration(duration) : undefined;
  const dateStr = formatDate(entry.targetDate);

  return {
    id: entry.id,
    label: getLabel(entry),
    subtitle: durationStr ? `${dateStr} · ${durationStr}` : dateStr,
    icon: getIcon(entry),
    group: new Date(entry.targetDate).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    }),
    keywords: entry.tags,
    badge: entry.tags.length > 0 ? entry.tags[0] : undefined,
    payload: entry,
  };
}
