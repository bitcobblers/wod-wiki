/**
 * Dashboard seed derivation — buildDashboardSeeds turns the seeded corpus's
 * `markdown/dashboards/**` files into addressable prebuilt dashboards.
 *
 * The corpus itself lives in the wod-wiki-community repo (its `wod build`
 * dashboard gate validates every shipped note's #899 format and WQL); this
 * test pins the app-side derivation with fixtures: only dashboards/ files
 * are kept, the slug comes from frontmatter `slug:` else the filename, and
 * the input really is a dashboard note with parseable widgets.
 */
import { describe, expect, it } from 'bun:test';
import { buildDashboardDocument, isDashboardWidgetType, parseDashboardNote, parseQuery, resolveWidgetType } from '@bitcobblers/wod-wiki-wql';
import { buildDashboardSeeds } from './dashboardSeeds';

const FIXTURE_FILES = {
  'markdown/dashboards/with-slug.md': [
    '---',
    'dashboard: true',
    'slug: custom-slug',
    'title: With Slug',
    '---',
    '# With Slug',
    '',
    '## Volume',
    '',
    '```query:table-2',
    'count:elapsed{} by {day}',
    '```',
    '',
  ].join('\n'),
  'markdown/dashboards/plain-name.md': [
    '---',
    'dashboard: true',
    'title: Plain',
    '---',
    '# Plain',
    '',
    '## Intensity',
    '',
    '```query:bar',
    'sum:tis{} by {session, day}',
    '```',
    '',
  ].join('\n'),
  'markdown/collections/other/readme.md': '# not a dashboard',
};

describe('buildDashboardSeeds', () => {
  it('keeps only markdown/dashboards/ files', () => {
    const seeds = buildDashboardSeeds(FIXTURE_FILES);
    expect(seeds.map((s) => s.slug).sort()).toEqual(['custom-slug', 'plain-name']);
  });

  it('derives the slug from frontmatter slug, else the filename', () => {
    const seeds = buildDashboardSeeds(FIXTURE_FILES);
    expect(seeds.find((s) => s.title === 'With Slug')?.slug).toBe('custom-slug');
    expect(seeds.find((s) => s.title === 'Plain')?.slug).toBe('plain-name');
  });

  it('fixtures are valid dashboard notes with parseable WQL widgets (the #899 contract)', () => {
    for (const seed of buildDashboardSeeds(FIXTURE_FILES)) {
      const { meta, sections } = parseDashboardNote(seed.rawContent);
      const doc = buildDashboardDocument(sections, meta);
      expect(doc.isDashboard, seed.slug).toBe(true);
      expect(doc.widgets.length, seed.slug).toBeGreaterThan(0);
      for (const widget of doc.widgets) {
        expect(isDashboardWidgetType(resolveWidgetType(widget.type)), seed.slug).toBe(true);
        expect(parseQuery(widget.body).error, `${seed.slug}: ${widget.body}`).toBeUndefined();
      }
    }
  });
});
