import { RepMetric } from '../../src/runtime/compiler/metrics/RepMetric';
import { EffortMetric } from '../../src/runtime/compiler/metrics/EffortMetric';
import { describe, it, expect, vi} from 'vitest';
import { EditorState } from '@codemirror/state';
import { DialectStack, createDialectStack, dialectStack } from '../../src/dialects/DialectStack';
import { UnitsDialect } from '../../src/dialects/UnitsDialect';
import { CrossFitDialect } from '../../src/dialects/CrossFitDialect';
import { ClimbDialect } from '../../src/dialects/ClimbDialect';
import { IDialect } from '@bitcobblers/wod-wiki-core';
import { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { MetricType, IMetric } from '@bitcobblers/wod-wiki-core';
import { hintsToContainer, getHints, hasHint } from '../../src/metrics/hints';
import { extractStatements } from '../../src/parser/lezer-mapper';
import { whiteboardScriptLanguage } from '../../src/parser/whiteboard-script-language';
import { MdTimerRuntime } from '../../src/parser/md-timer';

/** Minimal statement with a fresh metrics container. */
function makeStatement(metrics: IMetric[] = []): ICodeStatement {
    return {
        metrics: MetricContainer.from(metrics),
        metricMeta: new Map(),
    } as unknown as ICodeStatement;
}

/** A no-op dialect that records whether it ran, for ordering assertions. */
function probe(id: string, callLog: string[]): IDialect {
    return {
        id,
        name: id,
        analyze: () => {
            callLog.push(`${id}:analyze`);
            return {};
        },
    };
}

describe('DialectStack — composition', () => {
    it('runs dialects in registration order (later dialects see earlier output)', () => {
        const calls: string[] = [];
        const stack = new DialectStack([
            probe('first', calls),
            probe('second', calls),
            probe('third', calls),
        ]);
        stack.process(makeStatement());
        expect(calls).toEqual(['first:analyze', 'second:analyze', 'third:analyze']);
    });

    it('runs transform before analyze within a single dialect', () => {
        const order: string[] = [];
        const d: IDialect = {
            id: 'ordered',
            name: 'ordered',
            transform: () => order.push('transform'),
            analyze: () => {
                order.push('analyze');
                return {};
            },
        };
        new DialectStack([d]).process(makeStatement());
        expect(order).toEqual(['transform', 'analyze']);
    });

    it('base Units Dialect transform runs before sport dialects see the statement', () => {
        // A sport dialect that asserts a *dimensioned* metric is present —
        // only true if the base Units Dialect's transform ran first.
        const observed: MetricType[] = [];
        const sport: IDialect = {
            id: 'sport-observer',
            name: 'sport-observer',
            analyze: (s) => {
                observed.push(...s.metrics.toArray().map(m => m.type));
                return {};
            },
        };
        const stack = new DialectStack([new UnitsDialect(), sport]);
        // RepMetric(100) + EffortMetric('m Run') → fuseUnits → Distance
                        stack.process(makeStatement([new RepMetric(100), new EffortMetric('m Run')]));
        expect(observed).toContain(MetricType.Distance);
    });

    it('accumulates hints from every dialect (no later-wins drop for hints)', () => {
        const d1: IDialect = {
            id: 'd1', name: 'd1',
            analyze: () => ({ metrics: hintsToContainer(['workout.amrap', 'behavior.time_bound']) }),
        };
        const d2: IDialect = {
            id: 'd2', name: 'd2',
            analyze: () => ({ metrics: hintsToContainer(['feature.auto_advance']) }),
        };
        const stmt = makeStatement();
        new DialectStack([d1, d2]).process(stmt);
        expect(getHints(stmt).sort()).toEqual(['behavior.time_bound', 'feature.auto_advance', 'workout.amrap']);
    });

    it('appends metrics (not precedence-merge) — mirrors DialectRegistry semantics', () => {
        const stmt = makeStatement();
        const before = stmt.metrics.length;
        const d: IDialect = {
            id: 'emit', name: 'emit',
            analyze: () => ({ metrics: hintsToContainer(['workout.emom']) }),
        };
        new DialectStack([d]).process(stmt);
        expect(stmt.metrics.length).toBe(before + 1);
    });

    it('processAll processes every statement; process processes one', () => {
        const d: IDialect = {
            id: 'tag', name: 'tag',
            analyze: () => ({ metrics: hintsToContainer(['feature.touched']) }),
        };
        const stack = new DialectStack([d]);
        const batch = [makeStatement(), makeStatement(), makeStatement()];
        stack.processAll(batch);
        for (const s of batch) expect(hasHint(s, 'feature.touched')).toBe(true);

        const lone = makeStatement();
        stack.process(lone);
        expect(hasHint(lone, 'feature.touched')).toBe(true);
    });

    it('exposes the ordered list for inspection', () => {
        const a = probe('a', []);
        const b = probe('b', []);
        const stack = new DialectStack([a, b]);
        expect(stack.list.map(d => d.id)).toEqual(['a', 'b']);
    });
});

describe('DialectStack — personal-overrides', () => {
    it('createDialectStack appends overrides last (a CONTEXT.md concept that was impossible before)', () => {
        const override: IDialect = {
            id: 'personal', name: 'personal',
            analyze: () => ({ metrics: hintsToContainer(['domain.my-override']) }),
        };
        const stack = createDialectStack([override]);
        expect(stack.list[stack.list.length - 1].id).toBe('personal');
    });

    it('override hints land on statements processed by the stack', () => {
        const override: IDialect = {
            id: 'personal', name: 'personal',
            analyze: () => ({ metrics: hintsToContainer(['domain.my-override']) }),
        };
        const stmt = makeStatement();
        createDialectStack([override]).process(stmt);
        expect(hasHint(stmt, 'domain.my-override')).toBe(true);
    });
});

describe('DialectStack — production wiring', () => {
    it('createDialectStack wires base Units first, then all six sport dialects', () => {
        const stack = createDialectStack();
        const ids = stack.list.map(d => d.id);
        expect(ids[0]).toBe('units'); // base must be first
        // The six sport dialects that previously never ran in production.
        expect(ids.slice(1).sort()).toEqual(['cardio', 'climb', 'crossfit', 'habits', 'wod', 'yoga']);
    });

    it('dialectStack module singleton is the production stack', () => {
        expect(dialectStack).toBeInstanceOf(DialectStack);
        expect(dialectStack.list.length).toBe(7); // 1 base + 6 sport
    });

    it('each production sport dialect is the real class (not a probe)', () => {
        const ids = dialectStack.list.map(d => d.id);
        expect(ids).toContain('crossfit');
        expect(ids).toContain('climb');
        const climb = dialectStack.list.find(d => d.id === 'climb')!;
        expect(climb).toBeInstanceOf(ClimbDialect);
        const crossfit = dialectStack.list.find(d => d.id === 'crossfit')!;
        expect(crossfit).toBeInstanceOf(CrossFitDialect);
    });
});

/**
 * Before/after hint snapshot — the guard for the S5b behavior change.
 *
 * Before S5b, only the base Units Dialect ran (the `baseUnits` singleton in
 * lezer-mapper); the six sport Dialects existed but were never registered, so
 * their hints (workout.amrap, workout.emom, climb.*, etc.) never appeared on
 * production-parsed statements. S5b wires the full Stack, so sport hints now
 * surface. This snapshot documents the delta and pins it as intentional.
 *
 * "before" = parse with only UnitsDialect (the old singleton behaviour)
 * "after"  = parse with the full production Stack (extractStatements)
 */
describe('DialectStack — before/after hint snapshot (S5b behavior change)', () => {
    function parseWith(stack: DialectStack, script: string): ICodeStatement[] {
        const runtime = new MdTimerRuntime();
        const raw = runtime.readWithoutDialects(script).statements as ICodeStatement[];
        stack.processAll(raw);
        return raw;
    }

    it('AMRAP script: raw parse has no workout.amrap; full Stack emits it', () => {
        const script = 'AMRAP 10\n  10 Push-ups\n  10 Squats\n';
        // before — only base Units Dialect (the old singleton)
        const before = parseWith(new DialectStack([new UnitsDialect()]), script);
        const beforeHints = before.flatMap(s => getHints(s));
        // after — the production Stack via extractStatements
        const state = EditorState.create({ doc: script, extensions: [whiteboardScriptLanguage] });
        const after = extractStatements(state);
        const afterHints = after.flatMap(s => getHints(s));

        // The behavior change: the hint was absent before, present after.
        expect(beforeHints).not.toContain('workout.amrap');
        expect(afterHints).toContain('workout.amrap');
    });

    it('the production Stack is a strict superset of the Units-only hint set', () => {
        const script = 'AMRAP 10\n  10 Push-ups\n';
        const before = new Set(parseWith(new DialectStack([new UnitsDialect()]), script).flatMap(s => getHints(s)));
        const state = EditorState.create({ doc: script, extensions: [whiteboardScriptLanguage] });
        const after = new Set(extractStatements(state).flatMap(s => getHints(s)));

        // Sport dialects only ADD hints; they never remove the base set.
        for (const h of before) expect(after.has(h)).toBe(true);
        // And the after set is strictly larger (sport hints landed).
        expect(after.size).toBeGreaterThan(before.size);
    });
});

/**
 * :sport block scoping (#895) — a ```` ```log:climbing ```` fence runs only
 * Units + Climb dialects on that block's statements; a bare `time`/`log`
 * runs the full registry stack (today's behavior). Unknown suffixes warn and
 * fall back to the full stack.
 */
describe('DialectStack — :sport block scoping (#895)', () => {
    const CLIMB_LINE = '[The Shield] V7 redpoint @12';
    const SCRIPT = `AMRAP 10\n  10 Push-ups\n${CLIMB_LINE}\n`;

    function parse(script: string, sport?: string): ICodeStatement[] {
        const state = EditorState.create({ doc: script, extensions: [whiteboardScriptLanguage] });
        return extractStatements(state, sport);
    }

    it('bare block runs the full registry stack (unchanged behavior)', () => {
        const hints = parse(SCRIPT).flatMap(s => getHints(s));
        expect(hints).toContain('workout.amrap'); // crossfit ran
        expect(hints).toContain('domain.climb');  // climb ran
    });

    it(':climbing block shows only units + climb dialect output', () => {
        const hints = parse(SCRIPT, 'climbing').flatMap(s => getHints(s));
        expect(hints).toContain('domain.climb');      // climb ran
        expect(hints).not.toContain('workout.amrap'); // crossfit skipped
    });

    it('registry id is accepted directly (:climb)', () => {
        const hints = parse(SCRIPT, 'climb').flatMap(s => getHints(s));
        expect(hints).toContain('domain.climb');
        expect(hints).not.toContain('workout.amrap');
    });

    it('Units still runs in a scoped block — fused units survive, other sport hints do not', () => {
        const statements = parse('400m Run\n', 'climbing');
        expect(statements[0].metrics.some(m => m.type === MetricType.Distance)).toBe(true);
        expect(getHints(statements[0])).not.toContain('workout.run'); // cardio skipped
    });

    it('scoped stack preserves registration order (units before the named sport)', () => {
        const calls: string[] = [];
        const stack = new DialectStack([
            probe('units', calls),
            probe('crossfit', calls),
            probe('climb', calls),
        ]);
        stack.process(makeStatement(), 'climb');
        expect(calls).toEqual(['units:analyze', 'climb:analyze']);
    });

    it('processAll carries the suffix to every statement', () => {
        const calls: string[] = [];
        const stack = new DialectStack([
            probe('units', calls),
            probe('climb', calls),
        ]);
        stack.processAll([makeStatement(), makeStatement()], 'climb');
        expect(calls).toEqual([
            'units:analyze', 'climb:analyze',
            'units:analyze', 'climb:analyze',
        ]);
    });

    it('unknown suffix warns and falls back to the full stack', () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const scoped = parse(SCRIPT, 'underwater-basket-weaving');
            const bare = parse(SCRIPT);
            expect(scoped.flatMap(s => getHints(s)).sort())
                .toEqual(bare.flatMap(s => getHints(s)).sort());
            expect(consoleWarn).toHaveBeenCalled();
        } finally {
            consoleWarn.mockRestore();
        }
    });

    it('an unknown suffix warns only once per suffix (no per-keystroke spam)', () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            parse('10 Pushups\n', 'not-a-sport');
            parse('10 Pushups\n', 'not-a-sport');
            expect(consoleWarn).toHaveBeenCalledTimes(1);
        } finally {
            consoleWarn.mockRestore();
        }
    });

    it('MdTimerRuntime.read carries the suffix down (WhiteboardScript path)', () => {
        const runtime = new MdTimerRuntime();
        const script = runtime.read(SCRIPT, 'climbing');
        const hints = script.statements.flatMap(s => getHints(s));
        expect(hints).toContain('domain.climb');
        expect(hints).not.toContain('workout.amrap');
    });
});
