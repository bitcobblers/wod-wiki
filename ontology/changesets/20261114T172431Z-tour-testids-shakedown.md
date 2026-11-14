# Ontology Changeset: `20261114T172431Z-tour-testids-shakedown`

- **Status**: `applied`
- **Slug**: `tour-testids-shakedown`
- **Author**: `serge`
- **Created**: `2026-11-14T17:24:31.583Z`
- **Base Ref**: `main`

## Impact Analysis

2 changed file(s) impacting ontology/app/, ontology/bridge/, ontology/code/

### Affected Ontology Modules
- `ontology/app/`
- `ontology/bridge/`
- `ontology/code/`

### Affected Code Targets
- `apps/playground/src/lib/routes.ts`
- `apps/playground/src/lib/testIds.ts`
- `e2e/contracts/TestIdContract.ts`

## Changed Files

- [M] `apps/playground/app/tour/HomeTour.tsx` (`routes`)
- [M] `apps/playground/src/lib/testIds.ts` (`test_ids`) — +symbols: TestId; +testIds: home-tour, tour-captions, tour-chapter-picker, tour-footer, tour-hero, tour-hero-reset-shared, tour-insights, tour-insights-empty, tour-insights-impatience, tour-insights-reaction, tour-insights-run, tour-insights-timeline, tour-jump-section, tour-learn, tour-pane-back-to-editor, tour-ring, tour-run-button-region, tour-scroll-hint, tour-section-editor, tour-section-insights, tour-session-dashboard, tour-session-dashboard-source, tour-sticky-pane, tour-why-video, tour-why-video-skip, tour-why-watch-again, tour-wod-block-region

## Proposed Triple Counts

- `:domain`: +0 / -0
- `:code`: +30 / -0
- `:bridge`: +0 / -0

## Approval & Apply Workflow

```bash
# 1. Review ontology/changesets/20261114T172431Z-tour-testids-shakedown.trig and approve:
bun run ontology:changeset approve 20261114T172431Z-tour-testids-shakedown

# 2. Apply approved changeset into canonical ontology/bridge:
bun run ontology:changeset apply 20261114T172431Z-tour-testids-shakedown
```
