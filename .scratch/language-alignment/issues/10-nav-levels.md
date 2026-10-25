# 10: The navigation ladder — L1 list, L2 thing, L3 place

**What to build:** The sidebar is derived from the route scheme instead of duplicating it. L1 is a library list page — always a bare plural, always queryable. L2 is one thing — always a singular prefix plus a slug. L3 is a place inside that thing — a note, a day, a page, a section anchor. The sidebar's labels *are* the list route names, so the nav can no longer disagree with the URL.

This also retires two L1 zones that are not concepts: "Playgrounds" is a notebook, and "Journal" is a notebook view (its days). Both become views within the notebooks zone rather than sibling zones.

**Blocked by:** 09 (the route scheme — the nav is derived from it).

**Status:** ready-for-agent

**Validate code**

```
bun run test
bun run test:components
bun run test:playground
bun x tsc --noEmit -p tsconfig.json 2>&> | rg -c "error" || true   # no NEW errors
bun run test:e2e
```

**Additional areas impacted**

- `apps/playground/app/nav/appNavTree.ts` — the authoritative L1+L2 tree. Its header comment describes the current structure (L1 zones, L2 panels, L3 injected per route) and its listing-zone spec carries a `scopeOptions` field that names the WQL source scopes each zone queries. Both change: the zones become the list routes, and the scope options follow the new plane vocabulary.
- `apps/playground/app/nav/navTypes.ts` — the `NavItem` shape, including the fixed level-3 marker used by the injected page index.
- `apps/playground/app/nav/NavContext.tsx` — `setL3Items`, the L3 injection seam.
- `apps/playground/app/hooks/usePageScrollSync.ts` — the observer that mirrors the current page's headings into the L3 list. It runs against whatever document is open, so it must keep working for a notebook, a feed, a page, a note and a dashboard alike.
- `apps/playground/app/nav/panels/ConditionsNavPanel.tsx` — the shared L2 panel for the list routes (the query-condition accordion and grouping presets). Every list route uses it, so the new planes' filters have to be expressible in it.
- `apps/playground/app/nav/panels/DashboardsNavPanel.tsx` — the one L2 panel that is bespoke, because dashboards are runtime data.
- `apps/playground/app/nav/AppRail.tsx`, `MenuList.tsx`, `ResponsiveActions.tsx` — the sidebar surfaces that render the tree.
- `apps/playground/app/views/stream/QueriableStreamView.tsx` — the shared list-page renderer, and the place where "the current-result `{}` condition accordion plus grouping presets over the CURRENT query" live.
- `apps/playground/app/lib/routeWqlConfig.ts` — the per-route saved query configuration, keyed by route path. A nav rebuild that renames routes must not orphan a user's saved settings.
- **Drift:** `groupByOptions.ts` documents that a stored favourites list is a *priority* list, not a filter, and that an absent list means "no preferences" while an explicitly stored empty list means the same — so the surface keeps its level default. The nav's grouping presets are one of the four consumers of that vocabulary, and they must keep agreeing with the list pages' own pickers.
- **Drift:** the home page's guide children are derived from the seeded canvas routes, so the L2 under Home changes with the guide-route rename in the URL ticket.

- [ ] Every L1 zone is a library list route, and its label is that route's name.
- [ ] Every L2 entry is one thing, reachable at its own route, and the tree's active state follows the route.
- [ ] L3 remains the injected page index for whatever document is open, for every kind of document.
- [ ] The "Playgrounds" and "Journal" zones are no longer sibling concepts; they are views within the notebooks zone.
- [ ] The list pages' grouping presets and the nav's grouping presets offer the same dimensions.
- [ ] A user's saved per-route query configuration survives the nav rebuild.
- [ ] The full test suite, type check and e2e acceptance suite are green.
