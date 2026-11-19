import React, { useState, useEffect } from 'react';
import { Plus, Copy, Calendar, Loader2 } from 'lucide-react';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  Separator,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { CalendarCard } from '@/components/atoms/CalendarCard';
import { cn } from '@/lib/utils';
import { isJournalEntry } from '@/types/notebook';
import type { IContentProvider } from '@/types/content-provider';

export interface WorkoutActionButtonProps {
  onAction: (date: Date) => void | Promise<void>;
  provider?: IContentProvider;
  mode?: 'create' | 'clone';
  label?: string;
  variant?: 'default' | 'outline' | 'ghost';
  className?: string;
  title?: string;
  secondaryActions?: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
  }[];
}

export const WorkoutActionButton: React.FC<WorkoutActionButtonProps> = ({
  onAction,
  provider,
  mode = 'create',
  label,
  variant = 'outline',
  className,
  title,
  secondaryActions = [],
}) => {
  const [open, setOpen] = useState(false);
  const [entryDates, setEntryDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const Icon = mode === 'create' ? Plus : Copy;
  const defaultLabel = mode === 'create' ? 'New' : 'Clone';
  const effectiveLabel = label === undefined ? defaultLabel : label;
  const effectiveTitle = title || (mode === 'create' ? 'Create for today' : 'Clone to today');

  useEffect(() => {
    if (!open || !provider) return;

    const loadEntryDates = async () => {
      setLoading(true);
      try {
        const entries = await provider.getRecords();
        const dates = new Set(
          entries
            .filter(isJournalEntry)
            .map((e) => new Date(e.targetDate).toISOString().split('T')[0]),
        );
        setEntryDates(dates);
      } catch {
        // Best-effort highlight loading
      } finally {
        setLoading(false);
      }
    };

    void loadEntryDates();
  }, [open, provider]);

  const handleMainAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    void onAction(new Date());
  };

  const handleDateSelect = (date: Date) => {
    date.setHours(12, 0, 0, 0);
    void onAction(date);
    setOpen(false);
  };

  return (
    <div className={cn('flex items-center -space-x-px', className)} onClick={(e) => e.stopPropagation()}>
      <Button
        variant={variant}
        size="sm"
        aria-label={effectiveLabel ? undefined : effectiveTitle}
        onClick={handleMainAction}
        className={cn(
          'rounded-r-none gap-2 px-3 h-11 font-semibold whitespace-nowrap z-10',
          variant === 'default' ? 'border-r border-primary-foreground/20' : 'border-r-0',
        )}
        title={effectiveTitle}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {effectiveLabel && <span className="hidden sm:inline">{effectiveLabel}</span>}
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant={variant}
              size="sm"
              aria-label="Pick a date"
              title="Pick a date"
              className={cn(
                'rounded-l-none px-2 h-11 transition-all',
                variant === 'ghost' ? 'border-l hover:bg-accent' : 'border-l',
              )}
            />
          }
        >
          <Calendar className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-auto p-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-3">
            <PopoverTitle className="flex items-center gap-2 px-1 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              {mode === 'create' ? 'Create on Date' : 'Clone to Date'}
            </PopoverTitle>
            <Separator className="my-2" />
            {loading ? (
              <div className="flex items-center justify-center py-10 w-[240px]">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <CalendarCard
                onDateSelect={handleDateSelect}
                entryDates={entryDates}
                className="p-0"
              />
            )}
          </div>

          {secondaryActions.length > 0 && (
            <>
              <Separator />
              <div className="p-1 space-y-0.5">
                {secondaryActions.map((action, idx) => (
                  <button
                    key={action.label || idx}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      action.onClick();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted transition-colors"
                  >
                    <span className="text-muted-foreground">{action.icon}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
};
