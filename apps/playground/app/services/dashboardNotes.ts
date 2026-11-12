/**
 * dashboardNotes — creation flow for dashboard notes (#907, format locked in
 * #899). A new dashboard is a typed vault note (`type: 'dashboard'`,
 * `sourceId: 'dashboards'`, no journal date) carrying the scaffold from
 * packages/wql/src/dashboard/scaffold (canonical, ticket 19); creation marks
 * it active and clears `dashboard.active` from every other dashboard note so
 * the route's discovery (active wins, else first) always lands on the new
 * one.
 */

import type { INotePersistence } from '@/services/persistence';
import { notePersistence } from '@/services/persistence';
import type { HistoryRecord } from '@/types/history';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/frontmatter';
import {
  buildDashboardScaffold,
  buildDashboardFromScope,
  dashboardSlug,
  DEFAULT_DASHBOARD_TITLE,
  type BuildScopedDashboardOptions,
} from '@bitcobblers/wod-wiki-wql';

import { notifyDashboardsChanged } from './dashboardEvents';
import { journalNotes, type JournalNotes } from './journalNotes';

export interface DashboardNotesDependencies {
  persistence: Pick<INotePersistence, 'listNotes'>;
  journal: JournalNotes;
}

export interface DashboardNotes {
  createDashboard(title?: string): Promise<HistoryRecord>;
  /** Promote any WQL query or EntityScopeDescriptor into an active Dashboard Note. */
  createDashboardFromScope(options: BuildScopedDashboardOptions): Promise<HistoryRecord>;
  /** Clone a prebuilt seed into the vault as an editable dashboard note,
   *  stamping its slug so it stays route-addressable at /dashboard/:slug. */
  cloneDashboard(slug: string, seedRawContent: string, title?: string): Promise<HistoryRecord>;
  /** Delete a user-owned (vault) dashboard note by id and notify dashboard
   *  listeners; prebuilt seeds are code-owned and never routable through this. */
  deleteDashboard(noteId: string): Promise<void>;
}

export function createDashboardNotes({ persistence, journal }: DashboardNotesDependencies): DashboardNotes {
  // Deactivate every other active dashboard so the just-created/cloned note
  // is the one the namespace lands on. Runs before the create so a failure
  // leaves the vault's existing dashboards intact. Typed discovery uses the
  // canonical Note kind rather than frontmatter to select dashboard notes.
  async function deactivateOthersAndCollectSlugs(excludeId?: string): Promise<Set<string>> {
    const notes = await persistence.listNotes({ kind: 'dashboard' });
    const slugs = new Set<string>();
    for (const note of notes) {
      const { meta, body } = parseFrontmatter(note.rawContent);
      if (typeof meta.slug === 'string' && meta.slug.trim()) {
        slugs.add(meta.slug.trim());
      }
      if (excludeId && note.id === excludeId) continue;
      if (meta['dashboard'] !== 'true' || meta['dashboard.active'] !== 'true') continue;
      const next = { ...meta };
      delete next['dashboard.active'];
      await journal.update(note, `---\n${serializeFrontmatter(next)}\n---\n${body}`);
    }
    return slugs;
  }

  function ensureUniqueSlug(
    rawContent: string,
    existingSlugs: Set<string>,
  ): { rawContent: string; slug: string; suffix: number } {
    const { meta, body } = parseFrontmatter(rawContent);
    const baseSlug =
      (typeof meta.slug === 'string' && meta.slug.trim()
        ? dashboardSlug(meta.slug)
        : dashboardSlug(String(meta.title ?? DEFAULT_DASHBOARD_TITLE))) || 'dashboard';
    let suffix = 1;
    let candidate = baseSlug;
    while (existingSlugs.has(candidate)) {
      suffix += 1;
      candidate = `${baseSlug}-${suffix}`;
    }
    if (meta.slug === candidate) {
      return { rawContent, slug: candidate, suffix };
    }
    const nextMeta: Record<string, string | number | string[]> = { ...meta, slug: candidate };
    if (suffix > 1 && meta.title === DEFAULT_DASHBOARD_TITLE) {
      nextMeta.title = `${DEFAULT_DASHBOARD_TITLE} ${suffix}`;
    }
    return {
      rawContent: `---\n${serializeFrontmatter(nextMeta)}\n---\n${body}`,
      slug: candidate,
      suffix,
    };
  }

  return {
    async createDashboard(title = DEFAULT_DASHBOARD_TITLE) {
      const existingSlugs = await deactivateOthersAndCollectSlugs();
      const unique = ensureUniqueSlug(buildDashboardScaffold(title), existingSlugs);
      const effectiveTitle =
        unique.suffix > 1 && title === DEFAULT_DASHBOARD_TITLE
          ? `${DEFAULT_DASHBOARD_TITLE} ${unique.suffix}`
          : title;
      const created = await journal.create({
        title: effectiveTitle,
        rawContent: unique.rawContent,
        type: 'dashboard',
        sourceId: 'dashboards',
      });
      notifyDashboardsChanged();
      return created;
    },

    async createDashboardFromScope(options) {
      const existingSlugs = await deactivateOthersAndCollectSlugs();
      const unique = ensureUniqueSlug(buildDashboardFromScope(options), existingSlugs);
      const { meta } = parseFrontmatter(unique.rawContent);
      const title = typeof meta.title === 'string' && meta.title ? meta.title : DEFAULT_DASHBOARD_TITLE;
      const created = await journal.create({
        title,
        rawContent: unique.rawContent,
        type: 'dashboard',
        sourceId: 'dashboards',
      });
      notifyDashboardsChanged();
      return created;
    },
    async cloneDashboard(slug, seedRawContent, title) {
      await deactivateOthersAndCollectSlugs();
      // Stamp the slug into the seed's frontmatter so the clone is
      // addressable; keep the seed's title unless overridden.
      const { meta, body } = parseFrontmatter(seedRawContent);
      const nextMeta: Record<string, string | number | string[]> = { ...meta, slug };
      if (title) nextMeta.title = title;
      const raw = `---\n${serializeFrontmatter(nextMeta)}\n---\n${body}`;
      const created = await journal.create({
        title: typeof nextMeta.title === 'string' ? nextMeta.title : slug,
        rawContent: raw,
        type: 'dashboard',
        sourceId: 'dashboards',
      });
      notifyDashboardsChanged();
      return created;
    },

    async deleteDashboard(noteId) {
      await journal.delete(noteId);
      notifyDashboardsChanged();
    },
  };
}

export const dashboardNotes = createDashboardNotes({ persistence: notePersistence, journal: journalNotes });
