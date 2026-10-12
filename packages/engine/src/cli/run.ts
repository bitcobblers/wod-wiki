/**
 * Headless Execution Command Runner
 *
 * Executes Whiteboard Script through JIT compiler and runtime state machine,
 * emitting a versioned execution-log IR envelope.
 */

import {
  createParser,
  createCompiler,
  RuntimeStack,
  createMockClock,
  EventBus,
  ScriptRuntime,
  StartSessionAction,
  NextEvent,
  createAnalyticsEngineForBlock,
  toStoredOutputStatement,
  type INowProvider,
  frozenNow,
} from '@bitcobblers/wod-wiki-lang';
import type {
  StoredOutputStatement,
  WorkoutResults,
  IOutputStatement,
} from '@bitcobblers/wod-wiki-core';
import { createIRFile, type WodWikiIRFile, type ExecutionLog } from '../ir';
import { ParseSyntaxError } from './parse';

export interface RunOptions {
  sport?: string;
  dialect?: 'time' | 'log';
  blockId?: string;
  blockVersion?: number;
  startTime?: number;
  maxIterations?: number;
  now?: INowProvider;
  sourceLabel?: string;
}

export function buildWorkoutResults(
  outputs: readonly IOutputStatement[],
  options: {
    readonly startTime?: number;
    readonly elapsedTime: number;
    readonly completed: boolean;
    readonly now: INowProvider;
  },
): WorkoutResults {
  return {
    startTime: options.startTime ?? options.now.nowMs(),
    endTime: options.now.nowMs(),
    duration: options.elapsedTime,
    completed: options.completed,
    logs: outputs.map(toStoredOutputStatement),
  };
}

/**
 * Runs a workout script to completion using headless state machine and Node clock.
 */
export async function runExecution(
  source: string,
  options: RunOptions = {},
): Promise<WodWikiIRFile<ExecutionLog>> {
  const parser = createParser();
  const script = parser.read(source, options.sport);

  if (script.errors && script.errors.length > 0) {
    throw new ParseSyntaxError(script.errors);
  }

  const startTime = options.startTime ?? Date.now();
  const now = options.now ?? frozenNow(new Date(startTime));
  const compiler = createCompiler();
  const clock = createMockClock(new Date(startTime));
  const stack = new RuntimeStack();
  const eventBus = new EventBus();

  const runtime = new ScriptRuntime(
    script,
    compiler,
    { stack, clock, eventBus },
    {},
    now,
  );

  const { engine, analyticsContext } = createAnalyticsEngineForBlock({
    id: options.blockId ?? 'cli-block',
    content: source,
    statements: script.statements,
    sport: options.sport,
    version: options.blockVersion ?? 1,
    startLine: 0,
    endLine: 0,
    dialect: options.dialect ?? 'time',
    state: 'idle',
    createdAt: Date.now(),
  });
  runtime.analyticsContext = analyticsContext;
  runtime.setAnalyticsEngine(engine);

  const outputs: IOutputStatement[] = [];
  runtime.subscribeToOutput((out) => {
    outputs.push(out);
  });

  // Start the workout session
  runtime.do(new StartSessionAction());

  const maxSteps = options.maxIterations ?? 5000;
  let steps = 0;

  while (stack.count > 0 && steps < maxSteps) {
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));
    clock.advance(1000);
    steps++;
  }

  const workoutResults = buildWorkoutResults(outputs, {
    startTime,
    elapsedTime: steps * 1000,
    completed: stack.count === 0,
    now,
  });

  const logs: StoredOutputStatement[] = outputs.map(toStoredOutputStatement);

  return createIRFile(
    'execution-log',
    {
      results: workoutResults,
      logs,
      statements: logs,
      sourceScript: source,
    },
    { source: options.sourceLabel ?? 'cli:wod run' },
  );
}
