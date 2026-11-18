/**
 * WW-092 — Workout Complete segment table leaks internal labels ('segm',
 * 'Type: segment | #uuid:0 · Block: waiting-to-start · Reason: user-advance')
 * and all split offsets persist as +00:00.
 *
 * Expected behavior: OutputStatementsTable shows human-readable segment
 * titles (no 'segm'), hover text free of internal block/reason/id strings,
 * and real split offsets (> +00:00 for subsequent segments).
 */
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MetricType, type IOutputStatement } from '@bitcobblers/wod-wiki-core';
import { OutputStatementsTable } from '@bitcobblers/wod-wiki-ui';

describe('WW-092 — segment table internal-label leak', () => {
  it('renders human-readable titles, clean hover text, and real split offsets', () => {
    const t0 = 1_700_000_000_000;
    const outputs: IOutputStatement[] = [
      {
        id: '11111111-1111-4111-8111-111111111111:0',
        outputType: 'segment',
        sourceBlockKey: 'waiting-to-start',
        completionReason: 'user-advance',
        timeSpan: { started: t0, ended: t0 + 15_000 },
        metrics: [
          { type: MetricType.Effort, image: '5 Burpees', value: 'Burpees', origin: 'parser' },
          { type: MetricType.Rep, image: '5', value: 5, origin: 'parser' },
        ],
      } as unknown as IOutputStatement,
      {
        id: '22222222-2222-4222-8222-222222222222:0',
        outputType: 'segment',
        sourceBlockKey: 'round-1',
        completionReason: 'user-advance',
        timeSpan: { started: t0 + 15_000, ended: t0 + 45_000 },
        metrics: [
          { type: MetricType.Effort, image: '10 Squats', value: 'Squats', origin: 'parser' },
          { type: MetricType.Rep, image: '10', value: 10, origin: 'parser' },
        ],
      } as unknown as IOutputStatement,
    ];

    const { container } = render(<OutputStatementsTable outputs={outputs} />);
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');

    expect(text).not.toMatch(/\bsegm\b/);
    expect(text).not.toContain('waiting-to-start');
    expect(text).not.toContain('user-advance');

    const leakyTitles = Array.from(container.querySelectorAll('[title]'))
      .map((el) => el.getAttribute('title') ?? '')
      .filter((t) =>
        /Type: segment|Block:|Reason:|waiting-to-start|#[0-9a-f]{8}-[0-9a-f]{4}/i.test(t),
      );
    expect(leakyTitles).toEqual([]);

    const offsets = [...text.matchAll(/\+(\d{2}):(\d{2})/g)].map(
      (m) => Number(m[1]) * 60 + Number(m[2]),
    );
    expect(offsets.length).toBeGreaterThanOrEqual(2);
    expect(offsets.some((s) => s > 0)).toBe(true);
  });
});
