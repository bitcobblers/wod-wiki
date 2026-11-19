import { Field, FieldLabel } from '@ui-sdk/react/field';
import { Input } from '@ui-sdk/react/input';
import { useState } from 'react';
import { parseQuery } from '@bitcobblers/wod-wiki-wql';
import { Button } from '../primitives/button';
import type {
  CustomSlotDefinition,
  CustomSlotEditorProps,
} from './ComposerRegistry';

export interface DateRange {
  start: string;
  end: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function DateRangeEditor({ value, onChange, onClose }: CustomSlotEditorProps<DateRange>) {
  const [start, setStart] = useState(value?.start ?? '');
  const [end, setEnd] = useState(value?.end ?? '');
  const shaped = ISO_DATE.test(start) && ISO_DATE.test(end);
  const parseError = shaped
    ? parseQuery(`:note from ${start} to ${end}`).error
    : undefined;
  const orderError = shaped && start > end ? 'Date range end must not precede its start' : undefined;
  const error = parseError ?? orderError;
  const ready = shaped && !error;

  return (
    <div className="space-y-2 text-xs" data-testid="date-range-editor">
      <div className="grid grid-cols-2 gap-1.5">
        <Field>
          <FieldLabel className="text-[10px] uppercase font-bold text-muted-foreground">
            Start
          </FieldLabel>
          <Input
            type="date"
            value={start}
            onValueChange={setStart}
            className="w-full min-h-12 h-12 rounded border border-border bg-background px-1.5 text-base font-mono"
            data-testid="date-range-start"
          />
        </Field>
        <Field>
          <FieldLabel className="text-[10px] uppercase font-bold text-muted-foreground">
            End
          </FieldLabel>
          <Input
            type="date"
            value={end}
            onValueChange={setEnd}
            className="w-full min-h-12 h-12 rounded border border-border bg-background px-1.5 text-base font-mono"
            data-testid="date-range-end"
          />
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-destructive" data-testid="date-range-error">
          {error}
        </p>
      )}
      <div className="pt-1 flex items-center justify-between gap-2 border-t border-border/50">
        <code className="text-[10px] font-mono text-muted-foreground truncate">
          {ready ? `daterange:${start}_${end}` : 'daterange: <start>_<end>'}
        </code>
        <div className="flex gap-1.5 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="min-h-12 px-3 text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!ready}
            onClick={() => onChange({ start, end })}
            className="min-h-12 px-3"
            data-testid="date-range-apply"
          >
            Set Range
          </Button>
        </div>
      </div>
    </div>
  );
}

export const dateRangeSlot: CustomSlotDefinition<DateRange> = {
  type: 'date-range',
  label: 'Date Range',
  icon: '📅',
  placeholder: 'Pick a workout date range...',
  placeholderText: 'daterange: [start_end]',
  description: 'Filter workouts to an explicit date range',
  Editor: DateRangeEditor,
  wqlGenerator: (value) => `daterange:${value.start}_${value.end}`,
  formatValue: (value) => `${value.start}_${value.end}`,
  parseValue: (raw) => {
    const [start, end] = raw.split('_');
    return start && end && ISO_DATE.test(start) && ISO_DATE.test(end) ? { start, end } : undefined;
  },
  validate: (value) => (value.end >= value.start ? null : 'Date range end must not precede its start'),
};
