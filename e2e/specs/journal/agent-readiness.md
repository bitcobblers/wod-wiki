---
domain: journal
specFile: e2e/live-app/agent-readiness.e2e.ts
routes: [/journal, /note/:noteId]
personas: [Browser AI Agent, Athlete]
viewports: [desktop, mobile-375]
priority: P0-gate
---

# JRN-06 — Browser Agent Readiness & WebMCP Journeys

The Playground exposes static discovery manifests (`/llms.txt` and `/.well-known/agent-capabilities.json`), DOM hydration and landmark readiness markers (`data-app-hydrated`, `data-agent-status`, `#agent-view-state`), mount-scoped WebMCP tools on `navigator.modelContext`, and Tier 2 human-in-the-loop confirmation modals (`AgentConfirmHost`).

### Scenario 1: Static discovery, hydration gates, embedded view state, and dynamic WebMCP lifecycle

Given a hydrated Playground workspace with core Seed data:

1. Browser AI Agent fetches `/llms.txt` and `/.well-known/agent-capabilities.json` from the Playground origin and opens `/journal`.
2. Browser AI Agent inspects `navigator.modelContext` on `/journal`, toggles dark theme via `ui_preferences`, invokes `wod_note_upsert` to author a workout `Note`, and navigates to `/note/:noteId` via `ui_navigate`.
3. Browser AI Agent invokes `ui_start_live_workout` to launch the live workout clock, then invokes `ui_clock_control` (`status`).
- expect: `/llms.txt` returns HTTP 200 advertising 22 portable domain tools + 9 live React UI/Clock tools, and `/.well-known/agent-capabilities.json` lists 22 `domainTools` and 9 `uiTools`.
- expect: `document.body.dataset.appHydrated` is `"true"`, `<main>` carries `data-agent-status="ready"` and `aria-busy="false"`, and `<script id="agent-view-state">` parses as valid JSON reflecting `/journal`.
- expect: On `/journal`, `ui_preferences` and `ui_set_stream_query` are registered while `ui_set_explorer_query`, `ui_editor_draft`, and `ui_clock_control` are unmounted; `ui_preferences` switches `<html>` to `dark`.
- expect: After `ui_navigate` to `/note/:noteId`, `ui_editor_draft` and `ui_start_live_workout` dynamically register on `navigator.modelContext`.
- expect: While the live timer is active, `ui_clock_control` dynamically registers on `navigator.modelContext` and returns a live `ClockSnapshot` with `runId`.
- expect: the browser console stays clean.

### Scenario 2: Tier 2 human-in-the-loop confirmation modal blocks destructive WebMCP deletion until approved

Given an authored workout `Note` in IndexedDB:

1. Browser AI Agent invokes `wod_note_delete` via `navigator.modelContext` without an explicit `confirmId`, and Athlete clicks Deny in the confirmation modal.
2. Browser AI Agent invokes `wod_note_delete` again, Athlete clicks Approve Action in `agent-confirm-dialog`, Browser AI Agent verifies mobile (`375x812`) layout readiness on `/journal?layout=rows`, and visits unknown route `/does-not-exist-qa`.
- expect: `agent-confirm-dialog` appears displaying the target `Note` ID, and clicking Deny rejects the tool call while preserving the `Note`.
- expect: Approving the modal resolves `wod_note_delete` with `deleted: true` and removes the `Note` from storage.
- expect: At `375x812`, `/journal?layout=rows` preserves the `rows` layout parameter without horizontal overflow, unknown route `/does-not-exist-qa` retains `<main data-agent-status="ready">` and `<nav>` landmarks, and the browser console stays clean.
