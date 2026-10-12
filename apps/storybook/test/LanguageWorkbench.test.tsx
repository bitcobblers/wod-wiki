import '@testing-library/jest-dom';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { JOURNALS, buildServiceForJournal } from '../src/gallery/journals';
import {
  createParser,
  getHints,
  hintsToContainer,
  defineLanguagePack,
  registerLanguagePack,
  unregisterLanguagePack,
  dialectRegistry,
  type IDialect,
  type ICodeStatement,
  type DialectAnalysis,
  type LanguagePack,
} from '@bitcobblers/wod-wiki-engine';
import { LanguageWorkbench } from '../src/workbench';
import { EditorView } from '@codemirror/view';
import { sectionField } from '@bitcobblers/wod-wiki-ui';

const DEMO_PACK_ID = 'demo-pack';

class DemoPackDialect implements IDialect {
  id = DEMO_PACK_ID;
  name = 'Demo Pack';
  priority = 10;
  analyze(statement: ICodeStatement): DialectAnalysis {
    const raw = (statement.meta as { raw?: string })?.raw ?? '';
    if (/benchmark/i.test(raw)) {
      return { metrics: hintsToContainer(['demo.pack']) };
    }
    return {};
  }
}

const demoPack: LanguagePack = defineLanguagePack({
  identity: {
    id: DEMO_PACK_ID,
    name: 'Demo Pack',
  },
  lang: {
    analyzer: DemoPackDialect,
  },
});

describe('LanguageWorkbench in apps/storybook', () => {
  beforeAll(() => {
    if (typeof window !== 'undefined') {
      if (!window.requestAnimationFrame) {
        window.requestAnimationFrame = (cb: FrameRequestCallback) =>
          setTimeout(() => cb(Date.now()), 16) as unknown as number;
      }
      if (!window.cancelAnimationFrame) {
        window.cancelAnimationFrame = (id: number) => clearTimeout(id);
      }
      if (typeof Range !== 'undefined') {
        if (!Range.prototype.getClientRects) {
          Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
        }
        if (!Range.prototype.getBoundingClientRect) {
          Range.prototype.getBoundingClientRect = () => ({
            top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {},
          } as DOMRect);
        }
      }
    }
  });

  beforeEach(() => {
    unregisterLanguagePack(demoPack);
    dialectRegistry.unregister(DEMO_PACK_ID);
  });

  afterEach(() => {
    unregisterLanguagePack(demoPack);
    dialectRegistry.unregister(DEMO_PACK_ID);
  });

  it('loads the crossfit corpus journal with 78 records', () => {
    expect(JOURNALS.crossfit.kind).toBe('event-journal');
    expect(JOURNALS.crossfit.records).toHaveLength(78);
  });

  it('evaluates WQL queries against inMemoryEventStore in real time', async () => {
    const service = buildServiceForJournal(JOURNALS.crossfit);
    const newest = Math.max(...JOURNALS.crossfit.records.map((record) => record.timestamp));
    const result = await service.runQuery('sum:totalVolume{} by {week}', {
      rangeEnd: newest,
      preferredUnit: 'lb',
    });

    expect(result.series).toBeDefined();
    expect(result.series.length).toBeGreaterThan(0);
    // 6 weeks of volume facts
    const totalVolumePoints = result.series[0].points;
    expect(totalVolumePoints.length).toBe(6);
    const sumTotal = totalVolumePoints.reduce((acc, p) => acc + p.value, 0);
    expect(sumTotal).toBeGreaterThan(50000);
  });

  it('parses Whiteboard Script and extracts hints', () => {
    const parser = createParser();
    const scriptText = [
      '// benchmark: Fran',
      '(21-15-9)',
      '  Thrusters @95lb',
      '  Pull-ups',
    ].join('\n');

    const script = parser.read(scriptText);
    expect(script.statements.length).toBeGreaterThanOrEqual(1);

    const hints = script.statements.flatMap((s) => getHints(s));
    // Default stack does not include demo.pack
    expect(hints).not.toContain('demo.pack');
  });

  it('dynamically registers Language Pack at runtime without server restart', () => {
    const parser = createParser();
    const scriptText = [
      '// benchmark: Fran',
      '(21-15-9)',
      '  Thrusters @95lb',
      '  Pull-ups',
    ].join('\n');

    // 1. Before registration: no demo.pack hint
    let script = parser.read(scriptText);
    let hints = script.statements.flatMap((s) => getHints(s));
    expect(hints).not.toContain('demo.pack');

    // 2. Register demo pack dynamically
    registerLanguagePack(demoPack);
    expect(dialectRegistry.has(DEMO_PACK_ID)).toBe(true);

    // 3. Immediately re-parse: demo.pack hint appears
    script = parser.read(scriptText);
    hints = script.statements.flatMap((s) => getHints(s));
    expect(hints).toContain('demo.pack');

    // 4. Unregister demo pack: demo.pack hint disappears
    unregisterLanguagePack(demoPack);
    expect(dialectRegistry.has(DEMO_PACK_ID)).toBe(false);

    script = parser.read(scriptText);
    hints = script.statements.flatMap((s) => getHints(s));
    expect(hints).not.toContain('demo.pack');
  });

  it('renders LanguageWorkbench UI with editor, statement strip, and wall clock', () => {
    render(<LanguageWorkbench />);

    expect(screen.getByTestId('language-workbench')).toBeInTheDocument();
    expect(screen.getByTestId('script-editor-host')).toBeInTheDocument();
    expect(screen.getByTestId('statement-strip')).toBeInTheDocument();
    expect(screen.getByTestId('panel-wallclock')).toBeInTheDocument();
    expect(screen.getByTestId('clock-primary')).toHaveTextContent('00:00');
    expect(screen.getByTestId('panel-timeline')).toBeInTheDocument();

    // Default primary WQL and secondary presets
    expect(screen.getByTestId('output-filter-preset-all')).toBeInTheDocument();
    expect(screen.getByTestId('output-filter-preset-segments')).toBeInTheDocument();
    expect(screen.getByTestId('output-filter-preset-events')).toBeInTheDocument();
  });

  it('keeps the selected duplicate workout occurrence after a prose insertion', () => {
    const fence = '```time\n10 Push-ups\n```';
    render(<LanguageWorkbench initialNote={`# Duplicates\n\n${fence}\n\n${fence}`} />);
    const editor = screen.getByTestId('script-editor-host').querySelector('.cm-editor');
    if (!(editor instanceof HTMLElement)) throw new Error('Expected mounted note editor');
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error('Expected CodeMirror view');
    const before = view.state.field(sectionField).sections.filter((section) => section.type === 'time');
    expect(before).toHaveLength(2);
    expect(before[0].id).not.toBe(before[1].id);
    fireEvent.click(screen.getByTestId('time-block-chip-1'));
    expect(screen.getByTestId('time-block-chip-1')).toHaveClass('border-primary');
    act(() => view.dispatch({ changes: { from: 0, insert: 'Recovery prose.\n\n' } }));
    const after = view.state.field(sectionField).sections.filter((section) => section.type === 'time');
    expect(after.map((section) => section.id)).toEqual(before.map((section) => section.id));
    expect(screen.getByTestId('time-block-chip-1')).toHaveClass('border-primary');
  });

  it('supports custom primary WQL, secondary filter presets, and dashboards', () => {
    render(
      <LanguageWorkbench
        outputTableQuery="type:event"
        outputTableFilters={['all', 'segments', 'events', 'sum:rep{}']}
        dashboards={[
          'sum:totalVolume{} by {week}',
          'sum:sessionLoad{} by {discipline}',
        ]}
      />
    );

    expect(screen.getByTestId('output-filter-preset-all')).toBeInTheDocument();
    expect(screen.getByTestId('output-filter-preset-segments')).toBeInTheDocument();
    expect(screen.getByTestId('output-filter-preset-events')).toBeInTheDocument();
    expect(screen.getByTestId('output-filter-preset-sum:rep{}')).toBeInTheDocument();
  });

  it('defaults dashboard query widgets to session data source and session-level WQL queries', () => {
    render(<LanguageWorkbench />);

    expect(screen.getByTestId('dashboard-analytics-section')).toBeInTheDocument();
    // Default session dashboard queries
    expect(screen.getByDisplayValue('sum:totalVolume{}')).toBeInTheDocument();
    expect(screen.getByDisplayValue('sum:rep{} by {effort}')).toBeInTheDocument();
    expect(screen.getByDisplayValue('sum:sessionLoad{} by {discipline}')).toBeInTheDocument();
    expect(screen.getByTestId('btn-export-markdown')).toBeInTheDocument();
    expect(screen.getByTestId('btn-export-parsed')).toBeInTheDocument();
    expect(screen.getByTestId('btn-export-session')).toBeInTheDocument();
  });
});
