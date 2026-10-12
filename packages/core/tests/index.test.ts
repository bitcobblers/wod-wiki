import { describe, it, expect } from 'vitest';
import {
  Metric,
  MetricType,
  MetricContainer,
  ParsedCodeStatement,
  OutputStatement,
  OwnershipResolver,
  createMetricOwnershipLedger,
  BlockKey,
  runAffordance,
  isWorkoutSectionType,
  toNotebookTag,
  fromNotebookTag,
  isNotebookTag,
  type TimeSpan,
  type StoredOutputStatement,
  type Session,
  type EventRecord,
  type Note,
  type BlockRevision,
  type BlockIndexRow,
  type AnalyticsDataPoint,
  type IDialectTagDescriptor,
  type IMetricSource,
} from '../src/index';

describe('@bitcobblers/wod-wiki-core public API', () => {
  describe('Metric & MetricType', () => {
    it('creates a metric and resolves numeric value', () => {
      const reps = new Metric('pullups', 'reps', 21, 'reps', 'parsed', 'set');
      expect(reps.name).toBe('pullups');
      expect(reps.type).toBe('reps');
      expect(reps.value).toBe(21);
      expect(reps.toNumber()).toBe(21);
    });

    it('parses string values to number', () => {
      const weight = new Metric('thruster', 'weight', '95', 'lbs', 'parsed', 'set');
      expect(weight.toNumber()).toBe(95);
    });

    it('returns 0 for unparseable string values', () => {
      const custom = new Metric('custom', 'custom', 'invalid', undefined, 'parsed', 'none');
      expect(custom.toNumber()).toBe(0);
    });

    it('exposes MetricType enum keys', () => {
      expect(MetricType.Duration).toBe('duration');
      expect(MetricType.Rep).toBe('rep');
      expect(MetricType.Elapsed).toBe('elapsed');
      expect(MetricType.Hint).toBe('hint');
      expect(MetricType.Calculated).toBe('calculated');
    });
  });

  describe('MetricContainer', () => {
    it('stores and retrieves metrics', () => {
      const container = new MetricContainer(undefined, 'note-123');
      const m1 = new Metric(MetricType.Rep, 10, 'parser');
      const m2 = new Metric(MetricType.Resistance, 135, 'parser', 'lbs');

      container.add(m1, m2);

      expect(container.size).toBe(2);
      expect(container.has(MetricType.Rep)).toBe(true);
      expect(container.get(MetricType.Rep)).toBe(m1);
      expect(container.getAll()).toEqual([m1, m2]);

      container.clear();
      expect(container.size).toBe(0);
    });
  });

  describe('TimeSpan', () => {
    it('handles TimeSpan shape', () => {
      const span: TimeSpan = { started: 1000, ended: 5000 };
      expect(span.started).toBe(1000);
      expect(span.ended).toBe(5000);
    });
  });

  describe('OutputStatement & CodeStatement', () => {
    it('creates ParsedCodeStatement and OutputStatement', () => {
      const stmt = new ParsedCodeStatement({
        id: 1,
        line: 1,
        text: '21 pullups',
        raw: '21 pullups',
        metrics: [new Metric(MetricType.Rep, 21)],
      });

      expect(stmt.id).toBe(1);
      expect(stmt.hasMetric(MetricType.Rep)).toBe(true);

      const output = new OutputStatement({
        outputType: 'segment',
        timeSpan: { started: 1700000000000, ended: 1700000060000 },
        sourceBlockKey: 'block-1',
        metrics: stmt.metrics,
      });

      expect(output.outputType).toBe('segment');
      expect(output.timeSpan.started).toBe(1700000000000);
      expect(output.hasMetric(MetricType.Rep)).toBe(true);

      const source: IMetricSource = output;
      expect(source.getDisplayMetrics()).toHaveLength(1);
    });
  });

  describe('OwnershipResolver & MetricOwnershipLedger', () => {
    it('resolves precedence via OwnershipResolver', () => {
      const resolver = new OwnershipResolver();
      const p = new Metric(MetricType.Rep, 10, 'parser');
      const r = new Metric(MetricType.Rep, 12, 'runtime');

      const result = resolver.resolve([p, r]);
      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(12);
    });

    it('explains visibility via createMetricOwnershipLedger', () => {
      const p = new Metric(MetricType.Rep, 10, 'parser');
      const r = new Metric(MetricType.Rep, 12, 'runtime');
      const ledger = createMetricOwnershipLedger([p, r]);

      expect(ledger.visible()).toHaveLength(1);
      expect(ledger.raw()).toHaveLength(2);
    });
  });

  describe('BlockKey & Sections', () => {
    it('creates and compares BlockKey', () => {
      const key1 = new BlockKey('custom-key');
      const key2 = new BlockKey('custom-key');
      const key3 = new BlockKey('other-key');

      expect(key1.equals(key2)).toBe(true);
      expect(key1.equals(key3)).toBe(false);
      expect(key1.toString()).toBe('custom-key');
    });

    it('runAffordance returns correct affordance', () => {
      expect(runAffordance('time')).toBe('run');
      expect(runAffordance('log')).toBe('log');
      expect(runAffordance('other')).toBe(null);
    });

    it('isWorkoutSectionType checks fence dialect types', () => {
      expect(isWorkoutSectionType('time')).toBe(true);
      expect(isWorkoutSectionType('log')).toBe(true);
      expect(isWorkoutSectionType('markdown')).toBe(false);
    });
  });

  describe('Notebook tags', () => {
    it('formats and parses notebook tags', () => {
      const tag = toNotebookTag('crossfit');
      expect(tag).toBe('notebook:crossfit');
      expect(isNotebookTag(tag)).toBe(true);
      expect(fromNotebookTag(tag)).toBe('crossfit');
      expect(isNotebookTag('general')).toBe(false);
      expect(fromNotebookTag('general')).toBe(null);
    });
  });

  describe('Persistence shape types compile cleanly', () => {
    it('accepts conformant shapes', () => {
      const storedOutput: StoredOutputStatement = {
        id: 1,
        outputType: 'segment',
        timeSpan: { started: 1000, ended: 2000 },
        metrics: [{ type: 'rep', value: 21, origin: 'parser' }],
        sourceBlockKey: 'b1',
      };

      const workoutResult: Session = {
        id: 'res-1',
        noteId: 'note-1',
        createdAt: 1000,
        blockId: 's1',
        blockVersion: 1,
        startTime: 1000,
        endTime: 2000,
        duration: 1000,
        completed: true,
      };

      const note: Note = {
        id: 'n1',
        title: 'Murph',
        createdAt: 1000,
        rawContent: '```time\n21 pullups\n```',
        sourceRevision: 1,
        blocks: { s1: { id: 's1', kind: 'wod', version: 1, sourceRevision: 1, from: 0, to: '```time\n21 pullups\n```'.length, dialect: 'time' } },
      };

      const revision: BlockRevision = {
        blockId: 's1', version: 1, noteId: 'n1', kind: 'wod', dialect: 'time',
        rawContent: note.rawContent, savedAt: 1000,
      };

      const indexRow: BlockIndexRow = {
        id: 'n1:s1',
        noteId: 'n1',
        blockId: 's1',
        blockVersion: 1,
        sourceRevision: 1,
        from: 0,
        to: note.rawContent.length,
        dataType: 'wod',
        rawContent: note.rawContent,
        noteTitle: 'Murph',
        createdAt: 1000,
      };

      const point: AnalyticsDataPoint = {
        id: 'p1',
        noteId: 'n1',
        blockId: 's1',
        blockVersion: 1,
        resultId: 'res-1',
        type: 'totalLoad',
        value: 1200,
        label: 'Total Load',
        timestamp: 1000,
        createdAt: 1000,
      };

      const dialectTag: IDialectTagDescriptor = {
        tag: 'climb',
        aliases: ['climbing'],
        name: 'Climbing',
        runnable: true,
      };

      expect(workoutResult.completed).toBe(true);
      expect(note.title).toBe('Murph');
      expect(revision.kind).toBe('wod');
      expect(indexRow.noteTitle).toBe('Murph');
      expect(point.value).toBe(1200);
      expect(dialectTag.tag).toBe('climb');
    });
  });
});
