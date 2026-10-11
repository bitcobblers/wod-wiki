import type { Page } from '@playwright/test';

/**
 * Self-seeded bundled-effort fixtures for e2e tests.
 *
 * The effort corpus (burpee, rowing, kettlebell-*, …) lives in the
 * wod-wiki-community content repo and is NOT bundled with the app — the
 * `efforts` object store is empty on a fresh boot (only the lang package's
 * five compiled-in defaults exist). Tests that exercise the bundled catalog /
 * detail surface seed this fixture set into IndexedDB themselves, so no e2e
 * test depends on community-repo content. Rows carry `registrySource:
 * 'bundled'` so the app renders them exactly like seed-imported rows.
 */

const WOD_DB = 'wodwiki-db';

interface FixtureEffort {
  slug: string;
  label: string;
  met: number;
  discipline: string;
  intensityTier: string;
  aliases: string[];
  body?: string;
}

const BURPEE_BODY = [
  'Burpees are a full-body conditioning effort that combine a squat, plank, and jump.',
  '',
  'Use this bundled note to seed markdown-backed effort detail content in the UI.',
].join('\n');

const KETTLEBELL_SWING_BODY = [
  'Kettlebell swings train hip extension and cyclical power production.',
  '',
  'The movement can be scaled as Russian or American swings depending on range of motion.',
].join('\n');

/** Pinned efforts the assertions reference by slug, plus padding so the
 *  catalog crosses the >10 / >20 row thresholds some tests wait on. */
export const BUNDLED_EFFORT_FIXTURES: readonly FixtureEffort[] = [
  { slug: 'burpee', label: 'Burpee', met: 10.0, discipline: 'bodyweight', intensityTier: 'high', aliases: ['burpees'], body: BURPEE_BODY },
  { slug: 'burpee-pull-up', label: 'Burpee Pull Up', met: 9.0, discipline: 'bodyweight', intensityTier: 'high', aliases: ['burpee pullups'] },
  { slug: 'burpee-box-jump-over', label: 'Burpee Box Jump Over', met: 9.4, discipline: 'bodyweight', intensityTier: 'high', aliases: [] },
  { slug: 'rowing', label: 'Rowing', met: 7.0, discipline: 'rowing', intensityTier: 'high', aliases: ['row', 'rower', 'rowing machine', 'erg', 'ergometer', 'concept2 row'] },
  { slug: 'kettlebell-snatch', label: 'Kettlebell Snatch', met: 12.0, discipline: 'kettlebell', intensityTier: 'high', aliases: ['kb snatch'], body: 'The kettlebell-snatch is a ballistic lift taking the bell from the ground to overhead in one motion.' },
  { slug: 'kettlebell-swing', label: 'Kettlebell Swing', met: 9.5, discipline: 'kettlebell', intensityTier: 'high', aliases: ['kb swing', 'russian swing'], body: KETTLEBELL_SWING_BODY },
  // ── Padding: keep the catalog above the row-count thresholds ──────────────
  { slug: 'running-6-mph', label: 'Running (6 mph)', met: 9.8, discipline: 'running', intensityTier: 'moderate', aliases: ['run', 'jogging', 'treadmill'] },
  { slug: 'back-squat', label: 'Back Squat', met: 6.0, discipline: 'strength', intensityTier: 'moderate', aliases: ['squat'] },
  { slug: 'plank', label: 'Plank', met: 3.5, discipline: 'bodyweight', intensityTier: 'low', aliases: [] },
  { slug: 'deadlift', label: 'Deadlift', met: 6.0, discipline: 'strength', intensityTier: 'moderate', aliases: [] },
  { slug: 'clean-and-jerk', label: 'Clean and Jerk', met: 8.0, discipline: 'strength', intensityTier: 'high', aliases: ['c&j'] },
  { slug: 'pull-up', label: 'Pull Up', met: 8.0, discipline: 'bodyweight', intensityTier: 'moderate', aliases: ['pullup'] },
  { slug: 'push-up', label: 'Push Up', met: 7.0, discipline: 'bodyweight', intensityTier: 'moderate', aliases: ['pushup'] },
  { slug: 'air-squat', label: 'Air Squat', met: 5.0, discipline: 'bodyweight', intensityTier: 'moderate', aliases: [] },
  { slug: 'box-jump', label: 'Box Jump', met: 7.7, discipline: 'plyometric', intensityTier: 'moderate', aliases: [] },
  { slug: 'double-under', label: 'Double Under', met: 9.0, discipline: 'jump-rope', intensityTier: 'moderate', aliases: [] },
  { slug: 'wall-ball', label: 'Wall Ball', met: 9.0, discipline: 'strength', intensityTier: 'high', aliases: [] },
  { slug: 'power-clean', label: 'Power Clean', met: 7.0, discipline: 'strength', intensityTier: 'high', aliases: [] },
  { slug: 'thruster', label: 'Thruster', met: 8.0, discipline: 'strength', intensityTier: 'high', aliases: [] },
  { slug: 'muscle-up', label: 'Muscle Up', met: 10.0, discipline: 'gymnastics', intensityTier: 'high', aliases: [] },
  { slug: 'handstand-push-up', label: 'Handstand Push Up', met: 9.1, discipline: 'gymnastics', intensityTier: 'high', aliases: ['hspu'] },
  { slug: 'toes-to-bar', label: 'Toes to Bar', met: 8.0, discipline: 'gymnastics', intensityTier: 'moderate', aliases: ['ttb'] },
];

/** Write the bundled-effort fixture set into the `efforts` store. Call after
 *  the app has booted once (so the wodwiki-db schema exists), then reload to
 *  re-hydrate the registry from these rows. */
export async function seedBundledEfforts(page: Page): Promise<void> {
  const rows = BUNDLED_EFFORT_FIXTURES.map((f) => ({
    id: `effort-${f.slug}`,
    slug: f.slug,
    label: f.label,
    aliases: f.aliases,
    baseAttributes: { met: f.met, discipline: f.discipline, intensityTier: f.intensityTier },
    registrySource: 'bundled',
    body: f.body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  await page.evaluate(
    async ({ dbName, rows }) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName as string);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['efforts'], 'readwrite');
          const store = tx.objectStore('efforts');
          for (const row of rows as Array<Record<string, unknown>>) {
            store.put(row);
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        req.onerror = () => reject(req.error);
      });
    },
    { dbName: WOD_DB, rows },
  );
}
