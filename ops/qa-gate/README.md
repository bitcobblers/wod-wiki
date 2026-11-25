# QA Gate scripts (helios ops)

> **Deprecated (rollback-only during n8n cutover):** External QA readiness and nightly dogfooding have migrated to webhook-driven **n8n** workflows (`Handle WOD GitHub Webhook`, `Finalize WOD Release Readiness`, `WOD QA Lead`, `WOD Defect Triager`, `WOD Release Failure Analyst`; see [`docs/e2e-promotion-agent.md`](../../docs/e2e-promotion-agent.md)). These legacy Helios bash scripts are retained temporarily for rollback during the n8n cutover and will be removed in a follow-up cleanup PR once n8n readiness has passed 2–3 production releases.

Canonical copy of the release-readiness gate scripts that run on helios
(`10.1.0.30`) under `/srv/nfs/helios/dogfood/wod-wiki/qa-gate/` and
`/usr/local/bin/wod-wiki-dogfood`. These scripts are not built, shipped, or
deployed — they gate `refs/tags/prod` promotion after `main.yml` stages a
build (see `docs/e2e-promotion-agent.md`).

## Release flow (2026-11-16, owner-approved)

Per-diff verdict is **E2E-only**; the dogfood audit runs nightly (Hermes cron
`wod-dogfood-night-orchestrator`, 6-domain rotation) and is deliberately not
part of the per-diff promotion decision:

1. `main.yml` stages a build → `build-changes` bucket diff → readiness dispatch.
2. `qa-readiness.sh <sha>` runs the E2E suites (phase 1) and decides PASS/FAIL
   from the suite results.
3. **PASS** → status `e2e/main-staging=success`, move `refs/tags/prod` →
   `deploy-prod.yml` (npm + GitHub Pages), stamp `qa-blessed-<shortsha>`.
   The `github-pages` environment needs a **tag-type** policy for `prod`
   (branch-type policies do not match tag refs — the 03:11Z deploy failed on
   exactly this until a `type: tag` policy was added via the environments API).
4. **FAIL** → status failure + a markdown research request uploaded to the
   files S3 `to-muse` bucket (helios `files` stack; the receiver noop-handler
   moves it to `to-muse-outbox` for the muse research agent). The request
   carries blocking reasons, the suite log tail, and asks for a root cause
   (`file:line` + symbol), a concrete fix, and a test tier. Local audit copy:
   `qa-gate/muse-request-<ts>-<sha>.md`. Upload helper verifies byte-for-byte
   re-GET; creds come from `/opt/helios-services/files.env` via sudo and are
   unset after use.

## Files

- `qa-readiness.sh` — promotion assessment for one staged `main` SHA: E2E gate
  verdict only. PASS moves `refs/tags/prod` (triggers `deploy-prod.yml` → npm +
  GitHub Pages) and stamps `qa-blessed-<shortsha>`; FAIL writes a markdown
  research request to the files S3 `to-muse` bucket for the muse research
  agent. Single-flight `flock`, `history.jsonl` skip-unless-`--force`.
  (`--skip-dogfood` remains accepted for caller compatibility and is ignored —
  dogfood is nightly-only.)
- `qa-gate.sh` — nightly/advisory E2E suites (smoke, storybook, webkit,
  optional journal with `--full`) against the S3 previews + open-issue ledger
  cross-check. Writes `history.jsonl` and reports; `--no-gh` for read-only.
- `readiness-dispatch.sh` — drains push-triggered readiness assessments from
  the files-stack `build-changes` spool queue (`spool/queue/`) on helios;
  started by the `wod-readiness.path` → `wod-readiness.service` systemd pair.
- `wod-wiki-dogfood` — two-stage dogfood driver (persona explorers + Stage 2
  planner synthesis with `known-issues.json` delta ledger).

## Install on helios

```bash
install -m 0755 qa-readiness.sh qa-gate.sh /srv/nfs/helios/dogfood/wod-wiki/qa-gate/
sudo install -m 0755 wod-wiki-dogfood /usr/local/bin/wod-wiki-dogfood
# readiness-dispatch.sh runs from the qa-gate dir; edit in place (itsme-owned)
```

Never edit live gate scripts while a readiness run is executing — bash reads
them lazily and in-place edits corrupt the running instance.

## History (2026-11-16)

Fixes for three false-fail / silent-failure modes observed when the gate
PASSed `1e96a51` with the critical WW-020 note-purge open:

1. **Single-flight + re-run dedupe** — `qa-readiness.sh` previously had no
   lock of its own; direct invocations (agent sessions, manual reruns) ran
   concurrently with the systemd-dispatched assessment, producing overlapping
   verdicts for the same SHA and leaving the `latest` session symlink stale.
   Now: `flock` on `qa-gate/.readiness.lock`, and a `history.jsonl`
   skip-unless-`--force` check after the SHA is resolved.
2. **Critical-severity case match** — phase 2 counted findings with
   `severity == "Critical"`, but workers record the canonical lowercase
   `critical`, so critical findings never blocked a release. (This check is
   gone with phase 2 — the verdict is E2E-only now.)
3. **Blocking-issue resilience** — `gh issue create --label qa-gate` failed on
   every FAIL verdict while the `qa-gate` label did not exist yet (created
   2026-11-15T23:45Z); stderr was swallowed. Now: bootstrap the label before
   every create and log create output to `qa-gate/issue-create.log`. (Later
   the same day the FAIL branch switched from GitHub issues to the `to-muse`
   research-request upload; the label bootstrap lives on in `qa-gate.sh`.)
4. **Owner-approved flow change (evening 2026-11-16)** — per-diff verdict is
   E2E-only (phase 2 dogfood removed; dogfood stays nightly via cron); FAIL
   now ships a markdown research request to the `to-muse` S3 bucket instead
   of opening a GitHub issue; the `github-pages` environment got a tag-type
   `prod` policy so `refs/tags/prod` pushes actually deploy to Pages (the
   03:11Z deploy had failed on "Tag prod is not allowed to deploy"). The
   pending `1e96a51` promotion was completed by rerunning the blocked run:
   npm + Pages + Release all green, `wod.wiki` serving the new build.

Plus: smoke wave wait raised 1200 s → 1800 s (real analytics smoke workers
run ~28 min), readiness driver kill-guard 3300 s → 4200 s, and
`wod-wiki-dogfood` now updates the `latest` session symlink before the slow
QA-site refresh so a mid-refresh kill cannot leave a stale pointer.
