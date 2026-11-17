import { describe, it } from 'vitest';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

function parseMetrics(input: string) {
    const script = createParser().read(input) as any;
    return (script.statements ?? []).map((s: any) =>
        (s.metrics ?? []).map((m: any) => ({ type: m.type, value: m.value, unit: m.unit ?? (m.value as any)?.unit }))
    );
}

describe('distance/weight unit parsing — spacing flexibility', () => {
    const cases: [string, string, number | undefined, string | undefined][] = [
        ['400m Run',        MetricType.Distance, 400,   'm'],
        ['400 m Run',       MetricType.Distance, 400,   'm'],
        ['4mile Run',       MetricType.Distance, 4,     'mile'],
        ['4 mile Run',      MetricType.Distance, 4,     'mile'],
        ['4miles Run',      MetricType.Distance, 4,     'miles'],
        ['4 miles Run',     MetricType.Distance, 4,     'miles'],
        ['1.5km Run',       MetricType.Distance, 1.5,   'km'],
        ['1.5 km Run',      MetricType.Distance, 1.5,   'km'],
        ['100ft jump',      MetricType.Distance, 100,   'ft'],
        ['100 ft jump',     MetricType.Distance, 100,   'ft'],
        ['135lb Clean',     MetricType.Resistance, 135, 'lb'],
        ['135 lb Clean',    MetricType.Resistance, 135, 'lb'],
        ['100kg Deadlift',  MetricType.Resistance, 100, 'kg'],
        ['100 kg Deadlift', MetricType.Resistance, 100, 'kg'],
    ];

    for (const [input, expectedType, expectedValue, expectedUnit] of cases) {
        it(`"${input}" → ${expectedType} ${expectedValue} ${expectedUnit}`, () => {
            const result = parseMetrics(input);
            console.log(`"${input}" =>`, JSON.stringify(result));
            const allMetrics = result.flat();
            const target = allMetrics.find((m: any) => m.type === expectedType);
            if (!target) {
                throw new Error(`Expected metric type=${expectedType} not found. Got: ${JSON.stringify(allMetrics)}`);
            }
            const v = target.value as any;
            const actualValue = typeof v === 'number' ? v : v?.amount;
            const actualUnit = target.unit ?? v?.unit;
            if (actualValue !== expectedValue) {
                throw new Error(`Expected value=${expectedValue}, got ${actualValue}`);
            }
            if (actualUnit !== expectedUnit) {
                throw new Error(`Expected unit="${expectedUnit}", got "${actualUnit}"`);
            }
        });
    }
});
