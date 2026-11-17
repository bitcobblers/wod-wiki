import { describe, it, expect } from 'bun:test';
import { MetricContainer } from '@bitcobblers/wod-wiki-engine';
import { MetricType, IMetric } from '@bitcobblers/wod-wiki-engine';

function makeMetric(type: MetricType, value: number, origin: 'parser' | 'runtime'): IMetric {
  return { type, value, origin, image: String(value) } as IMetric;
}

describe('debug sort', () => {
  it('sorts runtime first', () => {
    const c = new MetricContainer([
      makeMetric(MetricType.Rep, 10, 'parser'),
      makeMetric(MetricType.Rep, 15, 'runtime'),
    ]);
    const reps = c.getByType(MetricType.Rep);
    expect(reps[0].origin).toBe('runtime');
  });
});
