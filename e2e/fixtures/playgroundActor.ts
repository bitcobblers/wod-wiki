import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';
import {
  buildDomainWorld,
  resetTestingVocabulary,
  type DomainWorld,
  type DomainWorldInput,
  type TestPropertyNoteInput,
} from '../../packages/core/src/testing';
import type { PublicationVisibility } from '../../packages/core/src';
import type { IEffort } from '../../packages/lang/src';
import { DB_VERSION } from '@bitcobblers/wod-wiki-storage';
import { compileSeedRow, seedNoteIdSync } from '../../packages/tools/src/seedbuild/compiler';
import { TEST_IDS } from '../contracts/TestIdContract';
import {
  WOD_DB,
  deleteNoteByRouteId,
  getNoteContentByRouteId,
  seedCompletedSessions,
  seedJournalNote,
  seedNote,
} from '../helpers/wodwikiDb';
import { gotoFeedSurface, syncFeed, waitForFeedReady } from '../helpers/feedReadiness';
import { seedBundledEquipment } from '../helpers/seedEquipment';
import { seedBundledEfforts } from '../helpers/seedEfforts';
import { JournalEntryPage } from '../pages/JournalEntryPage';
import { EquipmentPage } from '../pages/EquipmentPage';
import { EffortsPage } from '../pages/EffortsPage';
import { WallClockPage } from '../pages/WallClockPage';
import { currentDocument, replaceDocument } from '../utils/noteEditor';
import { installFastClock } from '../utils/fastClock';

export interface SeedWorldResult {
  world: DomainWorld;
  noteId: string;
  noteIds: string[];
  sessionIds: string[];
}

export interface PeerFeedSpec {
  name?: string;
  notebookSlug: string;
  notebookLabel?: string;
  notes: Array<{
    slug: string;
    title: string;
    markdown: string;
    dateIso?: string;
  }>;
}

export interface ExportedFeedZipSummary {
  noteIds: string[];
  sessionIds: string[];
  files: string[];
}

export interface PlaygroundTestActor {
  readonly page: Page;
  goto(path: string): Promise<void>;
  assertCleanConsole(): void;

  readonly seed: {
    world(input: DomainWorldInput): Promise<SeedWorldResult>;
    journalNote(date: string, markdown: string, opts?: { title?: string }): Promise<void>;
    note(noteId: string, markdown: string, opts?: { type?: string; title?: string; journalDate?: string; sourceId?: string; sourcePath?: string }): Promise<void>;
    notebook(slug: string, opts?: { title?: string; description?: string; icon?: string; isPublic?: boolean }): Promise<string>;
    propertyOverride(input: TestPropertyNoteInput): Promise<void>;
    completedSessions(noteId: string, sessions: Array<{ id: string; createdAt: number; duration: number }>): Promise<void>;
    bundledEquipment(): Promise<void>;
    bundledEfforts(): Promise<void>;
    mockPeerFeed(baseUrl: string, spec: PeerFeedSpec): Promise<{ manifestUrl: string; noteIds: string[] }>;
  };

  readonly journal: {
    openStream(query?: string): Promise<void>;
    openDate(date: string): Promise<JournalEntryPage>;
    clearDate(date: string): Promise<void>;
    expectNotePersisted(routeId: string, expectedSubstring: string): Promise<void>;
  };

  readonly notebooks: {
    openLibrary(query?: string): Promise<void>;
    openNotebook(slug: string, target?: string): Promise<void>;
    create(name: string, description?: string): Promise<void>;
    rename(slug: string, newName: string): Promise<void>;
    delete(slug: string): Promise<void>;
    promoteNote(notebookIds: readonly string[]): Promise<void>;
    setNotebookPublic(slugOrId: string, isPublic: boolean): Promise<void>;
  };

  readonly properties: {
    openEffort(slug?: string): Promise<EffortsPage>;
    openEquipment(slug?: string): Promise<EquipmentPage>;
    openTags(category?: string, slug?: string): Promise<void>;
    saveScopedOverride(targetNotebookId: string): Promise<void>;
  };

  readonly editor: {
    openNote(noteId: string): Promise<void>;
    replaceDocument(markdown: string): Promise<void>;
    readDocument(): Promise<string>;
    typeLine(text: string): Promise<void>;
    readStoredContent(routeId: string): Promise<string | null>;
  };

  readonly runtime: {
    useFastClock(speedFactor?: number): Promise<void>;
    startWorkout(): Promise<void>;
    advance(steps?: number): Promise<void>;
    stopSession(): Promise<void>;
    wallClock(): WallClockPage;
  };

  readonly wql: {
    openExplorer(query?: string): Promise<void>;
    openDashboard(slug: string): Promise<void>;
    queryStream(route: string, wql: string): Promise<void>;
    fillStreamQueryBar(wql: string): Promise<void>;
    setStreamLayout(route: string, layout: 'cards' | 'feed' | 'rows' | 'agenda' | 'planner'): Promise<void>;
    expectStreamContains(text: string): Promise<void>;
    expectStreamExcludes(text: string): Promise<void>;
  };

  readonly feeds: {
    waitForReady(): Promise<void>;
    openFeeds(): Promise<void>;
    syncNow(feedId: string): Promise<void>;
    openPromotionPopover(): Promise<void>;
    closePromotionPopover(): Promise<void>;
    setSessionPublic(sessionId: string, isPublic: boolean): Promise<void>;
    expectPublicationVisibility(expected: PublicationVisibility): Promise<void>;
    exportPortable(format: 'feed-repo-zip'): Promise<ExportedFeedZipSummary>;
  };
}

async function ensureAppOriginReady(page: Page): Promise<void> {
  if (page.url() === 'about:blank' || !page.url().startsWith('http')) {
    await gotoFeedSurface(page, '/');
  } else {
    await waitForFeedReady(page);
  }
}

export const test = base.extend<{ app: PlaygroundTestActor }>({
  app: async ({ page }, use, testInfo) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const isColdBoot =
      testInfo.title.includes('@cold-boot') ||
      testInfo.titlePath.some((segment) => segment.includes('@cold-boot'));

    if (!isColdBoot) {
      await page.addInitScript(() => {
        window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
      });
    }

    const actor: PlaygroundTestActor = {
      page,

      async goto(path: string): Promise<void> {
        await gotoFeedSurface(page, path);
      },

      assertCleanConsole(): void {
        expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
        expect(consoleErrors, `Console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
      },

      seed: {
        async world(input: DomainWorldInput): Promise<SeedWorldResult> {
          await ensureAppOriginReady(page);
          resetTestingVocabulary();
          const world = buildDomainWorld(input);
          const explicitIds = new Set(world.notes.map((n) => n.id));
          const notebooksToWrite = world.notebooks.filter((nb) => !explicitIds.has(nb.id));
          const bundledEfforts = (input.propertyNotes ?? [])
            .filter((p) => p.kind === 'effort' && !p.asOverride && (!p.notebookId || p.notebookId === 'notebook/defaults'))
            .map((p) => ({
              id: p.id ?? `effort-${p.slug}`,
              slug: p.slug,
              label: p.label,
              aliases: p.aliases ?? [],
              baseAttributes: { met: 5.0, ...(p.baseAttributes ?? {}) } as IEffort['baseAttributes'],
              registrySource: 'bundled' as const,
              sourceId: 'core',
              ...(p.body ? { body: p.body } : {}),
            }));
          const bundledEquipment = (input.propertyNotes ?? [])
            .filter((p) => p.kind === 'equipment' && !p.asOverride && (!p.notebookId || p.notebookId === 'notebook/defaults'))
            .map((p) => ({
              id: p.id ?? `equipment-${p.slug}`,
              slug: p.slug,
              label: p.label,
              aliases: p.aliases ?? [],
              registrySource: 'bundled' as const,
              sourceId: 'core',
              ...(p.body ? { body: p.body } : {}),
            }));

          await page.evaluate(
            async ({ dbName, version, payload }) => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open(dbName);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
              });
              try {
                if (db.version !== version) {
                  throw new Error(`Expected IndexedDB v${version}, found v${db.version}`);
                }
                const storeNames = [
                  'notes',
                  'block_revisions',
                  'block_index',
                  'block_efforts',
                  'block_equipment',
                  'tags',
                  'note_tags',
                  'notebook_links',
                  'property_overrides',
                  'efforts',
                  'equipment',
                  'page',
                  'page_notes',
                  'sessions',
                  'events',
                ].filter((name) => db.objectStoreNames.contains(name));

                await new Promise<void>((resolve, reject) => {
                  const tx = db.transaction(storeNames, 'readwrite');
                  for (const nb of payload.notebooksToWrite) tx.objectStore('notes').put(nb);
                  for (const note of payload.world.notes) tx.objectStore('notes').put(note);
                  for (const rev of payload.world.revisions) tx.objectStore('block_revisions').put(rev);
                  for (const row of payload.world.blockIndex) tx.objectStore('block_index').put(row);
                  for (const row of payload.world.blockEfforts) tx.objectStore('block_efforts').put(row);
                  if (db.objectStoreNames.contains('block_equipment')) {
                    for (const row of payload.world.blockEquipment) tx.objectStore('block_equipment').put(row);
                  }
                  for (const tag of payload.world.tags) tx.objectStore('tags').put(tag);
                  for (const nt of payload.world.noteTags) tx.objectStore('note_tags').put(nt);
                  if (db.objectStoreNames.contains('notebook_links')) {
                    for (const link of payload.world.notebookLinks) tx.objectStore('notebook_links').put(link);
                  }
                  if (db.objectStoreNames.contains('property_overrides')) {
                    for (const ov of payload.world.propertyOverrides) tx.objectStore('property_overrides').put(ov);
                  }
                  for (const eff of payload.bundledEfforts) tx.objectStore('efforts').put(eff);
                  for (const eq of payload.bundledEquipment) tx.objectStore('equipment').put(eq);
                  for (const pg of payload.world.pages) tx.objectStore('page').put(pg);
                  for (const pn of payload.world.pageNotes) tx.objectStore('page_notes').put(pn);
                  for (const sess of payload.world.sessions) tx.objectStore('sessions').put(sess);
                  for (const ev of payload.world.events) tx.objectStore('events').put(ev);
                  tx.oncomplete = () => resolve();
                  tx.onerror = () => reject(tx.error);
                  tx.onabort = () => reject(tx.error);
                });
                const bc = new BroadcastChannel('wodwiki.seed');
                bc.postMessage({ type: 'seed-imported', sourceId: 'test-actor' });
                bc.close();
              } finally {
                db.close();
              }
            },
            {
              dbName: WOD_DB,
              version: DB_VERSION,
              payload: { world, notebooksToWrite, bundledEfforts, bundledEquipment },
            },
          );

          const noteIds = world.notes.map((n) => n.id);
          return {
            world,
            noteId: noteIds[0] ?? '',
            noteIds,
            sessionIds: world.sessions.map((s) => s.id),
          };
        },

        async journalNote(date: string, markdown: string, opts?: { title?: string }): Promise<void> {
          await ensureAppOriginReady(page);
          await seedJournalNote(page, date, markdown, opts);
        },

        async note(noteId: string, markdown: string, opts): Promise<void> {
          await ensureAppOriginReady(page);
          await seedNote(page, noteId, markdown, opts);
        },

        async notebook(slug: string, opts): Promise<string> {
          await ensureAppOriginReady(page);
          const cleanSlug = slug.replace(/^notebook\//, '');
          const notebookId = `notebook/${cleanSlug}`;
          const title = opts?.title ?? cleanSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          const desc = opts?.description ?? `${title} workouts`;
          const icon = opts?.icon ?? '🏋️';
          const isPublic = opts?.isPublic ?? false;

          await page.evaluate(
            async ({ dbName, notebookId: nbId, title: nbTitle, desc: nbDesc, icon: nbIcon, isPublic: pub }) => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open(dbName);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
              });
              try {
                await new Promise<void>((resolve, reject) => {
                  const tx = db.transaction(['notes'], 'readwrite');
                  tx.objectStore('notes').put({
                    id: nbId,
                    notebookId: nbId,
                    title: nbTitle,
                    rawContent: `---\ndescription: ${JSON.stringify(nbDesc)}\nicon: ${JSON.stringify(nbIcon)}\n---\n\n# ${nbTitle}\n`,
                    sourceRevision: 1,
                    blocks: {},
                    createdAt: Date.now(),
                    seedOrigin: 'user',
                    public: pub,
                  });
                  tx.oncomplete = () => resolve();
                  tx.onerror = () => reject(tx.error);
                });
              } finally {
                db.close();
              }
            },
            { dbName: WOD_DB, notebookId, title, desc, icon, isPublic },
          );
          return notebookId;
        },

        async propertyOverride(input: TestPropertyNoteInput): Promise<void> {
          await actor.seed.world({ propertyNotes: [{ ...input, asOverride: true }] });
        },

        async completedSessions(noteId: string, sessions): Promise<void> {
          await ensureAppOriginReady(page);
          await seedCompletedSessions(page, noteId, sessions);
        },

        async bundledEquipment(): Promise<void> {
          await ensureAppOriginReady(page);
          await seedBundledEquipment(page);
        },

        async bundledEfforts(): Promise<void> {
          await ensureAppOriginReady(page);
          await seedBundledEfforts(page);
        },

        async mockPeerFeed(baseUrl: string, spec: PeerFeedSpec) {
          const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
          const rows = [];
          const recordMap = new Map<string, string>();
          const indexRecords = [];
          const noteIds: string[] = [];

          for (const item of spec.notes) {
            const relPath = `markdown/notebooks/${spec.notebookSlug}/${item.slug}.md`;
            const createdAt = Date.parse(item.dateIso ?? '2026-11-01T12:00:00Z');
            const row = compileSeedRow(relPath, item.markdown, {
              noteTitle: item.title,
              routeId: `${spec.notebookSlug}/${item.slug}`,
              sourceId: `notebook:${spec.notebookSlug}/${item.slug}`,
              createdAt,
            });
            const uuid = seedNoteIdSync(relPath);
            row.uuid = uuid;
            row.commit = 'abc1234';
            row.version = 1;
            rows.push(row);
            noteIds.push(uuid);

            const recordJson = JSON.stringify(row, null, 2);
            const recordSha = createHash('sha256').update(recordJson).digest('hex');
            const recordRelPath = relPath.replace(/\.md$/, '.json');
            recordMap.set(recordRelPath, recordJson);
            indexRecords.push({
              uuid,
              path: relPath,
              recordPath: recordRelPath,
              commit: 'abc1234',
              version: 1,
              sha256: recordSha,
              title: item.title,
              date: createdAt,
            });
          }

          const chunkJson = JSON.stringify(rows);
          const chunkSha = createHash('sha256').update(chunkJson).digest('hex');
          const chunkId = `notebook.${spec.notebookSlug}`;
          const chunkPath = `chunks/${chunkId}.${chunkSha.slice(0, 8)}.json`;
          const indexPath = `indexes/notebooks/${chunkId}.json`;
          const summary = {
            notebookId: chunkId,
            label: spec.notebookLabel ?? spec.notebookSlug,
            category: spec.notebookSlug,
            indexPath,
            version: 1,
            commit: 'abc1234',
            builtAt: '2026-11-10T00:00:00.000Z',
            sha256: chunkSha,
            bytes: Buffer.byteLength(chunkJson),
            count: rows.length,
          };
          const notebookIndexJson = JSON.stringify({ ...summary, records: indexRecords });
          const manifestJson = JSON.stringify({
            name: spec.name ?? `Peer ${spec.notebookSlug} Feed`,
            description: `Peer feed for ${spec.notebookSlug}`,
            schema: 9,
            version: 1,
            builtAt: '2026-11-10T00:00:00.000Z',
            chunks: [{ id: chunkId, path: chunkPath, sha256: chunkSha, bytes: Buffer.byteLength(chunkJson), count: rows.length }],
            notebooks: [summary],
          });

          await page.context().route(`${normalizedBase}**`, async (route) => {
            const url = route.request().url();
            const rel = url.slice(normalizedBase.length).split('?')[0] ?? '';
            if (rel === 'manifest.json') {
              await route.fulfill({ status: 200, contentType: 'application/json', body: manifestJson });
              return;
            }
            if (rel === indexPath) {
              await route.fulfill({ status: 200, contentType: 'application/json', body: notebookIndexJson });
              return;
            }
            if (rel === chunkPath) {
              await route.fulfill({ status: 200, contentType: 'application/json', body: chunkJson });
              return;
            }
            const rec = recordMap.get(rel);
            if (rec) {
              await route.fulfill({ status: 200, contentType: 'application/json', body: rec });
              return;
            }
            await route.fulfill({ status: 404, body: 'Not found' });
          });

          return { manifestUrl: `${normalizedBase}manifest.json`, noteIds };
        },
      },

      journal: {
        async openStream(query?: string): Promise<void> {
          const url = query ? `/journal?q=${encodeURIComponent(query)}` : '/journal';
          await gotoFeedSurface(page, url);
        },

        async openDate(date: string): Promise<JournalEntryPage> {
          const jp = new JournalEntryPage(page);
          await jp.goto(date);
          return jp;
        },

        async clearDate(date: string): Promise<void> {
          await ensureAppOriginReady(page);
          await deleteNoteByRouteId(page, `journal/${date}`);
        },

        async expectNotePersisted(routeId: string, expectedSubstring: string): Promise<void> {
          const jp = new JournalEntryPage(page);
          await jp.awaitNotePersisted(routeId, expectedSubstring);
        },
      },

      notebooks: {
        async openLibrary(query?: string): Promise<void> {
          const url = query ? `/notebooks?q=${encodeURIComponent(query)}` : '/notebooks';
          await gotoFeedSurface(page, url);
        },

        async openNotebook(slug: string, target?: string): Promise<void> {
          const clean = slug.replace(/^notebook\//, '');
          const path = target ? `/notebook/${clean}/${target}` : `/notebook/${clean}`;
          await gotoFeedSurface(page, path);
        },

        async create(name: string, description?: string): Promise<void> {
          await page.getByTestId(TEST_IDS.NOTEBOOKS_CREATE_BUTTON).click();
          const dialog = page.locator('[role="dialog"]');
          await dialog.getByPlaceholder('e.g., Morning Routines').fill(name);
          if (description) {
            const descInput = dialog.locator('textarea, input[name="description"]').first();
            if ((await descInput.count()) > 0) await descInput.fill(description);
          }
          await dialog.getByRole('button', { name: 'Create' }).click();
          await expect(page).toHaveURL(/\/notebook\//);
        },

        async rename(slug: string, newName: string): Promise<void> {
          const clean = slug.replace(/^notebook\//, '');
          await page.getByTestId(`notebook-edit-${clean}`).click();
          const dialog = page.locator('[role="dialog"]');
          await dialog.getByPlaceholder('e.g., Morning Routines').fill(newName);
          await dialog.getByRole('button', { name: 'Save' }).click();
          await expect(page.getByTestId(TEST_IDS.STREAM_VIEW)).toContainText(newName);
        },

        async delete(slug: string): Promise<void> {
          const clean = slug.replace(/^notebook\//, '');
          await page.getByTestId(`notebook-delete-${clean}`).click();
          await page.getByTestId(`notebook-delete-confirm-${clean}`).click();
        },

        async promoteNote(notebookIds: readonly string[]): Promise<void> {
          await actor.feeds.openPromotionPopover();
          const popover = page.getByTestId(TEST_IDS.PUBLICATION_PILL_POPOVER);
          for (const rawId of notebookIds) {
            const nbId = rawId.startsWith('notebook/') ? rawId : `notebook/${rawId}`;
            const chip = popover.getByTestId(`promotion-notebook-chip-${nbId}`);
            await chip.locator('button').first().click();
          }
        },

        async setNotebookPublic(slugOrId: string, isPublic: boolean): Promise<void> {
          await actor.feeds.openPromotionPopover();
          const popover = page.getByTestId(TEST_IDS.PUBLICATION_PILL_POPOVER);
          const slug = slugOrId.replace(/^notebook\//, '');
          const specific = popover.getByTestId(`publication-notebook-public-toggle-${slug}`);
          const toggle =
            (await specific.count()) > 0
              ? specific
              : popover.getByTestId(TEST_IDS.PUBLICATION_NOTEBOOK_PUBLIC_TOGGLE);
          if ((await toggle.isChecked()) !== isPublic) {
            await toggle.click();
          }
        },
      },

      properties: {
        async openEffort(slug?: string): Promise<EffortsPage> {
          const path = slug ? `/effort/${slug}` : '/efforts';
          await gotoFeedSurface(page, path);
          return new EffortsPage(page);
        },

        async openEquipment(slug?: string): Promise<EquipmentPage> {
          const path = slug ? `/equipment/${slug}` : '/equipment';
          await gotoFeedSurface(page, path);
          return new EquipmentPage(page);
        },

        async openTags(category?: string, slug?: string): Promise<void> {
          const path = category && slug ? `/t/${category}/${slug}` : category ? `/t/${category}` : '/tags';
          await gotoFeedSurface(page, path);
        },

        async saveScopedOverride(targetNotebookId: string): Promise<void> {
          const sheet = page.getByTestId(TEST_IDS.PROPERTY_OVERRIDE_SHEET);
          await expect(sheet).toBeVisible();
          await sheet.getByTestId(`override-target-${targetNotebookId}`).click();
        },
      },

      editor: {
        async openNote(noteId: string): Promise<void> {
          await gotoFeedSurface(page, `/note/${noteId}`);
        },

        async replaceDocument(markdown: string): Promise<void> {
          await replaceDocument(page, markdown);
        },

        async readDocument(): Promise<string> {
          return currentDocument(page);
        },

        async typeLine(text: string): Promise<void> {
          const cm = page.locator('.cm-content[contenteditable="true"]').first();
          await cm.click();
          await page.keyboard.type(text);
          await page.keyboard.press('Enter');
        },

        async readStoredContent(routeId: string): Promise<string | null> {
          return getNoteContentByRouteId(page, routeId);
        },
      },

      runtime: {
        async useFastClock(speedFactor = 20): Promise<void> {
          await installFastClock(page, speedFactor);
        },

        async startWorkout(): Promise<void> {
          const startBtn = page
            .locator(`[data-testid="${TEST_IDS.EDITOR_START_WORKOUT}"], button[aria-label*="Run" i], button:has-text("Run")`)
            .first();
          await startBtn.click();
        },

        async advance(steps = 1): Promise<void> {
          for (let i = 0; i < steps; i++) {
            const nextBtn = page
              .locator(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"], [data-testid="${TEST_IDS.TRACKER_NEXT_BUTTON}"]`)
              .first();
            await nextBtn.click();
          }
        },

        async stopSession(): Promise<void> {
          await page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first().click();
          const confirm = page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT);
          if ((await confirm.count()) > 0 && (await confirm.isVisible())) {
            await confirm.click();
          }
        },

        wallClock(): WallClockPage {
          return new WallClockPage(page);
        },
      },

      wql: {
        async openExplorer(query?: string): Promise<void> {
          const path = query ? `/dashboards?q=${encodeURIComponent(query)}` : '/dashboards';
          await gotoFeedSurface(page, path);
        },

        async openDashboard(slug: string): Promise<void> {
          await gotoFeedSurface(page, `/dashboard/${slug}`);
        },

        async queryStream(route: string, wql: string): Promise<void> {
          await gotoFeedSurface(page, `${route}?q=${encodeURIComponent(wql)}`);
        },

        async fillStreamQueryBar(wql: string): Promise<void> {
          const editor = page.getByTestId(TEST_IDS.STREAM_QUERY_BAR).getByLabel('WQL', { exact: true });
          await editor.fill(wql);
          await editor.press('Enter');
        },

        async setStreamLayout(route: string, layout): Promise<void> {
          await page.addInitScript(
            ({ key, mode }) => {
              window.localStorage.setItem(
                key,
                JSON.stringify({ level: 'note', layout: mode, visibleFields: ['title', 'excerpt', 'date'] }),
              );
            },
            { key: `wodwiki.viewSettings.v1${route}`, mode: layout },
          );
        },

        async expectStreamContains(text: string): Promise<void> {
          await expect(page.getByTestId(TEST_IDS.STREAM_VIEW)).toContainText(text);
        },

        async expectStreamExcludes(text: string): Promise<void> {
          await expect(page.getByTestId(TEST_IDS.STREAM_VIEW)).not.toContainText(text);
        },
      },

      feeds: {
        async waitForReady(): Promise<void> {
          await waitForFeedReady(page);
        },

        async openFeeds(): Promise<void> {
          await gotoFeedSurface(page, '/feeds');
        },

        async syncNow(feedId: string): Promise<void> {
          await syncFeed(page, feedId);
        },

        async openPromotionPopover(): Promise<void> {
          const popover = page.getByTestId(TEST_IDS.PUBLICATION_PILL_POPOVER);
          if (!(await popover.isVisible())) {
            await page.getByTestId(TEST_IDS.PUBLICATION_PILL).first().click();
            await expect(popover).toBeVisible();
          }
        },

        async closePromotionPopover(): Promise<void> {
          const popover = page.getByTestId(TEST_IDS.PUBLICATION_PILL_POPOVER);
          if (await popover.isVisible()) {
            await page.keyboard.press('Escape');
          }
        },

        async setSessionPublic(sessionId: string, isPublic: boolean): Promise<void> {
          await actor.feeds.openPromotionPopover();
          const popover = page.getByTestId(TEST_IDS.PUBLICATION_PILL_POPOVER);
          const toggle = popover.getByTestId(`publication-session-toggle-${sessionId}`);
          if ((await toggle.isChecked()) !== isPublic) {
            await toggle.click();
          }
        },

        async expectPublicationVisibility(expected: PublicationVisibility): Promise<void> {
          const pill = page.getByTestId(TEST_IDS.PUBLICATION_PILL).first();
          await expect(pill).toHaveAttribute('data-visibility', expected);
        },

        async exportPortable(_format: 'feed-repo-zip'): Promise<ExportedFeedZipSummary> {
          await actor.feeds.openPromotionPopover();
          const popover = page.getByTestId(TEST_IDS.PUBLICATION_PILL_POPOVER);
          const downloadPromise = page.waitForEvent('download');
          await popover.getByTestId(TEST_IDS.PUBLICATION_EXPORT_REPO_ZIP_BTN).click();
          const download = await downloadPromise;
          const archivePath = await download.path();
          if (!archivePath) throw new Error('Playwright download path unavailable');
          const zipBytes = readFileSync(archivePath);
          const zip = await JSZip.loadAsync(zipBytes);
          const files = Object.keys(zip.files).filter((name) => !zip.files[name]!.dir);
          const noteIds: string[] = [];
          const sessionIds: string[] = [];

          for (const fileName of files) {
            if (fileName.startsWith('dist/chunks/notebook.') && fileName.endsWith('.json')) {
              const raw = await zip.file(fileName)!.async('string');
              const rows = JSON.parse(raw) as Array<{ uuid?: string; path?: string }>;
              for (const row of rows) {
                if (row.uuid) noteIds.push(row.uuid);
              }
            }
            if (fileName.endsWith('.jsonl')) {
              const raw = await zip.file(fileName)!.async('string');
              for (const line of raw.split(/\r?\n/)) {
                if (!line.trim()) continue;
                const parsed = JSON.parse(line) as { id?: string; kind?: string; record?: { id?: string }; session?: { id?: string } };
                const sid = parsed.session?.id ?? (parsed.kind === 'session' ? (parsed.id ?? parsed.record?.id) : undefined);
                if (sid && !sessionIds.includes(sid)) sessionIds.push(sid);
              }
            }
          }

          return { noteIds, sessionIds, files };
        },
      },
    };

    await use(actor);
  },
});

export { expect, TEST_IDS };
