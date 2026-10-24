import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { frontmatterPreview, frontmatterSuggestions, sectionField, type FrontmatterSuggestionCatalog } from '../src/extensions';

const catalog: FrontmatterSuggestionCatalog = {
  types: ['format', 'domain'],
  tags: [
    { label: 'amrap', type: 'format' },
    { label: 'for-time', type: 'format' },
    { label: 'parkour', type: 'domain' },
  ],
};
const views: EditorView[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  containers.splice(0).forEach((container) => container.remove());
  vi.useRealTimers();
});

function editor(doc: string, provider = async () => catalog) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc,
      extensions: [sectionField, frontmatterPreview, frontmatterSuggestions.of(provider)],
    }),
  });
  views.push(view);
  containers.push(container);
  return { container, view };
}

function input(container: HTMLElement, label: string) {
  const element = Array.from(container.querySelectorAll('input')).find((candidate) => candidate.getAttribute('aria-label') === label);
  if (!element) throw new Error(`Missing input ${label}`);
  return element;
}

/** The suggestion popup lives in a document-level layer, keyed by the field. */
function options(field: HTMLInputElement): HTMLElement[] {
  const listId = field.getAttribute('aria-controls');
  const list = listId ? document.getElementById(listId) : null;
  return Array.from(list?.querySelectorAll('[role="option"]') ?? []);
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('inline frontmatter suggestions', () => {
  it('creating tags focuses only the originating editor', () => {
    vi.useFakeTimers();
    const first = editor('---\nformat: amrap\n---\nBody');
    const second = editor('---\nformat: amrap\n---\nBody');
    const add = first.container.querySelector('button[aria-label="Add tag"]');
    if (!(add instanceof HTMLButtonElement)) throw new Error('Missing Add tag action');
    add.click();
    vi.advanceTimersByTime(0);
    expect(document.activeElement).toBe(input(first.container, 'Value for tags'));
    expect(second.container.querySelector('input[aria-label="Value for tags"]')).toBeNull();
    expect(second.view.state.doc.toString()).toBe('---\nformat: amrap\n---\nBody');
  });

  it('shows matching typed values on empty focus and commits deliberate keyboard choices', async () => {
    const { container, view } = editor('---\nformat: ""\ndomain: ""\n---\nBody');
    const format = input(container, 'Value for format');
    format.focus();
    await settle();
    expect(options(format).map((option) => option.textContent)).toEqual(['amrap', 'for-time']);
    expect(format.hasAttribute('aria-activedescendant')).toBe(false);
    format.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    const activeId = format.getAttribute('aria-activedescendant');
    expect(document.getElementById(activeId ?? '')?.getAttribute('aria-selected')).toBe('true');
    format.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toContain('format: amrap');
    const domain = input(container, 'Value for domain');
    domain.focus();
    await settle();
    domain.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    domain.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toContain('domain: parkour');
  });

  it('excludes selected chips, filters typing, and persists one clicked chip', async () => {
    const { container, view } = editor('---\ntags: [amrap]\n---\nBody');
    const tags = input(container, 'Value for tags');
    tags.focus();
    await settle();
    expect(options(tags).map((option) => option.textContent)).toEqual(['for-time', 'parkour']);
    tags.value = 'park';
    tags.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const option = options(tags)[0];
    if (!(option instanceof HTMLElement)) throw new Error('Missing parkour option');
    expect(option.textContent).toBe('parkour');
    option.click();
    expect(view.state.doc.toString()).toMatch(/tags:\n\s+- amrap\n\s+- parkour/);
    expect(container.querySelectorAll('button[aria-label="Remove tag parkour"]')).toHaveLength(1);
  });

  it('Escape preserves the draft and Ctrl-Space reopens without activating a choice', async () => {
    const { container, view } = editor('---\nformat: ""\n---\nBody');
    const format = input(container, 'Value for format');
    format.focus();
    format.value = 'am';
    format.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    format.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    format.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(format.value).toBe('am');
    expect(format.getAttribute('aria-expanded')).toBe('false');
    format.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(format.getAttribute('aria-expanded')).toBe('true');
    expect(format.hasAttribute('aria-activedescendant')).toBe(false);
    format.blur();
    await settle();
    expect(view.state.doc.toString()).toContain('format: am');
  });

  it('property key choices commit a rename without losing its value', async () => {
    const { container, view } = editor('---\nproperty: parkour\n---\nBody');
    const key = input(container, 'Property key');
    key.focus();
    key.value = '';
    key.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(options(key).map((option) => option.textContent)).toEqual(['format', 'domain']);
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toContain('domain: parkour');
    expect(view.state.doc.toString()).not.toContain('property:');
  });

  it('ignores an old async response after typing and after blur', async () => {
    const requests: Array<(value: FrontmatterSuggestionCatalog) => void> = [];
    const { container } = editor('---\nformat: ""\n---\nBody', () => new Promise((resolve) => requests.push(resolve)));
    const format = input(container, 'Value for format');
    format.focus();
    format.value = 'for';
    format.dispatchEvent(new Event('input', { bubbles: true }));
    requests[1](catalog);
    await settle();
    expect(options(format).map((option) => option.textContent)).toEqual(['for-time']);
    requests[0](catalog);
    await settle();
    expect(options(format).map((option) => option.textContent)).toEqual(['for-time']);
    format.value = 'am';
    format.dispatchEvent(new Event('input', { bubbles: true }));
    format.blur();
    requests[2](catalog);
    await settle();
    expect(format.getAttribute('aria-expanded')).toBe('false');
  });

  it('ignores pending suggestions when its editor is destroyed', async () => {
    let resolveRequest: ((value: FrontmatterSuggestionCatalog) => void) | undefined;
    const { container, view } = editor('---\nformat: ""\n---\nBody', () => new Promise((resolve) => { resolveRequest = resolve; }));
    const format = input(container, 'Value for format');
    format.focus();
    view.destroy();
    resolveRequest?.(catalog);
    await settle();
    expect(format.getAttribute('aria-expanded')).toBe('false');
    views.splice(views.indexOf(view), 1);
  });
});
