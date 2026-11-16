# QA Gate scripts (helios ops)

Canonical copy of the release-readiness gate scripts that run on helios
(`10.1.0.30`) under `/srv/nfs/helios/dogfood/wod-wiki/qa-gate/` and
`/usr/local/bin/wod-wiki-dogfood`. These scripts are not built, shipped, or
deployed — they gate `refs/tags/prod` promotion after `main.yml` stages a
build (see `docs/e2e-promotion-agent.md`).

## Files

- `qa-readiness.sh` — promotion assessment for one staged `main` SHA. Phase 1:
  advisory E2E gate (`qa-gate.sh --no-status`). Phase 2: quick dogfood smoke on
  `main.preview.wod.wiki` over the product-surface domains touched since the
  last release tag. Blocks on any `severity: critical` finding in the new
  session's `findings.jsonl`. PASS moves `refs/tags/prod` (triggers
  `deploy-prod.yml`) and stamps `qa-blessed-<shortsha>`. Supports
  `--skip-dogfood` and `--force`.
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
   `critical`, so critical findings never blocked a release. Now compares
   case-insensitively.
3. **Blocking-issue resilience** — `gh issue create --label qa-gate` failed on
   every FAIL verdict while the `qa-gate` label did not exist yet (created
   2026-11-15T23:45Z); stderr was swallowed. Now: bootstrap the label before
   every create and log create output to `qa-gate/issue-create.log`.

Plus: smoke wave wait raised 1200 s → 1800 s (real analytics smoke workers
run ~28 min), readiness driver kill-guard 3300 s → 4200 s, and
`wod-wiki-dogfood` now updates the `latest` session symlink before the slow
QA-site refresh so a mid-refresh kill cannot leave a stale pointer.
