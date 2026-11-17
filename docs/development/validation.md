# Validation

Canonical validation reference for this repo. Agent instruction files
(`AGENTS.md`, `.github/copilot-instructions.md`) point here instead of
duplicating command lists — update this document when validation commands or
policies change.

For authoring new tests across Tier 1 (domain scenarios), Tier 2 (Storybook `domainState` + `play()` and Playground `@/testing/host`), and Tier 3 (two-level `e2e/specs/` Markdown journeys + Playwright `PlaygroundTestActor`), load [`skills/wod-wiki-testing/SKILL.md`](../../skills/wod-wiki-testing/SKILL.md) and [`skills/wod-wiki-testing/references/markdown-to-playwright.md`](../../skills/wod-wiki-testing/references/markdown-to-playwright.md). For recording solo or collaborative human+agent browser workflows and extracting `e2e/specs/<domain>/<journey>.md` via `bun scripts/e2e-workflow-recorder.ts`, load [`skills/wod-playwright-recorder/SKILL.md`](../../skills/wod-playwright-recorder/SKILL.md).

All commands run from the repo root with `bun`.

## Command reference

| Surface | Command | Notes |
|---|---|---|
| Unit tests (packages + playground unit + Storybook tests + seed) | `bun run test` | Fast (~seconds); the workmux `pre_merge` gate |
| Component/integration tests (playground `tests/`) | `bun run --cwd apps/playground test:components` | Playwright component tests |
| Markdown fixture compile suite | `bun run --cwd apps/playground test:markdown` | Collections + syntax fixtures; decoupled from `bun run test` |
| Storybook tests | `bun run test:storybook` | Story smoke + `play()` interaction tests |
| Playground type gate | `bun run check:playground-types` | Compares `tsc` output against the checked-in baseline; pre-existing errors are tracked in that baseline, not by hand count |
| E2E Markdown <-> Playwright spec parity | `bun scripts/check-e2e-specs.ts` | Enforces 1:1 bidirectional links and `mobile-375` viewport parity between `e2e/specs/<domain>/<journey>.md` and `e2e/live-app/<journey>.e2e.ts` |
| Validation & CLI script unit tests | `bun run test:validation-scripts` | Tests `check-playground-types`, `check-e2e-specs`, `ticket-report`, and `migrate-seed-markdown` |
| Skill sync & cited-path check | `bun run check:skills` | Verifies served/mirrored skill copies and repo paths cited in `skills/` |
| Agent action parity & manifest check | `bun run check:agent-parity` | Verifies 1:1 parity across `DOMAIN_AGENT_TOOLS`, Playground WebMCP `uiTools`, CLI subcommands, risk-tier annotations, and static discovery files (`llms.txt`, `llms-full.txt`, `.well-known/agent-capabilities.json`) |
| `TEST_IDS` contract & burn-down gate | `bun run check:test-ids` | Fails on new literal `data-testid="..."` attributes, invalid `TEST_IDS.*` refs, or regressions above the legacy burn-down baseline (431) |
| Ontology RDF / SHACL validation | `bun run ontology:validate` | Runs `ontology/validate.sh` (`rdflib` + `pyshacl` via `uv`, see [ADR 0007](../adrs/0007-python-uv-ontology-validation.md)) across all 5 named graphs and `bridge:seedNoun` integrity |
| Ontology code-graph & bridge build | `bun run ontology:build` | Indexes `packages/`, `apps/playground/`, `e2e/`, and QA findings into `ontology/generated/` |
| Ontology TypeScript codegen | `bun run ontology:codegen` | Generates `ontology/generated/ontology-types.ts` (75+ classes, SHACL validators, stereotype metadata) |
| Ontology bidirectional query & chains | `bun run ontology:query -- --chains` | Generates `ontology/generated/chains.md` and supports `--journey`, `--file`, `--symbol`, `--issue` traversal |
| Ontology testing pyramid diagnostic | `bun run ontology:query -- --pyramid` | Generates testing pyramid seam coverage matrix, flags top-heavy nodes and mismatched issue coverage (`--json` supported) |
| Ontology static HTML explorer | `bun run ontology:viewer` | Generates self-contained, offline `ontology/generated/explorer.html` for interactive 5-layer traversal |
| Ontology bidirectional changeset gate | `bun run ontology:changeset` | Proposes, approves, and applies gated code-to-ontology changesets (`propose` / `approve` / `apply` / `sync-from-ontology`) |
| API storage & server contract | `bun run check:server` | Verifies SQLite-backed Hono/engine server API endpoints (`apps/api/check.ts`) |
| Full E2E / milestone acceptance | `bun run test:e2e` | Playwright journal config; heavyweight |
| Targeted preview acceptance | `bun run test:e2e:preview` | Runs E2E against a production preview build; the UI-worker done gate |
| Hosted API-mode SQLite E2E | `bun run test:e2e:api` | Builds `VITE_STORAGE=api` Playground bundle and runs Playwright against disposable SQLite `wod server` (`playwright.api.config.ts`) |
| WebKit cross-browser smoke E2E | `bun run test:e2e:webkit` | Single-shard Desktop Safari + iPhone 13 WebKit smoke suite (`playwright.webkit.config.ts`) |
| Static Storybook build | `bun run build-storybook` | Never cancel; can take up to 60 minutes |
| Docs link check | `bun run docs:check` | Sub-second; must pass before merge |

## Testing Pyramid & Seam Selection Matrix

WOD Wiki establishes a hardened 4-tier / 7-seam testing pyramid. Every testing layer owns an explicit boundary contract so upper seams can trust it without duplicating combinatorial permutations in full browser tests:

| Tier / Seam | Runner | Boundary Contract Owned | What Upper Seams Trust (Never Re-Test Above) |
|---|---|---|---|
| **Tier 0: Static & Ontology Contracts** | `ontology:validate`, `check:*` (`< 2s`) | Schema/ID alignment across RDF, TS, routes, `TEST_IDS`, WebMCP/CLI, E2E crosswalk, and zero-orphan tests gate. | Every referenced ID, route, tool schema, and test file registration is valid. |
| **Tier 1a: Pure Compute** | `bun run test:package` (`~1–3s`) | `Text / AST / MockClock -> Output` in `packages/core`, `packages/lang`, `packages/wql`, and `packages/engine/src/runtime` (0 storage, 0 React). | Dialect parsing, unit fusion, `Metric Shake-Out Queue` precedence, WQL parsing/planning, and `RuntimeStack` block strategies. |
| **Tier 1b: Storage & Codec Conformance** | `bun run test:package` (`~2–4s`) | Parameterized `IStorage` suite across `InMemoryStorage`, `SqlStorage(':memory:')`, `IndexedDBStorage`, and `ApiStorage`, plus `.zip`/`.jsonl` codecs (`packages/storage/tests/storage-conformance.test.ts`). | `InMemoryStorage` and `SqlStorage` behave identically to browser `IndexedDBStorage` and HTTP `ApiStorage` on index ranges, transactions, rollbacks, and `queryDomain` plans. |
| **Tier 1c: Headless Domain & Agent** | `bun run test:package` (`~2–5s`) | Cross-entity workflows over shared `buildQueryServiceStoresFromStorage` + `persistDomainWorld`: `DomainScenarioHarness`, `DOMAIN_AGENT_TOOLS`, CLI JSON parity, and sample-corpus WQL contracts. | Multi-entity persistence, `ScopedPropertyOverride` resolution, `Session` intake & `EventRecord` splits, `NoteProvenance`, `PublicationVisibility`, `Feed` publish/import, and sample-dashboard non-emptiness. |
| **Tier 2a: App Host, Route & CM6 State** | `bun run test:playground:unit` (`~3–8s`) | JSDOM + `renderWithPlaygroundHost` / `setupPlaygroundTestHost` (`apps/playground/src/testing/host.tsx`) + `<AgentStateScript />`: route guards, URL/`?q=` sync, `data-agent-status` busy->ready, `#agent-view-state` JSON, autosave unmount-flush, and CodeMirror 6 transactions. | Route resolution, not-found states, query-bar <-> URL binding, draft persistence semantics, agent state projection, and CodeMirror document mutations. |
| **Tier 2b: Visual Organisms & Focus** | `bun run test:storybook` (`~5–12s`) | Real headless Chromium (`@vitest/browser-playwright`) + `parameters.domainState` + `play()` + `@storybook/addon-a11y`: `375px` organism layout, pointer/focus/`Escape` traps, `48px` coarse targets, CM6 autocomplete popups, chart ticks, and dark/light contrast. | Organism-level CSS layout, keyboard/focus traps, popover positioning, and WCAG contrast. |
| **Tier 3: Multi-Boundary Browser E2E** | `bun run test:e2e[:preview]` (`30–90s`) | **Strict Admission Gate:** scenarios requiring Web Workers / cold-boot seed sync, IndexedDB survival across full reload, multi-route `AppShell` handoffs, `FastClock` live timer execution, hosted SQLite server (`VITE_STORAGE=api`), or WebKit smoke. | Everything proven in Tiers 0–2b. |

## Lint and type check

ESLint is configured and enforced — there is no "no ESLint" exemption:

- `bun run lint` — packages + apps
- `bun run lint:packages` — `packages/*/src`
- `bun run lint:playground` — `apps/playground/src`
- `bun run lint:storybook` — `apps/storybook/src`

For types, run the narrowest relevant check for the touched surface and
`bun run check:playground-types` when touching the playground app. Only fix
type errors related to your changes; pre-existing errors live in the
checked-in baseline that `check:playground-types` compares against.

## E2E policy: targeted vs. milestone

- **Targeted** E2E runs cover only the acceptance criteria of the current
  change (a specific spec file or tag, or the preview-acceptance subset).
  These are the default for day-to-day work.
- **Milestone** E2E runs (`bun run test:e2e`) cover the full journal suite and
  are reserved for merge/readiness milestones, not every commit.
- Layout-affecting changes must be verified at **both** desktop and mobile
  viewports (mobile: 375×812).
- Acceptance must confirm **feed-ready navigation**: after the change, routes
  reach a feed-ready state without console errors or stuck loading shells.
- `playwright.journal.config.ts` seeds the `core` IndexedDB snapshot once in `journal-setup` (`indexedDB: true`) for `journal-chromium`, `journal-mobile-375`, and `journal-dark`, while `journal-cold-chromium` runs `cold-boot.e2e.ts` against an empty profile. Demo walkthrough scripts (`*-recording.e2e.ts`) are skipped unless `PLAYWRIGHT_RECORDING=1` is set.

Run the home-page WCAG A/AA checks at mobile and desktop sizes with:

```sh
bun x playwright test --config playwright.journal.config.ts e2e/live-app/cold-boot-and-home-tour.e2e.ts --grep "meets WCAG" --project=journal-chromium --workers=1
```

### UI worker done gate

A UI worker **MUST** run targeted preview acceptance (`bun run test:e2e:preview`)
against the built preview before marking work done. "Local preview unavailable"
is not an acceptable substitute: fix the preview setup or escalate — do not
skip the gate. This is a per-worker done gate, not a full-E2E-per-merge gate;
the merge-level gate remains `bun run test` (workmux `pre_merge`).

## Ticket reports

`scripts/ticket-report.mjs` records machine-readable validation evidence per
ticket. Reports live in the **main checkout** at
`.scratch/ticket-reports/<slug>/report.json` (derived via
`git worktree list --porcelain`), so workmux cleanup of a linked worktree
cannot lose them. Logs passed via `--log` are copied into the ticket's
`logs/` directory.

Lifecycle (run from any worktree):

```bash
bun scripts/ticket-report.mjs init --ticket wod-123 --base <sha>
bun scripts/ticket-report.mjs accept --ticket wod-123 --text "timer pauses on stop"
bun scripts/ticket-report.mjs test --ticket wod-123 --kind focused \
  --command "bun run test" --passed 100 --failed 0 --log vitest.log
bun scripts/ticket-report.mjs test --ticket wod-123 --kind e2e \
  --command "bun run test:e2e:preview" --passed 8 --failed 0 --skipped 1 --spec e2e/timer.e2e.ts
bun scripts/ticket-report.mjs known --ticket wod-123 --text "seed sync flaky on cold boot"
bun scripts/ticket-report.mjs finalize --ticket wod-123
```

- `init` captures the current head SHA and changed files against `--base`.
- `accept` appends a behavioral acceptance criterion.
- `test` appends a focused or e2e result. A nonzero `--failed` count is data,
  not a CLI error. `--spec` and `--log` may repeat; logs are copied into the
  report directory.
- `known` records a pre-existing failure so reviewers can distinguish it from
  regressions.
- `finalize` refreshes head/changed files and requires base/head, at least one
  acceptance, and at least one test before writing `REPORT.md`.

`finalize` prints the report path and aggregate pass/fail/skip counts. Ticket
slugs must be lowercase kebab (`wod-123`); negative or non-numeric counts,
missing spec/log files, and malformed commands are rejected.
