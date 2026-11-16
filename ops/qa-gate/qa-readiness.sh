#!/usr/bin/env bash
# WOD Wiki release readiness assessment for one staged main build.
# Runs the E2E gate suites via qa-gate.sh --no-status and decides the verdict
# from the E2E results only. The dogfood audit runs nightly (Hermes cron
# orchestrator) and is deliberately NOT part of the per-diff verdict.
#
# PASS  -> commit status e2e/main-staging=success, move refs/tags/prod
#          (triggers deploy-prod.yml -> npm + GitHub Pages), stamp
#          qa-blessed-<shortsha> audit tag.
# FAIL  -> commit status failure + upload a markdown research request to the
#          files S3 `to-muse` bucket (receiver noops it into `to-muse-outbox`
#          for the muse research agent).
#
# Usage: qa-readiness.sh [SHA] [--force] [--skip-dogfood (ignored, kept for compat)]
# Exit: 0=ready (PASS), 1=blocked (FAIL), 2=environment/setup error.
set -uo pipefail
export PATH="$HOME/.bun/bin:$PATH"

DOG=/srv/nfs/helios/dogfood/wod-wiki
QADIR="$DOG/qa-gate"
GATE="$QADIR/qa-gate.sh"
REPO=/srv/nfs/helios/docker-shared/repos/wod-wiki
FILES_ENV=/opt/helios-services/files.env
S3=http://10.1.0.30:9000
MUSE_BUCKET=to-muse

SHA=""
SKIP_DOGFOOD=0
FORCE=0
for a in "$@"; do
  case "$a" in
    --skip-dogfood) SKIP_DOGFOOD=1 ;;  # dogfood is nightly-only now; accepted and ignored
    --force) FORCE=1 ;;
    --*) : ;;
    *) SHA=$a ;;
  esac
done

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[qa-readiness $(ts)] $*"; }
REASONS=()

# Single-flight: serialize every readiness invocation (dispatch + direct callers).
exec 9>"$QADIR/.readiness.lock"
if ! flock -n 9; then
  log "another readiness run holds the lock; waiting up to 300s"
  flock -w 300 9 || { log "FATAL: another readiness run still active after 300s"; exit 2; }
fi

if ! command -v gh >/dev/null 2>&1 || ! gh api repos/bitcobblers/wod-wiki --jq .full_name >/dev/null 2>&1; then
  log "FATAL: gh auth unavailable - readiness verdicts must be written to GitHub"
  exit 2
fi

git -C "$REPO" fetch -q origin main || { log "FATAL: git fetch failed"; exit 2; }
git -C "$REPO" fetch -q --tags origin || true
[ -z "$SHA" ] && SHA=$(git -C "$REPO" rev-parse origin/main)
SHORT=${SHA:0:7}
LAST_TAG=$(git -C "$REPO" tag --sort=-v:refname | grep -E '^v[0-9]+\.' | head -1 || true)
log "release $SHORT, changes since ${LAST_TAG:-(no release tag)}"

# Skip if this SHA already has a readiness verdict (stops relaunch/retry loops
# that bypass readiness-dispatch.sh's history check). --force re-runs anyway.
if [ "$FORCE" = 0 ] && grep -q "\"sha\":\"$SHA\".*\"kind\":\"readiness\"" "$QADIR/history.jsonl" 2>/dev/null; then
  log "SKIP: readiness already assessed for $SHORT (history.jsonl); pass --force to re-run"
  exit 0
fi

# --- 1. E2E gate (assessment only; qa-gate.sh writes its own report/history) ----
log "phase 1: E2E suites against staging previews"
"$GATE" --no-status >"$QADIR/suites/e2e-assess.log" 2>&1
E2E_RC=$?
if [ $E2E_RC -ne 0 ]; then
  REASONS+=("E2E suites/env failed (rc=$E2E_RC; details in qa-gate/qa-report.md)")
fi
log "phase 1 done rc=$E2E_RC"

# --- 2. Verdict -------------------------------------------------------------------
if [ ${#REASONS[@]} -eq 0 ]; then VERDICT=PASS; else VERDICT=FAIL; fi

{
  echo "# Readiness report - $SHORT"
  echo
  echo "- Run: $(ts)"
  echo "- Release commit: \`$SHA\`"
  echo "- Changes since: ${LAST_TAG:-unknown}"
  echo "- Verdict: **$VERDICT**"
  echo "- E2E gate: $([ $E2E_RC -eq 0 ] && echo pass || echo "fail (rc=$E2E_RC)")"
  echo
  if [ ${#REASONS[@]} -gt 0 ]; then
    echo "## Blocking reasons"; echo
    for r in "${REASONS[@]}"; do echo "- $r"; done
    echo
  fi
} >"$QADIR/readiness-report.md"

printf '{"run":"%s","sha":"%s","verdict":"%s","kind":"readiness","e2e_rc":%s,"reasons":%s}\n' \
  "$(ts)" "$SHA" "$VERDICT" "$E2E_RC" \
  "$(printf '%s\n' "${REASONS[@]:-}" | python3 -c 'import json,sys; print(json.dumps([l for l in sys.stdin.read().splitlines() if l]))')" \
  >>"$QADIR/history.jsonl"

# Upload a markdown object to the files S3 `to-muse` bucket and verify it by
# byte-for-byte re-GET. Credentials come from the root-owned files env via
# sudo; they are never echoed and unset immediately after use.
upload_to_muse() { # upload_to_muse <file> <key>
  local RK RS out rc
  RK=$(sudo -n awk -F= '$1=="RUSTFS_ACCESS_KEY"{print $2}' "$FILES_ENV") || return 1
  RS=$(sudo -n awk -F= '$1=="RUSTFS_SECRET_KEY"{print $2}' "$FILES_ENV") || return 1
  out="$(mktemp)"
  curl -sS --fail --aws-sigv4 "aws:amz:us-east-1:s3" --user "$RK:$RS" -T "$1" \
    "$S3/$MUSE_BUCKET/$2" &&
  curl -sS --fail --aws-sigv4 "aws:amz:us-east-1:s3" --user "$RK:$RS" -o "$out" \
    "$S3/$MUSE_BUCKET/$2" && cmp -s "$1" "$out"
  rc=$?
  rm -f "$out"; unset RK RS
  return $rc
}

if [ "$VERDICT" = PASS ]; then
  gh api "repos/bitcobblers/wod-wiki/statuses/$SHA" \
    -f state=success -f context=e2e/main-staging \
    -f description="Readiness PASS: E2E suites on staged build" >/dev/null \
    && log "commit status: success" || { log "FATAL: status write failed"; exit 2; }
  # Promote: move the mutable prod tag -> triggers deploy-prod.yml (npm + Pages)
  if gh api "repos/bitcobblers/wod-wiki/git/ref/tags/prod" >/dev/null 2>&1; then
    gh api "repos/bitcobblers/wod-wiki/git/refs/tags/prod" -X PATCH \
      -f sha="$SHA" -F force=true >/dev/null \
      && log "prod tag moved to $SHORT" || { log "FATAL: prod tag move failed"; exit 2; }
  else
    gh api repos/bitcobblers/wod-wiki/git/refs -X POST \
      -f ref="refs/tags/prod" -f sha="$SHA" >/dev/null \
      && log "prod tag created at $SHORT" || { log "FATAL: prod tag create failed"; exit 2; }
  fi
  sleep 15
  log "deploy-prod.yml latest run: $(gh run list --workflow deploy-prod.yml --limit 1 \
    --json status,conclusion,headSha -q '.[0] | .status + "/" + (.conclusion // "-") + " " + .headSha[0:7]' 2>/dev/null || echo unknown)"
  # audit trail: immutable per-SHA blessing tag
  if ! gh api "repos/bitcobblers/wod-wiki/git/ref/tags/qa-blessed-$SHORT" >/dev/null 2>&1; then
    gh api repos/bitcobblers/wod-wiki/git/refs -X POST \
      -f ref="refs/tags/qa-blessed-$SHORT" -f sha="$SHA" >/dev/null \
      && log "tag qa-blessed-$SHORT created" || log "WARNING: tag write failed"
  fi
else
  gh api "repos/bitcobblers/wod-wiki/statuses/$SHA" \
    -f state=failure -f context=e2e/main-staging \
    -f description="Readiness blocked: ${REASONS[0]:0:100}" >/dev/null \
    || log "WARNING: failure status write failed"

  # Research request for the muse agent: failure details + what to produce.
  MUSE_STAMP="$(date -u +%Y-%m-%d)/readiness-blocked-${SHORT}-$(date -u +%H%M%SZ)"
  MUSE_KEY="qa-gate/${MUSE_STAMP}.md"
  MUSE_LOCAL="$QADIR/muse-request-$(date -u +%Y%m%d-%H%M%SZ)-${SHORT}.md"
  {
    echo "# Research request: QA readiness blocked on main $SHORT"
    echo
    echo "- Run: $(ts)"
    echo "- Release commit: \`$SHA\`"
    echo "- Changes since: ${LAST_TAG:-unknown}"
    echo "- Verdict: FAIL"
    echo
    echo "## Blocking reasons"
    echo
    for r in "${REASONS[@]}"; do echo "- $r"; done
    echo
    echo "## Request"
    echo
    echo "Research the issues above and propose a fix. For each issue:"
    echo "1. Identify the root cause with exact \`file:line\` + symbol in the wod-wiki repo"
    echo "   (helios checkout: \`$REPO\`, commit \`$SHA\`)."
    echo "2. Propose a concrete code fix."
    echo "3. Name the regression test tier: Tier 1 unit (\`packages/*/tests\`),"
    echo "   Tier 2 Storybook/component, or Tier 3 \`e2e/specs/<domain>/\` journey."
    echo
    echo "## Failure log (suites/e2e-assess.log tail)"
    echo
    echo '```'
    tail -n 80 "$QADIR/suites/e2e-assess.log" 2>/dev/null
    echo '```'
    echo
    echo "Full reports: \`$QADIR/readiness-report.md\`, \`$QADIR/qa-report.md\`."
  } >"$MUSE_LOCAL"

  if upload_to_muse "$MUSE_LOCAL" "$MUSE_KEY"; then
    log "research request uploaded: $MUSE_BUCKET/$MUSE_KEY (local copy: $MUSE_LOCAL)"
  else
    log "WARNING: to-muse upload failed; research request kept at $MUSE_LOCAL"
  fi
fi

log "verdict: $VERDICT (report: $QADIR/readiness-report.md)"
[ "$VERDICT" = PASS ] && exit 0 || exit 1
