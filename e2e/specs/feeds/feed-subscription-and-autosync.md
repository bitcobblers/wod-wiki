---
domain: feeds
specFile: e2e/live-app/feed-subscription-and-autosync.e2e.ts
routes: [/subscribe, /feeds, /feed/:slug, /load, /load/journal, /notebooks, /settings/sync, /page/:slug]
personas: [Athlete]
viewports: [desktop, mobile-375]
priority: P0-gate
---

# FED-01 — Feed Subscription & Auto-Sync Lifecycle

External `Feed`s require explicit Athlete consent at `/subscribe?source=<url>` before registering in `localStorage` or importing `Seed` chunks. Subscribed Feeds import every published Notebook chunk, support automatic version-bump syncing vs. manual check-only updates on `/settings/sync` (reachable from `/notebooks` via L2 navigation on desktop and the mobile drawer), and purge unmodified Seed rows on `Unsubscribe` / `Delete` without harming user-authored `Note`s.

### Scenario 1: Subscription intake requires consent, reaches /settings/sync via L2 navigation, and remembers auto-sync across desktop and 375×812 mobile

Given an unregistered peer Feed ('Training catalog') served at `https://catalog.example.org/training/`:

1. Athlete opens '/subscribe?source=<url>' at both 1280×900 desktop and 375×812 mobile, checks 'Auto-sync updates', and clicks Subscribe (`feed-intake-subscribe`).
2. From `/notebooks`, Athlete opens '/settings/sync' via `notebooks-configure-sources` (directly in L2 on desktop, or inside the navigation drawer on 375×812 mobile) and inspects the registered Feed row.
- expect: Before clicking Subscribe, `wodwiki.seedSources` remains unset; after Subscribe, `/notebooks?q=:notebook{feed:training-catalog}` renders zero retired `/c/` or `/collections` links and zero horizontal overflow at 375×812.
- expect: Step 2 navigates cleanly to `/settings/sync` and lists `feed-source-training-catalog` with `feed-autosync-training-catalog` checked and a clean browser console.

### Scenario 2: Decline and Import Once honor non-subscribing consent choices

Given the same unregistered peer Feed at '/subscribe?source=<url>':

1. Athlete clicks Decline on the intake banner.
2. Athlete reopens '/subscribe?source=<url>', checks 'Auto-sync updates', and clicks Import Once (`feed-intake-once`), then inspects '/settings/sync' with 'Subscribed only' unchecked.
- expect: Step 1 navigates to `/notebooks` without registering any source in `wodwiki.seedSources`.
- expect: Step 2 imports the snapshot once while leaving `feed-subscribe-training-catalog` visible and `feed-autosync-training-catalog` unchecked.

### Scenario 3: Multi-Notebook import, overflow menu dismissal, auto-sync vs check-only updates, and Unsubscribe/Delete preserve user Notes

Given a multi-Notebook registered Feed ('Manage Library', v42, publishing two Notebook chunks) and a user-authored Note ('My own note') on `/settings/sync`:

1. Athlete inspects the unsubscribed row's origin URL, disabled Auto-sync toggle, and overflow menu links (`Published HTML` and `Git source directory`), dismissing the overflow menu with `Escape` and backdrop click.
2. Athlete subscribes to 'Manage Library' (v42), enables Auto-sync, reloads against published v43, then disables Auto-sync, reloads against v44, and clicks manual Sync.
3. Athlete opens the Feed overflow menu, clicks Unsubscribe, and then clicks Delete.
- expect: Step 1 dismisses `details[data-testid^="feed-more-"]` cleanly on both `Escape` and `feed-more-backdrop` click.
- expect: Step 2 imports every Notebook chunk the Feed publishes, auto-updates to `v43` when Auto-sync is on, and pauses at 'Update available' until manual Sync updates to `v44` when Auto-sync is off.
- expect: Step 3 Unsubscribe purges all imported Seed rows while keeping the source entry, Delete removes the source entry completely, and 'My own note' remains intact throughout with a clean browser console.

### Scenario 4: Bare /subscribe, /feed/:slug CTA, curated HYROX copy stability, /page/guide-start smoke, and /load import UI

Given an Athlete inspecting Feed catalog deep links, Guide routes, and portable bundle routes:

1. Athlete opens bare `/subscribe`, `/load`, `/load/journal`, and `/page/guide-start`.
2. Athlete opens `/feed/sport-hyrox`, subscribes to HYROX, navigates across `/feeds` and `/journal`, and inspects the HYROX card heading, description, and `wodwiki.seedSubscriptions`.
- expect: Step 1 keeps `/subscribe`, `/load`, and `/load/journal` mounted with intake/portable-import UIs and resolves `/page/guide-start` with title `'Wod.Wiki - Pages'`.
- expect: Step 2 keeps curated title `'HYROX'` and curated description `'HYROX race preparation and simulation workouts.'` on `/feeds` and retains `sport-hyrox: true` in `wodwiki.seedSubscriptions` across SPA navigation with a clean browser console.
