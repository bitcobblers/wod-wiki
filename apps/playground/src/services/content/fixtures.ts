import { HistoryRecord } from '../../types/history';

export const createMockEntry = (overrides: Partial<HistoryRecord> = {}): HistoryRecord => ({
    id: 'mock-entry-1',
    title: 'Mock WOD',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    targetDate: Date.now(),
    rawContent: '# Mock WOD\n\n- [ ] 100 Pushups',
    tags: ['mock'],
    results: undefined,
    schemaVersion: 1,
    ...overrides
});
