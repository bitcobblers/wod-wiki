import { describe, expect, it } from 'bun:test';
import { QueryService, type EventStore, type NoteQueryStore } from '@bitcobblers/wod-wiki-wql';
import type { StorageService } from '@/services/storage';
import { loadSampleData, purgeSampleData, hasSampleData, setSampleDataService } from '@/services/analytics/sample';
import type { AnalyticsDataPoint, EventRecord, Note } from '@/types/storage';

import { InMemoryStorage, StorageService as RealStorageService } from '@/services/storage';

const storage = new InMemoryStorage();
const service: StorageService = new RealStorageService(storage);
setSampleDataService(service);

function noteStore(serviceInstance: StorageService): NoteQueryStore {
  return {
    getAllNotes: () => serviceInstance.getAllNotes(),
    getNoteIdsForTag: async (label) => new Set((await serviceInstance.getNotesForTag(label)).map(n => n.id)),
    getNoteTagLabels: async (noteId) => (await serviceInstance.getTagsForNote(noteId)).map(tag => tag.label),
  };
}

function queryService(serviceInstance: StorageService) {
  return new QueryService({ eventStore: serviceInstance as EventStore, noteStore: noteStore(serviceInstance) });
}

describe('sample analytics dataset', () => {
  it('loads a realistic benchmark history that is queryable by effort', async () => {
    const before = await hasSampleData();
    expect(before).toBe(false);

    const { facts } = await loadSampleData();
    expect(facts).toBeGreaterThan(0);

    expect(await hasSampleData()).toBe(true);
    const notes = await service.getNotesForTag('sample');
    const first = notes[0];
    if (!first) throw new Error('Sample Note missing');
    const sessions = await service.getSessionsForNote(first.id);
    expect(first.rawContent).toContain('```log');
    expect(Object.keys(first.blocks)).toEqual(['sample-block']);
    expect(await service.getBlockRevision(first.id, sessions[0].blockId, sessions[0].blockVersion)).toMatchObject({ kind: 'wod', dialect: 'log' });
    expect(sessions[0]).not.toHaveProperty('data');

    const query = queryService(service);
    const thrusterReps = await query.runQuery('sum:totalReps{effort:thruster}');
    expect(thrusterReps.scalar).toBeGreaterThan(0);
    expect(thrusterReps.stages.selected).toBeGreaterThan(0);

    const pullUpTis = await query.runQuery('avg:tis{effort:pull-up}');
    expect(pullUpTis.scalar).toBeGreaterThan(0);
  });

  it('includes intensity tiers on load and volume facts', async () => {
    const query = queryService(service);
    const intensity = await query.runQuery('sum:sessionLoad{} by {intensity, week}');

    expect(intensity.series.length).toBeGreaterThan(0);
    const labels = intensity.series.map((s) => s.label);
    expect(labels).not.toContain('(none)');
    expect(labels).toContain('high');
    expect(labels).toContain('moderate');
    expect(labels).toContain('low');

    const volumeByIntensity = await query.runQuery('sum:totalVolume{} by {intensity}');
    expect(volumeByIntensity.series.length).toBeGreaterThan(0);
    expect(volumeByIntensity.series.map((s) => s.label)).not.toContain('(none)');
  });

  it('includes distance facts for rowing and running disciplines', async () => {
    const query = queryService(service);
    const distance = await query.runQuery('sum:totalDistance{} by {discipline}');

    expect(distance.series.length).toBeGreaterThan(0);
    expect(distance.series.some((s) => s.points.reduce((a, p) => a + (p.value as number), 0) > 0)).toBe(true);

    const disciplines = distance.series.map((s) => s.label);
    expect(disciplines).toContain('rowing');
    expect(disciplines).toContain('running');
  });

  it('emits wellness calc rollups so Recovery & Readiness renders out of the box (WW-028)', async () => {
    const query = queryService(service);
    // Stored unit per canonical key — what the Available Fields catalog and
    // widget labels read. Values live in the unit's natural magnitude (hrv
    // ms, sleep h); 'pts' matches the calc seeds' output units, which keeps
    // the duration-dimension system-default policy (s) from mangling them.
    const expectations: Array<[string, string, number, number]> = [
      ['calc.readiness', 'pts', 40, 100],
      ['calc.hrv', 'pts', 40, 90],
      ['calc.sleep', 'pts', 5, 10],
      ['calc.soreness', 'rating', 1, 7],
      ['calc.monotony', 'ratio', 1, 2],
      ['calc.acwr', 'ratio', 0.5, 1.6],
    ];
    const events = await service.scanAll();
    for (const [key, unit] of expectations) {
      const stored = events.filter((event) =>
        event.metrics.some((m) => 'metadata' in m && (m.metadata as Record<string, unknown> | undefined)?.canonicalKey === key && typeof m.value === 'number'),
      );
      expect(stored.length, key).toBeGreaterThan(0);
      for (const event of stored) {
        for (const m of event.metrics) {
          if ('metadata' in m && (m.metadata as Record<string, unknown> | undefined)?.canonicalKey === key && typeof m.value === 'number') {
            expect(m.unit, key).toBe(unit);
          }
        }
      }
    }
    // The dashboard's headline query and the daily trend series both have data.
    const readinessToday = await query.runQuery('last:calc.readiness{}');
    expect(readinessToday.scalar).toBeGreaterThanOrEqual(40);
    expect(readinessToday.stages.selected).toBeGreaterThan(0);
    for (const [key, , min, max] of expectations) {
      const daily = await query.runQuery(`avg:${key}{} by {day}`);
      expect(daily.series.length, key).toBeGreaterThan(0);
      const value = daily.series[0]!.points[0]!.value as number;
      expect(value, key).toBeGreaterThanOrEqual(min);
      expect(value, key).toBeLessThanOrEqual(max);
    }
  });

  it('reports totalVolume in kilograms, matching the calc engine canonical unit (WW-030)', async () => {
    // The stored unit (what the Available Fields catalog reads), not the
    // display-converted chart unit.
    const events = await service.scanAll();
    const volumeFacts = events.filter((event) =>
      event.metrics.some((m) => typeof m.value === 'number' && 'metadata' in m && (m.metadata as Record<string, unknown> | undefined)?.canonicalKey === 'totalVolume'),
    );
    expect(volumeFacts.length).toBeGreaterThan(0);
    const values: Array<{ value: number; unit: string }> = [];
    for (const event of volumeFacts) {
      for (const m of event.metrics) {
        if (typeof m.value === 'number' && 'metadata' in m && (m.metadata as Record<string, unknown> | undefined)?.canonicalKey === 'totalVolume') {
          expect(m.unit).toBe('kg');
          values.push({ value: m.value, unit: m.unit ?? '' });
        }
      }
    }
    expect(values.every((v) => v.value > 0)).toBe(true);

    const query = queryService(service);
    const volume = await query.runQuery('sum:totalVolume{}');
    expect(volume.scalar).toBeGreaterThan(0);
    expect(volume.unit).toBe('kg');
  });

  it('is idempotent: a second load does not add more facts', async () => {
    const first = await loadSampleData();
    const second = await loadSampleData();
    expect(second.facts).toBe(first.facts);

    const events = await service.scanAll();
    const sampleEvents = events.filter((event) => event.noteId.startsWith('sample-') && event.grain === 'summary');
    expect(sampleEvents).toHaveLength(first.facts);
  });

  it('purges exactly the sample rows and leaves user rows untouched', async () => {
    // Seed a user-owned event row and tag it distinctly.
    const userNoteId = `user-${crypto.randomUUID()}`;
    const userNote: Note = {
      id: userNoteId,
      title: 'User workout',
      createdAt: Date.now(),
      rawContent: '',
      sourceRevision: 1,
      blocks: {},
    };
    await service.saveNote(userNote);
    await service.setNoteTags(userNoteId, ['user-data']);
    const userFact: AnalyticsDataPoint = {
      id: `user-fact-${crypto.randomUUID()}`,
      noteId: userNoteId,
      resultId: `user-result-${crypto.randomUUID()}`,
      blockId: 'user-block',
      blockVersion: 1,
      grain: 'summary',
      type: 'totalReps',
      metricKey: 'totalReps',
      value: 100,
      unit: 'reps',
      label: 'Total reps',
      metricLabel: 'Total reps',
      metricUnit: 'reps',
      timestamp: Date.now(),
      createdAt: Date.now(),
    };
    await service.appendEvents([{
      id: `${userFact.resultId}:summary:${userFact.metricKey}`,
      resultId: userFact.resultId,
      noteId: userFact.noteId,
      blockId: userFact.blockId,
      blockVersion: userFact.blockVersion,
      timestamp: userFact.timestamp,
      grain: 'summary',
      outputType: 'analytics',
      metrics: [{ type: userFact.metricKey, value: userFact.value, unit: userFact.unit, origin: 'engine' }],
    } satisfies EventRecord]);

    const sampleNotes = await service.getNotesForTag('sample');
    const retainedNote = sampleNotes[0];
    if (!retainedNote) throw new Error('Sample Note missing');
    const retainedSession = (await service.getSessionsForNote(retainedNote.id))[0];
    await purgeSampleData();

    expect(await hasSampleData()).toBe(false);

    const events = await service.scanAll();
    const sampleEvents = events.filter((event) => event.noteId.startsWith('sample-'));
    expect(sampleEvents).toHaveLength(0);
    expect(await service.getBlockRevision(retainedNote.id, retainedSession.blockId, retainedSession.blockVersion)).toBeDefined();
    expect(await service.getSessionById(retainedSession.id)).toEqual(retainedSession);

    const allEvents = await service.scanAll();
    const userEvents = allEvents.filter((event) => event.noteId === userNoteId);
    expect(userEvents.length).toBeGreaterThan(0);

    const userTags = await service.getTagsForNote(userNoteId);
    expect(userTags.map(t => t.label)).toContain('user-data');
  });
});
