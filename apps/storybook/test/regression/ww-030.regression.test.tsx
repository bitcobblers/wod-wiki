/**
 * WW-030 — Chart unit formatting inconsistent: Y-axis baseline tick '0 kg'
 * (space) vs grouped ticks '5,000kg' (no space) on explorer bar charts.
 *
 * Expected behavior: every Y-axis tick on a kg WqlBars chart uses the shared
 * formatTimeseriesTick convention — locale-grouped digits, one space, then
 * the unit (e.g. '0 kg', '5,000 kg').
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { WqlBars } from '@bitcobblers/wod-wiki-ui';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 640, height: 320 } as Record<string, unknown>),
  };
});

describe('WW-030 — bar-chart Y-axis tick unit spacing', () => {
  it('formats every kg Y-axis tick with locale grouping and a single space before kg', () => {
    const result: QueryResult = {
      query: 'sum:totalVolume{} by {effort}',
      columns: ['effort', 'value'],
      rows: [],
      series: [
        {
          key: 'thrusters',
          label: 'Thrusters',
          unit: 'kg',
          points: [{ x: 'Thrusters', value: 5000 }],
        },
        {
          key: 'deadlift',
          label: 'Deadlift',
          unit: 'kg',
          points: [{ x: 'Deadlift', value: 2500 }],
        },
      ],
      executionTimeMs: 1,
    };

    const { container } = render(
      <div style={{ width: 640, height: 320 }}>
        <WqlBars result={result} />
      </div>,
    );

    const ticks = Array.from(
      container.querySelectorAll(
        '.recharts-yAxis-tick-labels text, .recharts-yAxis .recharts-cartesian-axis-tick text',
      ),
    )
      .map((el) => (el.textContent ?? '').trim())
      .filter(Boolean);

    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.some((t) => t.includes(','))).toBe(true);
    for (const tick of ticks) {
      expect(tick).toMatch(/^\d{1,3}(,\d{3})*(\.\d)? kg$/);
    }
  });
});
