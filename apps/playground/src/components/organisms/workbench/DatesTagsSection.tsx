import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Calendar, Clock, Tag, X, Plus, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HistoryRecord } from '@/types/history';
import type { IContentProvider } from '@/types/content-provider';
import { CalendarCard } from '@/components/atoms/CalendarCard';
import { isNotebookTag } from '@/types/notebook';
import { formatDateMedium, formatDateTimeMediumShort } from '@/lib/dateFormat';

interface DatesTagsSectionProps {
  entry: HistoryRecord;
  provider?: IContentProvider;
  onEntryUpdate?: (updated: HistoryRecord) => void;
}

export const DatesTagsSection: React.FC<DatesTagsSectionProps> = ({
  entry,
  provider,
  onEntryUpdate,
}) => {
  const canWrite = provider?.capabilities.canWrite ?? false;

  // Calendar popup state
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Tag input state
  const [tagInput, setTagInput] = useState('');
  const [isTagInputVisible, setIsTagInputVisible] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Close calendar on outside click
  useEffect(() => {
    if (!isCalendarOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setIsCalendarOpen(false);
      }
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCalendarOpen]);

  // Focus tag input when shown
  useEffect(() => {
    if (isTagInputVisible && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [isTagInputVisible]);

  const persistUpdate = useCallback(
    async (patch: Parameters<IContentProvider['updateRecord']>[1]) => {
      if (!provider) return;
      try {
        const updated = await provider.updateRecord(entry.id, patch);
        onEntryUpdate?.(updated);
      } catch (err) {
        console.error('Failed to update entry:', err);
      }
    },
    [entry.id, provider, onEntryUpdate]
  );

  const formatDate = (ms: number) =>
    formatDateTimeMediumShort(new Date(ms));

  const formatDay = (ms: number) =>
    formatDateMedium(new Date(ms));

  const handleDateSelect = async (_date: Date) => {
    setIsCalendarOpen(false);
  };

  const displayTags = entry.tags.filter((t) => !isNotebookTag(t));

  const handleAddTag = async () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag || entry.tags.includes(tag)) {
      setTagInput('');
      return;
    }
    const newTags = [...entry.tags, tag];
    await persistUpdate({ tags: newTags });
    setTagInput('');
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    const newTags = entry.tags.filter((t) => t !== tagToRemove);
    await persistUpdate({ tags: newTags });
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === 'Escape') {
      setTagInput('');
      setIsTagInputVisible(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Target Date */}
      <div className="relative">
        <label className="text-xs font-semibold text-foreground/70 uppercase tracking-tight block mb-1">
          Target Date
        </label>
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-primary" />
          <span className="flex-1 font-medium text-base">{formatDay(entry.targetDate)}</span>
          {canWrite && (
            <button
              onClick={() => setIsCalendarOpen(!isCalendarOpen)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors shadow-sm',
                isCalendarOpen
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted font-medium'
              )}
              title="Move to different date"
            >
              <ArrowRightLeft className="w-3 h-3" />
              Move
            </button>
          )}
        </div>
        {isCalendarOpen && (
          <div
            ref={calendarRef}
            className="absolute right-0 top-full mt-1 z-30 rounded-md border bg-popover shadow-lg"
          >
            <CalendarCard
              selectedDate={new Date(entry.targetDate)}
              onDateSelect={handleDateSelect}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 border-t border-border/50 pt-3">
        <div>
          <label className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider block mb-0.5">
            Created
          </label>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="w-3 h-3 opacity-70" />
            <span>{formatDate(entry.createdAt)}</span>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider block mb-0.5">
            Last Updated
          </label>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="w-3 h-3 opacity-70" />
            <span>{formatDate(entry.updatedAt)}</span>
          </div>
        </div>
      </div>

      {/* Tags */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Tags</label>
          {canWrite && (
            <button
              onClick={() => setIsTagInputVisible(!isTagInputVisible)}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Add tag"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {displayTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {displayTags.map((tag) => (
              <span
                key={tag}
                className="group inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground border border-border"
              >
                <Tag className="w-3 h-3 mr-1" />
                {tag}
                {canWrite && (
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="ml-1 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                    title={`Remove tag "${tag}"`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">No tags</div>
        )}
        {isTagInputVisible && (
          <div className="flex items-center gap-1.5 mt-2">
            <input
              ref={tagInputRef}
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => {
                if (!tagInput.trim()) setIsTagInputVisible(false);
              }}
              placeholder="Add tag…"
              className="flex-1 min-w-0 px-2 py-1 rounded-md border border-border bg-muted/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button
              onClick={handleAddTag}
              disabled={!tagInput.trim()}
              className="px-2 py-1 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
