/**
 * WW-068 — Live timer chip accessible names leak raw values — resistance
 * 'Value: [object Object]' and duration 'Value: 1200000 Origin: parser'.
 *
 * Expected behavior: metric chips in MetricVisualizer expose formatted,
 * human-readable values in their title/accessible names (e.g. 95 lb, 20:00),
 * never '[object Object]' or raw millisecond integers.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MetricType, type IMetric } from '@bitcobblers/wod-wiki-core';
import { MetricVisualizer } from '@/views/runtime/MetricVisualizer';

describe('WW-068 — timer chip labels format metric values', () => {
  it('formats resistance and duration chip tooltips without [object Object] or raw milliseconds', () => {
    const metrics: IMetric[] = [
      {
        type: MetricType.Duration,
        image: '20:00',
        value: 1_200_000,
        origin: 'parser',
      },
      {
        type: MetricType.Resistance,
        image: '95lb',
        value: { amount: 95, units: 'lb' },
        origin: 'parser',
      },
    ];

    const { container } = render(<MetricVisualizer metrics={metrics} />);
    const titles = Array.from(container.querySelectorAll('[title]'))
      .map((el) => el.getAttribute('title') ?? '')
      .filter((t) => t.includes('Type:'));

    expect(titles.length).toBeGreaterThanOrEqual(2);
    for (const title of titles) {
      expect(title).not.toContain('[object Object]');
      expect(title).not.toMatch(/Value: \d{5,}/);
    }
    const resistanceTitle = titles.find((t) => t.startsWith('Type: resistance'));
    expect(resistanceTitle).toBeDefined();
    expect(resistanceTitle).toContain('95');
    expect(resistanceTitle).toContain('lb');
  });
});
