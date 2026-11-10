import { describe, expect, it } from 'bun:test';
import { MetricContainer, MetricType } from '@bitcobblers/wod-wiki-engine';
import type { ScriptBlock } from '@/components/Editor/types';
import { createRuntimeForBlock, prepareRuntimeBlock } from './runtimeTimerModel';

function makeBlock(content: string): ScriptBlock {
  return {
    id: 'blk-wizard-test',
    content,
    dialect: 'time',
    startLine: 0,
    endLine: content.split('\n').length,
    version: 1,
    state: 'idle',
    widgetIds: {},
    createdAt: Date.now(),
  };
}

describe('runtimeTimerModel — Pre-Run Wizard choice/target preservation', () => {
  it('preserves mutated statement metrics on a prepared block instead of re-parsing at start', () => {
    const rawBlock = makeBlock('5 Back Squat ? lb');
    const prepared = prepareRuntimeBlock(rawBlock);
    expect(prepared.statements.length).toBeGreaterThan(0);

    // Simulate <CollectionWizard> resolving the `? lb` placeholder to 225 lb
    // on `prepared.statements[0]` prior to clicking Start.
    const stmt = prepared.statements[0]!;
    stmt.metrics = MetricContainer.from([
      ...stmt.metrics.filter((m) => m.type !== MetricType.Resistance),
      {
        type: MetricType.Resistance,
        origin: 'user',
        value: { amount: 225, unit: 'lb' },
        image: '225 lb',
      },
    ]);

    const rt = createRuntimeForBlock(prepared);
    expect(rt).not.toBeNull();
    const compiledStmt = rt!.script.statements[0]!;
    const resistance = compiledStmt.metrics.find((m) => m.type === MetricType.Resistance);
    expect(resistance?.origin).toBe('user');
    expect(resistance?.value).toEqual({ amount: 225, unit: 'lb' });
    rt?.dispose();
  });

  it('still parses an unprepared raw block when createRuntimeForBlock is called directly', () => {
    const rawBlock = makeBlock('21 Thrusters 95 lb');
    const rt = createRuntimeForBlock(rawBlock);
    expect(rt).not.toBeNull();
    expect(rt!.script.statements.length).toBe(1);
    rt?.dispose();
  });
});
