import { describe, it, expect } from 'bun:test';
import type { IMetric, IRuntimeBlock, IScriptRuntime, WhiteboardScript } from '@bitcobblers/wod-wiki-engine';
import {
  createCompiler,
  createParser,
  EventBus,
  MemoryLocation,
  MetricType,
  RuntimeClock,
  RuntimeStack,
  ScriptRuntime,
  StartSessionAction,
} from '@bitcobblers/wod-wiki-engine';
import { commitActualReps, findActualRepOccurrence, getActualRepTargets, readActualReps } from './actuals';

/**
 * Real-runtime regression for the actuals module: user actuals commit onto
 * live blocks, survive pop emission keyed by stable block UUID, separate
 * repeated-round instances, and target exact movement groups in grouped
 * blocks. Uses the production compiler factory and session-root driving
 * (same construction path as the engine integration tests).
 */

function makeRuntime(scriptText: string): { runtime: IScriptRuntime; script: WhiteboardScript } {
  const script = createParser().read(scriptText) as WhiteboardScript;
  const runtime = new ScriptRuntime(script, createCompiler(), {
    stack: new RuntimeStack(),
    clock: new RuntimeClock(),
    eventBus: new EventBus(),
  });
  return { runtime, script };
}

function pushStatement(runtime: IScriptRuntime, script: WhiteboardScript, index: number): IRuntimeBlock {
  const statement = script.statements[index];
  if (!statement) throw new Error(`Statement index ${index} out of bounds`);
  const block = runtime.jit.compile([statement], runtime);
  if (!block) throw new Error(`Failed to compile statement ${index}`);
  runtime.pushBlock(block);
  return block;
}

function userReps(metrics: Iterable<IMetric>): number[] {
  return [...metrics]
    .filter((m) => m.type === MetricType.Rep && m.origin === 'user' && typeof m.value === 'number')
    .map((m) => m.value as number);
}

describe('actuals on a real runtime', () => {
  it('commits, replaces, and emits the user actual on a movement block', () => {
    const { runtime, script } = makeRuntime('10 Burpees');
    try {
      const block = pushStatement(runtime, script, 0);

      expect(readActualReps(block)).toBeNull(); // unknown ≠ zero

      commitActualReps(block, 25); // over target is allowed
      expect(readActualReps(block)).toBe(25);
      commitActualReps(block, 17); // replacement, other metrics untouched
      expect(readActualReps(block)).toBe(17);

      runtime.popBlock();

      const segments = runtime.getOutputStatements().filter((o) => o.outputType === 'segment');
      expect(segments).toHaveLength(1);
      expect(segments[0].sourceBlockKey).toBe(block.key.toString());
      expect(userReps(segments[0].metrics)).toEqual([17]);
      // planned target + computed time results retained alongside the user winner
      expect(segments[0].metrics.toArray().some((m) => m.type === MetricType.Rep && m.origin === 'parser' && m.value === 10)).toBe(true);
      expect(segments[0].metrics.toArray().some((m) => m.type === MetricType.Elapsed)).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps an explicit zero and rejects invalid counts', () => {
    const { runtime, script } = makeRuntime('10 Burpees');
    try {
      const block = pushStatement(runtime, script, 0);

      commitActualReps(block, 0);
      expect(readActualReps(block)).toBe(0); // zero is a real count, not unknown

      expect(() => commitActualReps(block, -1)).toThrow(RangeError);
      expect(() => commitActualReps(block, 2.5)).toThrow(RangeError);
      expect(() => commitActualReps(block, Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
      expect(readActualReps(block)).toBe(0); // rejected writes changed nothing
    } finally {
      runtime.dispose();
    }
  });

  it('exposes targets with stable occurrence identity and resolves them back', () => {
    const { runtime, script } = makeRuntime('10 Burpees');
    try {
      const block = pushStatement(runtime, script, 0);

      const targets = getActualRepTargets(runtime);
      expect(targets).toHaveLength(1);
      expect(targets[0].block).toBe(block);
      expect(targets[0].occurrenceId).toBe(block.key.toString()); // exact stable UUID
      expect(targets[0].target).toBe(10);

      const resolved = findActualRepOccurrence(runtime, targets[0].occurrenceId);
      expect(resolved?.block).toBe(block);
      expect(resolved?.occurrence).toBeUndefined();
      expect(findActualRepOccurrence(runtime, 'stale-key')).toBeUndefined();

      // composite ids on a known block resolve with their occurrence selector
      expect(findActualRepOccurrence(runtime, `${block.key.toString()}:0`)).toBeDefined();
    } finally {
      runtime.dispose();
    }
  });

  it('separates repeated-round instances — fresh UUID and own count per round', () => {
    const { runtime } = makeRuntime('(2)\n  10 Push Ups');
    try {
      // Session root drives statement compilation (production entry path);
      // without it the rounds parent never pushes its children.
      runtime.do(new StartSessionAction());

      const committed: { key: string; value: number }[] = [];
      let guard = 0;
      while (committed.length < 2 && guard++ < 20) {
        const entry = getActualRepTargets(runtime).find((t) => readActualReps(t.block) === null);
        if (entry) {
          const count = committed.length === 0 ? 8 : 12;
          commitActualReps(entry.block, count);
          committed.push({ key: entry.block.key.toString(), value: readActualReps(entry.block)! });
          runtime.popBlock();
        } else {
          // advance the session when no uncommitted rep occurrence is live
          runtime.handle({ name: 'next', timestamp: runtime.clock.currentDate, data: { source: 'actuals-test' } });
        }
      }

      expect(committed).toHaveLength(2);
      expect(committed[0].key).not.toBe(committed[1].key); // fresh UUID per round instance
      expect(committed.map((c) => c.value)).toEqual([8, 12]);

      const segments = runtime.getOutputStatements().filter((o) => o.outputType === 'segment');
      const allUserReps = segments.flatMap((s) => userReps(s.metrics)).sort((a, b) => a - b);
      expect(allUserReps).toEqual([8, 12]);
      const segmentKeys = segments.filter((s) => userReps(s.metrics).length > 0).map((s) => s.sourceBlockKey).sort();
      expect(segmentKeys).toEqual(committed.map((c) => c.key).sort());
    } finally {
      runtime.dispose();
    }
  });
});

describe('actuals on grouped movement blocks', () => {
  const repMetric = (value: number): IMetric => ({ type: MetricType.Rep, value, origin: 'parser', image: String(value) });
  const effortMetric = (name: string): IMetric => ({ type: MetricType.Effort, value: name, origin: 'parser', image: name });

  function groupedBlock() {
    const display = [
      new MemoryLocation('metric:display', [repMetric(21), effortMetric('Thrusters')]),
      new MemoryLocation('metric:display', [repMetric(15), effortMetric('Pull Ups')]),
    ];
    const result: InstanceType<typeof MemoryLocation>[] = [];
    const block = {
      key: { toString: () => 'grouped-key' },
      sourceIds: [7, 9],
      label: 'Group',
      blockType: 'Movement',
      getMemoryByTag: (tag: string) =>
        tag === 'metric:display' ? display : tag === 'metric:result' ? result : [],
      pushMemory: (loc: InstanceType<typeof MemoryLocation>) => { result.push(loc); },
    } as unknown as IRuntimeBlock;
    return { block, runtime: { stack: { blocks: [block] } } as unknown as IScriptRuntime };
  }

  it('writes and reads per movement group — never across movements', () => {
    const { block } = groupedBlock();

    // ambiguous commit without a selector throws instead of broadcasting
    expect(() => commitActualReps(block, 5)).toThrow(/sourceId/);

    commitActualReps(block, 12, { sourceId: 9 });
    expect(readActualReps(block, { sourceId: 9 })).toBe(12);
    expect(readActualReps(block, { sourceId: 7 })).toBeNull();
    expect(readActualReps(block)).toBeNull(); // grouped read without selector is unknown

    commitActualReps(block, 20, { sourceId: 9 }); // replacement on the same group
    expect(readActualReps(block, { sourceId: 9 })).toBe(20);
    // exactly one result location pair created, user metric only on group 1
    const locs = block.getMemoryByTag('metric:result');
    expect(locs).toHaveLength(2);
    expect(userReps(locs[0].metrics)).toEqual([]);
    expect(userReps(locs[1].metrics)).toEqual([20]);
  });

  it('projects grouped targets with composite occurrence ids and resolves them back', () => {
    const { block, runtime } = groupedBlock();

    const targets = getActualRepTargets(runtime);
    expect(targets.map((t) => t.occurrenceId)).toEqual(['grouped-key:7', 'grouped-key:9']);
    expect(targets.map((t) => t.target)).toEqual([21, 15]);
    expect(targets.map((t) => t.label)).toEqual(['Thrusters', 'Pull Ups']);

    const resolved = findActualRepOccurrence(runtime, 'grouped-key:9');
    expect(resolved?.block).toBe(block);
    expect(resolved?.occurrence).toEqual({ sourceId: 9 });
    expect(findActualRepOccurrence(runtime, 'grouped-key')?.occurrence).toBeUndefined();
    expect(findActualRepOccurrence(runtime, 'other-key')).toBeUndefined();
  });

  it('excludes timers/rest/containers and lists targetless movements with null target', () => {
    const movement = (key: string, blockType: string, metrics: IMetric[], extraTags: string[] = []) => {
      const memory = [new MemoryLocation('metric:display', metrics)];
      for (const tag of extraTags) memory.push(new MemoryLocation(tag as never, []));
      return {
        key: { toString: () => key },
        sourceIds: [1],
        label: key,
        blockType,
        getMemoryByTag: (tag: string) => memory.filter((loc) => loc.tag === tag),
        pushMemory: () => {},
      } as unknown as IRuntimeBlock;
    };
    // container parent with a rep in display — must never be listed
    const parent = movement('parent', 'Rounds', [repMetric(10)], ['children:status']);
    // targetless movement (e.g. 500m Row) — listed with null target
    const row = movement('row', 'effort', [{ type: MetricType.Distance, value: 500, origin: 'parser', image: '500m' }, effortMetric('Row')]);
    // pure timer/rest — time-domain, never rep-countable
    const timer = movement('timer', 'Timer', [{ type: MetricType.Duration, value: 30_000, origin: 'parser', image: '0:30' }, effortMetric('Run')]);

    const runtime = { stack: { blocks: [parent, row, timer] } } as unknown as IScriptRuntime;
    const targets = getActualRepTargets(runtime);
    expect(targets).toHaveLength(1);
    expect(targets[0].occurrenceId).toBe('row');
    expect(targets[0].target).toBeNull();
  });
});
