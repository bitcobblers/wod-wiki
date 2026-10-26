# ADR 0004: Bundle-owned Home Route

**Status:** Accepted
**Date:** 2026-10-24
**Design source:** `docs/prototypes/playground-home-cold-boot-decoupling.md`

## Context

The playground's `/` route used to be derived from the seeded canvas corpus. On a fresh browser, that made the home page wait for the seed manifest and chunks, the IndexedDB import, a full notes read-back, and canvas-page parsing. The 2026-10-25 UX retest measured a 34–35 second cold start. The visible home page was already hardcoded React; only its quests and a small set of demo documents came from the corpus.

## Decision

1. **`/` is an explicit, bundle-owned route.** `App.tsx` registers it before the wildcard, `routeView` classifies it as `home` before canvas classification, and `buildCanvasRoutes` no longer emits a `/` route. Corpus presence cannot change the home page kind, shell, title, or nav.
2. **The Home Slice is compiled into the bundle.** `app/canvas/homeSlice.ts` imports `markdown/canvas/home/README.md` and its referenced demo documents with Vite `?raw` imports, then exposes `HOME_PAGE` and `HOME_DOCS`. Markdown remains the content source; the browser performs no runtime file or IndexedDB read for this content. `HomeView` and `SyntaxView` consume the same slice.
3. **The seed pipeline is background work for Home.** Boot sync, IndexedDB import, corpus hydration, tag loading, and registry hydration are unchanged. Only `markdown/canvas/home/README.md` is excluded from the playground's compiled seed. `welcome-1.md` and `sample-script.md` remain seeded for guide consumers, and Storybook continues to compile the full corpus.
4. **Progress is phase-specific.** The static HTML shell reports `Downloading the app shell…`; storage startup reports `Opening local library…`; corpus-gated deep links report the live feed phase and counts. `feed:start`, `home:first-paint`, `corpus:ready`, and `feed:settled` are emitted as performance marks and mirrored onto the document element for e2e diagnostics.

## Consequences

- Home renders with an empty IndexedDB and while the seed import is still running. Corpus-backed routes still wait for the corpus.
- The old governance test that forbade a hardcoded `/` route is replaced by behavioral ownership tests. The route table contains no `/`; Home has exactly one owner.
- Home content changes ship with the app build. The baked slice and the seed are produced from the same `markdown/` tree in that build.
- Production cold-boot e2e coverage enforces meaningful progress under 1 second and usable Home under 5 seconds, including 4× CPU slowdown and 10 Mbps / 40 ms networking with cache disabled.
- The compiler's `excludePaths` option filters both chunk rows and the derived block index, so excluded content cannot re-enter through a second scan.
