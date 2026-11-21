import { describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CompletionContext } from '@codemirror/autocomplete';
import {
  editorFocusTracker,
  linkPreview,
  markdownSyntaxHiding,
  markdownTablePreview,
  previewDecorations,
  queryBlockPreview,
  registeredSectionWidgets,
  sectionField,
  setEditorFocused,
  slashBlockCompletion,
  toggleInlineMarkdown,
  widgetBlockPreview,
} from '../src/extensions';

describe('markdownSyntaxHiding & focus-gated WYSIWYG', () => {
  it('hides markdown syntax across all lines when blurred and reveals only the active line when focused', () => {
    const doc = [
      '# Strength Cycle',
      '**Heavy** `5x5` and ~~skip~~',
      '- [ ] Warmup set',
      '> Keep torso upright',
      '---',
    ].join('\n');

    const state = EditorState.create({
      doc,
      extensions: [sectionField, editorFocusTracker, markdownSyntaxHiding()],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    // Place cursor on line 1 while editor is blurred
    view.dispatch({ selection: { anchor: 3 }, effects: setEditorFocused.of(false) });

    // Even on line 1, `# ` is hidden while blurred and heading line class is applied
    expect(container.querySelector('.cm-md-heading-1')).not.toBeNull();
    expect(container.textContent?.startsWith('# ')).toBe(false);
    expect(container.querySelector('.cm-md-inline-code')).not.toBeNull();
    expect(container.querySelector('.cm-md-strike')).not.toBeNull();
    expect(container.querySelector('button.cm-md-task-checkbox')).not.toBeNull();
    expect(container.querySelector('.cm-md-blockquote')).not.toBeNull();
    expect(container.querySelector('.cm-md-hr-line')).not.toBeNull();

    // Focus editor on line 1 -> line 1 reveals `# `, while non-cursor lines stay WYSIWYG
    view.dispatch({ effects: setEditorFocused.of(true) });
    expect(container.textContent).toContain('# Strength Cycle');
    expect(container.querySelector('button.cm-md-task-checkbox')).not.toBeNull();

    view.destroy();
    container.remove();
  });

  it('toggles task checkboxes between - [ ] and - [x] on click', () => {
    const doc = '- [ ] Mobilize hips\nNext line\n';
    const state = EditorState.create({
      doc,
      extensions: [sectionField, editorFocusTracker, markdownSyntaxHiding()],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });
    view.dispatch({ selection: { anchor: doc.length }, effects: setEditorFocused.of(true) });

    const checkbox = container.querySelector('button.cm-md-task-checkbox') as HTMLButtonElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.getAttribute('aria-checked')).toBe('false');

    checkbox.click();
    expect(view.state.doc.toString()).toContain('- [x] Mobilize hips');
    expect(container.querySelector('.cm-md-task-done')).not.toBeNull();

    view.destroy();
    container.remove();
  });

  it('wraps and unwraps inline markdown via toggleInlineMarkdown', () => {
    const doc = 'Lift heavy today';
    const state = EditorState.create({ doc, extensions: [sectionField] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    const from = doc.indexOf('heavy');
    const to = from + 'heavy'.length;
    view.dispatch({ selection: { anchor: from, head: to } });

    toggleInlineMarkdown(view, '**');
    expect(view.state.doc.toString()).toBe('Lift **heavy** today');

    toggleInlineMarkdown(view, '**');
    expect(view.state.doc.toString()).toBe('Lift heavy today');

    view.destroy();
    container.remove();
  });
});

describe('slashBlockCompletion, dialect toggle & pinned query preview', () => {
  it('offers slash block templates at line start in markdown and suppresses inside fenced blocks', () => {
    const mdDoc = '/ti';
    const mdState = EditorState.create({ doc: mdDoc, extensions: [sectionField] });
    const mdResult = slashBlockCompletion(new CompletionContext(mdState, mdDoc.length, false));
    expect(mdResult).not.toBeNull();
    expect(mdResult?.options.some((o) => o.label === '/time')).toBe(true);

    const fenceDoc = '```time\n/ti\n```';
    const fenceState = EditorState.create({ doc: fenceDoc, extensions: [sectionField] });
    const innerPos = fenceDoc.indexOf('/ti') + 3;
    const fenceResult = slashBlockCompletion(new CompletionContext(fenceState, innerPos, false));
    expect(fenceResult).toBeNull();
  });

  it('toggles fence dialect between time and log when clicking the header badge', () => {
    const doc = '```time\n10:00 Run\n```\nDone.\n';
    const state = EditorState.create({
      doc,
      extensions: [sectionField, previewDecorations],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });
    view.dispatch({ selection: { anchor: doc.length } });

    const badge = container.querySelector('.cm-wod-dialect-badge') as HTMLButtonElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('TIMER');

    badge.click();
    expect(view.state.doc.line(1).text).toBe('```log');
    expect(container.querySelector('.cm-wod-dialect-badge')?.textContent).toBe('LOG');

    view.destroy();
    container.remove();
  });

  it('keeps query block preview mounted on cursor entry until Source is clicked, then restores on exit', async () => {
    const doc = 'Intro\n\n```query\nsum:reps{}\n```\n\nOutro\n';
    const state = EditorState.create({
      doc,
      extensions: [sectionField, editorFocusTracker, queryBlockPreview()],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    let view!: EditorView;
    await act(async () => {
      view = new EditorView({ state, parent: container });
      view.dispatch({ effects: setEditorFocused.of(true) });
    });

    // Move cursor directly inside the query block — preview stays pinned!
    const queryPos = doc.indexOf('sum:reps{}');
    await act(async () => {
      view.dispatch({ selection: { anchor: queryPos } });
    });
    expect(container.querySelector('[data-testid="query-block-view"]')).not.toBeNull();

    // Click explicit Source button -> switches to raw source editing
    const sourceBtn = container.querySelector('[data-testid="query-edit-source"]') as HTMLButtonElement;
    expect(sourceBtn).not.toBeNull();
    await act(async () => {
      sourceBtn.click();
    });
    expect(container.querySelector('[data-testid="query-block-view"]')).toBeNull();
    expect(container.textContent).toContain('sum:reps{}');

    // Move cursor outside the query section -> automatically restores preview
    await act(async () => {
      view.dispatch({ selection: { anchor: doc.length } });
    });
    expect(container.querySelector('[data-testid="query-block-view"]')).not.toBeNull();

    view.destroy();
    container.remove();
  });

  it('preserves mounted table, link, checkbox, badge, and query DOM elements when typing above them and still targets shifted offsets', async () => {
    const doc = [
      'Intro line.',
      '',
      '- [ ] Warm up',
      '',
      'See [Guide](/guide) next.',
      '',
      '| Lift | Reps |',
      '| --- | --- |',
      '| Squat | 5 |',
      '',
      '```time',
      '10:00 AMRAP',
      '```',
      '',
      '```query',
      'sum:reps{}',
      '```',
      '',
      'End.',
    ].join('\n');

    const container = document.createElement('div');
    document.body.appendChild(container);
    let view!: EditorView;
    await act(async () => {
      view = new EditorView({
        parent: container,
        state: EditorState.create({
          doc,
          extensions: [
            sectionField,
            editorFocusTracker,
            markdownSyntaxHiding(),
            linkPreview,
            markdownTablePreview,
            previewDecorations,
            queryBlockPreview(),
          ],
        }),
      });
      view.dispatch({ selection: { anchor: doc.length }, effects: setEditorFocused.of(true) });
    });

    const beforeCheckbox = container.querySelector('button.cm-md-task-checkbox') as HTMLButtonElement;
    const beforePill = container.querySelector('.cm-link-pill') as HTMLElement;
    const beforeTable = container.querySelector('.cm-table-preview') as HTMLElement;
    const beforeBadge = container.querySelector('.cm-wod-dialect-badge') as HTMLButtonElement;
    const beforeQuery = container.querySelector('.cm-query-block-preview') as HTMLElement;

    expect(beforeCheckbox).not.toBeNull();
    expect(beforePill).not.toBeNull();
    expect(beforeTable).not.toBeNull();
    expect(beforeBadge).not.toBeNull();
    expect(beforeQuery).not.toBeNull();

    // Type above all widgets, shifting every byte offset forward.
    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: 0, insert: 'Prefix note text. ' },
        selection: { anchor: view.state.doc.length + 'Prefix note text. '.length },
      });
    });

    expect(container.querySelector('button.cm-md-task-checkbox')).toBe(beforeCheckbox);
    expect(container.querySelector('.cm-link-pill')).toBe(beforePill);
    expect(container.querySelector('.cm-table-preview')).toBe(beforeTable);
    expect(container.querySelector('.cm-wod-dialect-badge')).toBe(beforeBadge);
    expect(container.querySelector('.cm-query-block-preview')).toBe(beforeQuery);

    // Interactive widgets still resolve their shifted live offsets on click.
    beforeCheckbox.click();
    expect(view.state.doc.toString()).toContain('- [x] Warm up');

    beforeBadge.click();
    expect(view.state.doc.toString()).toContain('```log\n10:00 AMRAP');

    view.destroy();
    container.remove();
  });

  it('preserves mounted query and widget DOM nodes across StateEffect.reconfigure', async () => {
    const doc = [
      'Intro',
      '',
      '```widget:demo-card',
      '{"title":"Ready"}',
      '```',
      '',
      '```query',
      'sum:reps{}',
      '```',
      '',
      'Outro',
    ].join('\n');

    const registry = new Map([
      [
        'demo-card',
        () => React.createElement('div', { 'data-testid': 'demo-card-widget' }, 'Ready'),
      ],
    ]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    let view!: EditorView;
    await act(async () => {
      view = new EditorView({
        parent: container,
        state: EditorState.create({
          doc,
          extensions: [
            registeredSectionWidgets.of(['demo-card']),
            sectionField,
            editorFocusTracker,
            widgetBlockPreview(registry),
            queryBlockPreview({ readOnly: false }),
          ],
        }),
      });
      view.dispatch({ selection: { anchor: doc.length } });
    });

    const beforeWidget = container.querySelector('.cm-widget-block-preview');
    const beforeQuery = container.querySelector('.cm-query-block-preview');
    expect(beforeWidget).not.toBeNull();
    expect(beforeQuery).not.toBeNull();

    // Reconfiguring with fresh widgetBlockPreview / queryBlockPreview calls preserves module StateFields & DOM.
    await act(async () => {
      view.dispatch({
        effects: StateEffect.reconfigure.of([
          registeredSectionWidgets.of(['demo-card']),
          sectionField,
          editorFocusTracker,
          widgetBlockPreview(registry),
          queryBlockPreview({ readOnly: true }),
        ]),
      });
    });

    expect(container.querySelector('.cm-widget-block-preview')).toBe(beforeWidget);
    expect(container.querySelector('.cm-query-block-preview')).toBe(beforeQuery);

    view.destroy();
    container.remove();
  });
});
