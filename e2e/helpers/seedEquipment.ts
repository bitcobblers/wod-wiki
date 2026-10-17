import type { Page } from '@playwright/test';
import { WOD_DB, seedNote } from './wodwikiDb';
import { waitForSeedReady } from './seedReadiness';

/**
 * Self-seeded bundled-equipment fixtures for e2e tests.
 *
 * Mirrors helpers/seedEfforts.ts: the bundled equipment corpus is a seed
 * concern, so tests seed the `equipment` registry projection, the owner
 * note (id `equipment/<slug>`, sourceId `equipment`, source path
 * `markdown/equipment/<slug>.md`), and — for the usage surface — one
 * consumer note with `block_equipment` link rows. No test depends on
 * community-corpus content.
 */

export interface FixtureEquipment {
  slug: string;
  label: string;
  aliases: string[];
  body: string;
}

export const BUNDLED_EQUIPMENT_FIXTURES: readonly FixtureEquipment[] = [
  {
    slug: 'dumbbell',
    label: 'Dumbbell',
    aliases: ['db', 'dumbbells'],
    body: 'A handheld free weight. Keep setup guidance, photos, links, and handling notes in the Markdown body.',
  },
  {
    slug: 'kettlebell',
    label: 'Kettlebell',
    aliases: ['kb'],
    body: 'A cast-iron ball with a handle, used for ballistics, swings, and carries.',
  },
];

/** The definition document the app stores as the equipment owner note. */
export function equipmentDocument(f: FixtureEquipment): string {
  return [
    '---',
    'type: equipment',
    `id: equipment-bundled-${f.slug}`,
    `slug: ${f.slug}`,
    `label: "${f.label}"`,
    'aliases:',
    ...f.aliases.map((a) => `  - ${a}`),
    '---',
    f.body,
    '',
  ].join('\n');
}

/** The document a clone-and-edit flow must commit: the custom slug/id/label
 *  identity with the authored body preserved. Committing the bundled
 *  identity under a custom owner would diverge source and projection. */
export function customEquipmentDocument(f: FixtureEquipment, customSlug: string, extraBody: string, customId?: string): string {
  return [
    '---',
    'type: equipment',
    `id: ${customId ?? `equipment-user-${customSlug}`}`,
    `slug: ${customSlug}`,
    `label: "${f.label} (Custom)"`,
    'aliases:',
    ...f.aliases.map((a) => `  - ${a}`),
    '---',
    f.body,
    '',
    extraBody,
    '',
  ].join('\n');
}

/** Related-definition fixture: an effort whose definition lists the equipment. */
const DUMBBELL_SNATCH_EFFORT = {
  id: 'effort-bundled-dumbbell-snatch',
  slug: 'dumbbell-snatch',
  label: 'Dumbbell Snatch',
  equipment: ['dumbbell'],
  body: 'A one-arm overhead pull with a dumbbell, hip-driven like a kettlebell snatch.',
};

/** Consumer note whose script uses the equipment — drives the "Used in" list. */
const USAGE_NOTE_ID = 'equipment-e2e-gym/dumbbell-day';
const USAGE_NOTE_TITLE = 'Dumbbell Day';
const USAGE_NOTE_CONTENT = [
  '# Dumbbell Day',
  '',
  '```time',
  '10 Dumbbell Snatch @15kg',
  '```',
  '',
].join('\n');

/** Seed one bundled equipment fixture set: registry rows, owner notes, a
 *  related effort, and a usage note with block_equipment link rows. Call
 *  after the app has booted once (schema exists), then reload to rehydrate
 *  the registries. */
export async function seedBundledEquipment(page: Page): Promise<void> {
  await waitForSeedReady(page);

  for (const f of BUNDLED_EQUIPMENT_FIXTURES) {
    const raw = equipmentDocument(f);
    // Registry projection row (`equipment` store, keyPath `slug`).
    await page.evaluate(
      async ({ dbName, row }) => {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open(dbName as string);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('equipment')) {
              db.close();
              reject(new Error('equipment store missing — boot the app once first'));
              return;
            }
            const tx = db.transaction(['equipment'], 'readwrite');
            tx.objectStore('equipment').put(row);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
          };
          req.onerror = () => reject(req.error);
        });
      },
      {
        dbName: WOD_DB,
        row: {
          id: `equipment-bundled-${f.slug}`,
          slug: f.slug,
          label: f.label,
          aliases: f.aliases,
          registrySource: 'bundled',
          body: f.body,
          ownerNoteId: `equipment/${f.slug}`,
          sourceId: 'equipment',
          sourcePath: `markdown/equipment/${f.slug}.md`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    );

    // Owner note — the canonical Markdown source the detail page renders.
    await seedNote(page, `equipment/${f.slug}`, raw, {
      title: f.label,
      sourceId: 'equipment',
      sourcePath: `markdown/equipment/${f.slug}.md`,
    });
  }

  // Related effort: definition references the equipment (IEffort.equipment).
  await page.evaluate(
    async ({ dbName, row }) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName as string);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['efforts'], 'readwrite');
          tx.objectStore('efforts').put(row);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      });
    },
    {
      dbName: WOD_DB,
      row: {
        id: DUMBBELL_SNATCH_EFFORT.id,
        slug: DUMBBELL_SNATCH_EFFORT.slug,
        label: DUMBBELL_SNATCH_EFFORT.label,
        aliases: [],
        baseAttributes: { met: 10.5, discipline: 'strength', intensityTier: 'high' },
        equipment: DUMBBELL_SNATCH_EFFORT.equipment,
        registrySource: 'bundled',
        body: DUMBBELL_SNATCH_EFFORT.body,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
  );

  // Usage note (a real collection workout) + block_equipment link rows so the
  // detail page's "Used in" section resolves real titles and routes.
  await seedNote(page, USAGE_NOTE_ID, USAGE_NOTE_CONTENT, { title: USAGE_NOTE_TITLE });
  await page.evaluate(
    async ({ dbName, noteId, equipmentSlug }) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName as string);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('block_equipment')) {
            db.close();
            reject(new Error('block_equipment store missing — boot the app once first'));
            return;
          }
          const tx = db.transaction(['block_index', 'block_equipment'], 'readwrite');
          const indexReq = tx.objectStore('block_index').index('by-note').getAll(noteId as string);
          indexReq.onsuccess = () => {
            for (const row of indexReq.result as Array<{ blockId: string; noteTitle: string }>) {
              tx.objectStore('block_equipment').put({
                id: `${noteId}:${row.blockId}:equipment:${equipmentSlug}`,
                noteId,
                blockId: row.blockId,
                equipmentSlug,
                noteTitle: row.noteTitle,
                createdAt: Date.now(),
              });
            }
          };
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
          tx.onabort = () => { db.close(); reject(tx.error ?? new Error('usage link seeding aborted')); };
        };
        req.onerror = () => reject(req.error);
      });
    },
    { dbName: WOD_DB, noteId: USAGE_NOTE_ID, equipmentSlug: 'dumbbell' },
  );
}

export { USAGE_NOTE_ID, USAGE_NOTE_TITLE };
