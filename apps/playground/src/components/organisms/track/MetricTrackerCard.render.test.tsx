import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import * as realEngine from '@bitcobblers/wod-wiki-engine/react';

mock.module('@bitcobblers/wod-wiki-engine/react', () => ({
  ...realEngine,
  // Live Tier-2 snapshot: one entry per projection (Label + value pair).
  useLiveAnalytics: () => ([
    { outputType: 'analytics', metrics: [
      { type: 'label', image: 'totalLoad', value: 'totalLoad' },
      { type: 'metric', image: '1200 kg', value: 1200, unit: 'kg' },
    ]},
    { outputType: 'analytics', metrics: [
      { type: 'label', image: 'calculated', value: 'calculated' },
      { type: 'metric', image: '420 pts', value: 420, unit: 'pts' },
    ]},
    { outputType: 'analytics', metrics: [
      { type: 'label', image: 'custom_metric', value: 'custom_metric' },
      { type: 'metric', image: 'Zone 2 ', value: 'Zone 2', unit: '' },
    ]},
  ]),
  useOutputStatements: () => ({ outputs: [] }),
}));

const { MetricTrackerCard } = await import('./MetricTrackerCard');

describe('MetricTrackerCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('humanizes unknown session-total keys while keeping custom and calculated metrics visible', () => {
    render(<MetricTrackerCard />);

    expect(screen.getByText('Total Load')).toBeDefined();
    expect(screen.getByText('Calculated')).toBeDefined();
    expect(screen.getByText('Custom Metric')).toBeDefined();
    expect(screen.getByText('1200')).toBeDefined();
    expect(screen.getByText('420')).toBeDefined();
    expect(screen.getByText('Zone 2')).toBeDefined();
  });
});
