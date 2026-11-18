/**
 * WW-074 — HRV trend widget on /dashboard/recovery-readiness labels Y-axis
 * ticks and readout in kg instead of ms.
 *
 * Expected behavior: the HRV trend widget (avg:calc.hrv{} by {day}) labels
 * its Y-axis in milliseconds ('<number> ms') and never in kg.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { WqlTimeseries } from '@bitcobblers/wod-wiki-ui';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 640, height: 320 } as Record<string, unknown>),
  };
});

describe('WW-074 — HRV trend widget units are milliseconds', () => {
  it('labels avg:calc.hrv{} Y-axis ticks in ms, never kg', () => {
    const result: QueryResult = {
      query: 'avg:calc.hrv{} by {day}',
      columns: ['day', 'value'],
      rows: [],
      series: [
        {
          key: 'calc.hrv',
          label: 'HRV',
          points: [
            { x: '2026-11-01', value: 65 },
            { x: '2026-11-02', value: 71 },
            { x: '2026-11-03', value: 78 },
          ],
        },
      ],
      executionTimeMs: 1,
    };

    const { container } = render(
      <div style={{ width: 640, height: 320 }}>
        <WqlTimeseries result={result} unit="kg" />
      </div>,
    );

    const ticks = Array.from(
      container.querySelectorAll(
        '.recharts-yAxis-tick-labels text, .recharts-yAxis .recharts-cartesian-axis-tick text',
      ),
    )
      .map((el) => (el.textContent ?? '').trim())
      .filter(Boolean);

    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const tick of ticks) {
      expect(tick).toMatch(/^\d{1,3}(,\d{3})*(\.\d)? ms$/);
    }
    expect(container.textContent ?? '').not.toContain('kg');
  });
});
