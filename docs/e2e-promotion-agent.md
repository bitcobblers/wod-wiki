# E2E Promotion Agent Instructions

This document defines the exact procedure for the external E2E validation agent that tests staged `main` builds on S3 (`https://main.preview.wod.wiki` and `https://main.story.wod.wiki`) and either **promotes** the commit to production (`prod` tag) or **fails** it.

Related: [deployment.md](./deployment.md)

## Overview

1. `main.yml` builds, verifies, uploads `packages-dist` + `playground-dist` artifacts (7-day retention), and deploys to S3 staging.
2. **This agent** runs E2E validation against the S3 staging endpoints for the `main.yml` commit SHA (`$SHA`).
3. **On PASS**: the agent marks `$SHA` as `success` and tags `$SHA` as `prod` via `gh`, triggering `deploy-prod.yml` (npm `@bitcobblers/*`, GitHub Pages `https://wod.wiki`, and GitHub Release).
4. **On FAIL**: the agent does **not** tag `prod`, marks `$SHA` as `failure` via `gh`, records the failure details, and exits non-zero.

---

## Step 1 — Resolve the `main` commit to validate

Query the latest completed `main.yml` workflow run:

```bash
RUN_JSON=$(gh run list \
  --workflow main.yml \
  --branch main \
  --limit 1 \
  --json databaseId,headSha,status,conclusion,url)

RUN_ID=$(echo "$RUN_JSON" | jq -r '.[0].databaseId')
SHA=$(echo "$RUN_JSON" | jq -r '.[0].headSha')
STATUS=$(echo "$RUN_JSON" | jq -r '.[0].status')
CONCLUSION=$(echo "$RUN_JSON" | jq -r '.[0].conclusion')

if [ "$STATUS" != "completed" ] || [ "$CONCLUSION" != "success" ]; then
  echo "Latest main.yml run ($RUN_ID) is not green: status=$STATUS conclusion=$CONCLUSION"
  exit 1
fi

echo "Validating main commit $SHA (main.yml run $RUN_ID)"
```

Verify the S3 staging endpoints are reachable before running Playwright:

```bash
curl -fsS https://main.preview.wod.wiki >/dev/null
curl -fsS https://main.story.wod.wiki >/dev/null
```

---

## Step 2 — Run the E2E validation suites

Check out `$SHA` and prepare the runtime workspace packages:

```bash
git fetch origin main
git checkout "$SHA"
bun install
bun run build:packages:runtime
```

Run the E2E suites against S3 staging (matching `.github/workflows/preview-e2e.yml`):

```bash
# 1. Playground full E2E suite
CI=true E2E_APP_URL=https://main.preview.wod.wiki \
  bun x playwright test --config playwright.journal.config.ts

# 2. Playground smoke suite
CI=true E2E_APP_URL=https://main.preview.wod.wiki \
  bun run test:e2e:smoke

# 3. Storybook smoke suite
CI=true STORYBOOK_URL=https://main.story.wod.wiki \
  bun x playwright test --config playwright.storybook.config.ts

# 4. WebKit cross-browser smoke suite
CI=true E2E_APP_URL=https://main.preview.wod.wiki \
  bun x playwright test --config playwright.webkit.config.ts
```

> **Note:** All four commands must exit `0` for the commit to pass.

---

## Step 3A — On PASS: Mark commit valid and tag `prod`

When all E2E suites pass:

1. Report a passing commit status on `$SHA`:

   ```bash
   gh api "repos/{owner}/{repo}/statuses/${SHA}" \
     -f state=success \
     -f context="e2e/main-staging" \
     -f description="S3 staging E2E passed (run ${RUN_ID})"
   ```

2. Tag `$SHA` with `prod` (triggers `.github/workflows/deploy-prod.yml`):

   ```bash
   if gh api "repos/{owner}/{repo}/git/ref/tags/prod" >/dev/null 2>&1; then
     gh api "repos/{owner}/{repo}/git/refs/tags/prod" \
       -X PATCH \
       -f sha="${SHA}" \
       -F force=true
   else
     gh api "repos/{owner}/{repo}/git/refs" \
       -X POST \
       -f ref="refs/tags/prod" \
       -f sha="${SHA}"
   fi
   ```

   *(Alternative immutable tag format also accepted by `deploy-prod.yml`: `refs/tags/prod-${SHA:0:7}`.)*

3. Confirm `deploy-prod.yml` was triggered:

   ```bash
   gh run list --workflow deploy-prod.yml --limit 3
   ```

---

## Step 3B — On FAIL: Block `prod` and report failure

When any E2E suite fails:

1. **Do NOT** create or update any `prod` or `prod-*` tag.
2. Report a failing commit status on `$SHA`:

   ```bash
   gh api "repos/{owner}/{repo}/statuses/${SHA}" \
     -f state=failure \
     -f context="e2e/main-staging" \
     -f description="S3 staging E2E failed — prod promotion blocked"
   ```

3. Open an issue (or notify) with the failing suite output and commit SHA:

   ```bash
   gh issue create \
     --title "Main staging E2E failed (${SHA:0:7})" \
     --body "E2E validation failed for commit \`${SHA}\` (main.yml run \`${RUN_ID}\`). Production promotion (\`prod\` tag) was blocked."
   ```

4. Exit with a non-zero status code (`exit 1`).

---

## Helios external-agent operational notes

The reference implementation runs on the Helios workstation (`itsme@helios`), nightly plus per staged build:

- Env: `bun` at `~/.bun/bin/bun` (not on default PATH), repo clone `/srv/nfs/helios/docker-shared/repos/wod-wiki`, Playwright browsers via `bun x playwright install chromium webkit` **and** `bun x playwright install-deps webkit`, workspace packages via `bun run build:packages:runtime`.
- Scripts (`/srv/nfs/helios/dogfood/wod-wiki/qa-gate/`): `qa-gate.sh` (nightly advisory E2E + ledger check) and `qa-readiness.sh` (promotion verdict: the four suites above plus a quick dogfood on the domains touched since the last release tag, and a critical-findings check). On PASS it writes `e2e/main-staging=success` and **moves the `prod` tag**; on FAIL it writes `failure` and opens a labeled issue. Verdicts are append-only in `history.jsonl`.
- Suite strategy: smoke + storybook + webkit run on every assessment (~6 min on an SBC); the full journal suite runs nightly through the same agent or on demand — CI `preview-e2e.yml` shards remain the reference full-journal run.
- Quick dogfood: domains derived from `git log <last release tag>..<SHA>` path matching (journal/notebooks/runtime/properties/analytics/feeds), smoke missions against `main.preview.wod.wiki`. Any `severity: Critical` finding blocks promotion; deploy/CI-only diffs skip the dogfood phase.
- `deploy-prod.yml` additionally requires the `e2e/main-staging=success` status before publishing (defense in depth against a manual `prod` tag); `workflow_dispatch` with `force: true` bypasses the check for emergencies.
- Reports are served read-only at `https://qa.forest-adhara.ts.net/qa-gate/` (`qa-report.md`, `readiness-report.md`, `history.jsonl`).
