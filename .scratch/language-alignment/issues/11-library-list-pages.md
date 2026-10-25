# 11: Every library list page is one query surface

**What to build:** Every list route in the app behaves the same way: it binds a default query, accepts `?q=` to override it, renders the query's output, offers the filters that apply to its plane, produces a shareable URL that reproduces the same list, and links each row to the concept's own route.

Today they are inconsistent. `/tags` accepts no query at all — it renders a hand-rolled list. `/equipment` queries the note plane by source rather than having its own plane. `/journal` groups by date but is not reachable by a query anyone can copy. The inconsistency is what makes the URL scheme feel arbitrary: a list route that isn't query-driven isn't a list route in any meaningful sense.

**Blocked by:** 08 (the WQL planes), 09 (the URL scheme — the list routes are named there), 10 (the nav ladder).

**Status:** ready-for-agent

**Validate code**

```
bun run test
bun run test:components
bun run test:playground
bun run test:storybook
bun x tsc --noEmit -p tsconfig.json 2>&> | rg -c "error" || true   # no NEW errors
bun run test:e2e
```

**Additional areas impacted**

- `apps/playground/app/views/stream/streamProfile.ts` — the profile per route: its default query, its level (which card layout it renders), its scope options, its empty message and its shelf visibility. Every list route has one, and the new routes need profiles.
- `apps/playground/app/views/stream/QueriableStreamView.tsx` — the shared renderer. It already accepts `?q=` and a saved per-route config, with `?q=` beating the default and the saved config beating both.
- `apps/playground/app/hooks/useComposerQueryState.ts` — the precedence chain the renderer uses.
- `apps/playground/app/hooks/useExplorerQueryState.ts` — the explorer variant, used by the dashboards route.
- `apps/playground/app/pages/TagsPage.tsx` — the hand-rolled tag list. It reads `?tag=` and renders its own table; it becomes a query surface like every other list.
- `apps/playground/app/pages/EquipmentDetailPage.tsx` and `EffortDetailPage.tsx` — the detail surfaces; the detail pages are not list pages, but the equipment *list* is.
- `apps/playground/app/lib/wqlLink.ts` — the canonical WQL→host-page map, which decides which surface a query result links to.
- `packages/wql/src/capabilities.ts` — the per-target allowed-clause sets that decide which filters a list page's composer offers.
- `packages/ui/src/blocks/QueryBlockView.tsx` — the shared result renderer for the tables, cards and rows a list page shows.
- `packages/ui/src/composer/queryClauses.ts` — the composer's target descriptions and placeholder text, one set per plane.
- **Drift:** `groupByOptions.ts` names four consumers of the grouping vocabulary — the stream view's checklist, the bare landing's fallback dimension, the per-page query settings dialog, and the stored-favourites validation. Each list page's grouping picker must agree with the others, and a bare landing's fallback dimension is now derived from the route's profile rather than hard-coded per surface.
- **Drift:** the tag plane must expose tag *contributions* (metrics, tags, functions), not just labels. A tag row in a list must show what the tag carries, and the composer's tag filter must not offer a contribution as if it were a label.

- [ ] Every list route binds a default query, accepts `?q=`, and renders the query's output rather than a bespoke list.
- [ ] `/tags` and `/equipment` stop rendering hand-rolled lists and render query output instead.
- [ ] Each list page's composer offers exactly the filters that apply to its plane.
- [ ] The URL that produced a list reproduces it exactly — the query, the filters and the ordering.
- [ ] Each row links to the concept's own direct-rendering route.
- [ ] The grouping pickers across the list pages, the query-settings dialog and the stored favourites all offer the same dimensions.
- [ ] A tag row shows what the tag carries, and a contribution is not offered as a label filter.
- [ ] The full test suite, type check, storybook tests and e2e acceptance suite are green.
