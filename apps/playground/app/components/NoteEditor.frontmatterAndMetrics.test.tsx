import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { setupPlaygroundTestHost, type PlaygroundHostHandle } from '@/testing/host';

const BASE_DOC = [
  '---',
  'title: Ref Metrics',
  'metrics.effort: burpee',
  'metrics.equipment:',
  '  - kettlebell',
  'metrics.rpe: 7',
  '---',
  '',
  '# Refs',
  '',
  '```time',
  '10 Dumbbell Snatch @15kg',
  '```',
  '',
].join('\n');

const UNKNOWN_DOC = BASE_DOC.replace('metrics.effort: burpee', 'metrics.effort: no-such-move');

let host: PlaygroundHostHandle;

beforeEach(async () => {
  host = await setupPlaygroundTestHost({
    world: {
      propertyNotes: [
        { kind: 'effort', slug: 'burpee', label: 'Burpee' },
        { kind: 'effort', slug: 'rowing', label: 'Rowing' },
        { kind: 'equipment', slug: 'kettlebell', label: 'Kettlebell' },
      ],
    },
  });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await host.cleanup();
});

function mountPreviewEditor(doc: string) {
  let createdView: EditorView | undefined;
  const rendered = render(
    <NoteEditor
      value={doc}
      onChange={() => {}}
      enablePreview
      enableLinting={false}
      onViewCreated={(view) => {
        createdView = view;
      }}
    />,
  );
  if (!createdView) throw new Error('NoteEditor did not expose EditorView');
  // Place caret in body so frontmatter renders its preview widget
  act(() => {
    createdView!.dispatch({ selection: { anchor: doc.length } });
  });
  return { view: createdView, ...rendered };
}

describe('NoteEditor frontmatter preview, reference metrics, and property a11y (Tier 2a)', () => {
  it('hides YAML frontmatter delimiter and hidden keys from .cm-content when preview is active', async () => {
    const syntaxDoc = [
      '---',
      'title: Just a Movement',
      'search: hidden',
      '---',
      '',
      '# Syntax Guide',
      '',
      '```time',
      'Run',
      '```',
      '',
    ].join('\n');

    const { view } = mountPreviewEditor(syntaxDoc);
    await waitFor(() => {
      expect(document.querySelector('.cm-frontmatter-preview')).toBeTruthy();
    });

    const contentText = view.contentDOM.textContent ?? '';
    expect(contentText.trimStart().startsWith('---')).toBe(false);
    expect(contentText).not.toContain('search: hidden');
    expect(contentText).not.toContain('title: Just a Movement');
    expect(contentText).toContain('Run');
  });

  it('renders canonical metric labels, patches metrics.effort via Add metric, and reverts in one undo step preserving siblings', async () => {
    const { view } = mountPreviewEditor(BASE_DOC);

    await waitFor(() => {
      expect(document.querySelector('.cm-frontmatter-preview')).toBeTruthy();
    });
    const showDetails = screen.queryByRole('button', { name: 'Show property details' });
    if (showDetails) fireEvent.click(showDetails);

    const preview = document.querySelector('.cm-frontmatter-preview') as HTMLElement;
    expect(within(preview).getAllByText(/Burpee/i).length).toBeGreaterThan(0);
    expect(within(preview).getAllByText(/Kettlebell/i).length).toBeGreaterThan(0);

    // Add metric -> patches metrics.effort while preserving siblings
    fireEvent.click(within(preview).getByTestId('editor-add-metric-note'));
    const draftInput = document.querySelector('[data-frontmatter-metric-draft] input') as HTMLInputElement;
    expect(draftInput).toBeTruthy();
    fireEvent.change(draftInput, { target: { value: 'rowing' } });
    fireEvent.keyDown(draftInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(view.state.doc.toString()).toContain('metrics.effort: rowing');
    });
    const after = view.state.doc.toString();
    expect(after).toContain('metrics.rpe: 7');
    expect(after).toContain('  - kettlebell');
    expect(after).toContain('10 Dumbbell Snatch @15kg');

    // Single undo step restores metrics.effort: burpee and keeps siblings intact
    act(() => {
      undo(view);
    });
    const undone = view.state.doc.toString();
    expect(undone).toContain('metrics.effort: burpee');
    expect(undone).not.toContain('metrics.effort: rowing');
    expect(undone).toContain('metrics.rpe: 7');
  });

  it('surfaces unknown effort ref diagnostic and repairs only that property via its value input', async () => {
    const { view, container } = mountPreviewEditor(UNKNOWN_DOC);

    await waitFor(() => {
      expect(container.querySelector('.cm-frontmatter-preview')).toBeTruthy();
    });
    const showDetails = screen.queryByRole('button', { name: 'Show property details' });
    if (showDetails) fireEvent.click(showDetails);

    const initialDiag = container.querySelector('[data-testid="editor-ref-unknown"]');
    expect(initialDiag?.textContent).toContain('no-such-move');

    const valueInput = container.querySelector(
      '.cm-frontmatter-preview input[aria-label="Value for metrics.effort"]',
    ) as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: 'burpee' } });
    fireEvent.blur(valueInput);

    await waitFor(() => {
      expect(view.state.doc.toString()).toContain('metrics.effort: burpee');
    });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="editor-ref-unknown"]')).toBeNull();
    });
    expect(view.state.doc.toString()).toContain('metrics.rpe: 7');
    expect(view.state.doc.toString()).toContain('  - kettlebell');
  });

  it('exposes Key/Value column labels, combobox aria-haspopup attributes, and Add tag -> category classification', async () => {
    const tagDoc = ['---', 'title: Properties A11y', 'category:', '---', '', '# Properties', ''].join('\n');
    const { view, container } = mountPreviewEditor(tagDoc);

    await waitFor(() => {
      expect(container.querySelector('.cm-frontmatter-preview')).toBeTruthy();
    });
    const showDetails = screen.queryByRole('button', { name: 'Show property details' });
    if (showDetails) fireEvent.click(showDetails);

    const preview = container.querySelector('.cm-frontmatter-preview') as HTMLElement;
    expect(preview.querySelector('[data-frontmatter-column="key"]')?.textContent).toBe('Key');
    expect(preview.querySelector('[data-frontmatter-column="value"]')?.textContent).toBe('Value');

    const valueInput = preview.querySelector(
      '[data-frontmatter-row="category"] input[aria-label="Value for category"]',
    ) as HTMLInputElement;
    expect(valueInput).toBeTruthy();
    expect(valueInput.getAttribute('aria-haspopup')).toBe('listbox');
    expect(valueInput.getAttribute('role')).toBe('combobox');

    // Add tag classifies as category rather than tags
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    const field = within(preview).getByLabelText('Value for category') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'strength' } });
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(view.state.doc.toString()).toMatch(/category:\n\s+- strength/);
    });
    expect(view.state.doc.toString()).not.toContain('tags:');
  });
});
