import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MetricType, ParsedCodeStatement } from '@bitcobblers/wod-wiki-engine';
import type { IMetric } from '@bitcobblers/wod-wiki-engine';
import type { ICodeStatement } from '@bitcobblers/wod-wiki-engine';
import type { EditorSection } from '@bitcobblers/wod-wiki-ui/extensions';
import type { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { MetricInlinePanel } from './MetricInlinePanel';
import { usePaletteStore } from '@/components/organisms/command-palette/palette-store';

function makeStatement(metrics: IMetric[]): ICodeStatement {
  return new ParsedCodeStatement({ id: 0, line: 1, raw: 'test', metrics });
}

function makeSection(): EditorSection {
  return {
    id: 'test-section',
    type: 'time',
    from: 0,
    to: 20,
    contentFrom: 5,
    contentTo: 15,
    startLine: 1,
    endLine: 2,
  };
}

function createMockView() {
  return {
    coordsAtPos: () => ({ bottom: 100, left: 0 }),
    dom: {
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 500, height: 200 }),
    },
    contentDOM: {
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 500 }),
    },
    state: {} as unknown as EditorState,
  };
}

describe('MetricInlinePanel ADR-0009 regressions', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders custom metric chips inline', () => {
    const view = createMockView();
    const statement = makeStatement([
      { type: MetricType.Custom, value: 'Zone 2', image: 'Zone 2', origin: 'parser' } as IMetric,
    ]);
    const section = makeSection();

    const getCursorFocusState = mock(() => ({
      section,
      statement,
      cursorLine: 1,
      lineFrom: 0,
      lineTo: 10,
      focusedMetric: null,
    }));

    render(<MetricInlinePanel view={view as unknown as EditorView} cursorVersion={1} getCursorFocusState={getCursorFocusState} />);

    expect(screen.getByText('custom')).toBeDefined();
    expect(screen.getByText('Zone 2')).toBeDefined();
  });

  it('shows the tag a line points at, with a link to the tag', () => {
    const view = {
      ...createMockView(),
      state: {
        facet: () => () => ({
          openHref: (kind: string, slug: string) =>
            kind === 'tag' ? `/tags?tag=${slug}` : `/e/${slug}`,
          createHref: () => '/tags',
        }),
      } as unknown as EditorState,
    };
    const statement = makeStatement([
      {
        type: 'intensity',
        value: 'heavy',
        image: 'heavy',
        origin: 'parser',
        metadata: {
          tagReference: { slug: 'heavy', label: 'heavy', functions: ['e1rm'] },
        },
      } as IMetric,
    ]);
    const section = makeSection();

    const getCursorFocusState = mock(() => ({
      section,
      statement,
      cursorLine: 1,
      lineFrom: 0,
      lineTo: 10,
      focusedMetric: null,
    }));

    render(<MetricInlinePanel view={view as unknown as EditorView} cursorVersion={1} getCursorFocusState={getCursorFocusState} />);

    const link = screen.getByLabelText('Open the heavy tag') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/tags?tag=heavy');
  });

  it('renders calculated metric chips inline', () => {
    const view = createMockView();
    const statement = makeStatement([
      { type: MetricType.Calculated, value: 'RPE 8', image: 'RPE 8', origin: 'parser' } as IMetric,
    ]);
    const section = makeSection();

    const getCursorFocusState = mock(() => ({
      section,
      statement,
      cursorLine: 1,
      lineFrom: 0,
      lineTo: 10,
      focusedMetric: null,
    }));

    render(<MetricInlinePanel view={view as unknown as EditorView} cursorVersion={1} getCursorFocusState={getCursorFocusState} />);

    expect(screen.getByText('calculated')).toBeDefined();
    expect(screen.getByText('RPE 8')).toBeDefined();
  });

  it('does NOT filter out custom or calculated metrics', () => {
    const view = createMockView();
    const statement = makeStatement([
      { type: MetricType.Custom, value: 'Zone 2', image: 'Zone 2', origin: 'parser' } as IMetric,
      { type: MetricType.Calculated, value: 'RPE 8', image: 'RPE 8', origin: 'parser' } as IMetric,
    ]);
    const section = makeSection();

    const getCursorFocusState = mock(() => ({
      section,
      statement,
      cursorLine: 1,
      lineFrom: 0,
      lineTo: 10,
      focusedMetric: null,
    }));

    render(<MetricInlinePanel view={view as unknown as EditorView} cursorVersion={1} getCursorFocusState={getCursorFocusState} />);

    expect(screen.getByText('custom')).toBeDefined();
    expect(screen.getByText('calculated')).toBeDefined();
  });

  it('filters out Sound and System metrics only', () => {
    const view = createMockView();
    const statement = makeStatement([
      { type: MetricType.Rep, value: '10', image: '10', origin: 'parser' } as IMetric,
      { type: MetricType.Sound, value: 'beep', origin: 'runtime' } as IMetric,
      { type: MetricType.System, value: 'start', origin: 'runtime' } as IMetric,
    ]);
    const section = makeSection();

    const getCursorFocusState = mock(() => ({
      section,
      statement,
      cursorLine: 1,
      lineFrom: 0,
      lineTo: 10,
      focusedMetric: null,
    }));

    render(<MetricInlinePanel view={view as unknown as EditorView} cursorVersion={1} getCursorFocusState={getCursorFocusState} />);

    // Rep should be visible
    expect(screen.getByText('10')).toBeDefined();
    // Sound and System should be filtered out
    expect(screen.queryByText('beep')).toBeNull();
    expect(screen.queryByText('start')).toBeNull();
  });

  it('renders "No metrics on this line" when only Sound/System are present', () => {
    const view = createMockView();
    const statement = makeStatement([
      { type: MetricType.Sound, value: 'beep', origin: 'runtime' } as IMetric,
      { type: MetricType.System, value: 'start', origin: 'runtime' } as IMetric,
    ]);
    const section = makeSection();

    const getCursorFocusState = mock(() => ({
      section,
      statement,
      cursorLine: 1,
      lineFrom: 0,
      lineTo: 10,
      focusedMetric: null,
    }));

    render(<MetricInlinePanel view={view as unknown as EditorView} cursorVersion={1} getCursorFocusState={getCursorFocusState} />);

    expect(screen.getByText(/no metrics on this line/i)).toBeDefined();
  });

  it('hides iconless hints and shows iconed hints as icon with hint text on hover', () => {
    const view = createMockView();
    const statement = makeStatement([
      { type: MetricType.Hint, value: 'workout.amrap', image: 'workout.amrap', origin: 'dialect' } as IMetric,
      { type: MetricType.Hint, value: 'workout.emom', image: 'workout.emom', origin: 'dialect', icon: '🔁' } as IMetric,
    ]);
    const section = makeSection();

    const getCursorFocusState = mock(() => ({
      section,
      statement,
      cursorLine: 1,
      lineFrom: 0,
      lineTo: 10,
      focusedMetric: null,
    }));

    render(<MetricInlinePanel view={view as unknown as EditorView} cursorVersion={1} getCursorFocusState={getCursorFocusState} />);

    // Iconless hint: not rendered anywhere.
    expect(screen.queryByText('workout.amrap')).toBeNull();

    // Iconed hint: icon only, no hint text, hint text on hover.
    expect(screen.getByText('🔁')).toBeDefined();
    expect(screen.queryByText('workout.emom')).toBeNull();
    expect(screen.getByText('🔁').parentElement!.getAttribute('title')).toBe('workout.emom');
  });
});

describe('MetricInlinePanel chip focus, hover, and palette click', () => {
  afterEach(() => {
    cleanup();
    usePaletteStore.setState({ isOpen: false, request: null, _resolve: null });
  });

  function renderPanel(metrics: IMetric[], focusedMetric: IMetric | null, viewOverrides: object = {}) {
    const statement = makeStatement(metrics);
    const section = makeSection();
    const view = {
      ...createMockView(),
      ...viewOverrides,
    };
    const getCursorFocusState = mock(() => ({
      section,
      statement,
      cursorLine: 1,
      lineFrom: 0,
      lineTo: 10,
      focusedMetric,
    }));
    render(
      <MetricInlinePanel
        view={view as unknown as EditorView}
        cursorVersion={1}
        getCursorFocusState={getCursorFocusState}
      />
    );
  }

  it('bolds the chip whose metric the cursor is on', () => {
    const rep = { type: MetricType.Rep, value: 10, origin: 'parser' } as IMetric;
    const effort = { type: MetricType.Effort, value: 'Burpees', origin: 'parser' } as IMetric;
    renderPanel([rep, effort], rep);

    const repChip = screen.getByText('Reps').parentElement!;
    const effortChip = screen.getByText('Exercise').parentElement!;
    expect(repChip.className).toContain('font-bold');
    expect(effortChip.className).not.toContain('font-bold');
  });

  it('exposes metric details on hover matching the effort-widget badges', () => {
    const rep = { type: MetricType.Rep, value: 10, origin: 'parser' } as IMetric;
    renderPanel([rep], null);

    const repChip = screen.getByText('Reps').parentElement!;
    expect(repChip.getAttribute('title')).toContain('Type: rep');
    expect(repChip.getAttribute('title')).toContain('Value: 10');
  });

  it('opens the statement-builder palette on the clicked segment', async () => {
    const weight = { type: MetricType.Resistance, value: '20kg', origin: 'parser' } as IMetric;
    renderPanel([weight], null, {
      state: { doc: { sliceString: () => '10 burpees 20kg' } },
    });

    fireEvent.click(screen.getByText('Weight').parentElement!);

    await waitFor(() => expect(usePaletteStore.getState().isOpen).toBe(true));
    const request = usePaletteStore.getState().request;
    expect(request?.sources[0]?.id).toBe('segment:weight');
    expect(request?.placeholder).toContain('load');

    usePaletteStore.getState()._dismiss();
  });
});
