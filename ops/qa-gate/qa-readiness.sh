#!/usr/bin/env bash
# WOD Wiki release readiness assessment for one staged main build.
# Runs: (a) E2E gate suites via qa-gate.sh --no-status, (b) quick touched-domain
# dogfood smoke on main.preview (changes since the last release tag), (c) critical
# findings check. Writes the composed verdict as commit status e2e/main-staging and
# a qa-blessed-<shortsha> tag. A release is promotable only on PASS.
#
# Usage: qa-readiness.sh [SHA] [--skip-dogfood]
# Exit: 0=ready (PASS), 1=blocked (FAIL), 2=environment/setup error.
set -uo pipefail
export PATH="$HOME/.bun/bin:$PATH"

DOG=/srv/nfs/helios/dogfood/wod-wiki
QADIR="$DOG/qa-gate"
GATE="$QADIR/qa-gate.sh"
REPO=/srv/nfs/helios/docker-shared/repos/wod-wiki
PREVIEW_APP=https://main.preview.wod.wiki
DOGFOOD=/usr/local/bin/wod-wiki-dogfood
DOGF_TIMEOUT=4200

SHA=""
SKIP_DOGFOOD=0
FORCE=0
for a in "$@"; do
  case "$a" in
    --skip-dogfood) SKIP_DOGFOOD=1 ;;
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

# --- 2. Quick dogfood on the changes since the last release ---------------------
CRIT_COUNT=0
CRIT_LIST=""
DOMAINS="(skipped)"
SESSION=""
if [ "$SKIP_DOGFOOD" = 0 ]; then
  DOMAINS=$(git -C "$REPO" log --name-only --pretty=format: "${LAST_TAG}..${SHA}" 2>/dev/null | python3 -c '
import sys, re
kw = [(r"journal|/note|editor", "journal"), (r"notebook", "notebooks"),
      (r"runtime|timer|clock|/run|workout", "runtime"), (r"propert", "properties"),
      (r"analytic|dashboard|results|chart|effort", "analytics"),
      (r"feed|stream", "feeds")]
seen = []
for line in sys.stdin:
    p = line.strip().lower()
    if not p:
        continue
    for rx, d in kw:
        if re.search(rx, p) and d not in seen:
            seen.append(d)
            break
print(",".join(seen[:2]))
')  # empty output = no product-surface changes -> dogfood phase skipped
  if [ -n "$DOMAINS" ]; then
    log "phase 2: quick dogfood on $PREVIEW_APP, domains: $DOMAINS"
    if timeout "$DOGF_TIMEOUT" "$DOGFOOD" --url "$PREVIEW_APP" --domains "$DOMAINS" --smoke \
      >"$QADIR/suites/dogfood-quick.log" 2>&1; then
      SESSION=$(ls -dt "$DOG"/*-smoke-*/ 2>/dev/null | head -1)
      log "dogfood session: ${SESSION:-none found}"
      if [ -n "$SESSION" ]; then
        CRIT_OUT=$(python3 - "$SESSION" <<'PY'
import json, sys, glob, os
crit = []
for f in glob.glob(os.path.join(sys.argv[1], "domains", "*", "findings.jsonl")):
    for line in open(f):
        d = json.loads(line)
        if str(d.get("severity", "")).lower() == "critical":
            crit.append(f"{d.get('title', '')[:110]} [{os.path.basename(os.path.dirname(f))}]")
print(len(crit))
for c in crit:
    print("- " + c)
PY
)
      CRIT_COUNT=$(printf '%s\n' "$CRIT_OUT" | head -1)
      CRIT_LIST=$(printf '%s\n' "$CRIT_OUT" | tail -n +2)
      [ "$CRIT_COUNT" != "0" ] && REASONS+=("dogfood found $CRIT_COUNT Critical finding(s) on the staged build")
    fi
    else
      REASONS+=("dogfood smoke driver failed or timed out after ${DOGF_TIMEOUT}s")
    fi
  else
    log "phase 2 skipped: no product-surface changes since $LAST_TAG"
    DOMAINS="(no product-surface changes)"
  fi
fi
log "phase 2 done (critical findings: $CRIT_COUNT)"

# --- 3. Verdict ------------------------------------------------------------------
if [ ${#REASONS[@]} -eq 0 ]; then VERDICT=PASS; else VERDICT=FAIL; fi

{
  echo "# Readiness report - $SHORT"
  echo
  echo "- Run: $(ts)"
  echo "- Release commit: \`$SHA\`"
  echo "- Changes since: ${LAST_TAG:-unknown}"
  echo "- Verdict: **$VERDICT**"
  echo "- E2E gate: $([ $E2E_RC -eq 0 ] && echo pass || echo "fail (rc=$E2E_RC)")"
  echo "- Quick dogfood domains: $DOMAINS"
  echo "- Dogfood session: ${SESSION:-none}"
  echo "- Critical findings: $CRIT_COUNT"
  echo
  if [ ${#REASONS[@]} -gt 0 ]; then
    echo "## Blocking reasons"; echo
    for r in "${REASONS[@]}"; do echo "- $r"; done
    echo
  fi
  [ -n "$CRIT_LIST" ] && { echo "## Critical findings"; echo; echo "$CRIT_LIST"; echo; }
} >"$QADIR/readiness-report.md"

printf '{"run":"%s","sha":"%s","verdict":"%s","kind":"readiness","e2e_rc":%s,"domains":"%s","critical":%s,"reasons":%s}\n' \
  "$(ts)" "$SHA" "$VERDICT" "$E2E_RC" "$DOMAINS" "$CRIT_COUNT" \
  "$(printf '%s\n' "${REASONS[@]:-}" | python3 -c 'import json,sys; print(json.dumps([l for l in sys.stdin.read().splitlines() if l]))')" \
  >>"$QADIR/history.jsonl"

if [ "$VERDICT" = PASS ]; then
  gh api "repos/bitcobblers/wod-wiki/statuses/$SHA" \
    -f state=success -f context=e2e/main-staging \
    -f description="Readiness PASS: E2E + quick dogfood on staged build" >/dev/null \
    && log "commit status: success" || { log "FATAL: status write failed"; exit 2; }
  # Promote: move the mutable prod tag -> triggers deploy-prod.yml
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
  gh label create qa-gate -R bitcobblers/wod-wiki \
    --description "Blocking issue opened by helios QA readiness gate" \
    --color D93F0B --force >/dev/null 2>&1 || true
  gh issue create -R bitcobblers/wod-wiki \
    --title "Readiness blocked main $SHORT" \
    --label qa-gate \
    --body "$(printf 'Readiness verdict FAIL for `%s`.\n\n' "$SHA"; printf -- '- %s\n' "${REASONS[@]}"; [ -n "$CRIT_LIST" ] && { echo; echo '## Critical findings'; echo "$CRIT_LIST"; }; echo; echo 'Report: /srv/nfs/helios/dogfood/wod-wiki/qa-gate/readiness-report.md')" \
    >>"$QADIR/issue-create.log" 2>&1 && log "blocking issue opened" || log "WARNING: issue create failed (details: $QADIR/issue-create.log)"
fi

log "verdict: $VERDICT (report: $QADIR/readiness-report.md)"
[ "$VERDICT" = PASS ] && exit 0 || exit 1
