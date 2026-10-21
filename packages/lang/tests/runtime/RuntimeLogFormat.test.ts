import { describe, it, expect, afterEach } from 'vitest';
import { MetricType, OutputStatement } from '@bitcobblers/wod-wiki-core';
import type { IMetric, IOutputStatement } from '@bitcobblers/wod-wiki-core';
import {
    formatRuntimeTimestamp,
    formatRuntimeLogLine,
    formatRuntimeLogRule,
    RUNTIME_LOG_SUBJECT_WIDTH,
} from '../../src/runtime/RuntimeLogFormat';
import { RuntimeLogger } from '../../src/runtime/RuntimeLogger';
import { TimeSpan } from '../../src/runtime/models/TimeSpan';
import { createParser } from '../../src/parser/parserInstance';
import { createCompiler } from '../../src/runtime/services/runtimeServices';
import { ScriptRuntime } from '../../src/runtime/ScriptRuntime';
import { RuntimeStack } from '../../src/runtime/RuntimeStack';
import { RuntimeClock } from '../../src/runtime/RuntimeClock';
import { EventBus } from '../../src/runtime/events/EventBus';
import type { WhiteboardScript } from '../../src/parser/WhiteboardScript';

describe('formatRuntimeTimestamp', () => {
    it('renders HH:MM:SS.mmm with fixed-width fields', () => {
        const d = new Date(2026, 0, 1, 9, 4, 7, 5);
        expect(formatRuntimeTimestamp(d)).toBe('09:04:07.005');
    });
});

describe('formatRuntimeLogLine', () => {
    const ts = new Date(2026, 0, 1, 12, 0, 0, 0);

    it('lays out fixed columns: timestamp, 5-char event, 24-char subject, payload', () => {
        const line = formatRuntimeLogLine(ts, 'PUSH', 'session:helen', 'd1  timer');
        const expected =
            '12:00:00.000' + '  ' + 'PUSH ' + '  ' +
            'session:helen'.padEnd(RUNTIME_LOG_SUBJECT_WIDTH) + '  ' + 'd1  timer';
        expect(line).toBe(expected);
        // Event column always starts at the same offset.
        expect(line.indexOf('PUSH')).toBe(14);
    });

    it('truncates overlong events and pads short subjects', () => {
        const line = formatRuntimeLogLine(ts, 'PUSHED', 'x', undefined);
        expect(line.startsWith('12:00:00.000  PUSHE  ')).toBe(true);
        expect(line.endsWith('x'.padEnd(RUNTIME_LOG_SUBJECT_WIDTH))).toBe(true);
    });

    it('omits the payload separator when there is no payload', () => {
        const line = formatRuntimeLogLine(ts, 'POP', 'rounds');
        expect(line.endsWith('rounds'.padEnd(RUNTIME_LOG_SUBJECT_WIDTH))).toBe(true);
    });
});

describe('formatRuntimeLogRule', () => {
    it('renders a full-width rule without a label', () => {
        expect(formatRuntimeLogRule()).toBe('─'.repeat(52));
    });

    it('centers a labeled rule at 52 chars', () => {
        const rule = formatRuntimeLogRule('round 2 of 3');
        expect(rule.length).toBe(52);
        expect(rule).toContain(' round 2 of 3 ');
        expect(rule.startsWith('─')).toBe(true);
        expect(rule.endsWith('─')).toBe(true);
    });
});

describe('RuntimeLogger paper output', () => {
    const logged: unknown[][] = [];
    const originalLog = console.log;

    afterEach(() => {
        // Disable while the spy is still installed so the HALT line the
        // transition writes lands in the spy, not the real console.
        RuntimeLogger.disable();
        console.log = originalLog;
        RuntimeLogger.clearHistory();
    });

    function spyConsole(): void {
        logged.length = 0;
        console.log = (...args: unknown[]) => { logged.push(args); };
    }

    it('writes nothing while disabled', () => {
        spyConsole();
        RuntimeLogger.logBoot('statements 3');
        expect(logged.length).toBe(0);
        expect(RuntimeLogger.getHistory().length).toBe(0);
    });

    it('writes one aligned paper line per state change when enabled', () => {
        spyConsole();
        RuntimeLogger.enable(); // BOOT line for the transition itself
        logged.length = 0;

        RuntimeLogger.logPush(
            {
                key: 'abcdef12',
                label: 'Run 400 m',
                blockType: 'Timer',
                sourceIds: [],
            } as unknown as Parameters<typeof RuntimeLogger.logPush>[0],
            undefined,
            3,
        );

        expect(logged.length).toBe(1);
        const line = logged[0][0] as string;
        expect(line).toContain('PUSH');
        expect(line).toContain('Run 400 m');
        expect(line).toContain('d3');
        // History mirrors the structured entry.
        const entry = RuntimeLogger.getHistory().find(e => e.category === 'push');
        expect(entry?.message).toBe('PUSH Run 400 m');
    });

    it('derives the OUT subject from real OutputStatement text/Label and filters system/load', () => {
        spyConsole();
        RuntimeLogger.enable();
        logged.length = 0;

        const statement = (outputType: IOutputStatement['outputType'], text?: string, metrics?: IMetric[]) =>
            new OutputStatement({
                outputType,
                timeSpan: new TimeSpan(0, 0),
                sourceBlockKey: 'b1',
                stackLevel: 1,
                text,
                metrics,
            });

        // Subject comes from the propagated source text…
        RuntimeLogger.logOutput(statement('segment', '7 Burpees'));
        // …or from the explicit Label metric when text was never propagated.
        RuntimeLogger.logOutput(statement('milestone', undefined, [{
            type: MetricType.Label, image: 'Round 2', value: 'Round 2', origin: 'runtime', timestamp: new Date(),
        }]));
        // 'system' (and 'load'/'compiler') outputs stay filtered.
        RuntimeLogger.logOutput(statement('system', 'Sound: beep'));
        RuntimeLogger.logOutput(statement('load', '7 Burpees'));

        expect(logged.length).toBe(2);
        expect((logged[0][0] as string).includes('OUT')).toBe(true);
        expect((logged[0][0] as string).includes('7 Burpees')).toBe(true);
        expect((logged[1][0] as string).includes('Round 2')).toBe(true);
        expect(RuntimeLogger.getHistory().filter(e => e.category === 'output').length).toBe(2);
    });

    it('logs the real push/pop segment exactly once, named from source text', () => {
        spyConsole();
        RuntimeLogger.enable();
        logged.length = 0;

        const script = createParser().read('7 Burpees') as WhiteboardScript;
        const runtime = new ScriptRuntime(script, createCompiler(), {
            stack: new RuntimeStack(),
            clock: new RuntimeClock(),
            eventBus: new EventBus(),
        });
        try {
            const block = runtime.jit.compile([script.statements[0]], runtime);
            if (!block) throw new Error('compile failed');
            runtime.pushBlock(block);
            runtime.popBlock();

            const outs = RuntimeLogger.getHistory().filter(e => e.category === 'output');
            expect(outs).toHaveLength(1);
            expect(outs[0].message).toContain('Burpees');
            // Exactly one OUT console line — no double log through public addOutput.
            expect(logged.filter(a => (a[0] as string).includes('OUT'))).toHaveLength(1);
        } finally {
            runtime.dispose();
        }
    });
});
