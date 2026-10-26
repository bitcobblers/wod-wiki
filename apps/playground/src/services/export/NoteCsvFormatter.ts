import type { HistoryRecord } from '@/types/history';

/**
 * Escape a CSV field value
 */
export function escapeCSV(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Convert array of objects to CSV string
 */
export function arrayToCSV(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
    const headerRow = headers.map(escapeCSV).join(',');
    const dataRows = rows.map(row => row.map(escapeCSV).join(','));
    return [headerRow, ...dataRows].join('\n');
}

/**
 * Convert parsed statements/metrics to CSV
 */
export function statementsToCSV(entry: HistoryRecord): string {
    const headers = [
        'Statement ID',
        'Parent ID',
        'Line',
        'Fragment Type',
        'Fragment Value',
        'Fragment Behavior'
    ];

    const rows: (string | number | null)[][] = [];

    // Extract statements from sections if they exist
    if (entry.sections) {
        for (const section of entry.sections) {
            if (section.scriptBlock?.statements) {
                for (const stmt of section.scriptBlock.statements) {
                    if (stmt.metrics && stmt.metrics.length > 0) {
                        for (const metric of stmt.metrics) {
                            rows.push([
                                stmt.id,
                                stmt.parent ?? null,
                                stmt.meta?.line ?? null,
                                metric.type,
                                metric.value !== undefined ? JSON.stringify(metric.value) : null,
                                metric.origin ?? null,
                            ]);
                        }
                    } else {
                        // Statement without metrics
                        rows.push([
                            stmt.id,
                            stmt.parent ?? null,
                            stmt.meta?.line ?? null,
                            null,
                            null,
                            null,
                        ]);
                    }
                }
            }
        }
    }

    if (rows.length === 0) {
        return arrayToCSV(headers, [['No statements found', null, null, null, null, null]]);
    }

    return arrayToCSV(headers, rows);
}

/**
 * Convert workout results to CSV format
 */
export function resultsToCSV(entry: HistoryRecord): string {
    const headers = [
        'Start Time',
        'End Time',
        'Duration (ms)',
        'Rounds Completed',
        'Total Rounds',
        'Reps Completed',
        'Completed',
        'Fragment Type',
        'Fragment Value',
        'Metric Behavior',
        'Metric Timestamp'
    ];

    const rows: (string | number | boolean | null)[][] = [];

    if (entry.results) {
        const result = entry.results;

        // If there are logs, create a row for each segment output
        if (result.logs && result.logs.length > 0) {
            for (const log of result.logs) {
                for (const metric of log.metrics) {
                    rows.push([
                        result.startTime,
                        result.endTime,
                        result.duration,
                        result.roundsCompleted ?? null,
                        result.totalRounds ?? null,
                        result.repsCompleted ?? null,
                        result.completed,
                        metric.type,
                        metric.value !== undefined ? JSON.stringify(metric.value) : null,
                        metric.origin ?? null,
                        log.timeSpan.started ?? null,
                    ]);
                }
            }
        } else {
            // No log data, just the result summary
            rows.push([
                result.startTime,
                result.endTime,
                result.duration,
                result.roundsCompleted ?? null,
                result.totalRounds ?? null,
                result.repsCompleted ?? null,
                result.completed,
                null,
                null,
                null,
                null,
            ]);
        }
    }

    if (rows.length === 0) {
        return arrayToCSV(headers, [['No results found', null, null, null, null, null, null, null, null, null, null]]);
    }

    return arrayToCSV(headers, rows);
}
