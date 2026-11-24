import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import {
  GoalRings,
  PRBadge,
  QueryValue,
  WqlEmptyState,
} from '@bitcobblers/wod-wiki-ui';

function makeScalarResult(value: number, unit: string, label = 'Metric'): QueryResult {
  return {
    parsed: {
      family: 'aggregate',
      raw: ':journal | :sum{metric:volume}',
      agg: 'sum',
      metric: 'volume',
      displayUnit: unit,
      error: undefined,
    },
    unit,
    stages: [],
    matched: 1,
    series: [
      {
        key: 'primary',
        label,
        unit,
        points: [{ x: '2026-11-23', value }],
      },
    ],
  } as unknown as QueryResult;
}

function makeEmptyResult(error?: string): QueryResult {
  return {
    parsed: {
      family: 'aggregate',
      raw: ':journal',
      agg: 'sum',
      metric: 'volume',
      error,
    },
    stages: [],
    matched: 0,
    series: [],
  } as unknown as QueryResult;
}

const meta: Meta = {
  title: 'Analyze/Dashboards/Analytics Widgets',
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
  },
};

export default meta;

export const PRBadgeControls: StoryObj<{
  isPR: boolean;
  label: string;
  improvement: number;
  unit: string;
}> = {
  args: {
    isPR: true,
    label: 'Back Squat 1RM',
    improvement: 10,
    unit: 'lb',
  },
  argTypes: {
    isPR: { control: 'boolean' },
    label: { control: 'text' },
    improvement: { control: 'number' },
    unit: { control: 'text' },
  },
  render: (args) => (
    <div className="rounded-xl border border-border bg-card p-6 inline-flex items-center gap-4">
      <PRBadge {...args} />
      {!args.isPR && (
        <span className="text-xs text-muted-foreground">isPR=false renders null</span>
      )}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('pr-badge')).toHaveTextContent('PR!');
    await expect(canvas.getByTestId('pr-badge')).toHaveTextContent('+10 lb');
  },
};

export const QueryValueControls: StoryObj<{
  value: number;
  unit: string;
  label: string;
  useThresholds: boolean;
}> = {
  args: {
    value: 14250,
    unit: 'lb',
    label: 'Weekly Volume (Last 7d)',
    useThresholds: false,
  },
  argTypes: {
    value: { control: { type: 'number', step: 250 } },
    unit: { control: 'text' },
    label: { control: 'text' },
    useThresholds: { control: 'boolean', description: 'Apply green (10k-20k) / red (>=25k) thresholds' },
  },
  render: ({ value, unit, label, useThresholds }) => (
    <div className="rounded-xl border border-border bg-card p-6 h-48 max-w-sm">
      <QueryValue
        result={makeScalarResult(value, unit, label)}
        unit={unit}
        label={label}
        thresholds={useThresholds ? { green: [10000, 20000], red: [25000, 100000] } : undefined}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Weekly Volume (Last 7d)')).toBeInTheDocument();
  },
};

export const GoalRingsControls: StoryObj<{
  currentValue: number;
  goalTarget: number;
  unit: string;
  label: string;
}> = {
  args: {
    currentValue: 4,
    goalTarget: 5,
    unit: 'sessions',
    label: 'Weekly Sessions',
  },
  argTypes: {
    currentValue: { control: { type: 'range', min: 0, max: 7, step: 1 } },
    goalTarget: { control: { type: 'range', min: 1, max: 7, step: 1 } },
    unit: { control: 'text' },
    label: { control: 'text' },
  },
  render: ({ currentValue, goalTarget, unit, label }) => (
    <div className="rounded-xl border border-border bg-card p-6 h-52 max-w-md">
      <GoalRings
        result={makeScalarResult(currentValue, unit, label)}
        attributes={{ goal: String(goalTarget) }}
        unit={unit}
        label={label}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('goal-rings-widget')).toBeInTheDocument();
    await expect(canvas.getByTestId('goal-ring-item')).toBeInTheDocument();
  },
};

export const WqlEmptyStateControls: StoryObj<{
  state: 'loading' | 'error' | 'empty' | 'fallback';
  errorMessage: string;
  fallbackMessage: string;
}> = {
  args: {
    state: 'empty',
    errorMessage: 'Unknown metric key "watts_peak"',
    fallbackMessage: 'Select a series to render chart output.',
  },
  argTypes: {
    state: {
      control: 'inline-radio',
      options: ['loading', 'error', 'empty', 'fallback'],
    },
    errorMessage: { control: 'text' },
    fallbackMessage: { control: 'text' },
  },
  render: ({ state, errorMessage, fallbackMessage }) => {
    const result =
      state === 'loading'
        ? undefined
        : state === 'error'
          ? makeEmptyResult(errorMessage)
          : state === 'empty'
            ? makeEmptyResult()
            : makeScalarResult(1, 'sessions');

    return (
      <div className="rounded-xl border border-border bg-card p-6 h-40 max-w-md">
        <WqlEmptyState
          result={result}
          fallbackMessage={state === 'fallback' ? fallbackMessage : undefined}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No data for this range.')).toBeInTheDocument();
  },
};
