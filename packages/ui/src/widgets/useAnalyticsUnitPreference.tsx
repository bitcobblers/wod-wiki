import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from '@ui-sdk/react/segmented-control';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '../utils/cn';
import { parseQuery } from '@bitcobblers/wod-wiki-wql';
import type { AnalyticsQueryDef } from './useAnalyticsQueries';
import type { StorageLike } from '../contracts/storage';

export const ANALYTICS_UNIT_STORAGE_KEY = 'wod.analytics.unit';
export const DEFAULT_ANALYTICS_UNIT = 'kg';
export type AnalyticsUnit = 'kg' | 'lb';

const VALID_UNITS: readonly AnalyticsUnit[] = ['kg', 'lb'];

const memoryStore = new Map<string, string>();
const inMemoryStorage: StorageLike = {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStore.set(key, value);
  },
  removeItem: (key: string) => {
    memoryStore.delete(key);
  },
};

const unitListeners = new Set<() => void>();
function notifyUnitChange() {
  for (const l of unitListeners) l();
}

function resolveStorage(custom?: StorageLike): StorageLike {
  return custom ?? inMemoryStorage;
}

export function readStoredUnit(storage?: StorageLike): AnalyticsUnit {
  const store = resolveStorage(storage);
  const stored = store.getItem(ANALYTICS_UNIT_STORAGE_KEY);
  return (VALID_UNITS as readonly string[]).includes(stored ?? '')
    ? (stored as AnalyticsUnit)
    : DEFAULT_ANALYTICS_UNIT;
}

export function useAnalyticsUnitPreference(customStorage?: StorageLike) {
  const storage = resolveStorage(customStorage);
  const [unit, setUnitState] = useState<AnalyticsUnit>(() => readStoredUnit(storage));

  useEffect(() => {
    setUnitState(readStoredUnit(storage));
    const sync = () => setUnitState(readStoredUnit(storage));
    unitListeners.add(sync);
    return () => {
      unitListeners.delete(sync);
    };
  }, [storage]);

  const setUnit = useCallback(
    (next: AnalyticsUnit) => {
      storage.setItem(ANALYTICS_UNIT_STORAGE_KEY, next);
      setUnitState(next);
      notifyUnitChange();
    },
    [storage],
  );

  const toggleUnit = useCallback(() => {
    const next: AnalyticsUnit = unit === 'kg' ? 'lb' : 'kg';
    setUnit(next);
  }, [unit, setUnit]);

  return { unit, setUnit, toggleUnit };
}

export function getEffectiveAnalyticsUnit(
  query: string,
  preferredUnit: AnalyticsUnit,
): { unit: AnalyticsUnit; forced: boolean } {
  const parsed = parseQuery(query);
  const displayUnit = 'displayUnit' in parsed ? parsed.displayUnit : undefined;
  if (displayUnit === 'lb' || displayUnit === 'kg') {
    return { unit: displayUnit as AnalyticsUnit, forced: true };
  }
  return { unit: preferredUnit, forced: false };
}

export function getDashboardEffectiveUnit(
  queries: AnalyticsQueryDef[],
  preferredUnit: AnalyticsUnit,
): { unit: AnalyticsUnit; forced: boolean } {
  const units = queries
    .map((q) => {
      const parsed = parseQuery(q.query);
      return 'displayUnit' in parsed ? parsed.displayUnit : undefined;
    })
    .filter((u): u is string => u === 'kg' || u === 'lb');

  const unique = Array.from(new Set(units));
  if (unique.length === 1) {
    return { unit: unique[0] as AnalyticsUnit, forced: true };
  }
  return { unit: preferredUnit, forced: false };
}
export interface AnalyticsUnitPreferenceProps {
  className?: string;
  unit?: AnalyticsUnit;
  forced?: boolean;
  storage?: StorageLike;
}

export function AnalyticsUnitPreference({ className, unit: unitProp, forced = false, storage }: AnalyticsUnitPreferenceProps) {
  const { unit: storedUnit, setUnit } = useAnalyticsUnitPreference(storage);
  const activeUnit = unitProp ?? storedUnit;

  return (
    <div
      data-testid="analytics-unit-preference"
      className={cn('inline-flex items-center gap-1 text-xs', className)}
    >
      <SegmentedControl
        aria-label="Display unit preference"
        value={activeUnit}
        disabled={forced}
        onValueChange={(next) => {
          if (next === 'kg' || next === 'lb') setUnit(next);
        }}
        title={forced ? 'Unit forced by query directive in this view' : 'Display unit preference'}
        className={cn(
          'inline-flex items-center rounded-lg border border-border bg-card p-1',
          forced && 'opacity-70',
        )}
      >
        <SegmentedControlIndicator />
        <SegmentedControlItem
          value="kg"
          className="px-2.5 py-1 rounded-md transition-colors text-xs font-mono text-muted-foreground hover:text-foreground data-checked:bg-primary data-checked:text-primary-foreground data-checked:font-medium"
        >
          kg
        </SegmentedControlItem>
        <SegmentedControlItem
          value="lb"
          className="px-2.5 py-1 rounded-md transition-colors text-xs font-mono text-muted-foreground hover:text-foreground data-checked:bg-primary data-checked:text-primary-foreground data-checked:font-medium"
        >
          lb
        </SegmentedControlItem>
      </SegmentedControl>
      {forced && (
        <span className="text-[11px] text-muted-foreground italic">forced by note</span>
      )}
    </div>
  );
}
