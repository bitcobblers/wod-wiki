import { describe, it, expect } from 'bun:test';
import { escapeCSV, arrayToCSV, statementsToCSV, resultsToCSV } from './NoteCsvFormatter';
import type { HistoryRecord } from '@/types/history';

describe('escapeCSV', () => {
    it('returns empty string for null and undefined', () => {
        expect(escapeCSV(null)).toBe('');
        expect(escapeCSV(undefined)).toBe('');
    });

    it('converts number to string', () => {
        expect(escapeCSV(42)).toBe('42');
        expect(escapeCSV(3.14)).toBe('3.14');
    });

    it('returns string as-is when no special chars', () => {
        expect(escapeCSV('hello')).toBe('hello');
        expect(escapeCSV('plain text')).toBe('plain text');
    });

    it('wraps in quotes when value contains comma', () => {
        expect(escapeCSV('a,b')).toBe('"a,b"');
    });

    it('escapes double quotes by doubling them', () => {
        expect(escapeCSV('say "hello"')).toBe('"say ""hello"""');
    });

    it('wraps in quotes when value contains newline', () => {
        expect(escapeCSV('line1\nline2')).toBe('"line1\nline2"');
    });
});

describe('arrayToCSV', () => {
    it('formats a single row', () => {
        const csv = arrayToCSV(['A', 'B'], [['1', '2']]);
        expect(csv).toBe('A,B\n1,2');
    });

    it('formats multiple rows', () => {
        const csv = arrayToCSV(['A', 'B'], [['1', '2'], ['3', '4']]);
        expect(csv).toBe('A,B\n1,2\n3,4');
    });

    it('handles special chars in values', () => {
        const csv = arrayToCSV(['A', 'B'], [['a,b', 'x"y'], ['m\nn', 'plain']]);
        expect(csv).toBe('A,B\n"a,b","x""y"\n"m\nn",plain');
    });
});

describe('statementsToCSV', () => {
    it('returns fallback row when sections are empty', () => {
        const entry: HistoryRecord = {
            id: '1',
            createdAt: 0,
            updatedAt: 0,
            schemaVersion: 1,
            sections: [],
        } as unknown as HistoryRecord;
        const csv = statementsToCSV(entry);
        expect(csv).toBe('Statement ID,Parent ID,Line,Fragment Type,Fragment Value,Fragment Behavior\nNo statements found,,,,,');
    });

    it('returns correct CSV for entry with one section, one statement, one metric', () => {
        const entry: HistoryRecord = {
            id: '1',
            createdAt: 0,
            updatedAt: 0,
            schemaVersion: 1,
            sections: [
                {
                    scriptBlock: {
                        statements: [
                            {
                                id: 'stmt-1',
                                parent: 'parent-1',
                                meta: { line: 5 },
                                metrics: [
                                    { type: 'reps', value: 10, origin: 'explicit' },
                                ],
                            },
                        ],
                    },
                },
            ],
        } as unknown as HistoryRecord;
        const csv = statementsToCSV(entry);
        expect(csv).toBe(
            'Statement ID,Parent ID,Line,Fragment Type,Fragment Value,Fragment Behavior\n' +
            'stmt-1,parent-1,5,reps,10,explicit'
        );
    });

    it('returns null columns for statement without metrics', () => {
        const entry: HistoryRecord = {
            id: '1',
            createdAt: 0,
            updatedAt: 0,
            schemaVersion: 1,
            sections: [
                {
                    scriptBlock: {
                        statements: [
                            {
                                id: 'stmt-2',
                                parent: undefined,
                                meta: {},
                                metrics: [],
                            },
                        ],
                    },
                },
            ],
        } as unknown as HistoryRecord;
        const csv = statementsToCSV(entry);
        expect(csv).toBe(
            'Statement ID,Parent ID,Line,Fragment Type,Fragment Value,Fragment Behavior\n' +
            'stmt-2,,,,,'
        );
    });
});

describe('resultsToCSV', () => {
    it('returns fallback row when no results', () => {
        const entry: HistoryRecord = {
            id: '1',
            createdAt: 0,
            updatedAt: 0,
            schemaVersion: 1,
        } as unknown as HistoryRecord;
        const csv = resultsToCSV(entry);
        expect(csv).toBe(
            'Start Time,End Time,Duration (ms),Rounds Completed,Total Rounds,Reps Completed,Completed,Fragment Type,Fragment Value,Metric Behavior,Metric Timestamp\n' +
            'No results found,,,,,,,,,,'
        );
    });

    it('returns correct row for result with logs and metrics', () => {
        const entry: HistoryRecord = {
            id: '1',
            createdAt: 0,
            updatedAt: 0,
            schemaVersion: 1,
            results: {
                startTime: 1000,
                endTime: 2000,
                duration: 1000,
                roundsCompleted: 3,
                totalRounds: 5,
                repsCompleted: 15,
                completed: true,
                logs: [
                    {
                        metrics: [
                            { type: 'weight', value: 225, origin: 'input' },
                        ],
                        timeSpan: { started: 1500 },
                    },
                ],
            },
        } as unknown as HistoryRecord;
        const csv = resultsToCSV(entry);
        expect(csv).toBe(
            'Start Time,End Time,Duration (ms),Rounds Completed,Total Rounds,Reps Completed,Completed,Fragment Type,Fragment Value,Metric Behavior,Metric Timestamp\n' +
            '1000,2000,1000,3,5,15,true,weight,225,input,1500'
        );
    });

    it('returns summary row when result has no logs', () => {
        const entry: HistoryRecord = {
            id: '1',
            createdAt: 0,
            updatedAt: 0,
            schemaVersion: 1,
            results: {
                startTime: 1000,
                endTime: 2000,
                duration: 1000,
                roundsCompleted: null,
                totalRounds: null,
                repsCompleted: null,
                completed: false,
            },
        } as unknown as HistoryRecord;
        const csv = resultsToCSV(entry);
        expect(csv).toBe(
            'Start Time,End Time,Duration (ms),Rounds Completed,Total Rounds,Reps Completed,Completed,Fragment Type,Fragment Value,Metric Behavior,Metric Timestamp\n' +
            '1000,2000,1000,,,,false,,,,'
        );
    });
});
