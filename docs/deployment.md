# Production deployment flow

## Goal

Pull requests deploy isolated previews and run full E2E verification.
A push to `main` builds, verifies, generates release artifacts (`packages-dist` and `playground-dist`), and stages Playground + Storybook to S3 (`https://main.preview.wod.wiki` and `https://main.story.wod.wiki`).
E2E testing on `main` is executed externally against the S3 staging environment. Once external E2E passes, tagging the commit `prod` triggers `deploy-prod.yml`, which promotes the staged artifacts to GitHub Pages (`https://wod.wiki`) and npm (`@bitcobblers/*`) and creates the version tag and GitHub release.

## Flow

| Event | Workflow | Does |
|---|---|---|
| PR opened/updated | `pull-request.yml` | verify → S3 preview `<slug>.preview.wod.wiki` + `<slug>.story.wod.wiki` → live preview E2E |
| PR closed | `pull-request.yml` | delete the S3 preview and invalidate its cache |
| Merge/push to `main` | `main.yml` | compute version → verify & upload `packages-dist` → build & upload `playground-dist` → stage Playground & Storybook to S3 |
| Tag `prod` (or `prod-*` / `prod/*`) | `deploy-prod.yml` → `_publish.yml` | resolve `main.yml` artifacts → publish npm `@bitcobblers/*` + GitHub Pages (`https://wod.wiki`) → create `v<version>` tag/release |

PR previews remain read-only with respect to release tags and package versions.
Production version bumps use the existing Conventional Commits rules; the
build component is the GitHub Actions run number.

## Invariants

- `main` builds and stages all artifacts (`packages-dist`, `playground-dist`, S3 `main` preview/storybook) without running live S3 E2E or publishing to production.
- `prod` tag promotion (`deploy-prod.yml`) is the only production deployment trigger; it reuses the exact artifacts built by `main.yml` for the tagged commit.
- Pull requests do not deploy to `wod.wiki` or npm.
- PR previews are destroyed when the PR closes or merges.
- A version tag (`v<version>`) already pointing at the current SHA is safe to re-run; a tag pointing elsewhere fails rather than moving a release marker.

See [e2e-promotion-agent.md](./e2e-promotion-agent.md) for the external E2E agent validation and `prod` tagging runbook.

Out of scope: preview URL naming, CloudFront/S3 layout, and `_verify.yml` internals.
