import { describe, expect, it } from 'vitest';
import {
  resolveEntityScope,
  buildWidgetsForWqlScope,
  buildDashboardFromScope,
  parseDashboardNote,
  buildDashboardDocument,
} from '../src';

describe('Entity WQL Scope & Dashboard Promotion', () => {
  it('resolves Effort, Equipment, Tag, Tag Category, Notebook, Feed, and Note scopes consistently', () => {
    const effort = resolveEntityScope({ noteId: 'effort/thruster', label: 'Thruster' });
    expect(effort.kind).toBe('effort');
    expect(effort.scopeFilter).toBe('effort:thruster');
    expect(effort.notesWql).toBe(':note{effort:thruster}');
    expect(effort.sessionsWql).toBe(':session{effort:thruster}');
    expect(effort.recordsWql).toBe(':segment{effort:thruster}');
    expect(effort.tokens.scope).toBe('effort:thruster');

    const equip = resolveEntityScope({ noteId: 'equipment/kettlebell', label: 'Kettlebell' });
    expect(equip.kind).toBe('equipment');
    expect(equip.scopeFilter).toBe('equipment:kettlebell');
    expect(equip.notesWql).toBe(':note{equipment:kettlebell}');
    expect(equip.sessionsWql).toBe(':session{equipment:kettlebell}');
    expect(equip.recordsWql).toBe(':segment{equipment:kettlebell}');

    const typedTag = resolveEntityScope({ noteId: 't/domain/crossfit', label: 'CrossFit' });
    expect(typedTag.kind).toBe('tag');
    expect(typedTag.scopeFilter).toBe('domain:crossfit');
    expect(typedTag.notesWql).toBe(':note{domain:crossfit}');

    const customTag = resolveEntityScope({ noteId: 't/tag/heavy', label: 'Heavy' });
    expect(customTag.kind).toBe('tag');
    expect(customTag.scopeFilter).toBe('tags:heavy');
    expect(customTag.notesWql).toBe(':note{tags:heavy}');

    const notebook = resolveEntityScope({ noteId: 'notebook/crossfit-girls', label: 'CrossFit Girls' });
    expect(notebook.kind).toBe('notebook');
    expect(notebook.notesWql).toBe(':note{notebook:crossfit-girls}');
    expect(notebook.sessionsWql).toBe(':session{} where :note{notebook:crossfit-girls}');

    const feed = resolveEntityScope({ noteId: 'feed/wod-science', label: 'WOD Science' });
    expect(feed.kind).toBe('feed');
    expect(feed.notesWql).toBe(':notebook{feed:wod-science}');
    expect(feed.sessionsWql).toBe(':session{} where :notebook{feed:wod-science}');

    const note = resolveEntityScope({
      noteId: 'note-123',
      label: 'Fran Session',
      rawContent: '---\ntitle: Fran\nwql: ":segment{effort:thruster}"\n---\nBody',
    });
    expect(note.kind).toBe('note');
    expect(note.sessionsWql).toBe(':session{note:note-123}');
    expect(note.recordsWql).toBe(':segment{note:note-123}');
    expect(note.primaryWql).toBe(':segment{effort:thruster}');
  });

  it('promotes any EntityScope or WQL query into a valid multi-widget Dashboard Note', () => {
    const effortScope = resolveEntityScope({ noteId: 'effort/snatch', label: 'Snatch' });
    const markdown = buildDashboardFromScope({ scope: effortScope });
    const { meta, sections } = parseDashboardNote(markdown);
    const doc = buildDashboardDocument(sections, meta);

    expect(doc.isDashboard).toBe(true);
    expect(doc.title).toBe('Snatch Dashboard');
    expect(doc.widgets.length).toBe(3);
    expect(doc.widgets[0]?.type).toBe('timeseries');
    expect(doc.widgets[0]?.body).toBe('sum:$metric{effort:snatch} by {week}');
    expect(doc.widgets[2]?.type).toBe('list');
    expect(doc.widgets[2]?.body).toBe(':note{effort:snatch}');

    const fromQuery = buildDashboardFromScope({
      title: 'Benchmark Volume',
      scope: ':note{intent:benchmark}',
    });
    const parsedFromQuery = parseDashboardNote(fromQuery);
    const queryDoc = buildDashboardDocument(parsedFromQuery.sections, parsedFromQuery.meta);
    expect(queryDoc.isDashboard).toBe(true);
    expect(queryDoc.widgets.length).toBe(2);
    expect(queryDoc.widgets[0]?.body).toBe(':note{intent:benchmark}');
    expect(queryDoc.widgets[1]?.body).toBe('sum:$metric{} by {week} where :note{intent:benchmark}');
  });

  it('supports pipelines with chart sinks when building widgets from a raw WQL query', () => {
    const widgets = buildWidgetsForWqlScope(':segment{effort:snatch} | :sum{metric:tis} | :value{}');
    expect(widgets).toHaveLength(1);
    expect(widgets[0]?.type).toBe('value');
    expect(widgets[0]?.spanCols).toBe(1);
  });
});
