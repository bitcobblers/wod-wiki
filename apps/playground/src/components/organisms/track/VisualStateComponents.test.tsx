import React from 'react';
import { describe, it, expect, beforeEach } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { getOutputsForHistoryBlock, HistorySummaryView } from '@/components/atoms/VisualStateComponents';
import { MetricType, OutputStatement, OutputStatementType } from '@bitcobblers/wod-wiki-engine';
import { TimeSpan } from '@bitcobblers/wod-wiki-engine';

function makeOutput(type: OutputStatementType, stackLevel: number): OutputStatement {
    return new OutputStatement({
        outputType: type,
        timeSpan: new TimeSpan(0, 60000),
        sourceBlockKey: `block-${stackLevel}`,
        stackLevel,
        metrics: [],
    });
}

describe('getOutputsForHistoryBlock', () => {
    beforeEach(() => {
        OutputStatement.resetIdCounter();
    });

    it('assigns depth-1 outputs to root when only root is visible', () => {
        const outputs = [
            makeOutput('segment', 1),
        ];
        // Only root visible (totalVisible = 1)
        const result = getOutputsForHistoryBlock(outputs, 0, 1);
        expect(result).toHaveLength(1);
        expect(result[0].stackLevel).toBe(1);
    });

    it('bubbles up orphaned deep outputs to the deepest visible ancestor', () => {
        const outputs = [
            makeOutput('segment', 1),
            makeOutput('segment', 2),
            makeOutput('segment', 3),
        ];
        // Only root visible (totalVisible = 1)
        const rootHistory = getOutputsForHistoryBlock(outputs, 0, 1);
        expect(rootHistory).toHaveLength(3);
        expect(rootHistory.map(o => o.stackLevel)).toEqual([1, 2, 3]);
    });

    it('shows immediate children under their parent when stack is full', () => {
        const outputs = [
            makeOutput('segment', 1),
            makeOutput('segment', 2),
            makeOutput('segment', 3),
        ];
        // Full stack visible: root + child + leaf (totalVisible = 3)
        const rootHistory = getOutputsForHistoryBlock(outputs, 0, 3);
        expect(rootHistory.map(o => o.stackLevel)).toEqual([1]);

        const childHistory = getOutputsForHistoryBlock(outputs, 1, 3);
        expect(childHistory.map(o => o.stackLevel)).toEqual([2]);

        const leafHistory = getOutputsForHistoryBlock(outputs, 2, 3);
        expect(leafHistory.map(o => o.stackLevel)).toEqual([3]);
    });

    it('handles partially collapsed stack (intermediate block popped)', () => {
        const outputs = [
            makeOutput('segment', 1), // child output
            makeOutput('segment', 2), // leaf output (child was popped)
        ];
        // Root + leaf visible, child was popped (totalVisible = 2)
        const rootHistory = getOutputsForHistoryBlock(outputs, 0, 2);
        expect(rootHistory.map(o => o.stackLevel)).toEqual([1]);

        const leafHistory = getOutputsForHistoryBlock(outputs, 1, 2);
        expect(leafHistory.map(o => o.stackLevel)).toEqual([2]);
    });

    it('ignores non-segment outputs', () => {
        const outputs = [
            makeOutput('system', 1),
            makeOutput('segment', 1),
            makeOutput('event', 2),
        ];
        const result = getOutputsForHistoryBlock(outputs, 0, 1);
        expect(result).toHaveLength(1);
        expect(result[0].outputType).toBe('segment');
    });

    it('ignores root-level outputs (stackLevel 0)', () => {
        const outputs = [
            makeOutput('segment', 0),
        ];
        const result = getOutputsForHistoryBlock(outputs, 0, 1);
        expect(result).toHaveLength(0);
    });

    it('returns empty array when no outputs match', () => {
        const outputs: OutputStatement[] = [];
        const result = getOutputsForHistoryBlock(outputs, 0, 1);
        expect(result).toHaveLength(0);
    });

    it('WW-009: excludes zero-duration structural waiting-to-start and session-root markers from completed history', () => {
        const waitingMount = new OutputStatement({
            outputType: 'segment',
            timeSpan: new TimeSpan(1000, 1000),
            sourceBlockKey: 'waiting-to-start',
            stackLevel: 1,
            metrics: [{ type: MetricType.Label, value: 'Ready to Start', image: 'Ready to Start', origin: 'runtime' }],
        });
        const waitingPop = new OutputStatement({
            outputType: 'segment',
            timeSpan: new TimeSpan(1000, 1000),
            sourceBlockKey: 'waiting-to-start',
            stackLevel: 1,
            metrics: [{ type: MetricType.Elapsed, value: 0, image: '0:00', origin: 'tracked' }],
        });
        const emptyMarker = new OutputStatement({
            outputType: 'segment',
            timeSpan: new TimeSpan(1000, 1000),
            sourceBlockKey: 'container-open',
            stackLevel: 1,
            metrics: [],
        });

        expect(getOutputsForHistoryBlock([waitingMount, waitingPop, emptyMarker], 0, 2)).toHaveLength(0);

        render(<HistorySummaryView outputs={[waitingMount, waitingPop, emptyMarker]} />);
        expect(screen.getByText('0')).toBeTruthy();
    });

    it('WW-009: counts zero-duration segments that carry real effort or rep metrics', () => {
        const quickSet = new OutputStatement({
            outputType: 'segment',
            timeSpan: new TimeSpan(1000, 1000),
            sourceBlockKey: 'effort-1',
            stackLevel: 2,
            metrics: [
                { type: MetricType.Effort, value: 'Pushups', image: 'Pushups', origin: 'parser' },
                { type: MetricType.Rep, value: 10, image: '10', origin: 'parser' },
            ],
        });

        expect(getOutputsForHistoryBlock([quickSet], 1, 2)).toHaveLength(1);
    });
});
