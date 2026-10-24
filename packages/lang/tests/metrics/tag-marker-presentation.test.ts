import { describe, expect, it } from 'vitest';
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
});
