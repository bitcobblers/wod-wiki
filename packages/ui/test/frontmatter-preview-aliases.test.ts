import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { parseFrontmatterBody } from '@bitcobblers/wod-wiki-wql';
import {
  frontmatterPreview,
  frontmatterReferenceIndex,
  sectionField,
} from '../src/extensions';

/**
 * Alias fidelity — dogfood finding #10.
 *
 * The /t/effort/thruster note authors three aliases (thrusters, barbell
 * thruster, Weighted Thrusters). The compact summary renders them verbatim,
 * but the detailed properties table resolved every alias chip through the
 * reference provider and displayed the canonical label — three identical
 * "Thruster" pills. A pill that no longer shows its authored token cannot be
 * told apart from its siblings, and removal becomes guesswork.
 *
 * These tests pin the user-visible contract: aliases render as authored in
 * both views, and removing a pill removes exactly the authored token.
 */

const ALIASES = ['thrusters', 'barbell thruster', 'Weighted Thrusters'];

const THRUSTER_NOTE = `---
title: Thruster
type: effort
aliases:
  - thrusters
  - barbell thruster
  - Weighted Thrusters
---
# Thruster
A thruster is a front squat followed by an overhead press.
`;

// Deployed catalog shape: every authored alias resolves back to the same
// canonical Thruster entry — exactly what the live reference index returns.
const thrusterCatalog = {
  resolve: () => ({
    matched: 'thrusters',
    effortRef: { kind: 'effort' as const, slug: 'thruster', label: 'Thruster' },
    equipment: [],
    diagnostics: [],
  }),
  resolveEffort: (_token: string) => ({ slug: 'thruster', label: 'Thruster' }),
  resolveEquipment: (_token: string) => null,
  openHref: (kind: 'effort' | 'equipment' | 'tag', slug: string) => `/t/${kind}/${slug}`,
  createHref: (kind: 'effort' | 'equipment' | 'tag') => `/t/${kind}`,
};

function openThrusterEditor() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: THRUSTER_NOTE,
      extensions: [
        sectionField,
        frontmatterReferenceIndex.of(() => thrusterCatalog),
        frontmatterPreview,
      ],
    }),
  });
  return { container, view };
}

function openDetails(container: HTMLElement): void {
  container.querySelector<HTMLButtonElement>('button[aria-label="Show property details"]')?.click();
}

/** Texts of the pill labels inside `root` (pill = span.inline-flex > span). */
function pillTexts(root: HTMLElement | null): string[] {
  if (!root) return [];
  return [...root.querySelectorAll('span.inline-flex > span')].map((el) => el.textContent ?? '');
}

function frontmatterMeta(doc: string): Record<string, unknown> {
  const body = doc.replace(/^---\r?\n/, '').replace(/\r?\n---[\s\S]*$/, '');
  return parseFrontmatterBody(body);
}

describe('frontmatter alias fidelity', () => {
  it('summary lists the authored aliases verbatim', () => {
    const { container, view } = openThrusterEditor();
    try {
      const summary = container.querySelector<HTMLElement>('[data-frontmatter-summary]');
      expect(summary).not.toBeNull();
      expect(pillTexts(summary)).toEqual(ALIASES);
    } finally {
      view.destroy();
      container.remove();
    }
  });

  it('detailed pills show the authored alias values, not the resolved canonical label', () => {
    const { container, view } = openThrusterEditor();
    try {
      openDetails(container);
      const row = container.querySelector<HTMLElement>('[data-frontmatter-row="aliases"]');
      expect(row).not.toBeNull();
      const texts = pillTexts(row);
      expect(
        texts,
        `alias pills collapsed to the canonical label: ${JSON.stringify(texts)} — ` +
          'detailed view must render each authored alias so its pill is distinguishable',
      ).toEqual(ALIASES);
    } finally {
      view.destroy();
      container.remove();
    }
  });

  it('summary and detailed views agree on the alias values', () => {
    const { container, view } = openThrusterEditor();
    try {
      const summary = container.querySelector<HTMLElement>('[data-frontmatter-summary]');
      const summarized = pillTexts(summary);
      openDetails(container);
      const detailed = pillTexts(container.querySelector('[data-frontmatter-row="aliases"]'));
      expect(detailed).toEqual(summarized);
    } finally {
      view.destroy();
      container.remove();
    }
  });

  it('removing one alias pill removes exactly that authored token and keeps its siblings', () => {
    const { container, view } = openThrusterEditor();
    try {
      openDetails(container);
      const remove = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Remove barbell thruster"]',
      );
      expect(remove, 'each alias pill must expose a remove control keyed by its authored token').not.toBeNull();
      remove!.click();

      const meta = frontmatterMeta(view.state.doc.toString());
      expect(meta['aliases']).toEqual(['thrusters', 'Weighted Thrusters']);
      // Authored casing must survive the round-trip.
      expect(view.state.doc.toString()).toContain('Weighted Thrusters');

      const texts = pillTexts(container.querySelector('[data-frontmatter-row="aliases"]'));
      expect(texts).toEqual(['thrusters', 'Weighted Thrusters']);
    } finally {
      view.destroy();
      container.remove();
    }
  });

  it('never flags resolvable aliases as unknown references', () => {
    const { container, view } = openThrusterEditor();
    try {
      openDetails(container);
      expect(container.querySelector('[data-testid="editor-ref-unknown"]')).toBeNull();
    } finally {
      view.destroy();
      container.remove();
    }
  });
});
