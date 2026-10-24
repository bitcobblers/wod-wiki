import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  computeInlinePanelBox,
  frontmatterPreview,
  frontmatterSuggestions,
  sectionField,
  type FrontmatterSuggestionCatalog,
} from '../src/extensions';

const catalog: FrontmatterSuggestionCatalog = {
  types: ['format', 'domain'],
  tags: [
    { label: 'amrap', type: 'format' },
    { label: 'for-time', type: 'format' },
  ],
};

const views: EditorView[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  containers.splice(0).forEach((container) => container.remove());
});

function editor(doc: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc,
      extensions: [
        sectionField,
        frontmatterPreview,
        frontmatterSuggestions.of(async () => catalog),
      ],
    }),
  });
  views.push(view);
  containers.push(container);
  return { container, view };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('frontmatter suggestion panel geometry', () => {
  it('clamps the panel to the field width instead of the full row', () => {
    const box = computeInlinePanelBox(
      { left: 400, width: 900 },
      { left: 280, width: 1000 },
      800,
    );
    expect(box.width).toBe(320);
  });

  it('gives a narrow field a readable minimum width', () => {
    const box = computeInlinePanelBox(
      { left: 280, width: 90 },
      { left: 280, width: 1000 },
      800,
    );
    expect(box.width).toBe(192);
  });

  it('anchors the panel to the field inside its row', () => {
    const box = computeInlinePanelBox(
      { left: 480, width: 176 },
      { left: 280, width: 1000 },
      800,
    );
    expect(box.offsetLeft).toBe(200);
  });

  it('caps the panel height so it never grows past the viewport', () => {
    expect(computeInlinePanelBox({ left: 0, width: 200 }, { left: 0, width: 200 }, 2000).maxHeight).toBe(256);
    expect(computeInlinePanelBox({ left: 0, width: 200 }, { left: 0, width: 200 }, 120).maxHeight).toBe(96);
  });
});

describe('frontmatter suggestion panel semantics', () => {
  it('exposes the field as a combobox wired to a named listbox', async () => {
    const { container } = editor('---\nformat: ""\n---\nBody');
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Value for format"]');
    if (!field) throw new Error('Missing value field');
    expect(field.getAttribute('role')).toBe('combobox');
    expect(field.getAttribute('aria-haspopup')).toBe('listbox');
    expect(field.getAttribute('aria-expanded')).toBe('false');

    field.focus();
    await settle();

    const listId = field.getAttribute('aria-controls');
    expect(listId).toBeTruthy();
    const list = document.getElementById(listId ?? '');
    expect(list?.getAttribute('role')).toBe('listbox');
    expect(list?.getAttribute('aria-label')).toBe('Suggested tags');
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(list?.querySelectorAll('[role="option"]').length).toBe(2);
  });

  it('expands inside the properties panel instead of floating over the page', async () => {
    const { container } = editor('---\nformat: ""\n---\nBody');
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Value for format"]');
    if (!field) throw new Error('Missing value field');
    field.focus();
    await settle();

    const listId = field.getAttribute('aria-controls');
    const list = document.getElementById(listId ?? '');
    // The panel lives inside the properties table, so the metadata actions
    // and the saved-history region below are pushed down, not covered.
    expect(list?.closest('.cm-frontmatter-preview')).not.toBeNull();
    expect(list?.parentElement?.className).toContain('rounded-lg');
  });

  it('drops the panel from the document when the field closes', async () => {
    const { container } = editor('---\nformat: ""\n---\nBody');
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Value for format"]');
    if (!field) throw new Error('Missing value field');
    field.focus();
    await settle();
    const listId = field.getAttribute('aria-controls');
    expect(document.getElementById(listId ?? '')).not.toBeNull();

    field.blur();
    await settle();
    expect(document.getElementById(listId ?? '')).toBeNull();
    expect(field.getAttribute('aria-expanded')).toBe('false');
  });
});
