import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { ScriptRuntimeProvider } from '@bitcobblers/wod-wiki-engine/react';
import { RuntimeTestBuilder } from '@/testing/harness/RuntimeTestBuilder';
import { MetricTrackerCard } from './MetricTrackerCard';

// Idle runtime — the hook only needs a ScriptRuntimeProvider to exist; the
// card's entries come from the DI seam, not from live analytics.
const harness = new RuntimeTestBuilder().withScript('Helen\n3 Rounds\n400m Run').build();

describe('MetricTrackerCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('humanizes unknown session-total keys while keeping custom and calculated metrics visible', () => {
    render(
      <ScriptRuntimeProvider runtime={harness.runtime}>
        <MetricTrackerCard
          entriesOverride={[
            { label: 'totalLoad', value: 1200, unit: 'kg' },
            { label: 'calculated', value: 420, unit: 'pts' },
            { label: 'custom_metric', value: 'Zone 2', unit: '' },
          ]}
        />
      </ScriptRuntimeProvider>,
    );

    expect(screen.getByText('Total Load')).toBeDefined();
    expect(screen.getByText('Calculated')).toBeDefined();
    expect(screen.getByText('Custom Metric')).toBeDefined();
    expect(screen.getByText('1200')).toBeDefined();
    expect(screen.getByText('420')).toBeDefined();
    expect(screen.getByText('Zone 2')).toBeDefined();
  });
});
