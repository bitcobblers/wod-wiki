# Validation

Canonical validation reference for this repo. Agent instruction files
(`AGENTS.md`, `.github/copilot-instructions.md`) point here instead of
duplicating command lists — update this document when validation commands or
policies change.

All commands run from the repo root with `bun`.

## Command reference

| Surface | Command | Notes |
|---|---|---|
| Unit tests (packages + playground unit + Storybook tests + seed) | `bun run test` | Fast (~seconds); the workmux `pre_merge` gate |
| Component/integration tests (playground `tests/`) | `bun run --cwd apps/playground test:components` | Playwright component tests |
| Markdown fixture compile suite | `bun run --cwd apps/playground test:markdown` | Collections + syntax fixtures; decoupled from `bun run test` |
| Storybook tests | `bun run test:storybook` | Story smoke + `play()` interaction tests |
| Playground type gate | `bun run check:playground-types` | Compares `tsc` output against the checked-in baseline; pre-existing errors are tracked in that baseline, not by hand count |
| Full E2E / milestone acceptance | `bun run test:e2e` | Playwright journal config; heavyweight |
| Targeted preview acceptance | `bun run test:e2e:preview` | Runs E2E against a production preview build; the UI-worker done gate |
| Static Storybook build | `bun run build-storybook` | Never cancel; can take up to 60 minutes |
| Docs link check | `bun run docs:check` | Sub-second; must pass before merge |

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
