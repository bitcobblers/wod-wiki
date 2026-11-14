---
domain: feeds
specFile: e2e/live-app/portable-codecs-and-backup-restore.e2e.ts
routes: [/load, /settings/storage, /note/:noteId, /results/:sessionId]
personas: [Athlete]
viewports: [desktop, mobile-375]
priority: P1
---

# FED-04 — Portable Codecs & Backup Restore

The `/load` Portable Bundle Import surface restores canonical `.zip` archives (paired `.md` Notes + `.jsonl` Session and EventRecord telemetry) and standalone `.jsonl` bundles into IndexedDB without auto-executing workouts, while rejecting malformed or corrupt `.zip` uploads with an inline alert and zero uncaught page errors.

### Scenario 1: Valid `.zip` round-trip export/upload and standalone `.jsonl` upload on `/load` restore Notes and Sessions into IndexedDB and UI

Given a seeded Note 'FED04 Vault Kettlebell Benchmark' with completed Session `sess-fed04-vault-1` (`kettlebell-swing` EventRecord) and a standalone `.jsonl` telemetry bundle for Note 'FED04 Standalone Jsonl Relay' with Session `sess-fed04-jsonl-2` (`burpee` EventRecord):

1. Athlete exports Notes (`.md` + `.jsonl` `.zip`) from `/settings/storage`, deletes the local Note and its Session history from IndexedDB, opens `/load`, and uploads the portable `.zip` archive via `bundle-file-input`.
2. Athlete opens `/note/:noteId` and `/results/sess-fed04-vault-1`, reloads the browser, then returns to `/load` to upload the standalone `.jsonl` bundle and inspects `/note/:noteId` and `/results/sess-fed04-jsonl-2`.
- expect: Step 1 imports the `.zip` archive on `/load`, redirects to `/`, and restores both 'FED04 Vault Kettlebell Benchmark' and `sess-fed04-vault-1` in IndexedDB.
- expect: Step 2 renders the restored Note editor and `kettlebell-swing` EventRecord table on `/results/sess-fed04-vault-1` across reload, restores 'FED04 Standalone Jsonl Relay' and `sess-fed04-jsonl-2` (`burpee`) from the `.jsonl` upload, and keeps the browser console clean.

### Scenario 2: Corrupt `.zip` upload on `/load` surfaces a descriptive inline error alert with zero uncaught page errors across desktop and mobile 375×812

Given an Athlete on `/load` with a malformed non-zip payload `corrupt-archive.zip`:

1. Athlete opens `/load` at 1280×900, uploads `corrupt-archive.zip` via `bundle-file-input`, and inspects the intake surface.
2. Athlete resizes `/load` to 375×812 mobile, uploads `corrupt-archive.zip` again, and checks layout bounds and browser console health.
- expect: Step 1 keeps `load-zip-intake` mounted on `/load` without redirecting and displays a descriptive alert inside `bundle-import-error`.
- expect: Step 2 displays `bundle-import-error` cleanly at 375×812 with zero horizontal overflow and zero uncaught page or console errors.
