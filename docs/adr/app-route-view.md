# ADR-0001: App route view and stream composition

Status: accepted (records decisions already implemented on `wql-fix` —
commits bfcd3cca, 2628347f, 14e1b9d0)

## Context

Playground routes were classified and rendered ad hoc: AppContent held a
render ternary, every call site hand-built record URLs, list surfaces were a
hardcoded path list, and the same view variations (which secondary rail, which
default query, which empty message) were re-derived per page. Rebranding a
route for a different note type meant touching many files. Target scheme and
link rules: [../link-crosswalk.md](../link-crosswalk.md) and
[../playground-routes.md](../playground-routes.md).

## Decisions

1. **Pure classification.** `routeView.resolveRouteView` is a pure function
   (pathname + params + injected data → view). `useRouteView` is its React
   adapter. AppContent maps `PageKind → element` through a `renderInner`
   record; no routing logic lives in JSX closures.

2. **Stream composition via profiles.** A stream surface is fully declared by
   a `StreamProfile` in `views/stream/streamProfile.ts`: route, default WQL,
   entity level, type options, shelf, empty message, **secondary rail**
   (`secondary?: MenuSpec`), and **display title**. `QueriableStreamView`
   renders any of them. Adding or rebranding a stream route = adding a
   profile; no view code changes.

3. **One stream registry.** `isStreamRoute` (streamProfile) is the single
   membership test `routeView.derivePage` consults for the `library` page
   kind — routeView keeps no parallel path list. `streamRouteTitle` is
   similarly the single source for stream display names in `deriveWorkout`.

4. **Secondary rails are profile-owned.** AppContent renders
   `profile.secondary`; no page-level constant invents a rail. Surfaces
   declare variations (sessions and playgrounds have their own rails).

5. **Storage ids and route slugs stay separate.** `Entry.id` and `noteId`
   retain the owning note identity. `pageId` is the Page UUID; `pageSlug`
   addresses named pages at `/page/:slug`. Search resolves named membership
   through `page_notes`, skipping calendar pages. Plain notes fall back to
   `/note/:noteId`. Collection routes use declared `sourceId` or imported
   `sourcePath`, not UUIDs: `/notebook/:catalog` for landings and
   `/notebook/:catalog/:item` for workouts. Block results preserve section anchors.

6. **Redirect components, not scattered literals.** Each retired path family
   has one Navigate component in `lib/routeRedirects.tsx`, mounted in the App
   route table. `lib/routes.ts` (pure, no React) keeps patterns, builders, and
   the legacy resolveRedirect matrix; nav derivation lives in
   `lib/routeNav.ts`.

7. **Unmatched routes stay visible.** The route table always mounts a wildcard.
   Before the seeded root exists, it shows loading or re-seed recovery; after
   the root is available, it shows `NotFoundPage` with home navigation.
   Explicit note routes retain their own missing-note state.

## Consequences

- New stream surface = profile + route pattern; classification, membership,
  title, and secondary follow from the profile.
- Old paths keep working through redirects; behavior changes land in one
  component each.
- UUID-keyed collection members remain notes, not catalog landings. The
  catalog projection derives grouping and landing status from source routes.
- Runtime results from named pages retain the loaded note UUID, not the
  presentation slug.
