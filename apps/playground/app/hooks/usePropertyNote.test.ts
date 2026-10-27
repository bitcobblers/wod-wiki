import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { parseQuery } from '@bitcobblers/wod-wiki-wql';
import type { Tag, TagTypeRecord } from '@bitcobblers/wod-wiki-core';
import { getTagIndex } from '@/services/tags/tagCatalogue';
import { setStorageForTesting, resetStorageForTesting, storageService } from '@/services/storage';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import {
  buildTagCategoryNoteDocument,
  buildTagNoteDocument,
  usePropertyNote,
  type UsePropertyNoteResult,
} from './usePropertyNote';

afterEach(() => {
  cleanup();
  resetStorageForTesting();
});

/** The first ```query fence of a synthesized Property Note — the widget a
 *  reader lands on when the note is opened. */
function firstQueryFence(document: string): string {
  const match = /```query\r?\n([\s\S]*?)```/.exec(document);
  if (!match) throw new Error('synthesized Property Note carries no ```query widget');
  return match[1].trim();
}

describe('buildTagNoteDocument', () => {
  it('preserves metrics and summaries contributed by a Tag Property Note', () => {
    const doc = buildTagNoteDocument({
      id: 'tag-tonnage',
      label: 'tonnage',
      createdAt: 0,
      contributions: [
        { kind: 'metric', type: 'resistance', value: 24, unit: 'kg' },
        { kind: 'metric', type: 'work', value: 'reps * resistance' },
        { kind: 'metric', type: 'summaries.totalWork', value: 'sum(work)' },
      ],
    });

    expect(doc).toContain('metrics.resistance: 24 kg');
    expect(doc).toContain('metrics.work: "reps * resistance"');
    expect(doc).toContain('summaries.totalWork: sum(work)');
  });

  it('synthesizes a default widget query the real WQL parser accepts', () => {
    // Dogfood finding 9: the synthesized tonnage Property Note embedded the
    // retired `find:note` head, so the fresh note opened on a query syntax
    // error. The contract is parser-level, not string-level: whatever head
    // the synthesizer emits must parse today.
    const doc = buildTagNoteDocument({
      id: 'tag-tonnage',
      label: 'tonnage',
      createdAt: 0,
      contributions: [
        { kind: 'metric', type: 'resistance', value: 24, unit: 'kg' },
        { kind: 'metric', type: 'work', value: 'reps * resistance' },
        { kind: 'metric', type: 'summaries.totalWork', value: 'sum(work)' },
      ],
    });

    const parsed = parseQuery(firstQueryFence(doc));
    expect(parsed.error ?? null).toBeNull();
  });

  it('synthesizes a default widget query for a Tag Category the parser accepts', () => {
    const doc = buildTagCategoryNoteDocument('domain', {
      id: 'type-domain',
      name: 'domain',
      label: 'Domain',
      createdAt: 0,
    });
    const parsed = parseQuery(firstQueryFence(doc));
    expect(parsed.error ?? null).toBeNull();
  });
});

describe('usePropertyNote — category note save/reload', () => {
  beforeEach(() => {
    setStorageForTesting(new InMemoryStorage());
  });

  function Probe(props: {
    category?: string;
    tagSlug?: string;
    tag?: Tag | null;
    tagType?: TagTypeRecord | null;
    expose: (result: UsePropertyNoteResult) => void;
  }) {
    props.expose(usePropertyNote(props.category, props.tagSlug, props.tag, props.tagType));
    return null;
  }

  it('persists an added frontmatter metric through save and reload', async () => {
    // Dogfood finding 4: on /t/domain the user adds `metrics.resistance:
    // 12kg` to the category note and hits Save Category Note; the metric
    // vanished while the (re-synthesized) prose persisted.
    await storageService.putTagType({ id: 'type-domain', name: 'domain', label: 'Domain', createdAt: 0 });
    await storageService.putTag({ id: 'tag-cf', label: 'crossfit', type: 'domain', createdAt: 0 });

    let latest: UsePropertyNoteResult | null = null;
    const expose = (result: UsePropertyNoteResult) => { latest = result; };

    render(createElement(Probe, { category: 'domain', expose }));
    await waitFor(() => expect(latest!.document).toContain('# Domain'), { timeout: 5000 });

    const edited = latest!.document.replace(
      '\n---\n\n# Domain',
      '\nmetrics.resistance: 12kg\n---\n\n# Domain',
    );
    expect(edited).toContain('metrics.resistance: 12kg');

    await act(async () => { await latest!.save(edited); });

    const stored = await storageService.getNote('t/domain');
    expect(stored).toBeDefined();
    expect(stored!.rawContent).toContain('metrics.resistance: 12kg');
    expect(stored!.rawContent).toContain('# Domain');

    // The save also refreshes the executable category projection.
    const tagType = await storageService.getTagType('domain');
    expect(tagType!.contributions).toContainEqual({ kind: 'metric', type: 'resistance', value: 12, unit: 'kg' });
    expect(getTagIndex().resolve('domain')?.contributions).toContainEqual({ kind: 'metric', type: 'resistance', value: 12, unit: 'kg' });
    expect(getTagIndex().resolve('crossfit')?.contributions).toContainEqual({ kind: 'tag', slug: 'domain' });

    // Reload the way navigating away and back does: a fresh hook mount must
    // read the committed source, not re-synthesize the document.
    cleanup();
    latest = null;
    render(createElement(Probe, { category: 'domain', expose }));
    await waitFor(() => expect(latest!.document).toContain('metrics.resistance: 12kg'), { timeout: 5000 });
    expect(latest!.document).toContain('# Domain');
    expect(latest!.sourceRevision).toBe(stored!.sourceRevision);
  });
});
