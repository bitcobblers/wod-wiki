/**
 * WQL-5 — visual stage separation in the composer: the active pipeline
 * stage (source → reduce → sink) is highlighted in the diagnostics strip as
 * the cursor moves across the query.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { parseQuery, resolveWqlCursorStage, type AnyParsedQuery } from '@bitcobblers/wod-wiki-wql';
import { WqlComposer } from '../src/composer/WqlComposer';
import { WqlDiagnosticsStrip } from '../src/composer/WqlDiagnosticsStrip';
afterEach(cleanup);

const PIPELINE = ':journal{effort:snatch} | :sum{metric:reps} by {equipment} | :bar{unit:reps}';

function strip() {
  const ast = parseQuery(PIPELINE) as AnyParsedQuery;
  return render(
    <WqlDiagnosticsStrip
      diagnostics={{ valid: true, wql: PIPELINE, ast }}
      activeStage={resolveWqlCursorStage(PIPELINE, PIPELINE.indexOf(':bar') + 2)}
    />,
  );
}

describe('WQL-5 — active stage feedback in the diagnostics strip', () => {
  it('marks the sink chip as the active stage with aria-current', () => {
    strip();
    const sink = screen.getByTestId('diag-summary-sink');
    expect(sink.getAttribute('data-active-stage')).toBe('sink');
    expect(sink.getAttribute('aria-current')).toBe('step');
    expect(sink.getAttribute('data-stage-role')).toBe('sink');
  });

  it('marks the source chip active when the cursor is in the source stage', () => {
    const ast = parseQuery(PIPELINE) as AnyParsedQuery;
    render(
      <WqlDiagnosticsStrip
        diagnostics={{ valid: true, wql: PIPELINE, ast }}
        activeStage={resolveWqlCursorStage(PIPELINE, 5)}
      />,
    );
    expect(screen.getByTestId('diag-summary-source').getAttribute('data-active-stage')).toBe('source');
    expect(screen.getByTestId('diag-summary-sink').getAttribute('data-active-stage')).toBeNull();
  });

  it('marks the reducer chip active when the cursor is in the reduce stage', () => {
    const ast = parseQuery(PIPELINE) as AnyParsedQuery;
    render(
      <WqlDiagnosticsStrip
        diagnostics={{ valid: true, wql: PIPELINE, ast }}
        activeStage={resolveWqlCursorStage(PIPELINE, PIPELINE.indexOf(':sum') + 2)}
      />,
    );
    expect(screen.getByTestId('diag-summary-fn-1').getAttribute('data-active-stage')).toBe('reduce');
    expect(screen.getByTestId('diag-summary-source').getAttribute('data-active-stage')).toBeNull();
  });

  it('moves the active stage as the cursor crosses the pipeline', async () => {
    const ast = parseQuery(PIPELINE) as AnyParsedQuery;
    const { rerender } = render(
      <WqlDiagnosticsStrip
        diagnostics={{ valid: true, wql: PIPELINE, ast }}
        activeStage={resolveWqlCursorStage(PIPELINE, 5)}
      />,
    );
    expect(screen.getByTestId('diag-summary-source').getAttribute('data-active-stage')).toBe('source');

    rerender(
      <WqlDiagnosticsStrip
        diagnostics={{ valid: true, wql: PIPELINE, ast }}
        activeStage={resolveWqlCursorStage(PIPELINE, PIPELINE.indexOf(':sum') + 2)}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('diag-summary-fn-1').getAttribute('data-active-stage')).toBe('reduce');
    });

    rerender(
      <WqlDiagnosticsStrip
        diagnostics={{ valid: true, wql: PIPELINE, ast }}
        activeStage={resolveWqlCursorStage(PIPELINE, PIPELINE.indexOf(':bar') + 2)}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('diag-summary-sink').getAttribute('data-active-stage')).toBe('sink');
    });
  });
});

describe('WQL-5 — the composer cursor drives the active stage chip', () => {
  it('moves the active stage as the cursor crosses the pipeline in the editor', async () => {
    render(<WqlComposer initialQuery={PIPELINE} compact />);
    const editor = screen.getByTestId('wql-text-input');
    expect(editor).toBeDefined();

    // The cursor starts at the source stage.
    await waitFor(() => {
      expect(screen.getByTestId('diag-summary-source').getAttribute('data-active-stage')).toBe('source');
    });

    // Move the cursor into the reducer stage.
    const view = EditorView.findFromDOM(editor)!;
    expect(view).toBeDefined();
    view.dispatch({ selection: { anchor: PIPELINE.indexOf(':sum') + 2 } });

    await waitFor(() => {
      expect(screen.getByTestId('diag-summary-fn-1').getAttribute('data-active-stage')).toBe('reduce');
    });

    // Move the cursor into the sink stage.
    view.dispatch({ selection: { anchor: PIPELINE.indexOf(':bar') + 2 } });
    await waitFor(() => {
      expect(screen.getByTestId('diag-summary-sink').getAttribute('data-active-stage')).toBe('sink');
    });
  });
});
