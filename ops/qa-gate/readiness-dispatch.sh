#!/usr/bin/env bash
# Drain readiness triggers enqueued by the files `build-changes` receiver
# handler into the shared spool queue. Started by the wod-readiness.path
# systemd unit whenever the queue directory changes — push driven, no polling.
# Each trigger runs exactly one qa-readiness.sh assessment for the diff's
# build SHA; assessed, unknown, or malformed triggers are archived instead.
# Archive: qa-gate/triggers/  Log: journal (stdout) + qa-gate/readiness-run.log
set -uo pipefail
shopt -s nullglob

DOG=/srv/nfs/helios/dogfood/wod-wiki
QADIR=$DOG/qa-gate
QUEUE=/srv/nfs/helios/docker-shared/files/spool/queue
REPO=/srv/nfs/helios/docker-shared/repos/wod-wiki
ARCHIVE=$QADIR/triggers
MAX_WAIT=${MAX_WAIT:-14400}
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[readiness-dispatch $(ts)] $*"; }

field() { # field <json file> <key>
  python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2],""))' "$1" "$2" 2>/dev/null
}

finish() { # finish <trigger id> <suffix> <diff path>
  mv "$QUEUE/$1.json" "$ARCHIVE/$1.$2.json" 2>/dev/null || true
  if [ -n "${3:-}" ] && [ -e "$3" ]; then mv "$3" "$ARCHIVE/" 2>/dev/null || true; fi
}

mkdir -p "$ARCHIVE"
git -C "$REPO" fetch -q origin main || { log "FATAL: git fetch origin main failed"; exit 2; }
git -C "$REPO" fetch -q --tags origin || true
ORIGIN_MAIN=$(git -C "$REPO" rev-parse -q --verify origin/main 2>/dev/null) \
  || { log "FATAL: origin/main missing in $REPO"; exit 2; }

deadline=$(( $(date +%s) + MAX_WAIT ))
ran=0
skipped=0

while :; do
  files=("$QUEUE"/*.json)
  [ ${#files[@]} -eq 0 ] && break

  for t in "${files[@]}"; do
    id=${t##*/}; id=${id%.json}
    build=$(field "$t" build_commit)
    diff=$(field "$t" diff_file)
    diff=${diff##*/}; [ -n "$diff" ] && diff="$QUEUE/$diff"
    key=$(field "$t" key); key=${key:-$id}

    if [ -z "$build" ]; then
      log "REJECT $id: malformed trigger (key=$key)"
      finish "$id" rejected ""; skipped=$((skipped + 1)); continue
    fi

    full=$(git -C "$REPO" rev-parse -q --verify "$build^{commit}" 2>/dev/null)
    if [ -z "$full" ]; then
      log "REJECT $id: build $build is not a commit in $REPO (key=$key)"
      finish "$id" rejected "$diff"; skipped=$((skipped + 1)); continue
    fi
    short=${full:0:7}

    if grep -q "\"sha\":\"$full\".*\"kind\":\"readiness\"" "$QADIR/history.jsonl" 2>/dev/null; then
      log "SKIP $id: $short already assessed (history.jsonl; key=$key)"
      finish "$id" skipped "$diff"; skipped=$((skipped + 1)); continue
    fi

    if [ "$full" != "$ORIGIN_MAIN" ]; then
      log "WARN $id: $short is not origin/main (${ORIGIN_MAIN:0:7}); staged build may lag"
    fi

    waited=0
    while pgrep -f 'qa-readiness\.sh' >/dev/null 2>&1; do
      if [ "$(date +%s)" -ge "$deadline" ]; then
        log "FATAL: in-flight readiness run still going after MAX_WAIT=${MAX_WAIT}s; leaving $id queued"
        exit 3
      fi
      [ $((waited % 30)) -eq 0 ] && log "waiting for in-flight readiness run before $short"
      waited=$((waited + 1)); sleep 20
    done

    log "START $short (trigger $id, key $key)"
    "$QADIR/qa-readiness.sh" "$full" >>"$QADIR/readiness-run.log" 2>&1
    rc=$?
    verdict=$(sed -n 's/^- Verdict: \*\*\(.*\)\*\*/\1/p' "$QADIR/readiness-report.md" 2>/dev/null | head -1)
    log "DONE $short rc=$rc verdict=${verdict:-unknown}"

    finish "$id" done "$diff"
    ran=$((ran + 1))
  done
done

log "queue drained: ran=$ran skipped=$skipped"
