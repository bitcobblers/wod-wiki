---
domain: feeds
specFile: e2e/live-app/feed-subscription-and-autosync.e2e.ts
routes: [/subscribe, /feeds, /feed/:slug, /load, /load/journal, /notebooks, /settings/sync, /page/:slug]
personas: [Athlete]
viewports: [desktop, mobile-375]
priority: P0-gate
---

# FED-01 — Feed Subscription & Auto-Sync Lifecycle

External `Feed`s require explicit Athlete consent at `/subscribe?source=<url>` before registering in authoritative `IStorage` (`feed:registry` / `feed:subscriptions`) or importing `Seed` chunks. Subscribed Feeds default to `index-only` (zero eager chunk download, with opt-in `Download for offline`), support automatic version-bump syncing vs. manual check-only updates on `/settings/sync` (reachable from `/notebooks` via L2 navigation on desktop and the mobile drawer), and purge unmodified Seed rows via accessible `EditorDialog` `Unsubscribe` / `Delete` confirmations without harming user-authored or session-pinned `Note`s.

### Scenario 1: Subscription intake requires consent, reaches /settings/sync via L2 navigation, and remembers auto-sync across desktop and 375×812 mobile

Given an unregistered peer Feed ('Training catalog') served at `https://catalog.example.org/training/`:

1. Athlete opens '/subscribe?source=<url>' at both 1280×900 desktop and 375×812 mobile, checks 'Auto-sync updates', and clicks Subscribe (`feed-intake-subscribe`).
2. From `/notebooks`, Athlete opens '/settings/sync' via `notebooks-configure-sources` (directly in L2 on desktop, or inside the navigation drawer on 375×812 mobile) and inspects the registered Feed row.
- expect: Before clicking Subscribe, `feed:registry` has no `training-catalog` entry; after Subscribe, `/notebooks?q=:notebook{feed:training-catalog}` renders zero retired `/c/` or `/collections` links, `feed:subscriptions` stores `offlinePolicy: 'index-only'`, `/settings/sync` shows `Index active`, and zero horizontal overflow occurs at 375×812.
- expect: Step 2 navigates cleanly to `/settings/sync` and lists `feed-source-training-catalog` with `feed-autosync-training-catalog` checked and a clean browser console.

### Scenario 2: Decline leaves source unregistered while default Subscribe is index-only and Download for offline imports chunks

Given the same unregistered peer Feed at '/subscribe?source=<url>':

1. Athlete clicks Decline on the intake banner.
2. Athlete reopens '/subscribe?source=<url>', checks 'Auto-sync updates', leaves 'Download for offline' unchecked, and clicks 'Subscribe' (`feed-intake-subscribe`).
3. Athlete opens '/settings/sync', verifies `Index active` and `Auto-sync` checked on `feed-source-training-catalog`, and clicks `Download offline` (`feed-download-offline-training-catalog`).
- expect: Step 1 navigates to `/notebooks` without registering any source in `feed:registry` or `localStorage`.
- expect: Step 2 subscribes index-only without eagerly downloading chunks (`chunkFetches` empty; note remains absent from `notes` store).
- expect: Step 3 downloads chunks offline, transitions `feed-sync-status` to `Up to date`, and persists the note locally.

### Scenario 3: Multi-Notebook index-first subscribe, Download offline, overflow menu dismissal, auto-sync vs manual updates, and Unsubscribe/Delete EditorDialog preserve user Notes

Given a multi-Notebook registered Feed ('Manage Library', v42, publishing two Notebook chunks) in `feed:registry` and a user-authored Note ('My own note') on `/settings/sync`:

1. Athlete inspects the unsubscribed row's origin URL, disabled Auto-sync toggle, and overflow menu links (`Published HTML` and `Git source directory`), dismissing the overflow menu with `Escape` and backdrop click.
2. Athlete clicks `Subscribe` on 'Manage Library' (index-only, zero eager chunk fetches), then clicks `Download offline` (`feed-download-offline-manage-library`), enables Auto-sync and reloads against published v43, then disables Auto-sync, reloads against v44, and clicks manual Sync.
3. Athlete opens the Feed overflow menu, clicks Unsubscribe and confirms in the `EditorDialog`, then clicks Delete and confirms in the `EditorDialog`.
- expect: Step 1 dismisses `details[data-testid^="feed-more-"]` cleanly on both `Escape` and `feed-more-backdrop` click.
- expect: Step 2 keeps initial Subscribe index-only (`Index active`, zero chunk downloads), imports every Notebook chunk on `Download offline` (`Up to date`, `v42`), auto-updates to `v43` when Auto-sync is on, and pauses at 'Update available' until manual Sync updates to `v44` when Auto-sync is off.
- expect: Step 3 Unsubscribe `EditorDialog` ('Unsubscribe', mentioning pinned notes) purges unmodified Seed rows while keeping the source entry, Delete `EditorDialog` ('Delete source') removes the source entry completely, and 'My own note' remains intact throughout with a clean browser console.

### Scenario 4: Bare /subscribe, /feed/:slug CTA, curated HYROX copy stability, /page/guide-start smoke, and /load import UI

Given an Athlete inspecting Feed catalog deep links, Guide routes, and portable bundle routes:

1. Athlete opens bare `/subscribe`, `/load`, `/load/journal`, and `/page/guide-start`.
2. Athlete opens `/feed/sport-hyrox`, subscribes to HYROX, navigates across `/feeds` and `/journal` to inspect curated copy and authoritative `feed:subscriptions` in `IStorage`, and unsubscribes via `EditorDialog` on `/settings/sync`.
- expect: Step 1 keeps `/subscribe`, `/load`, and `/load/journal` mounted with intake/portable-import UIs and resolves `/page/guide-start` with title `'Wod.Wiki - Pages'`.
- expect: Step 2 keeps curated title `'HYROX'` and curated description `'HYROX race preparation and simulation workouts.'` on `/feeds`, persists `sport-hyrox` `subscribed: true` in IDB `feed:subscriptions` across navigation, and cleans up via `EditorDialog` Unsubscribe with a clean browser console.
