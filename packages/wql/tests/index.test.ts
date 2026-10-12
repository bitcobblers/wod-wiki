import { describe, it, expect } from 'vitest';
import {
  parseQuery,
  serialize,
  isFindQuery,
  QueryService,
  WQL_KEYWORDS,
  WQL_CALC_TARGETS,
  WQL_METRIC_FAMILIES,
  WQL_METRIC_AGGREGATES,
  WQL_AGGREGATORS,
  WQL_COMPARISON_OPS,
  WQL_TAG_KEYS,
  WQL_VIRTUAL_DIMS,
  WQL_FIND_TARGETS,
  WQL_SOURCE_VALUES,
  WQL_CONTENT_FILTER_KEYS,
  WQL_SOURCES,
  WQL_ROLLUP_PERIODS,
  WQL_DISPLAY_UNITS,
  wql,
  wqlLanguage,
  wqlParser,
  buildDashboardDocument,
  parseDashboardNote,
  buildDashboardScaffold,
  EFFORT_DISCIPLINES,
  convertViaCatalog,
  resolveOutputUnit,
  normalizeSummaryFacts,
  toEventRows,
  toSummaryEventRows,
  projectEventToFacts,
  type EventStore,
  type NoteQueryStore,
  type BlockQueryStore,
  type EffortQueryStore,
  type QueryServiceStores,
  type ParsedAggregateQuery,
  type ParsedFindQuery,
  type DashboardDocument,
} from '../src/index';

describe('@bitcobblers/wod-wiki-wql public surface', () => {
  it('exports grammar, AST parser, and type guards', () => {
    expect(wqlParser).toBeDefined();
    const findAst = parseQuery(':note{tags:pr} in journal last 8w');
    expect(isFindQuery(findAst)).toBe(true);
    expect((findAst as ParsedFindQuery).target).toBe('note');

    const sessionAst = parseQuery(':session{block:bc-1}');
    expect(isFindQuery(sessionAst)).toBe(true);
    expect((sessionAst as ParsedFindQuery).target).toBe('session');

    const analyticsAst = parseQuery('sum:totalVolume{discipline:strength} by {week} in kg');
    expect(isFindQuery(analyticsAst)).toBe(false);
    expect((analyticsAst as ParsedAggregateQuery).agg).toBe('sum');
    expect((analyticsAst as ParsedAggregateQuery).metric).toBe('totalVolume');
    expect(serialize(parseQuery('sum:tis{}'))).toBe('sum:tis{}');
  });

  it('exports vocabulary constants and disciplines', () => {
    expect(WQL_KEYWORDS.length).toBeGreaterThan(0);
    expect(WQL_CALC_TARGETS.length).toBeGreaterThan(0);
    expect(WQL_METRIC_FAMILIES.length).toBeGreaterThan(0);
    expect(WQL_METRIC_AGGREGATES.length).toBeGreaterThan(0);
    expect(WQL_AGGREGATORS.length).toBeGreaterThan(0);
    expect(WQL_COMPARISON_OPS.length).toBeGreaterThan(0);
    expect(WQL_TAG_KEYS.length).toBeGreaterThan(0);
    expect(WQL_VIRTUAL_DIMS.length).toBeGreaterThan(0);
    expect(WQL_FIND_TARGETS.length).toBeGreaterThan(0);
    expect(WQL_SOURCE_VALUES.length).toBeGreaterThan(0);
    expect(WQL_CONTENT_FILTER_KEYS.length).toBeGreaterThan(0);
    expect(WQL_SOURCES.length).toBeGreaterThan(0);
    expect(WQL_ROLLUP_PERIODS.length).toBeGreaterThan(0);
    expect(WQL_DISPLAY_UNITS.length).toBeGreaterThan(0);
    expect(EFFORT_DISCIPLINES.length).toBe(10);
  });

  it('exports CodeMirror language extension', () => {
    expect(wql).toBeDefined();
    expect(wqlLanguage).toBeDefined();
    const extension = wql();
    expect(extension).toBeDefined();
  });

  it('exports DashboardDocument model, parser, and scaffold', () => {
    const raw = buildDashboardScaffold('My Dashboard');
    const { meta, sections } = parseDashboardNote(raw);
    const doc: DashboardDocument = buildDashboardDocument(sections, meta);
    expect(doc.isDashboard).toBe(true);
    expect(doc.title).toBe('My Dashboard');
    expect(doc.widgets.length).toBeGreaterThanOrEqual(1);
  });

  it('exports QueryService with injectable stores and zero default DB imports', async () => {
    const mockEventStore: EventStore = {
      getEventsByTimeRange: async () => [],
      getEventsByResult: async () => [],
      getEventsForNote: async () => [],
      getEventsByContent: async () => [],
      scanAll: async () => [],
      appendEvents: async () => {},
      finalizeSummaries: async () => {},
      deleteEvents: async () => {},
    };
    const mockNoteStore: NoteQueryStore = {
      getAllNotes: async () => [],
      getNoteIdsForTag: async () => new Set(),
      getNoteTagLabels: async () => [],
    };
    const mockBlockStore: BlockQueryStore = {
      getAllBlocks: async () => [],
    };
    const mockEffortStore: EffortQueryStore = {
      getAllEfforts: async () => [],
    };

    const stores: QueryServiceStores = {
      eventStore: mockEventStore,
      noteStore: mockNoteStore,
      blockStore: mockBlockStore,
      effortStore: mockEffortStore,
    };

    const service = new QueryService(stores);
    const result = await service.runQuery('sum:totalVolume{}');
    expect(result.series).toEqual([]);
    expect(result.stages.selected).toBe(0);

    const emptyService = new QueryService();
    const emptyResult = await emptyService.runQuery('sum:totalVolume{}');
    expect(emptyResult.series).toEqual([]);
  });

  it('exports pure utilities for units and event derivation', () => {
    expect(convertViaCatalog(100, 'kg', 'lb')).toBeGreaterThan(200);
    expect(resolveOutputUnit([{ unit: 'lb' }], { directive: 'kg' }).unit).toBe('kg');
    expect(normalizeSummaryFacts([], { noteId: 'n1', resultId: 'r1' })).toEqual([]);
    expect(toEventRows([], { noteId: 'n1', resultId: 'r1' })).toEqual([]);
    expect(toSummaryEventRows([], { noteId: 'n1', resultId: 'r1' })).toEqual([]);
    expect(projectEventToFacts(toEventRows([], { noteId: 'n1', resultId: 'r1' })[0] ?? {
      id: 'x', resultId: 'r', noteId: 'n', timestamp: 0, grain: 'event', outputType: 'segment', metrics: [],
    })).toEqual([]);
  });
});
