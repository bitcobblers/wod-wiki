/**
 * FeedFeed — flat list of date groups for feed content.
 *
 * The caller computes and passes `dateKeys` (only dates with content), no
 * infinite scroll, no IO observers.
 */

import { useMemo } from 'react';
import { CalendarIcon, FileTextIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateHeader } from '@/lib/dateFormat';

// ── Types ──────────────────────────────────────────────────────────────────

export interface FeedItem {
  id: string;
  feedId: string;
  feedName: string;
  feedDate: string;   // YYYY-MM-DD
  name: string;
  content: string;
  path: string;
}

/** Journal note metadata for a given date (title + last update). */
export interface JournalEntrySummary {
  title: string;
  updatedAt: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

// ── Props ──────────────────────────────────────────────────────────────────

export interface FeedFeedProps {
  /** Ordered YYYY-MM-DD keys — caller controls which dates appear. */
  dateKeys: string[];
  items: FeedItem[];
  journalEntries: Map<string, JournalEntrySummary>;
  onSelectItem: (item: FeedItem) => void;
  onOpenEntry?: (dateKey: string) => void;
  onAddToToday?: (item: FeedItem) => void;
  className?: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function FeedFeed({
  dateKeys,
  items,
  journalEntries,
  onSelectItem,
  onOpenEntry,
  onAddToToday,
  className,
}: FeedFeedProps) {
  const itemsByDate = useMemo(() => {
    const map = new Map<string, FeedItem[]>();
    for (const item of items) {
      const group = map.get(item.feedDate) ?? [];
      group.push(item);
      map.set(item.feedDate, group);
    }
    return map;
  }, [items]);

  if (dateKeys.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-20 text-muted-foreground/50', className)}>
        <p className="text-sm font-medium">No feed content found.</p>
        <p className="text-xs mt-1">Feed workouts will appear here once content is available.</p>
      </div>
    );
  }

  return (
    <div className={cn('bg-card flex flex-col', className)} data-testid="feed-feed">
      {dateKeys.map(key => {
        const date = new Date(key + 'T00:00:00');
        const dayItems = itemsByDate.get(key) ?? [];
        const noteEntry = journalEntries.get(key);

        return (
          <div key={key} id={key} className="flex flex-col">
            {/* Date header */}
            <div className="sticky z-[5] px-6 py-2 bg-muted/80 backdrop-blur-sm border-y border-border flex items-center gap-2 top-0">
              <CalendarIcon className="size-3 text-muted-foreground flex-shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                {formatDateHeader(date)}
              </span>
            </div>

            <div className="flex flex-col gap-0 pb-1">
              {/* Journal note card if the user has a note for this date */}
              {noteEntry && (
                <button
                  onClick={() => onOpenEntry?.(key)}
                  className="flex items-center gap-4 px-6 py-3.5 hover:bg-muted/40 transition-colors text-left group"
                >
                  <div className="flex-shrink-0 size-9 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <FileTextIcon className="size-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-foreground truncate">{noteEntry.title}</h3>
                    <p className="text-[11px] text-muted-foreground font-medium">Journal note</p>
                  </div>
                  <ChevronRightIcon className="size-4 text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0" />
                </button>
              )}

              {/* Feed items for this date */}
              {dayItems.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-4 px-6 py-3.5 hover:bg-muted/30 transition-colors cursor-pointer group"
                  onClick={() => onSelectItem(item)}
                >
                  <div className="flex-shrink-0 size-9 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                    <span className="text-[10px] font-black text-primary">WOD</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">{item.name}</h3>
                    <p className="text-[11px] text-muted-foreground font-medium mt-0.5">{item.feedName}</p>
                  </div>
                  {onAddToToday && (
                    <button
                      onClick={e => { e.stopPropagation(); onAddToToday(item); }}
                      title="Add to today's journal"
                      className={cn(
                        'flex items-center gap-1 rounded-full border border-border px-2.5 py-1',
                        'text-[10px] font-black uppercase tracking-widest text-muted-foreground',
                        'hover:text-primary hover:border-primary/50 transition-colors shrink-0',
                        'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      <PlusIcon className="size-3" />
                      Today
                    </button>
                  )}
                  <ChevronRightIcon className="size-4 text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
