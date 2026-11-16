#!/usr/bin/env bash
# WOD Wiki QA gate: verify the latest main deploy against staging previews,
# cross-check the dogfood defect ledger, and bless (or block) the release.
#
# Usage: qa-gate.sh [--full] [--no-gh] [--skip-suites]
#   --full          also run the full journal Playwright suite (slow on SBC)
#   --no-gh         never touch GitHub API (read-only verdict)
#   --skip-suites   environments + ledger only (fast smoke of the gate itself)
#
# Outputs: qa-gate/qa-report.md (latest), qa-gate/history.jsonl (append-only),
# qa-gate/suites/<name>.log (per-suite logs).
# Exit: 0 = PASS, 1 = FAIL, 2 = environment/setup error.
set -uo pipefail
export PATH="$HOME/.bun/bin:$PATH"

REPO=/srv/nfs/helios/docker-shared/repos/wod-wiki
DOG=/srv/nfs/helios/dogfood/wod-wiki
QADIR="$DOG/qa-gate"
REPORT="$QADIR/qa-report.md"
HISTORY="$QADIR/history.jsonl"
LEDGER="$DOG/known-issues.json"
PREVIEW_APP=https://main.preview.wod.wiki
PREVIEW_STORY=https://main.story.wod.wiki
LIVE=https://wod.wiki

FULL=0; USE_GH=1; RUN_SUITES=1; WRITE_STATUS=1
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    --no-gh) USE_GH=0 ;;
    --skip-suites) RUN_SUITES=0 ;;
    --no-status) WRITE_STATUS=0 ;;
  esac
done
mkdir -p "$QADIR/suites"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[qa-gate $(ts)] $*"; }

REASONS=()
declare -A SUITES=()

note_fail() { REASONS+=("$1"); }

# --- 1. Resolve release commit -------------------------------------------------
git -C "$REPO" fetch -q origin main || { log "FATAL: git fetch failed"; exit 2; }
SHA=$(git -C "$REPO" rev-parse origin/main) || { log "FATAL: cannot resolve origin/main"; exit 2; }
SHORT=${SHA:0:7}
log "release commit $SHORT"

# --- 2. gh capability probe ----------------------------------------------------
GH_OK=0
if [ "$USE_GH" = 1 ] && command -v gh >/dev/null 2>&1; then
  if gh api repos/bitcobblers/wod-wiki --jq .full_name >/dev/null 2>&1; then
    GH_OK=1
    CI_STATE=""
    for i in $(seq 1 20); do
      # -R is mandatory: the gate runs outside any git checkout (dogfood cwd)
      # and gh falls back to `git remote` resolution, which fails there.
      CI_STATE=$(gh run list -R bitcobblers/wod-wiki --workflow main.yml --branch main --limit 1 \
        --json status,conclusion,headSha \
        -q '.[0] | .status + " " + (.conclusion // "-") + " " + .headSha' 2>/dev/null)
      case "$CI_STATE" in completed*) break ;; esac
      log "main.yml not finished yet (${CI_STATE%% *} ...) - waiting ($i/20)"
      sleep 30
    done
    log "gh auth ok; main.yml latest: ${CI_STATE:-unknown}"
    case "$CI_STATE" in
      "completed success $SHA") : ;;
      "") note_fail "cannot resolve latest main.yml run" ;;
      "completed success"*) note_fail "main.yml success is for a different commit (staging stale?): $CI_STATE" ;;
      "completed failure"*) note_fail "main.yml failed at $SHORT - preview not staged" ;;
      *) note_fail "main.yml did not reach a conclusion within 10 min - staging still in progress" ;;
    esac
  else
    log "gh auth insufficient (org forbids classic PAT?) - read-only mode"
  fi
fi
[ "$GH_OK" = 1 ] || log "WARNING: no gh access - verdict is advisory, no status/tag/issue written"

# --- 3. Environment checks -----------------------------------------------------
env_check() { # name url
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$2")
  if [ "$code" = 200 ] || [ "$code" = 304 ]; then
    SUITES["env:$1"]=pass
  else
    SUITES["env:$1"]="fail($code)"
    note_fail "preview $1 returned HTTP $code"
  fi
}
env_check "app($PREVIEW_APP)" "$PREVIEW_APP"
env_check "story($PREVIEW_STORY)" "$PREVIEW_STORY"
env_check "live($LIVE)" "$LIVE"
LIVE_FP=$(curl -s --max-time 20 "$LIVE" | grep -oE '/assets/main-[A-Za-z0-9_-]+\.js' | head -1)
PREVIEW_FP=$(curl -s --max-time 20 "$PREVIEW_APP" | grep -oE '/assets/main-[A-Za-z0-9_-]+\.js' | head -1)
log "live fingerprint: ${LIVE_FP:-unknown} preview: ${PREVIEW_FP:-unknown}"

# --- 4. Playwright suites ------------------------------------------------------
suite() { # name config targetenv timeout_s
  local name=$1 cfg=$2 tenv=$3 tmo=$4 logf="$QADIR/suites/$1.log"
  log "suite $name start (timeout ${tmo}s)"
  ( cd "$REPO" && timeout "$tmo" env "$tenv" bun x playwright test --config "$cfg" ) >"$logf" 2>&1
  local rc=$?
  if [ $rc -eq 0 ]; then
    SUITES["suite:$name"]=pass
    log "suite $name PASS"
  else
    SUITES["suite:$name"]="fail(rc=$rc)"
    note_fail "suite $name failed (rc=$rc, log: suites/$name.log)"
    log "suite $name FAIL rc=$rc"
  fi
}

if [ "$RUN_SUITES" = 1 ]; then
  # webkit/journal suites import the seed compiler, which needs built workspace packages
  # (CI runs `bun run build:packages:runtime` before every E2E job).
  if [ ! -f "$REPO/packages/lang/dist/index.mjs" ]; then
    log "workspace dist missing - building runtime packages"
    ( cd "$REPO" && bun run build:packages:runtime ) >>"$QADIR/suites/build.log" 2>&1 \
      || { log "FATAL: build:packages:runtime failed (see suites/build.log)"; exit 2; }
  fi
  suite smoke playwright.smoke.config.ts "E2E_APP_URL=$PREVIEW_APP" 1200
  suite storybook playwright.storybook.config.ts "STORYBOOK_URL=$PREVIEW_STORY" 1200
  suite webkit playwright.webkit.config.ts "E2E_APP_URL=$PREVIEW_APP" 1800
  if [ "$FULL" = 1 ]; then
    suite journal playwright.journal.config.ts "E2E_APP_URL=$PREVIEW_APP" 5400
  fi
fi

# --- 5. Dogfood ledger cross-check ---------------------------------------------
LEDGER_MD=""
if [ -f "$LEDGER" ]; then
  LEDGER_MD=$(python3 - "$LEDGER" <<'PY'
import json, sys, collections
d = json.load(open(sys.argv[1]))
items = d if isinstance(d, list) else d.get('issues', [])
if isinstance(items, dict):
    items = list(items.values())
c = collections.Counter((i.get('severity'), i.get('status')) for i in items)
open_hi = [i for i in items if i.get('status') == 'open' and i.get('severity') in ('high', 'critical')]
resolved = [i for i in items if i.get('status') == 'resolved']
print(f"Ledger: {len(items)} issues; open: " + ", ".join(
    f"{s}={n}" for (s, st), n in sorted(c.items()) if st == 'open'))
print()
print(f"### Open High/Critical needing retest on preview ({len(open_hi)})")
for i in sorted(open_hi, key=lambda x: x.get('severity') != 'critical'):
    print(f"- {i['id']} [{i['severity']}] {i['title'][:120]}")
print()
print(f"### Resolved claims to verify shipped ({len(resolved)} latest listed)")
for i in sorted(resolved, key=lambda x: x.get('id', ''))[-15:]:
    print(f"- {i['id']} [{i['severity']}] resolved in {i.get('resolved_in_run', i.get('resolved_in_session', '?'))}: {i['title'][:100]}")
PY
)
else
  LEDGER_MD="Ledger missing at $LEDGER"
fi

# --- 6. Verdict ----------------------------------------------------------------
if [ ${#REASONS[@]} -eq 0 ]; then
  VERDICT=PASS
else
  VERDICT=FAIL
fi

{
  echo "# QA gate report - $SHORT"
  echo
  echo "- Run: $(ts)"
  echo "- Release commit: \`$SHA\`"
  echo "- Verdict: **$VERDICT**"
  echo "- gh access: $([ "$GH_OK" = 1 ] && echo yes || echo 'no (advisory only)')"
  echo "- Live fingerprint: ${LIVE_FP:-unknown}"
  echo "- Preview fingerprint: ${PREVIEW_FP:-unknown}"
  echo
  echo "## Environment"
  echo
  for k in "${!SUITES[@]}"; do
    case "$k" in env:*) echo "- ${k#env:}: ${SUITES[$k]}" ;; esac
  done
  echo
  echo "## Suites"
  echo
  if [ "$RUN_SUITES" = 1 ]; then
    for k in "${!SUITES[@]}"; do
      case "$k" in suite:*) echo "- ${k#suite:}: ${SUITES[$k]}" ;; esac
    done
  else
    echo "- skipped (--skip-suites)"
  fi
  echo
  if [ ${#REASONS[@]} -gt 0 ]; then
    echo "## Blocking reasons"
    echo
    for r in "${REASONS[@]}"; do echo "- $r"; done
    echo
  fi
  echo "## Dogfood ledger"
  echo
  echo "$LEDGER_MD"
} >"$REPORT"

printf '{"run":"%s","sha":"%s","verdict":"%s","gh":%s,"reasons":%s}\n' \
  "$(ts)" "$SHA" "$VERDICT" "$GH_OK" "$(printf '%s\n' "${REASONS[@]:-}" | python3 -c 'import json,sys; print(json.dumps([l for l in sys.stdin.read().splitlines() if l]))')" \
  >>"$HISTORY"

# --- 7. GitHub side effects ----------------------------------------------------
if [ "$GH_OK" = 1 ] && [ "$WRITE_STATUS" = 1 ]; then
  if [ "$VERDICT" = PASS ]; then
    gh api "repos/bitcobblers/wod-wiki/statuses/$SHA" \
      -f state=success -f context=e2e/main-staging \
      -f description="Staging E2E + dogfood ledger check passed" >/dev/null \
      && log "commit status recorded: success" || log "WARNING: status write failed"
    if ! gh api "repos/bitcobblers/wod-wiki/git/ref/tags/qa-blessed-$SHORT" >/dev/null 2>&1; then
      gh api repos/bitcobblers/wod-wiki/git/refs -X POST \
        -f ref="refs/tags/qa-blessed-$SHORT" -f sha="$SHA" >/dev/null \
        && log "blessing tag qa-blessed-$SHORT created" || log "WARNING: tag write failed"
    fi
  else
    gh api "repos/bitcobblers/wod-wiki/statuses/$SHA" \
      -f state=failure -f context=e2e/main-staging \
      -f description="QA gate blocked: ${REASONS[0]:0:100}" >/dev/null \
      && log "commit status recorded: failure" || log "WARNING: status write failed"
    gh label create qa-gate -R bitcobblers/wod-wiki \
      --description "Blocking issue opened by helios QA readiness gate" \
      --color D93F0B --force >/dev/null 2>&1 || true
    gh issue create -R bitcobblers/wod-wiki \
      --title "QA gate blocked main $SHORT" \
      --label qa-gate \
      --body "$(printf 'QA gate verdict FAIL for `%s`.\n\n' "$SHA"; printf -- '- %s\n' "${REASONS[@]}"; echo; echo "Report: /srv/nfs/helios/dogfood/wod-wiki/qa-gate/qa-report.md")" \
      >>"$QADIR/issue-create.log" 2>&1 && log "blocking issue opened" || log "WARNING: issue create failed (details: $QADIR/issue-create.log)"
  fi
else
  log "no gh writes (read-only mode)"
fi

log "verdict: $VERDICT (report: $REPORT)"
[ "$VERDICT" = PASS ] && exit 0 || exit 1
