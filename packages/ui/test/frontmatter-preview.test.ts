import { afterEach, describe, expect, it, vi } from 'vitest';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  sectionField,
  frontmatterPreview,
  frontmatterSuggestions,
  frontmatterVisibility,
} from '../src/extensions';

const SAMPLE_NOTE = `---
tags:
  - domain-model
store: field_catalog
keyPath: id
db: wodwiki-db (v20)
---

# FieldCatalogEntry
Some note body here.
`;

function openDetails(container: HTMLElement): void {
  container.querySelector<HTMLButtonElement>('button[aria-label="Show property details"]')?.click();
}

describe('frontmatterPreview extension', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('loads a compact summary and expands every property in detailed view', () => {
    const doc = `---
tags: [strength, intervals]
aliases: [Conditioning]
title: Engine Builder
metrics.effort: air-bike
---
# Body
`;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({
      parent: container,
      state: EditorState.create({ doc, extensions: [sectionField, frontmatterPreview] }),
    });

    try {
      const summary = container.querySelector('[data-frontmatter-summary]');
      expect(summary?.textContent).toContain('#strength');
      expect(summary?.textContent).toContain('#intervals');
      expect(summary?.textContent).toContain('Conditioning');
      expect(summary?.textContent).toContain('2 more properties');
      expect(summary?.textContent).toContain('1 custom metric');
      expect(container.querySelectorAll('[data-frontmatter-field]').length).toBe(0);
      expect(view.contentDOM.textContent).not.toContain('Engine Builder');

      const details = container.querySelector<HTMLButtonElement>('button[aria-label="Show property details"]');
      if (!details) throw new Error('Missing property details control');
      details.click();

      expect(container.querySelector('[data-frontmatter-summary]')).toBeNull();
      expect(container.querySelector<HTMLInputElement>('[data-frontmatter-row="title"] [data-frontmatter-field="value"]')?.value).toBe('Engine Builder');
      expect(container.querySelector<HTMLInputElement>('[data-frontmatter-row="metrics.effort"] [data-frontmatter-field="value"]')?.value).toBe('air-bike');
      expect(container.querySelector('button[aria-label="Show property summary"]')).not.toBeNull();
    } finally {
      view.destroy();
      container.remove();
    }
  });
  it('hides frontmatter without changing source and restores editable properties on opt-in', async () => {
    const visibility = new Compartment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: SAMPLE_NOTE,
        extensions: [sectionField, frontmatterPreview, visibility.of(frontmatterVisibility.of(false))],
      }),
    });
    try {
      expect(container.querySelector('.cm-frontmatter-preview')).toBeNull();
      expect(view.contentDOM.textContent).not.toContain('field_catalog');
      expect(view.contentDOM.textContent).toContain('FieldCatalogEntry');
      expect(view.state.doc.toString()).toBe(SAMPLE_NOTE);

      view.dispatch({ selection: { anchor: SAMPLE_NOTE.indexOf('store:') } });
      expect(view.contentDOM.textContent).not.toContain('field_catalog');
      view.dispatch({
        selection: { anchor: SAMPLE_NOTE.indexOf('# FieldCatalogEntry') },
        effects: visibility.reconfigure(frontmatterVisibility.of(true)),
      });
      openDetails(container);
      const input = Array.from(container.querySelectorAll('input')).find((item) => item.value === 'field_catalog');
      expect(input).toBeDefined();
      if (!input) throw new Error('Missing property value input');
      input.value = 'updated_catalog';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      expect(view.state.doc.toString()).toContain('store: updated_catalog');

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: '# Body only' },
        effects: visibility.reconfigure(frontmatterVisibility.of(false)),
      });
      expect(container.querySelector('[aria-label="Add property"]')).toBeNull();
      expect(container.querySelector('[aria-label="Add tag"]')).toBeNull();
      expect(view.contentDOM.textContent).toContain('Body only');
    } finally {
      view.destroy();
      container.remove();
    }
  });
  it('renders properties box with tag pills, list icons, and add property button', () => {
    const state = EditorState.create({
      doc: SAMPLE_NOTE,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    openDetails(container);
    const previewEl = container.querySelector('.cm-frontmatter-preview');
    expect(previewEl).not.toBeNull();

    // "Properties" header
    expect(previewEl?.textContent).toContain('Properties');

    // Tags pill
    expect(previewEl?.textContent).toContain('domain-model');

    // Scalar values
    const inputs = previewEl?.querySelectorAll('input');
    const inputValues = Array.from(inputs ?? []).map((i) => (i as HTMLInputElement).value);

    // Key inputs
    expect(inputValues).toContain('tags');
    expect(inputValues).toContain('store');
    expect(inputValues).toContain('keyPath');
    expect(inputValues).toContain('db');

    // Value inputs
    expect(inputValues).toContain('field_catalog');
    expect(inputValues).toContain('id');
    expect(inputValues).toContain('wodwiki-db (v20)');

    // Add property button
    expect(previewEl?.textContent).toContain('Add property');

    view.destroy();
    container.remove();
  });

  it('allows removing a tag via its pill remove button', () => {
    const state = EditorState.create({
      doc: SAMPLE_NOTE,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    openDetails(container);
    const removeTagBtn = container.querySelector('button[aria-label="Remove tag domain-model"]') as HTMLButtonElement;
    expect(removeTagBtn).not.toBeNull();

    removeTagBtn.click();

    expect(view.state.doc.toString()).not.toContain('domain-model');
    expect(view.state.doc.toString()).toContain('store: field_catalog');

    view.destroy();
    container.remove();
  });

  it('allows adding a new tag via tag input', () => {
    const state = EditorState.create({
      doc: SAMPLE_NOTE,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    openDetails(container);
    const tagInput = container.querySelector('input[placeholder*="Add tag"]') as HTMLInputElement;
    expect(tagInput).not.toBeNull();

    tagInput.value = 'architecture';
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(view.state.doc.toString()).toContain('architecture');
    expect(view.state.doc.toString()).toContain('domain-model');

    view.destroy();
    container.remove();
  });

  it('allows editing a property value input', async () => {
    const state = EditorState.create({
      doc: SAMPLE_NOTE,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    openDetails(container);
    const storeInput = Array.from(container.querySelectorAll('input')).find(
      (i) => (i as HTMLInputElement).value === 'field_catalog',
    ) as HTMLInputElement;
    expect(storeInput).not.toBeNull();

    storeInput.value = 'custom_catalog';
    storeInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(view.state.doc.toString()).toContain('store: custom_catalog');

    view.destroy();
    container.remove();
  });

  it('allows adding a new property via Add property button', () => {
    const state = EditorState.create({
      doc: SAMPLE_NOTE,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    const addBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add property'),
    );
    expect(addBtn).toBeDefined();

    addBtn?.click();

    expect(view.state.doc.toString()).toContain('property:');

    view.destroy();
    container.remove();
  });

  it('allows removing a property via row remove button', () => {
    const state = EditorState.create({
      doc: SAMPLE_NOTE,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    openDetails(container);
    const delKeyPathBtn = container.querySelector('button[aria-label="Remove property keyPath"]') as HTMLButtonElement;
    expect(delKeyPathBtn).not.toBeNull();

    delKeyPathBtn.click();

    expect(view.state.doc.toString()).not.toContain('keyPath:');
    expect(view.state.doc.toString()).toContain('store: field_catalog');

    view.destroy();
    container.remove();
  });

  it('renders read-only mode without editable inputs or action buttons', () => {
    const state = EditorState.create({
      doc: SAMPLE_NOTE,
      extensions: [sectionField, frontmatterPreview, EditorState.readOnly.of(true)],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    openDetails(container);
    const previewEl = container.querySelector('.cm-frontmatter-preview');
    expect(previewEl?.querySelectorAll('input').length).toBe(0);
    expect(previewEl?.querySelectorAll('button:not([aria-label="Show property summary"])').length).toBe(0);
    expect(previewEl?.textContent).toContain('domain-model');
    expect(previewEl?.textContent).toContain('field_catalog');

    view.destroy();
    container.remove();
  });

  it('renders +tag along with +property when no tags property is in frontmatter', () => {
    const NOTE_NO_TAGS = `---
title: My Workout
author: Coach
---
# Workout body
`;
    const state = EditorState.create({
      doc: NOTE_NO_TAGS,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    const addPropBtn = container.querySelector('button[aria-label="Add property"]');
    const addTagBtn = container.querySelector('button[aria-label="Add tag"]');

    expect(addPropBtn).not.toBeNull();
    expect(addTagBtn).not.toBeNull();

    view.destroy();
    container.remove();
  });

  it.each(['tags', 'tag', 'Category'])('Add tag focuses the existing %s input without changing metadata', (key) => {
    const state = EditorState.create({
      doc: `---\n${key}: [parkour]\n---\nBody`,
      extensions: [sectionField, frontmatterPreview],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });
    const before = view.state.doc.toString();
    const addTagBtn = container.querySelector('button[aria-label="Add tag"]');
    if (!(addTagBtn instanceof HTMLButtonElement)) throw new Error('Missing Add tag action');
    addTagBtn.click();
    expect(document.activeElement?.getAttribute('aria-label')).toBe(`Value for ${key}`);
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
    container.remove();
  });

  it('Add tag with missing tag property drafts a category input without touching the doc until a value commits', async () => {
    const NOTE_NO_TAGS = `---
title: My Workout
---
# Body
`;
    const state = EditorState.create({
      doc: NOTE_NO_TAGS,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    const addTagBtn = container.querySelector('button[aria-label="Add tag"]') as HTMLButtonElement;
    expect(addTagBtn).not.toBeNull();
    addTagBtn.click();

    // Clicking must not persist an empty category property.
    expect(view.state.doc.toString()).toBe(NOTE_NO_TAGS);

    const draftInput = container.querySelector('input[aria-label="Value for category"]') as HTMLInputElement;
    expect(draftInput).not.toBeNull();
    expect(document.activeElement).toBe(draftInput);

    // Blur without a value discards the draft.
    draftInput.blur();
    await Promise.resolve();
    expect(container.querySelector('[data-frontmatter-tag-draft]')).toBeNull();
    expect(view.state.doc.toString()).toBe(NOTE_NO_TAGS);

    // Escape discards too, even when the suggestion listbox handled the same event.
    addTagBtn.click();
    const draftInputEsc = container.querySelector('input[aria-label="Value for category"]') as HTMLInputElement;
    expect(draftInputEsc).not.toBeNull();
    draftInputEsc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(container.querySelector('[data-frontmatter-tag-draft]')).toBeNull();
    expect(view.state.doc.toString()).toBe(NOTE_NO_TAGS);

    // Committing a value writes it once, as a category (the app's
    // tagged-resource classification).
    addTagBtn.click();
    const draftInput2 = container.querySelector('input[aria-label="Value for category"]') as HTMLInputElement;
    draftInput2.value = 'parkour';
    draftInput2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const after = view.state.doc.toString();
    expect(after).toMatch(/category:\n\s+- parkour/);
    expect(after).not.toContain('tags:');
    expect(after).not.toContain('category: []');
    expect(after).not.toContain('category: ""');

    view.destroy();
    container.remove();
  });

  it('shows catalog suggestions on focus and commits the chosen type via keyboard', async () => {
    vi.useFakeTimers();
    const state = EditorState.create({
      doc: `---\ntitle: Session\n---\n# Body\n`,
      extensions: [
        sectionField,
        frontmatterPreview,
        frontmatterSuggestions.of(async () => ({ types: ['equipment', 'movement'], tags: [] })),
      ],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    const addBtn = container.querySelector('button[aria-label="Add property"]') as HTMLButtonElement;
    addBtn.click();
    await vi.advanceTimersByTimeAsync(10);

    const keyInput = document.activeElement as HTMLInputElement;
    expect(keyInput.getAttribute('aria-label')).toBe('Property key: property');

    const list = document.getElementById(keyInput.getAttribute('aria-controls')!) as HTMLElement;
    expect(list.hidden).toBe(false);
    expect(list.children.length).toBeGreaterThan(0);
    expect(list.textContent).toContain('equipment');

    keyInput.value = 'eq';
    keyInput.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(list.textContent).toContain('equipment');
    expect(list.textContent).not.toContain('movement');

    keyInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    keyInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const doc = view.state.doc.toString();
    expect(doc).toContain('equipment');
    expect(doc).not.toContain('property:');

    view.destroy();
    container.remove();
  });

  it('Ctrl+Space reopens tag value suggestions scoped to the property type', async () => {
    vi.useFakeTimers();
    const state = EditorState.create({
      doc: `---\nworkout: hiit\n---\n# Body\n`,
      extensions: [
        sectionField,
        frontmatterPreview,
        frontmatterSuggestions.of(async () => ({
          types: ['workout'],
          tags: [
            { label: 'hiit', type: 'workout' },
            { label: 'tempo', type: 'workout' },
            { label: 'general' },
          ],
        })),
      ],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    openDetails(container);
    const valueInput = Array.from(container.querySelectorAll('input')).find(
      (i) => i.getAttribute('aria-label') === 'Value for workout',
    ) as HTMLInputElement;
    expect(valueInput).not.toBeNull();

    valueInput.focus();
    await vi.advanceTimersByTimeAsync(10);
    const list = document.getElementById(valueInput.getAttribute('aria-controls')!) as HTMLElement;
    expect(list.hidden).toBe(false);
    expect(list.textContent).toContain('tempo');
    expect(list.textContent).not.toContain('general');
    expect(list.textContent).not.toContain('hiit');

    valueInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(list.hidden).toBe(true);

    valueInput.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(list.hidden).toBe(false);
    expect(list.textContent).toContain('tempo');

    view.destroy();
    container.remove();
  });

  it('replacing the doc while a property input is focused yields the exact replacement with no duplicate frontmatter', async () => {
    const state = EditorState.create({
      doc: `---\ntitle: Session\n---\n# Body\n`,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    openDetails(container);
    const valueInput = Array.from(container.querySelectorAll('input')).find(
      (i) => i.getAttribute('aria-label') === 'Value for title',
    ) as HTMLInputElement;
    expect(valueInput).not.toBeNull();
    valueInput.focus();
    valueInput.value = 'Stale draft';

    // Widget teardown while focused must not re-commit the stale input value
    // via a blur-triggered dispatch (reentrant EditorView.update crash/corruption).
    const replacement = `---\ntitle: Rewritten\n---\n# Fresh body\n`;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: replacement } });
    await Promise.resolve();

    const doc = view.state.doc.toString();
    expect(doc).toBe(replacement);
    expect((doc.match(/^---$/gm) ?? []).length).toBe(2);
    expect(doc).not.toContain('Stale draft');

    view.destroy();
    container.remove();
  });

  it('does not duplicate existing tags case-insensitively', () => {
    const state = EditorState.create({
      doc: `---\ntags:\n  - parkour\n---\n# Body\n`,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    openDetails(container);
    const tagInput = container.querySelector('input[aria-label="Value for tags"]') as HTMLInputElement;
    expect(tagInput).not.toBeNull();
    tagInput.value = 'PARKOUR';
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const doc = view.state.doc.toString();
    expect((doc.match(/parkour/gi) ?? []).length).toBe(1);

    view.destroy();
    container.remove();
  });

  it('reveals raw YAML and focuses the opening delimiter via Edit YAML', () => {
    const state = EditorState.create({
      doc: SAMPLE_NOTE,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    expect(container.querySelector('.cm-frontmatter-preview')).not.toBeNull();

    const editBtn = container.querySelector('button[aria-label="Edit YAML"]') as HTMLButtonElement;
    expect(editBtn).not.toBeNull();
    editBtn.click();

    expect(view.state.selection.main.anchor).toBe(0);
    expect(container.querySelector('.cm-frontmatter-preview')).toBeNull();
    expect(container.textContent).toContain('tags:');

    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(container.querySelector('.cm-frontmatter-preview')).not.toBeNull();

    view.destroy();
    container.remove();
  });

  it('renders +tag along with +properties at the top when editing a note with no frontmatter', () => {
    const NOTE_WITHOUT_FM = `# Just A Heading
No frontmatter here.
`;
    const state = EditorState.create({
      doc: NOTE_WITHOUT_FM,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    const addPropBtn = container.querySelector('button[aria-label="Add property"]');
    const addTagBtn = container.querySelector('button[aria-label="Add tag"]');

    expect(addPropBtn).not.toBeNull();
    expect(addTagBtn).not.toBeNull();

    (addTagBtn as HTMLButtonElement).click();

    // Draft only: the note still has no frontmatter until a tag value commits.
    expect(view.state.doc.toString()).toBe(NOTE_WITHOUT_FM);

    const draftInput = container.querySelector('input[aria-label="Value for category"]') as HTMLInputElement;
    expect(draftInput).not.toBeNull();
    draftInput.value = 'strength';
    draftInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const after = view.state.doc.toString();
    expect(after).toMatch(/^---\r?\ncategory:/);
    expect(after).toContain('strength');
    expect(after).toContain(NOTE_WITHOUT_FM.trim());

    view.destroy();
    container.remove();
  });

  it('renders a new-tab navigate button for URL-valued properties (edit and read-only)', () => {
    const doc = '---\ntitle: Demo\nsource: https://example.com/src\n---\n# Body\n';

    const editState = EditorState.create({
      doc,
      extensions: [sectionField, frontmatterPreview],
    });
    const editContainer = document.createElement('div');
    document.body.appendChild(editContainer);
    const editView = new EditorView({ state: editState, parent: editContainer });

    openDetails(editContainer);
    const editLink = editContainer.querySelector('a[aria-label="Open source in new tab"]') as HTMLAnchorElement;
    expect(editLink).not.toBeNull();
    expect(editLink.href).toBe('https://example.com/src');
    expect(editLink.target).toBe('_blank');
    expect(editLink.rel).toContain('noopener');
    // Non-URL values get no button.
    expect(editContainer.querySelector('a[aria-label="Open title in new tab"]')).toBeNull();
    editView.destroy();
    editContainer.remove();

    const roState = EditorState.create({
      doc,
      extensions: [sectionField, frontmatterPreview, EditorState.readOnly.of(true)],
    });
    const roContainer = document.createElement('div');
    document.body.appendChild(roContainer);
    const roView = new EditorView({ state: roState, parent: roContainer });

    openDetails(roContainer);
    const roLink = roContainer.querySelector('a[aria-label="Open source in new tab"]') as HTMLAnchorElement;
    expect(roLink).not.toBeNull();
    expect(roLink.href).toBe('https://example.com/src');
    roView.destroy();
    roContainer.remove();
  });

  it('labels every property field visibly and programmatically', () => {
    const doc = '---\ncategory:\nstore: field_catalog\n---\n# Body\n';
    const state = EditorState.create({
      doc,
      extensions: [sectionField, frontmatterPreview],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    openDetails(container);
    const preview = container.querySelector('.cm-frontmatter-preview');
    expect(preview).not.toBeNull();

    // Visible, persistent column labels — the placeholder is never the only cue.
    expect(preview?.querySelector('[data-frontmatter-column="key"]')?.textContent).toBe('Key');
    expect(preview?.querySelector('[data-frontmatter-column="value"]')?.textContent).toBe('Value');

    const keyField = preview?.querySelector<HTMLInputElement>(
      '[data-frontmatter-row="store"] [data-frontmatter-field="key"]',
    );
    expect(keyField?.getAttribute('aria-label')).toBe('Property key: store');

    const valueField = preview?.querySelector<HTMLInputElement>(
      '[data-frontmatter-row="store"] [data-frontmatter-field="value"]',
    );
    expect(valueField?.getAttribute('aria-label')).toBe('Value for store');

    // A tag property is still a VALUE field, not a separate "add tag" control.
    const tagField = preview?.querySelector<HTMLInputElement>(
      '[data-frontmatter-row="category"] [data-frontmatter-field="value"]',
    );
    expect(tagField?.getAttribute('aria-label')).toBe('Value for category');

    // Every field carries readable helper text for assistive technology.
    for (const field of [keyField, valueField, tagField]) {
      const describedBy = field?.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const helper = document.getElementById(describedBy ?? '');
      expect(helper?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }

    view.destroy();
    container.remove();
  });

  it('does not render metadata buttons for notes without frontmatter in read-only mode', () => {
    const NOTE_WITHOUT_FM = `# Readonly Heading
No frontmatter.
`;
    const state = EditorState.create({
      doc: NOTE_WITHOUT_FM,
      extensions: [sectionField, frontmatterPreview, EditorState.readOnly.of(true)],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    const previewEl = container.querySelector('.cm-frontmatter-preview');
    expect(previewEl).toBeNull();

    view.destroy();
    container.remove();
  });
  it('groups Tag Categories in summary mode and authors custom metrics and summaries', () => {
    const doc = `---
tags: [strength]
domain: [crossfit]
equipment: [kettlebell]
aliases: [KB Complex]
title: Bell Work
metrics.met: 6
summaries.totalWork: sum(work)
---
# Body
`;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({
      parent: container,
      state: EditorState.create({ doc, extensions: [sectionField, frontmatterPreview] }),
    });

    try {
      const summary = container.querySelector('[data-frontmatter-summary]');
      expect(summary?.textContent).toContain('#strength');
      expect(summary?.textContent).toContain('#crossfit');
      expect(summary?.textContent).toContain('#kettlebell');
      expect(summary?.textContent).toContain('KB Complex');
      expect(summary?.textContent).toContain('3 more properties');
      expect(summary?.textContent).toContain('1 custom metric');
      expect(summary?.textContent).toContain('1 summary');

      // Add metric -> Custom / Equation from summary mode auto-expands to detailed mode
      const addMetricBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Add metric"]');
      if (!addMetricBtn) throw new Error('Missing Add metric button');
      addMetricBtn.click();
      expect(container.querySelector('[data-frontmatter-summary]')).toBeNull();

      const kindSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Metric kind"]');
      if (!kindSelect) throw new Error('Missing Metric kind select');
      kindSelect.value = 'custom';
      kindSelect.dispatchEvent(new Event('change', { bubbles: true }));

      const metricKeyInput = container.querySelector<HTMLInputElement>('input[aria-label="Metric key"]');
      const metricValInput = container.querySelector<HTMLInputElement>('input[aria-label="Metric value"]');
      if (!metricKeyInput || !metricValInput) throw new Error('Missing custom metric draft inputs');
      metricKeyInput.value = 'work';
      metricValInput.value = 'reps * resistance';
      metricValInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(view.state.doc.toString()).toContain('metrics.work: "reps * resistance"');

      // Add summary authors summaries.<key>
      const addSummaryBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Add summary"]');
      if (!addSummaryBtn) throw new Error('Missing Add summary button');
      addSummaryBtn.click();

      const summaryKeyInput = container.querySelector<HTMLInputElement>('input[aria-label="Summary key"]');
      const summaryEqInput = container.querySelector<HTMLInputElement>('input[aria-label="Summary equation"]');
      if (!summaryKeyInput || !summaryEqInput) throw new Error('Missing summary draft inputs');
      summaryKeyInput.value = 'workRate';
      summaryEqInput.value = 'sum(work) / convert(sum(elapsed), min)';
      summaryEqInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(view.state.doc.toString()).toContain('summaries.workRate: "sum(work) / convert(sum(elapsed), min)"');
    } finally {
      view.destroy();
      container.remove();
    }
  });
});
