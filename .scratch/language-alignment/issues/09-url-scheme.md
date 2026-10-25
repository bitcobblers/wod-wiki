# 09: The URL scheme — spelled-out prefixes, one per concept

**What to build:** Every URL in the app says which concept it addresses and whether it is one thing or many. `/notebook/crossfit-girls` is one notebook. `/notebooks` is the list of them. `/note/{uuid}` is one note. `/day/2026-01-12` is one day across notebooks. `/page/guide-wql` is one page. `/t/domain/running` is one tag of one type. `/feed/seed-crossfit` is one source. `/equipment/barbell` is one equipment item.

The old paths go away rather than redirecting — there is no backwards-compatibility shim, so the canonical shapes are the only shapes.

**Blocked by:** 05 (the notebook plane), 06 (pages), 07 (definitions are notes), 08 (the WQL planes — the list pages render query output).

**Status:** ready-for-agent

**Validate code**

```
bun run test
bun run test:components
bun run test:playground
bun x tsc --noEmit -p tsconfig.json 2>&1 | rg -c "error" || true   # no NEW errors
bun run test:e2e
```

**Additional areas impacted**

- `apps/playground/app/lib/routes.ts` — the route pattern table, every path builder, and the redirect matrix. The matrix is replaced rather than extended: the legacy aliases stop existing.
- `apps/playground/app/App.tsx` — the route registrations and the redirect components (`CollectionsRedirect`, `CollectionItemRedirect`, `EffortRedirect`, `NotePlaygroundRedirect`, `WorkoutRedirect`, `ResultsRedirect`, `DashboardLandingRedirect`, `ExplorerRedirect`). The ones for retired paths are deleted.
- `apps/playground/app/lib/entryActions.ts` — the route builders that turn entries into links; every one of them changes.
- `apps/playground/app/lib/directRouteMounting.ts` — **retired**; its route→default-query job moved to the stream profiles, and only its cutover test remains.
- `apps/playground/app/lib/routeView.ts` — derives the page kind from a pathname; every path prefix it recognises changes.
- `apps/playground/app/lib/DocumentTitleSync.tsx` — the route→title map. Today `/catalogs` shows the title "Notebooks" and `/feeds` shows "Notes" while their paths say otherwise; under the new scheme the title and the path agree.
- `apps/playground/app/views/stream/streamProfile.ts` — one profile per list route, each carrying its default query. New routes need profiles; renamed ones need theirs re-bound.
- `apps/playground/app/nav/appNavTree.ts` — the L1/L2 nav tree and the `isActive` predicates, which match on path prefixes.
- `apps/playground/app/pages/` — the per-surface pages: `FeedDetailPage`, `FeedItemPage`, `CollectionDatePage`, `NoteByIdPage`, `JournalPage`, `JournalDatePage`, `EffortDetailPage`, `EquipmentDetailPage`, `DashboardViewPage`, `CatalogsManagerDrawer`, `TagsPage`.
- `packages/wql/src/QueryService.ts` and `packages/ui/src/blocks/QueryBlockView.tsx` — links generated inside query results point at the concept's own prefix.
- `packages/lang/src/effort-registry/` — the runtime resolves an effort reference to a link; that link's shape changes.
- `docs/prototypes/seed-data-unification.md`, `docs/screens/`, `docs/app/screens-and-workflow.md` — user-facing docs that show routes.
- `e2e/` — the acceptance specs address routes directly; every spec that navigates by URL changes.
- **Drift:** the canvas guide routes are declared in the corpus frontmatter (`route:`) and consumed by `canvasRoutes.ts`, not by the route table. The guide routes are therefore corpus data — under the new scheme each guide page's route becomes `/page/{guide-*}` and the corpus has to say so.
- **Drift:** the entry mapper's corpus-note branches produce links for effort, equipment and dashboard notes (they open at `/e/<slug>` and `/d/<slug>` today). Those links change with the prefix rename.
- **Drift:** `groupByOptions.ts` validation runs over stored per-route query config. A route rename changes the route key the config is stored under, so saved query settings for a renamed route must survive the rename.

- [ ] Each concept has one direct-rendering route and one library list route, and they are distinguishable by depth.
- [ ] The old paths no longer resolve, and no redirect is left behind for them.
- [ ] A page's list route exists and can create pages, and a page is listed the same way every other concept is.
- [ ] Every link generated inside a query result points at the concept's own prefix.
- [ ] The route title matches the route path everywhere — no route displays a title that names a different concept.
- [ ] A saved per-route query configuration survives the route rename.
- [ ] The corpus-declared guide routes resolve to the new page prefix.
- [ ] The full test suite, type check and e2e acceptance suite are green.
