# Level-1 Journey Specifications (`e2e/specs/`)

This directory holds the canonical **Level-1 Markdown journey specifications** for the Playground live-app e2e suite. Every spec pairs 1:1 with a **Level-2 Playwright script** in `e2e/live-app/` that composes the shared [PlaygroundTestActor](../fixtures/playgroundActor.ts) fixture.

## Two-level contract

1. **Level 1 — `e2e/specs/<domain>/<journey>.md`**: business-readable journey (YAML frontmatter + `# <ID> — <Title>` H1 + `### Scenario N` bodies).
2. **Level 2 — `e2e/live-app/<journey>.e2e.ts`**: thin Playwright script whose line 1 is `// spec: e2e/specs/<domain>/<journey>.md` and whose scenarios assert zero uncaught page or console errors via `app.assertCleanConsole()`.

`bun scripts/check-e2e-specs.ts` ([source](../../scripts/check-e2e-specs.ts)) is the bidirectional integrity gate: frontmatter completeness & enum checks, H1 + scenario schema, `specFile` existence, `mobile-375` viewport parity (either matched by `journal-mobile-375` in `playwright.journal.config.ts` or exercising `375px` via `setViewportSize`), and exact 1:1 crosswalk mapping in both directions.

## Frontmatter schema

```yaml
---
domain: analytics        # one of: journal, notebooks, runtime, properties, analytics, feeds
specFile: e2e/live-app/<journey>.e2e.ts
routes: [/results/:sessionId, /dashboards]
personas: [Athlete]
viewports: [desktop, mobile-375]   # desktop = 1280x900, mobile-375 = 375x812, cold-boot, dark
priority: P0-gate        # P0-gate | P1-core | P1 | P2
---
```

## Scenario body schema

- `# <ID> — <Title>` — top-level document heading (with optional architectural context paragraph).
- `### Scenario N: <business title>` — one heading per scenario.
- `Given <world setup using exact GLOSSARY.md nouns>:` — precondition line.
- `1. <Persona> opens '<route>' and <action>.` — numbered user steps.
- `- expect: <observable outcome>.` — outcome assertions as bullets.

## Journey taxonomy (6 domains, 28 journeys — 18 authored, including all 9 P0-gates)

| Domain | Journey | Slug | Priority |
|---|---|---|---|
| journal | JRN-01 | [cold-boot-and-home-tour](journal/cold-boot-and-home-tour.md) | P0-gate |
| journal | JRN-02 | [daily-note-authoring-and-persistence](journal/daily-note-authoring-and-persistence.md) | P0-gate |
| journal | JRN-03 | `contextual-entry-creation-wizard` | P1 |
| journal | JRN-04 | `calendar-agenda-and-planner` | P1 |
| journal | JRN-05 | [markdown-and-zip-journal-intake](journal/markdown-and-zip-journal-intake.md) | P1 |
| journal | JRN-06 | [agent-readiness](journal/agent-readiness.md) | P0-gate |
| notebooks | NBK-01 | [notebook-hierarchy-and-crud](notebooks/notebook-hierarchy-and-crud.md) | P0-gate |
| notebooks | NBK-02 | [nm-promotion-and-note-provenance](notebooks/nm-promotion-and-note-provenance.md) | P0-gate |
| notebooks | NBK-03 | [page-placements-and-shell-navigation](notebooks/page-placements-and-shell-navigation.md) | P1 |
| notebooks | NBK-04 | `playground-scratchpad-and-guides` | P2 |
| runtime | RUN-01 | [wall-clock-and-fastclock-protocols](runtime/wall-clock-and-fastclock-protocols.md) | P0-gate |
| runtime | RUN-02 | [readonly-intake-and-provenance-run](runtime/readonly-intake-and-provenance-run.md) | P0-gate |
| runtime | RUN-03 | `timer-responsive-tiers-and-cast-receiver` | P1 |
| runtime | RUN-04 | `session-actuals-persistence-and-retry` | P1 |
| properties | PRP-01 | [efforts-catalog-and-alias-lifecycle](properties/efforts-catalog-and-alias-lifecycle.md) | P1 |
| properties | PRP-02 | [equipment-catalog-and-backlinks](properties/equipment-catalog-and-backlinks.md) | P1-core |
| properties | PRP-03 | [effort-creation-and-tag-mobile-layout](properties/effort-creation-and-tag-mobile-layout.md) | P1-core |
| properties | PRP-04 | [scoped-property-override-sheets](properties/scoped-property-override-sheets.md) | P1 |
| properties | PRP-05 | `tag-categories-and-metric-stacking` | P1 |
| analytics | ANL-01 | `stream-wql-and-query-settings` | P1 |
| analytics | ANL-02 | `analytics-explorer-and-pipeline` | P1 |
| analytics | ANL-03 | `dashboard-multi-widget-authoring` | P1 |
| analytics | ANL-04 | [entity-scope-and-dashboard-promotion](analytics/entity-scope-and-dashboard-promotion.md) | P1-core |
| analytics | ANL-05 | [recovery-sample-and-dashboard-lifecycle](analytics/recovery-sample-and-dashboard-lifecycle.md) | P1-core |
| feeds | FED-01 | [feed-subscription-and-autosync](feeds/feed-subscription-and-autosync.md) | P0-gate |
| feeds | FED-02 | `remote-notebook-preview-and-clone` | P1 |
| feeds | FED-03 | [publication-visibility-and-feed-export](feeds/publication-visibility-and-feed-export.md) | P0-gate |
| feeds | FED-04 | [portable-codecs-and-backup-restore](feeds/portable-codecs-and-backup-restore.md) | P1 |

Each journey's Level-2 script lives at `e2e/live-app/<slug>.e2e.ts`.

## `PlaygroundTestActor` (8 namespaces)

The fixture under [e2e/fixtures/playgroundActor.ts](../fixtures/playgroundActor.ts) exports `{ test, expect, TEST_IDS }` and exposes `app` with:

| Namespace | Purpose |
|---|---|
| `app.seed` | Deterministic world seeding: `world(DomainWorldInput)`, `journalNote`, `notebook`, `propertyOverride`, `completedSessions`, `mockPeerFeed` |
| `app.journal` | Journal stream/date navigation, palette entry creation, zip intake, persistence checks |
| `app.notebooks` | Notebook library CRUD, note promotion, placements, `setNotebookPublic` |
| `app.properties` | Effort/equipment/tag catalog surfaces and scoped override sheets |
| `app.editor` | Note editor open/replace/read, inlay widgets, mobile wheel |
| `app.runtime` | FastClock protocol, workout start/advance/stop, timer tiers, cast receiver |
| `app.wql` | Stream query bar, `?q=` route queries, stream layout, dashboard navigation |
| `app.feeds` | Feed readiness/sync, publication visibility ladder, portable `.zip` export/import |

DOM hooks come from the shared contract in [e2e/contracts/TestIdContract.ts](../contracts/TestIdContract.ts) (`TEST_IDS`), never ad-hoc selectors.

## Validation

```bash
bun scripts/check-e2e-specs.ts
```

Every spec/script change must pass this gate before merge; UI journeys additionally run under the Playwright projects (`journal-chromium` 1280x900, `journal-mobile-375` 375x812) via `bun run test:e2e`.
