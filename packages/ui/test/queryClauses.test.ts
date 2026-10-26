import { describe, expect, it } from 'vitest';
import { CLAUSE_META, TARGET_OPTIONS, allowedFilterTypesForTarget, getClauseMeta } from '../src/composer/queryClauses';
import { WQL_FIND_TARGETS } from '@bitcobblers/wod-wiki-wql';

describe('plane clause metadata (ticket 08)', () => {
  it('the retired catalog: filter key is gone from the composer', () => {
    expect('catalog' in CLAUSE_META).toBe(false);
    for (const target of WQL_FIND_TARGETS) {
      expect(allowedFilterTypesForTarget(target, 'find').has('catalog')).toBe(false);
    }
  });

  it('labels differ so the facet rail shows one heading per filter', () => {
    expect(getClauseMeta('notebook').label).toBe('Notebook');
    expect(getClauseMeta('contributes').label).toBe('Contributes');
    expect(getClauseMeta('contributes').label).not.toBe(getClauseMeta('tag').label);
  });

  it('notebook description says what the filter matches', () => {
    const notebook = getClauseMeta('notebook').description;
    expect(notebook).toMatch(/notebook container id/i);
    expect(notebook).toMatch(/notebook\/journal/);
    expect(notebook).toMatch(/notebook\/playground/);
    expect(notebook).toMatch(/notebook\/guides/);
  });

  it('the contributes clause exposes contribution kinds — never a label filter', () => {
    const contributes = getClauseMeta('contributes');
    expect(contributes.prefix).toBe('contributes:');
    expect(contributes.description).toMatch(/contributes/i);
    expect(contributes.description).toMatch(/metric/);
    // The plane's registered filter set carries contributes, not tags-as-contributions.
    expect(allowedFilterTypesForTarget('tag', 'find').has('contributes')).toBe(true);
    expect(allowedFilterTypesForTarget('note', 'find').has('contributes')).toBe(false);
  });

  it('the page clause describes the placement plane narrowing', () => {
    const page = getClauseMeta('page');
    expect(page.prefix).toBe('page:');
    expect(page.description).toMatch(/slug/i);
  });

  it('every find target has a target option with a description', () => {
    for (const target of WQL_FIND_TARGETS) {
      const option = TARGET_OPTIONS.find((o) => o.value === target);
      expect(option, target).toBeDefined();
      expect(option?.description, target).toBeTruthy();
    }
  });

  it('each plane offers exactly its registered filter keys', () => {
    // The notebook plane IS the note plane (its executor delegates) — the
    // two advertise the same member-criteria keys, asserted against the
    // implementation rather than a hard-coded subset.
    expect(allowedFilterTypesForTarget('notebook', 'find')).toEqual(allowedFilterTypesForTarget('note', 'find'));
    expect(allowedFilterTypesForTarget('page', 'find')).toEqual(new Set(['page', 'notebook', 'text', 'note', 'time']));
    expect(allowedFilterTypesForTarget('tag', 'find')).toEqual(new Set(['tag', 'type', 'contributes', 'text', 'time']));
    expect(allowedFilterTypesForTarget('equipment', 'find')).toEqual(new Set(['equipment', 'tags', 'text', 'notebook', 'time']));
  });
});
