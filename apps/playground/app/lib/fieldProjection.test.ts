import { describe, it, expect } from 'bun:test'
import type { Entry } from './entryMapper'
import {
  getEntityLevel,
  getFieldsForLevel,
  getDefaultVisibleFieldIds,
  projectEntry,
  type EntityLevel,
} from './fieldProjection'

describe('fieldProjection - getEntityLevel', () => {
  it('identifies the note kind as note level (sessions and posts folded into note)', () => {
    const noteEntry: Entry = {
      id: 'n1',
      kind: 'note',
      sourceNotebook: 'journal',
      sourceNote: 'n1',
      title: 'Daily Log',
      date: '2026-09-02',
    }
    const postEntry: Entry = {
      id: 'p1',
      kind: 'note',
      sourceNotebook: 'feeds',
      sourceNote: 'p1',
      title: 'Feed Post',
      date: '2026-09-02',
    }
    expect(getEntityLevel(noteEntry)).toBe('note')
    expect(getEntityLevel(postEntry)).toBe('note')
  })

  it('identifies result kind as result level', () => {
    const resultEntry: Entry = {
      id: 'r1',
      kind: 'result',
      sourceNotebook: 'results',
      sourceNote: 'r1',
      title: 'Murph Session',
      date: '2026-09-02',
    }
    expect(getEntityLevel(resultEntry)).toBe('result')
  })

  it('identifies segment and event kinds as segment level', () => {
    const segmentEntry: Entry = {
      id: 'seg-1',
      kind: 'segment',
      sourceNotebook: 'results',
      sourceNote: 'seg-1',
      title: 'Round 1',
      date: '2026-09-02',
    }
    const eventEntry: Entry = {
      id: 'ev-1',
      kind: 'event',
      sourceNotebook: 'results',
      sourceNote: 'ev-1',
      title: 'Split 1',
      date: '2026-09-02',
    }
    expect(getEntityLevel(segmentEntry)).toBe('segment')
    expect(getEntityLevel(eventEntry)).toBe('segment')
  })

  it('identifies effort kind as effort level', () => {
    const effortEntry: Entry = {
      id: 'back-squat',
      kind: 'effort',
      sourceNotebook: 'community',
      sourceNote: 'back-squat',
      title: 'Back Squat',
      date: null,
    }
    expect(getEntityLevel(effortEntry)).toBe('effort')
  })
})

describe('fieldProjection - field registries per entity level (Ticket 002 requirements)', () => {
  it('defines the required available fields for Note level', () => {
    const fields = getFieldsForLevel('note')
    const fieldIds = fields.map(f => f.id)
    expect(fieldIds).toEqual(['title', 'tags', 'excerpt', 'sourceNotebook', 'date'])
  })

  it('defines the required available fields for Session level', () => {
    const fields = getFieldsForLevel('session')
    const fieldIds = fields.map(f => f.id)
    expect(fieldIds).toEqual(['title', 'protocol', 'movements', 'targetDuration', 'sessionLoad'])
  })

  it('defines the required available fields for Result level', () => {
    const fields = getFieldsForLevel('result')
    const fieldIds = fields.map(f => f.id)
    expect(fieldIds).toEqual(['title', 'elapsedTime', 'totalTonnage', 'tis', 'prBadges'])
  })

  it('defines the required available fields for Segment level', () => {
    const fields = getFieldsForLevel('segment')
    const fieldIds = fields.map(f => f.id)
    expect(fieldIds).toEqual(['splitDuration', 'roundIndex', 'reps', 'load', 'pacingTier'])
  })

  it('defines the required available fields for Effort level', () => {
    const fields = getFieldsForLevel('effort')
    const fieldIds = fields.map(f => f.id)
    expect(fieldIds).toEqual(['label', 'canonicalSlug', 'discipline', 'met', 'intensityTier', 'aliases'])
  })

  it('returns default visible field ids for each level', () => {
    const levels: EntityLevel[] = ['note', 'session', 'result', 'segment', 'effort']
    for (const lvl of levels) {
      const defaultIds = getDefaultVisibleFieldIds(lvl)
      expect(defaultIds.length).toBeGreaterThan(0)
      const allIds = getFieldsForLevel(lvl).map(f => f.id)
      for (const id of defaultIds) {
        expect(allIds).toContain(id)
      }
    }
  })
})

describe('fieldProjection - value extraction and formatting', () => {
  it('extracts note level fields from an entry', () => {
    const entry: Entry = {
      id: 'note-1',
      kind: 'note',
      sourceNotebook: 'journal',
      sourceNote: 'note-1',
      title: 'Morning Training',
      date: '2026-09-02',
      tags: ['strength', 'conditioning'],
      block: {
        blockId: 's1',
        dataType: 'wod',
        preview: ['5 rounds for time:', '10 pull-ups', '20 push-ups'],
      },
    }

    const projected = projectEntry(entry, 'note')
    expect(projected.title).toBe('Morning Training')
    expect(projected.tags).toBe('strength, conditioning')
    expect(projected.excerpt).toBe('5 rounds for time: 10 pull-ups 20 push-ups')
    expect(projected.sourceNotebook).toBe('journal')
    expect(projected.date).toBe('2026-09-02')
  })

  it('extracts session level fields from an entry', () => {
    const entry: Entry = {
      id: 'crossfit-girls/fran',
      kind: 'note',
      sourceNotebook: 'crossfit-girls',
      sourceNote: 'fran',
      title: 'Fran',
      date: null,
      subtitle: 'For Time',
      detail: 'Thruster, Pull-up',
      execution: {
        resultId: '',
        noteId: 'crossfit-girls/fran',
        timestamp: 0,
        outputType: 'all',
        elapsedMs: 300000,
        loadLbs: 2850,
      },
    }

    const projected = projectEntry(entry, 'session')
    expect(projected.title).toBe('Fran')
    expect(projected.protocol).toBe('For Time')
    expect(projected.movements).toBe('Thruster, Pull-up')
    expect(projected.targetDuration).toBe('05:00')
    expect(projected.sessionLoad).toBe('2,850 lbs')
  })

  it('extracts result level fields from an entry', () => {
    const entry: Entry = {
      id: 'res-101',
      kind: 'result',
      sourceNotebook: 'results',
      sourceNote: 'res-101',
      title: 'Murph Session',
      date: '2026-09-02',
      execution: {
        resultId: 'res-101',
        noteId: 'journal/2026-09-02',
        timestamp: 1725273600000,
        outputType: 'all',
        elapsedMs: 2453000, // 40m 53s
        loadLbs: 10000,
        tis: 48.5,
      },
    }

    const projected = projectEntry(entry, 'result')
    expect(projected.title).toBe('Murph Session')
    expect(projected.elapsedTime).toBe('40:53')
    expect(projected.totalTonnage).toBe('10,000 lbs')
    expect(projected.tis).toBe('48.5')
  })

  it('extracts segment level fields from an entry', () => {
    const entry: Entry = {
      id: 'res-101:seg-2',
      kind: 'segment',
      sourceNotebook: 'results',
      sourceNote: 'res-101:seg-2',
      title: 'Round 2',
      date: '2026-09-02',
      execution: {
        resultId: 'res-101',
        noteId: 'journal/2026-09-02',
        timestamp: 1725273600000,
        outputType: 'segment',
        elapsedMs: 105000, // 1m 45s
        reps: 21,
        loadLbs: 95,
      },
    }

    const projected = projectEntry(entry, 'segment')
    expect(projected.splitDuration).toBe('01:45')
    expect(projected.roundIndex).toBe('Round 2')
    expect(projected.reps).toBe('21')
    expect(projected.load).toBe('95 lbs')
  })

  it('extracts effort level fields from an entry', () => {
    const entry: Entry = {
      id: 'clean-and-jerk',
      kind: 'effort',
      sourceNotebook: 'canonical',
      sourceNote: 'clean-and-jerk',
      title: 'Clean & Jerk',
      date: null,
      effort: {
        slug: 'clean-and-jerk',
        label: 'Clean & Jerk',
        discipline: 'strength',
        met: 8.0,
        intensityTier: 'maximal',
        aliases: ['C&J', 'Olympic Clean and Jerk'],
      },
    }

    const projected = projectEntry(entry, 'effort')
    expect(projected.label).toBe('Clean & Jerk')
    expect(projected.canonicalSlug).toBe('clean-and-jerk')
    expect(projected.discipline).toBe('strength')
    expect(projected.met).toBe('8.0')
    expect(projected.intensityTier).toBe('maximal')
    expect(projected.aliases).toBe('C&J, Olympic Clean and Jerk')
  })

  it('filters projected fields to only requested visibleFieldIds', () => {
    const entry: Entry = {
      id: 'back-squat',
      kind: 'effort',
      sourceNotebook: 'canonical',
      sourceNote: 'back-squat',
      title: 'Back Squat',
      date: null,
      effort: {
        slug: 'back-squat',
        label: 'Back Squat',
        discipline: 'strength',
        met: 6.0,
        intensityTier: 'heavy',
      },
    }

    const projected = projectEntry(entry, 'effort', ['label', 'discipline'])
    expect(Object.keys(projected)).toEqual(['label', 'discipline'])
    expect(projected.label).toBe('Back Squat')
    expect(projected.discipline).toBe('strength')
    expect(projected.met).toBeUndefined()
  })
})
