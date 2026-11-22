import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MetricType, ParsedCodeStatement } from '@bitcobblers/wod-wiki-engine';
import type { IMetric } from '@bitcobblers/wod-wiki-engine';
import type { ICodeStatement } from '@bitcobblers/wod-wiki-engine';
import type { EditorSection } from '@bitcobblers/wod-wiki-ui/extensions';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { autocompletion, closeCompletion, completionStatus, startCompletion } from '@codemirror/autocomplete';
import { MetricInlinePanel } from './MetricInlinePanel';
import { TEST_IDS } from '@/lib/testIds';
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
    expect(repChip.getAttribute('title')).toBe('Reps: 10');
  });

  it('opens the unified syntax token inspector popover on chip click', async () => {
    const weight = { type: MetricType.Resistance, value: '20kg', origin: 'parser' } as IMetric;
    renderPanel([weight], null, {
      state: { doc: { sliceString: () => '10 burpees 20kg' } },
    });

    fireEvent.click(screen.getByText('Weight').parentElement!);

    const popover = await screen.findByTestId(TEST_IDS.EDITOR_INSPECTOR_POPOVER);
    expect(popover).toBeDefined();
    expect(popover.getAttribute('aria-label')).toBe('Syntax Token Inspector');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId(TEST_IDS.EDITOR_INSPECTOR_POPOVER)).toBeNull();
    });
  });

  it('surfaces inline creation actions for unknown effort and unresolved #tag tokens', () => {
    const unknownEffort = {
      type: MetricType.Effort,
      value: 'Zercher Carry',
      image: 'Zercher Carry',
      origin: 'parser',
      metadata: {
        references: {
          matched: 'none',
          source: 'Zercher Carry',
          diagnostics: [{ reason: 'unknown-effort', message: 'Unknown effort "Zercher Carry".', token: 'Zercher Carry' }],
        },
      },
    } as IMetric;
    const unknownTag = {
      type: MetricType.Custom,
      value: '#heavy-day',
      image: '#heavy-day',
      origin: 'parser',
    } as IMetric;

    renderPanel([unknownEffort, unknownTag], unknownEffort);

    // Unknown effort starts collapsed as a quiet "Define ▾" chip until clicked
    fireEvent.click(screen.getByTestId('editor-define-token'));

    expect(screen.getByTestId('editor-create-effort-inline')).toBeDefined();
    expect(screen.getByTestId('editor-link-alias-inline')).toBeDefined();
    expect(screen.getByTestId('editor-create-equipment-from-token')).toBeDefined();
    expect(screen.getByTestId('editor-create-tag-inline')).toBeDefined();
  });

  it('hides while completion is active, mutes aria-live while busy, and restores cleanly when closed', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const realView = new EditorView({
      state: EditorState.create({
        doc: '10 Back Squat',
        extensions: [
          autocompletion({
            interactionDelay: 0,
            override: [() => ({ from: 3, options: [{ label: 'Back Squat' }] })],
          }),
        ],
      }),
      parent: host,
    });
    realView.coordsAtPos = () => ({ left: 0, right: 80, top: 10, bottom: 28 });
    realView.dom.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      right: 500,
      bottom: 200,
      width: 500,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    realView.contentDOM.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      right: 500,
      bottom: 200,
      width: 500,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const section = makeSection();
    const statement = makeStatement([
      { type: MetricType.Rep, value: 10, image: '10', origin: 'parser' } as IMetric,
    ]);
    const getCursorFocusState = () => ({
      section,
      statement,
      cursorLine: 1,
      lineFrom: 0,
      lineTo: 13,
      focusedMetric: null,
    });

    try {
      const { rerender } = render(
        <MetricInlinePanel
          view={realView}
          cursorVersion={1}
          getCursorFocusState={getCursorFocusState}
        />,
      );
      const panel = await screen.findByLabelText('Metric inline panel');
      expect(panel.getAttribute('aria-live')).toBe('polite');

      startCompletion(realView);
      await waitFor(() => expect(completionStatus(realView.state)).toBe('active'));
      rerender(
        <MetricInlinePanel
          view={realView}
          cursorVersion={2}
          getCursorFocusState={getCursorFocusState}
        />,
      );
      expect(screen.queryByLabelText('Metric inline panel')).toBeNull();

      closeCompletion(realView);
      await waitFor(() => expect(completionStatus(realView.state)).toBeNull());
      rerender(
        <MetricInlinePanel
          view={realView}
          cursorVersion={3}
          getCursorFocusState={getCursorFocusState}
        />,
      );
      const restored = await screen.findByLabelText('Metric inline panel');
      expect(restored.getAttribute('aria-live')).toBe('polite');
    } finally {
      realView.destroy();
      host.remove();
    }
  });

  it('debounces newly appearing unknown-effort diagnostics during active same-line typing until pause', async () => {
    let currentDoc = '10 ';
    let currentStatement = makeStatement([
      { type: MetricType.Rep, value: 10, image: '10', origin: 'parser' } as IMetric,
    ]);
    const section = makeSection();
    const view = {
      ...createMockView(),
      state: {
        doc: {
          sliceString: () => currentDoc,
        },
      } as unknown as EditorState,
    };
    const getCursorFocusState = () => ({
      section,
      statement: currentStatement,
      cursorLine: 1,
      lineFrom: 0,
      lineTo: currentDoc.length,
      focusedMetric: null,
    });

    const { rerender } = render(
      <MetricInlinePanel
        view={view as unknown as EditorView}
        cursorVersion={1}
        getCursorFocusState={getCursorFocusState}
      />,
    );

    expect(screen.queryByTestId('editor-ref-unknown')).toBeNull();

    // Simulate typing partial unknown effort "Th" on the same line.
    currentDoc = '10 Th';
    currentStatement = makeStatement([
      { type: MetricType.Rep, value: 10, image: '10', origin: 'parser' } as IMetric,
      {
        type: MetricType.Effort,
        value: 'Th',
        image: 'Th',
        origin: 'parser',
        metadata: {
          references: {
            matched: 'none',
            source: 'Th',
            diagnostics: [{ reason: 'unknown-effort', message: 'Unknown effort "Th".', token: 'Th' }],
          },
        },
      } as IMetric,
    ]);

    rerender(
      <MetricInlinePanel
        view={view as unknown as EditorView}
        cursorVersion={2}
        getCursorFocusState={getCursorFocusState}
      />,
    );

    // Mid-word diagnostic must NOT flash immediately on the keystroke.
    expect(screen.queryByTestId('editor-ref-unknown')).toBeNull();

    // After the ~320ms settle debounce completes without further edits, the diagnostic surfaces cleanly.
    await waitFor(
      () => {
        expect(screen.getByTestId('editor-define-token')).toBeDefined();
      },
      { timeout: 1000 },
    );
  });
});
