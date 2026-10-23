import { describe, expect, it } from 'bun:test';
import { localDateKey } from './dateFormat';

describe('localDateKey', () => {
    it('formats a date as YYYY-MM-DD in local time', () => {
        expect(localDateKey(new Date(2026, 9, 22))).toBe('2026-10-22');
    });

    it('pads single-digit months and days', () => {
        expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    it('keeps the local calendar day instead of shifting to UTC', () => {
        // 23:30 local on the 22nd is still the 22nd locally, whatever the zone.
        expect(localDateKey(new Date(2026, 9, 22, 23, 30))).toBe('2026-10-22');
    });

    it('does not roll the day forward for times just after midnight', () => {
        expect(localDateKey(new Date(2026, 9, 23, 0, 15))).toBe('2026-10-23');
    });
});
