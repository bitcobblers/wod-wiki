import { describe, expect, it } from 'vitest';
import { MetricType, REFERENCE_METADATA_KEY } from '@bitcobblers/wod-wiki-core';
import { metricPresentation } from '../../src/metrics/presentation';
import { tagMarkerType } from '../../src/tags/TagContributions';

const marker = {
    type: tagMarkerType('heavy'),
    value: 'heavy',
    origin: 'parser' as const,
};

describe('tag markers in the display surfaces', () => {
    it('stays out of the runtime badge surface', () => {
        expect(metricPresentation.isHidden(marker, 'runtime-badge')).toBe(true);
    });

    it('stays out of the review grid', () => {
        expect(metricPresentation.isHidden(marker, 'review-grid-cell')).toBe(true);
    });

    it('shows in the debug surface', () => {
        expect(metricPresentation.isHidden(marker, 'debug')).toBe(false);
    });

    it('does not hide what a tag contributes', () => {
        const contributed = { type: 'intensity', value: 'heavy', origin: 'parser' as const };
        expect(metricPresentation.isHidden(contributed, 'runtime-badge')).toBe(false);
    });

    it('hides SystemTime, Spans, and compiler-implied Equipment on athlete surfaces while keeping them on debug', () => {
        const sysTime = { type: MetricType.SystemTime, value: new Date(1_700_000_000_000), origin: 'runtime' as const };
        const spans = { type: MetricType.Spans, value: [{ started: 1000, ended: 2000 }], origin: 'runtime' as const };
        const impliedEq = {
            type: MetricType.Equipment,
            value: ['pull-up-bar'],
            origin: 'compiler' as const,
            metadata: { [REFERENCE_METADATA_KEY]: { matched: 'whole' } },
        };

        for (const metric of [sysTime, spans, impliedEq]) {
            expect(metricPresentation.isHidden(metric, 'runtime-badge')).toBe(true);
            expect(metricPresentation.isHidden(metric, 'timer-subtitle')).toBe(true);
            expect(metricPresentation.isHidden(metric, 'debug')).toBe(false);
        }
    });
});
