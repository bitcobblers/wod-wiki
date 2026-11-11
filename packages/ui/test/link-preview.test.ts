import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  attachmentUrlFacet,
  embedPreviewDecorations,
  handleSmartUrlPaste,
  linkPreview,
  markdownTablePreview,
  navigationFacet,
  sectionField,
} from '../src/extensions';

function mount(doc: string, readOnly = false): { view: EditorView; container: HTMLElement } {
  const state = EditorState.create({
    doc,
    extensions: [sectionField, linkPreview, EditorState.readOnly.of(readOnly)],
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new EditorView({ state, parent: container });
  return { view, container };
}

describe('linkPreview extension', () => {
  it('renders markdown links and bare URLs as pills with a new-tab button', () => {
    const doc = 'See [the docs](https://example.com/docs) and https://foo.bar/baz for details.\nDone.\n';
    const { view, container } = mount(doc);
    // Move the cursor off the link line so pills render.
    view.dispatch({ selection: { anchor: doc.length } });

    const pills = container.querySelectorAll('.cm-link-pill');
    expect(pills.length).toBe(2);

    const opens = container.querySelectorAll('a.cm-link-pill-open');
    expect(opens.length).toBe(2);
    expect((opens[0] as HTMLAnchorElement).href).toBe('https://example.com/docs');
    expect((opens[0] as HTMLAnchorElement).target).toBe('_blank');
    expect((opens[0] as HTMLAnchorElement).rel).toContain('noopener');
    expect((opens[1] as HTMLAnchorElement).href).toBe('https://foo.bar/baz');
    expect(container.querySelector('.cm-link-pill-label')?.textContent).toBe('the docs');

    view.destroy();
    container.remove();
  });

  it('strips trailing punctuation from bare URLs', () => {
    const doc = 'Visit https://example.com/page.\nDone.\n';
    const { view, container } = mount(doc);
    view.dispatch({ selection: { anchor: doc.length } });
    const open = container.querySelector('a.cm-link-pill-open') as HTMLAnchorElement;
    expect(open).not.toBeNull();
    expect(open.href).toBe('https://example.com/page');
    expect(open.getAttribute('href')).toBe('https://example.com/page');
    view.destroy();
    container.remove();
  });

  it('leaves the raw link text on the cursor line while editing', () => {
    const doc = 'See [the docs](https://example.com/docs) here.\n';
    const { view, container } = mount(doc);
    // Move the cursor onto the link line.
    view.dispatch({ selection: { anchor: 10 } });

    expect(container.querySelector('.cm-link-pill')).toBeNull();
    expect(container.textContent).toContain('[the docs](https://example.com/docs)');

    view.destroy();
    container.remove();
  });

  it('shows a YouTube player for standalone embed links whenever the cursor is off the line', () => {
    const doc = '[Demo](https://youtu.be/dQw4w9WgXcQ)\n';

    const read = mount(doc, true);
    expect(read.container.querySelector('.cm-youtube-player iframe')).not.toBeNull();
    expect(read.container.querySelector('.cm-youtube-player iframe')?.getAttribute('src'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(read.container.querySelector('.cm-link-pill')).toBeNull();
    read.view.destroy();
    read.container.remove();

    // Edit mode: cursor moves off the line -> player; back onto it -> raw text.
    const edit = mount(`${doc}More text.\n`);
    edit.view.dispatch({ selection: { anchor: edit.view.state.doc.length } });
    expect(edit.container.querySelector('.cm-youtube-player iframe')).not.toBeNull();
    expect(edit.container.querySelector('.cm-link-pill')).toBeNull();
    edit.view.dispatch({ selection: { anchor: 4 } });
    expect(edit.container.querySelector('.cm-youtube-player')).toBeNull();
    expect(edit.container.textContent).toContain('[Demo](https://youtu.be/dQw4w9WgXcQ)');
    edit.view.destroy();
    edit.container.remove();
  });

  it('turns a bare URL on its own line into a player in edit mode', () => {
    const doc = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ\n';
    const { view, container } = mount(`${doc}Done.\n`);
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    expect(container.querySelector('.cm-youtube-player iframe')).not.toBeNull();
    view.destroy();
    container.remove();
  });

  it('turns a list item holding only a YouTube link into a player', () => {
    const doc = '- https://youtu.be/dQw4w9WgXcQ\n';
    const { view, container } = mount(`${doc}Done.\n`);
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    expect(container.querySelector('.cm-youtube-player iframe')).not.toBeNull();
    // Cursor back on the list line restores the raw markdown.
    view.dispatch({ selection: { anchor: 2 } });
    expect(container.querySelector('.cm-youtube-player')).toBeNull();
    expect(container.textContent).toContain('- https://youtu.be/dQw4w9WgXcQ');
    view.destroy();
    container.remove();
  });

  it('renders non-YouTube embed links as pills in read mode', () => {
    const { view, container } = mount('[Docs](https://example.com/docs)\n', true);
    expect(container.querySelector('.cm-link-pill')).not.toBeNull();
    expect(container.querySelector('.cm-youtube-player')).toBeNull();
    view.destroy();
    container.remove();
  });

  it('does not touch URLs inside code spans', () => {
    const doc = 'Use `https://example.com/raw` inline.\nDone.\n';
    const { view, container } = mount(doc);
    view.dispatch({ selection: { anchor: doc.length } });
    expect(container.querySelector('.cm-link-pill')).toBeNull();
    view.destroy();
    container.remove();
  });

  it('renders internal workspace links and wiki links and routes them through navigationFacet', () => {
    const navigated: string[] = [];
    const doc = 'Open [Fran](/notes/fran) or [[Pull-ups]] next.\nDone.\n';
    const state = EditorState.create({
      doc,
      extensions: [
        sectionField,
        linkPreview,
        navigationFacet.of((url) => navigated.push(url)),
      ],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });
    view.dispatch({ selection: { anchor: doc.length } });

    const pills = container.querySelectorAll('.cm-link-pill');
    expect(pills.length).toBe(2);

    const opens = container.querySelectorAll('a.cm-link-pill-open');
    (opens[0] as HTMLAnchorElement).click();
    (opens[1] as HTMLAnchorElement).click();
    expect(navigated).toEqual(['/notes/fran', '/notes/pull-ups']);

    view.destroy();
    container.remove();
  });

  it('wraps selected prose text into a Markdown link on smart URL paste', () => {
    const doc = 'Check the movement standards here.\n';
    const { view, container } = mount(doc);
    const from = doc.indexOf('movement standards');
    const to = from + 'movement standards'.length;
    view.dispatch({ selection: { anchor: from, head: to } });

    const fakeClipboard = {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? 'https://example.com/standards' : ''),
      },
      preventDefault: () => {},
    } as unknown as ClipboardEvent;
    const handled = handleSmartUrlPaste(fakeClipboard, view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe(
      'Check the [movement standards](https://example.com/standards) here.\n',
    );

    view.destroy();
    container.remove();
  });

  it('excludes Markdown image syntax from link pills and renders inline image figures instead', async () => {
    const doc = '![Form Check](https://example.com/form.png)\n\n![Track](att-uuid-1)\n\nDone.\n';
    const state = EditorState.create({
      doc,
      extensions: [
        sectionField,
        linkPreview,
        embedPreviewDecorations,
        attachmentUrlFacet.of(async (id) => (id === 'att-uuid-1' ? 'blob:resolved-track' : null)),
      ],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });
    view.dispatch({ selection: { anchor: doc.length } });

    expect(container.querySelector('.cm-link-pill')).toBeNull();
    const figures = container.querySelectorAll('figure.cm-image-embed-block');
    expect(figures.length).toBe(2);

    await new Promise((r) => setTimeout(r, 10));
    const imgs = container.querySelectorAll('img.cm-image-embed-img');
    expect((imgs[0] as HTMLImageElement).src).toBe('https://example.com/form.png');
    expect((imgs[1] as HTMLImageElement).src).toBe('blob:resolved-track');

    view.destroy();
    container.remove();
  });
});

describe('markdownTablePreview extension', () => {
  it('renders pipe tables as HTML tables outside the cursor', () => {
    const doc = '| Exercise | Reps |\n| --- | --- |\n| Squat | 5 |\n| Press | 3 |\n\nDone.\n';
    const state = EditorState.create({
      doc,
      extensions: [sectionField, markdownTablePreview],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });
    view.dispatch({ selection: { anchor: doc.length } });

    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('th').length).toBe(2);
    expect(table?.textContent).toContain('Squat');
    expect(container.textContent).not.toContain('| --- |');
    // Surrounding prose outside the table lines survives.
    expect(container.textContent).toContain('Done.');

    view.destroy();
    container.remove();
  });

  it('keeps the raw source while the cursor is inside the table', () => {
    const doc = '| Exercise | Reps |\n| --- | --- |\n| Squat | 5 |\n\nDone.\n';
    const state = EditorState.create({
      doc,
      extensions: [sectionField, markdownTablePreview],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });
    // Cursor on the separator line (inside the table).
    view.dispatch({ selection: { anchor: doc.indexOf('---') } });

    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('| --- |');

    view.destroy();
    container.remove();
  });

  it('renders tables that follow prose in the same section', () => {
    const doc = 'Warm-up sets:\n\n| Exercise | Reps |\n| --- | --- |\n| Squat | 5 |\n';
    const state = EditorState.create({
      doc,
      extensions: [sectionField, markdownTablePreview],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });
    view.dispatch({ selection: { anchor: 2 } }); // cursor on prose line, outside the table

    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.textContent).toContain('Squat');
    expect(container.textContent).toContain('Warm-up sets:');

    view.destroy();
    container.remove();
  });

  it('renders multiple pipe tables in a single markdown section and updates cells when edited', () => {
    const doc = [
      '| Lift | Top Set |',
      '| --- | --- |',
      '| Squat | 140kg |',
      '',
      'Accessory notes:',
      '',
      '| Movement | Sets |',
      '| --- | --- |',
      '| Lunge | 3x10 |',
      '',
      'Done.',
    ].join('\n');
    const state = EditorState.create({
      doc,
      extensions: [sectionField, markdownTablePreview],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });
    view.dispatch({ selection: { anchor: doc.length } });

    const tables = container.querySelectorAll('table');
    expect(tables.length).toBe(2);
    expect(tables[0]?.textContent).toContain('140kg');
    expect(tables[1]?.textContent).toContain('3x10');

    // Update a body cell in-place and ensure widget eq() re-renders DOM.
    const idx = view.state.doc.toString().indexOf('140kg');
    view.dispatch({
      changes: { from: idx, to: idx + '140kg'.length, insert: '150kg' },
      selection: { anchor: view.state.doc.length },
    });
    expect(container.querySelectorAll('table')[0]?.textContent).toContain('150kg');

    // Click a body cell to edit inline via <input> and commit on Enter.
    const firstBodyCell = container.querySelector('table tbody td') as HTMLTableCellElement;
    firstBodyCell.click();
    const input = firstBodyCell.querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'Front Squat';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(view.state.doc.toString()).toContain('| Front Squat | 150kg |');

    view.destroy();
    container.remove();
  });
});
