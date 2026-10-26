/**
 * Reference-note commit — the atomic save seam for effort/equipment
 * definition documents.
 *
 * ONE transaction commits the definition projection (efforts/equipment
 * store), the note source and the derived containment links
 * (block_efforts/block_equipment via the scoped block-index rebuild). A
 * failure — stale source revision, invalid document, storage error — aborts
 * the whole transaction, so the caller's draft stays intact and no partial
 * projection or half-rebuilt link set ever becomes visible.
 *
 * The raw document is canonical: projection id/label/slug always come from
 * the parsed source (never invented here), and an update that would change
 * the record's id is rejected — identity changes go through the clone flow,
 * which patches the id into the source first.
 */

import type { IEffort, IEquipment } from '@bitcobblers/wod-wiki-lang';
import { documentToEffort, documentToEquipment } from '@bitcobblers/wod-wiki-lang';
import { readFrontmatterMeta } from '@bitcobblers/wod-wiki-engine';
import { storageService } from '@/services/storage';

export type ReferenceKind = 'effort' | 'equipment';

export interface CommitReferenceNoteInput {
  kind: ReferenceKind;
  /** Canonical slug — must agree with the document's own `slug` field. */
  slug: string;
  /** Full markdown document (frontmatter + body), kept losslessly. */
  rawContent: string;
  /** Display label — must agree with the document's own `label` field. */
  title: string;
  /** Current note revision; 0 creates the note. */
  expectedSourceRevision: number;
  /**
   * Owning note id. Defaults to the projection's recorded owner when one
   * exists, else `effort/<slug>` / `equipment/<slug>` for a fresh note.
   */
  noteId?: string;
}

export interface CommitReferenceNoteResult {
  id: string;
  sourceRevision: number;
}

/** Semantic source families (mirrors the seed families, used for by-source reads). */
const FAMILY_SOURCE: Record<ReferenceKind, string> = { effort: 'efforts', equipment: 'equipment' };

// Full cascade scope: definition saves touch projection+source+links+alias
// pages; definition deletion additionally cascades note attachments, tag
// links and page-note links via deleteNote — every store must be in the
// enclosing IndexedDB transaction scope or the scoped writes throw.
const REFERENCE_TX_STORES = ['notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment', 'efforts', 'equipment', 'page', 'page_notes', 'note_tags', 'attachments'] as const;

export async function commitReferenceNote(input: CommitReferenceNoteInput): Promise<CommitReferenceNoteResult> {
  // Parse + validate BEFORE any write: an invalid document never touches
  // storage and the draft stays editable.
  const parsedEffort = input.kind === 'effort' ? documentToEffort(input.rawContent) : undefined;
  const parsedEquipment = input.kind === 'equipment' ? documentToEquipment(input.rawContent) : undefined;
  const parsed = parsedEffort?.effort ?? parsedEquipment?.equipment;
  const errors = [...(parsedEffort?.errors ?? parsedEquipment?.errors ?? [])];

  // The projection mirrors the SOURCE, never a generated stand-in: require an
  // authored id and exact agreement with the caller's view.
  const fm = readFrontmatterMeta(input.rawContent);
  const authoredId = typeof fm['id'] === 'string' ? fm['id'].trim() : '';
  if (!authoredId) errors.push('Frontmatter must declare a stable `id` (the clone flow patches it into the source)');
  if (parsed && parsed.slug !== input.slug) errors.push(`Document slug "${parsed.slug}" does not match "${input.slug}"`);
  if (parsed && parsed.label.trim() !== input.title.trim()) errors.push(`Document label "${parsed.label}" does not match title "${input.title}"`);
  if (errors.length > 0) throw new Error(errors.join('\n'));

  return storageService.withTransaction([...REFERENCE_TX_STORES], async (scoped) => {
    const prior: IEffort | IEquipment | undefined = input.kind === 'effort'
      ? await scoped.getEffort(input.slug)
      : await scoped.getEquipment(input.slug);

    // Bundled definitions are read-only seed projections — never shadowed
    // or overwritten by a save; the clone flow creates `<slug>-custom`.
    if (prior?.registrySource === 'bundled') {
      throw new Error(`"${input.slug}" is a bundled definition and cannot be saved over — clone it first`);
    }
    // Identity is authored in the source; a save may never re-key an
    // existing record to a different id.
    if (prior && prior.id !== authoredId) {
      throw new Error(`Document id "${authoredId}" does not match record id "${prior.id}" — clone instead of re-keying`);
    }

    const ownerNoteId = prior?.ownerNoteId;
    const noteId = input.noteId ?? ownerNoteId ?? `${input.kind}/${input.slug}`;
    // A caller-supplied note id must agree with the projection's actual
    // owner — silently re-pointing ownership would orphan the real note.
    if (ownerNoteId !== undefined && noteId !== ownerNoteId) {
      throw new Error(`"${input.slug}" is owned by note ${ownerNoteId}; refusing to save against ${noteId}`);
    }

    const now = new Date().toISOString();
    if (input.kind === 'effort') {
      const effort: IEffort = {
        ...parsedEffort!.effort,
        id: authoredId,
        slug: input.slug,
        registrySource: 'user',
        ownerNoteId: noteId,
        sourceId: FAMILY_SOURCE.effort,
        sourcePath: noteId,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      };
      // Projection first so the block-index rebuild below resolves against
      // the new catalog; the shared transaction makes the order safe.
      await scoped.saveEffort(effort);
    } else {
      const equipment: IEquipment = {
        ...parsedEquipment!.equipment,
        id: authoredId,
        slug: input.slug,
        registrySource: 'user',
        ownerNoteId: noteId,
        sourceId: FAMILY_SOURCE.equipment,
        sourcePath: noteId,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      };
      await scoped.saveEquipment(equipment);
    }

    const note = await scoped.saveNoteSource({
      noteId,
      rawContent: input.rawContent,
      expectedSourceRevision: input.expectedSourceRevision,
      metadata: { title: parsed!.label, sourceId: FAMILY_SOURCE[input.kind] },
      createdAt: Date.now(),
    });
    return { id: noteId, sourceRevision: note.sourceRevision };
  });
}

/** Remove a user-owned definition: projection + owning note + derived links in one transaction. */
export async function deleteReferenceNote(kind: ReferenceKind, slug: string): Promise<void> {
  await storageService.withTransaction([...REFERENCE_TX_STORES], async (scoped) => {
    const prior: IEffort | IEquipment | undefined = kind === 'effort'
      ? await scoped.getEffort(slug)
      : await scoped.getEquipment(slug);
    // Only user rows are removable here; bundled projections belong to
    // their feed and are managed by feed import/removal.
    if (prior?.registrySource !== 'user') throw new Error(`"${slug}" is not user-owned ${kind}`);
    if (kind === 'effort') await scoped.deleteEffort(slug);
    else await scoped.deleteEquipment(slug);
    const noteId = prior.ownerNoteId ?? `${kind}/${slug}`;
    if (await scoped.getNote(noteId)) await scoped.deleteNote(noteId);
  });
}
