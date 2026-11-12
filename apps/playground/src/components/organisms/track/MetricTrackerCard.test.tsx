import { describe, it, expect } from 'bun:test';
import { formatTrackerValue } from './MetricTrackerCard';
describe('formatTrackerValue', () => {
    it('formats time-like values from milliseconds', () => {
        expect(formatTrackerValue(45000, 'duration')).toBe('00:45');
        expect(formatTrackerValue(325000, 'elapsed')).toBe('05:25');
        expect(formatTrackerValue(5461000, 'total')).toBe('01:31:01');
    });

    it('converts sec/min/h units to ms before formatting', () => {
        expect(formatTrackerValue(90, 'duration', 'sec')).toBe('01:30');
        expect(formatTrackerValue(15, 'elapsed', 'min')).toBe('15:00');
        expect(formatTrackerValue(2, 'total', 'h')).toBe('02:00:00');
    });

    it('formats integers plainly', () => {
        expect(formatTrackerValue(135, 'rep')).toBe('135');
        expect(formatTrackerValue(0, 'rep')).toBe('0');
    });

    it('formats decimals to one decimal place', () => {
        expect(formatTrackerValue(5.2, 'distance')).toBe('5.2');
        expect(formatTrackerValue(8.55, 'intensity')).toBe('8.6');
    });

    it('passes strings through unchanged', () => {
        expect(formatTrackerValue('Rest', 'effort')).toBe('Rest');
        expect(formatTrackerValue('Heavy', 'text')).toBe('Heavy');
    });

    it('handles null/undefined as em-dash', () => {
        expect(formatTrackerValue(null, 'rep')).toBe('—');
        expect(formatTrackerValue(undefined, 'rep')).toBe('—');
    });
});
