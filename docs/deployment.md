# Production deployment flow

## Goal

Pull requests deploy isolated previews. A successful push to `main` is the
production release: it deploys GitHub Pages at `https://wod.wiki`, creates the
version tag and GitHub release, and runs smoke tests against the live site.

## Flow

| Event | Workflow | Does |
|---|---|---|
| PR opened/updated | `pull-request.yml` | verify → S3 preview `<slug>.preview.wod.wiki` → live preview E2E |
| PR closed | `pull-request.yml` | delete the S3 preview and invalidate its cache |
| Merge/push to `main` | `main.yml` → `_release.yml` | verify → compute version → deploy Pages → create tag/release → smoke E2E against `https://wod.wiki` |

PR previews remain read-only with respect to release tags and package versions.
Production version bumps use the existing Conventional Commits rules; the
build component is the GitHub Actions run number.

## Invariants

- `main` is the only production deployment trigger.
- Pull requests do not deploy to `wod.wiki`.
- PR previews are destroyed when the PR closes or merges.
- A tag already pointing at the current SHA is safe to re-run; a tag pointing
  elsewhere fails rather than moving a release marker.

The `prod` branch promotion workflow is retired. Branch protection should
therefore treat `main` as the required reviewed release path.

Out of scope: preview URL naming, CloudFront/S3 layout, and `_verify.yml` internals.
