# QA Defect Regression Suite (`e2e/regression/`)

One Playwright test file per **open** defect in the QA ledger
(<https://qa.forest-adhara.ts.net/issues.html>), generated from the ledger
snapshot of 2026-11-18 (`known-issues.json`, app commit `969de0d9e`):
**41 open defects** — 1 critical, 7 high, 20 medium, 13 low.

## How to read this suite

- Every test asserts the **correct** behavior, so the suite is **expected to
  be red** while its defect is open. A failing test is the defect, made
  executable; a passing test means the defect no longer reproduces and the
  test should graduate into the matching `e2e/live-app/` journey (with its
  Level-1 spec) and be deleted here.
- The suite is deliberately **not** wired into the required PR checks and is
  separate from the `e2e/specs/` ↔ `e2e/live-app/` 1:1 gate
  (`scripts/check-e2e-specs.ts`). Run it on demand:

  ```bash
  bun x playwright test --config playwright.regression.config.ts            # local dev app
  E2E_APP_URL=https://wod.wiki bun x playwright test --config playwright.regression.config.ts
  ```

- Tests compose the shared `PlaygroundTestActor` fixture
  (`e2e/fixtures/playgroundActor.ts`) and seed the smallest world that
  expresses each defect. Several defects are timing- or corpus-dependent
  (cold boot, boot/feed import cycle, full-corpus hydration); the config runs
  serially with retries disabled so a flaky pass cannot mask them.
- Each file's header records the ledger title, fingerprint, expected
  behavior, and the run in which the defect was last seen.

## Defect map

| Issue | Severity | Defect | Test |
| --- | --- | --- | --- |
| WW-020 | critical | User-authored notes silently deleted within seconds of creation by the boot/feed import cycle — now 7 reproduc | [ww-020.e2e.ts](ww-020.e2e.ts) |
| WW-019 | high | Boot/import readiness contract still broken: cold-boot bare-'loading' stalls, ready-at-partial-stream-total, a | [ww-019.e2e.ts](ww-019.e2e.ts) |
| WW-044 | high | Export→Import round-trip broken — repository-layout export prefixes every artifact 'dist/' while importFromZip | [ww-044.e2e.ts](ww-044.e2e.ts) |
| WW-051 | high | Recorded session timing wrong across lifecycle paths — card durations inconsistent with the IDB record; splits | [ww-051.e2e.ts](ww-051.e2e.ts) |
| WW-055 | high | Settings→Storage 'Export Feed Repository (.zip)' is a silent no-op on the happy path (public notebook present) | [ww-055.e2e.ts](ww-055.e2e.ts) |
| WW-056 | high | Benchmark PR Board widgets all 'No data for this range.' — sessions store = 0 after ready import | [ww-056.e2e.ts](ww-056.e2e.ts) |
| WW-085 | high | Ready-to-Start gate: mouse clicks on Start do nothing (keyboard '/' works), and after keyboard start the overl | [ww-085.e2e.ts](ww-085.e2e.ts) |
| WW-087 | high | (no title in ledger — see file header) | [ww-087.e2e.ts](ww-087.e2e.ts) |
| WW-036 | medium | Unfiltered /notes still full-corpus detail-hydrates — 7.8-14.7s ready gates across all three workers on a ~164 | [ww-036.e2e.ts](ww-036.e2e.ts) |
| WW-038 | medium | Invalid WQL on /dashboards destroys the rendered result pane, overwrites the shareable ?q= URL, and offers no  | [ww-038.e2e.ts](ww-038.e2e.ts) |
| WW-041 | medium | Uploading a manifest-less/empty .zip on /load silently bounces to Home with zero import feedback | [ww-041.e2e.ts](ww-041.e2e.ts) |
| WW-049 | medium | wod_note_delete without confirmId never resolves — promise pends indefinitely on a silent human-only 'Confirm  | [ww-049.e2e.ts](ww-049.e2e.ts) |
| WW-057 | medium | :session{text:fran} reports '0 applied, 1 ignored' yet empties the result list to 0 of 0 — ignore advisory con | [ww-057.e2e.ts](ww-057.e2e.ts) |
| WW-059 | medium | /day/:date has no Page options panel — Delete note, Clone, Export, Notebooks & Promotion unavailable vs /note/ | [ww-059.e2e.ts](ww-059.e2e.ts) |
| WW-065 | medium | prebuilt /dashboard/benchmark-pr-board settle latency — moot while every widget settles 'No data' (WW-056) | [ww-065.e2e.ts](ww-065.e2e.ts) |
| WW-066 | medium | Cast to TV click with no receiver produces zero user-facing feedback — console-only failure | [ww-066.e2e.ts](ww-066.e2e.ts) |
| WW-070 | medium | Scoped equipment override commits silently — no confirmation and header 'Bundled' badge stays stale until full | [ww-070.e2e.ts](ww-070.e2e.ts) |
| WW-072 | medium | /subscribe probe failure surfaces raw browser error 'Failed to fetch' with no remediation hint | [ww-072.e2e.ts](ww-072.e2e.ts) |
| WW-073 | medium | Feed overflow menu ignores Escape (backdrop click works) — contradicts FED-01 Scenario 3 despite handler + pas | [ww-073.e2e.ts](ww-073.e2e.ts) |
| WW-074 | medium | HRV trend widget on /dashboard/recovery-readiness labels Y-axis ticks and readout in kg instead of ms (0 kg..8 | [ww-074.e2e.ts](ww-074.e2e.ts) |
| WW-076 | medium | For Time '21-15-9' live run shows rep target '9' on the 21-rep first movement (ladder target resolves to last  | [ww-076.e2e.ts](ww-076.e2e.ts) |
| WW-077 | medium | Live run cannot advance past the first movement — Next/Enter never activate movement 2 (AMRAP-path specific; F | [ww-077.e2e.ts](ww-077.e2e.ts) |
| WW-084 | medium | Explorer empty-state 'Log your first workout' CTA links to retired /collections which renders 'Page not found' | [ww-084.e2e.ts](ww-084.e2e.ts) |
| WW-088 | medium | Equipment detail /equipment/:slug renders no canonical backlinks to related Efforts or referencing workout Not | [ww-088.e2e.ts](ww-088.e2e.ts) |
| WW-089 | medium | Shared /notes?q= link with space-separated words fails WQL parse — 'Invalid query — showing previous results'  | [ww-089.e2e.ts](ww-089.e2e.ts) |
| WW-090 | medium | Custom effort creation silently drops authored body prose — /effort/:slug?mode=create persists frontmatter onl | [ww-090.e2e.ts](ww-090.e2e.ts) |
| WW-091 | medium | Link-as-Alias target <select> renders 0 options on cold load — Confirm Link permanently disabled, flow unusabl | [ww-091.e2e.ts](ww-091.e2e.ts) |
| WW-092 | medium | Workout Complete segment table leaks internal labels ('segm', 'Type: segment / #<uuid>:0 · Block: waiting-to-s | [ww-092.e2e.ts](ww-092.e2e.ts) |
| WW-030 | low | Chart unit formatting inconsistent: Y-axis baseline tick '0 kg' (space) vs grouped ticks '5,000kg' (no space)  | [ww-030.e2e.ts](ww-030.e2e.ts) |
| WW-034 | low | WQL plain-text fallback on /efforts dead — bare words like 'kettlebell' parse as vacuous aggregates instead of | [ww-034.e2e.ts](ww-034.e2e.ts) |
| WW-047 | low | notebook library card count excludes the notebook's own landing note — contradicts the detail page stream coun | [ww-047.e2e.ts](ww-047.e2e.ts) |
| WW-048 | low | note header shows a backlink chip for only one of two linked notebooks — N:M membership under-represented in t | [ww-048.e2e.ts](ww-048.e2e.ts) |
| WW-052 | low | Exiting at the Ready-to-Start gate records a 0s phantom in-progress session row | [ww-052.e2e.ts](ww-052.e2e.ts) |
| WW-062 | low | wod_notebook_list advertises notebook URLs as /notebooks/:slug — every link 404s 'Page not found'; real route  | [ww-062.e2e.ts](ww-062.e2e.ts) |
| WW-068 | low | Live timer chip accessible names leak raw values — resistance 'Value: [object Object]' (prior), now also Up-Ne | [ww-068.e2e.ts](ww-068.e2e.ts) |
| WW-071 | low | Alias chips on /effort/:slug and /equipment/:slug are non-interactive spans — PRP-01 spec promises linked chip | [ww-071.e2e.ts](ww-071.e2e.ts) |
| WW-078 | low | Float-valued analytics readouts mix precision conventions on one panel (10.46 min 2dp, 37.1 pts 1dp, 41 MET-mi | [ww-078.e2e.ts](ww-078.e2e.ts) |
| WW-079 | low | Script Outline rows duplicate the movement name — dup surface shrank to the live Up-next/heading lines (gate o | [ww-079.e2e.ts](ww-079.e2e.ts) |
| WW-080 | low | Create Note dialog 'Start from' template combobox dumps ~1,355 unsorted corpus notes as native <option> rows | [ww-080.e2e.ts](ww-080.e2e.ts) |
| WW-086 | low | Subscribe on /feeds shows no pending/disabled state during the ~6-8s feed sync — identical enabled button invi | [ww-086.e2e.ts](ww-086.e2e.ts) |
| WW-093 | low | Session card mislabels load as 'Volume: 42.5 kg' (kg = bar load, not volume); /sessions strip '2 of 2' vs 3-ro | [ww-093.e2e.ts](ww-093.e2e.ts) |
## Maintenance

When a nightly dogfood run resolves a defect, expect its test here to go
green: verify, then graduate it. When a new defect opens, add one file per
issue following the existing headers — assert the behavior that should hold,
never the buggy behavior.
