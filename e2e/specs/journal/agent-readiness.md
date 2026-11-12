---
domain: journal
specFile: e2e/live-app/agent-readiness.e2e.ts
routes: /journal, /note/:noteId, /settings/system
personas: Browser AI Agent, Athlete
viewports: 1280x800, 375x812
priority: P0
---

# Browser Agent Readiness & WebMCP Journeys

### Scenario 1: Static discovery, hydration gates, embedded view state, and dynamic WebMCP lifecycle

Given a hydrated Playground workspace with core seed data:

1. Fetch `/llms.txt` and `/.well-known/agent-capabilities.json` from the Playground origin and open `/journal`.
   - expect: `/llms.txt` returns HTTP 200 containing WebMCP and CLI guidance, and `/.well-known/agent-capabilities.json` lists 22 `domainTools` and 9 `uiTools`.
   - expect: `document.body.dataset.appHydrated` is `"true"`, `<main>` carries `data-agent-status="ready"` and `aria-busy="false"`, and `<script id="agent-view-state">` parses as valid JSON reflecting `/journal`.
2. Inspect `navigator.modelContext` on `/journal`, invoke `wod_note_upsert` to author a workout `Note`, and navigate to `/note/<noteId>` via `ui_navigate`.
   - expect: On `/journal`, `ui_set_stream_query` is registered while `ui_editor_draft` and `ui_clock_control` are unmounted.
   - expect: After `ui_navigate` to `/note/<noteId>`, `ui_editor_draft` and `ui_start_live_workout` dynamically register on `navigator.modelContext`.
3. Invoke `ui_start_live_workout` to launch the live workout clock, then invoke `ui_clock_control` (`status` and `dismiss`).
   - expect: While the live timer is active, `ui_clock_control` dynamically registers on `navigator.modelContext` and returns a live `ClockSnapshot`.

### Scenario 2: Tier 2 human-in-the-loop confirmation modal blocks destructive WebMCP deletion until approved

Given an authored workout `Note` in IndexedDB:

1. Invoke `wod_note_delete` via `navigator.modelContext` without an explicit `confirmId` and click Deny in the confirmation modal.
   - expect: `data-testid="agent-confirm-dialog"` appears displaying the target `Note` ID, and clicking Deny rejects the tool call while preserving the `Note`.
2. Invoke `wod_note_delete` again and click Approve Action in `data-testid="agent-confirm-dialog"`, then verify mobile (`375x812`) layout readiness on `/journal?layout=rows`.
   - expect: Approving the modal resolves `wod_note_delete` with `deleted: true` and removes the `Note` from storage.
   - expect: At `375x812`, `/journal?layout=rows` preserves the `rows` layout parameter without horizontal overflow and exposes clean landmark accessibility.
