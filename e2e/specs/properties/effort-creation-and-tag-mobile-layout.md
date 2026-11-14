---
domain: properties
specFile: e2e/live-app/effort-creation-and-tag-mobile-layout.e2e.ts
routes: [/efforts, /effort/:slug, /t/:type/:tag, /notebook/:slug]
personas: [Athlete, Coach]
viewports: [desktop, mobile-375]
priority: P1-core
---

# PRP-03 — Effort Creation Immediate Resolution, WQL Syntax Guidance & Mobile Tag Layout

Newly created `Effort` definitions resolve immediately on `/effort/:slug` without requiring a full page reload, malformed WQL input on stream bars surfaces actionable `:effort{text:...}` syntax guidance, `/t/:type/:tag` drill-down views fit `375×812` mobile viewports with zero horizontal overflow, and unknown `/notebook/:slug` deep links render an explicit not-found recovery state.

### Scenario 1: Newly created Effort resolves immediately on detail route and invalid WQL displays syntax guidance

Given a hydrated Playground workspace on `/efforts`:

1. Athlete opens `/efforts`, enters plain-text `kettlebell` into the WQL bar, then enters malformed `:effort{oops`, and reads the query status strip.
2. Athlete opens the New Entry dialog (`+ Add`), selects Catalog -> Effort, enters `QA Turkish Get Up`, and clicks Create.
- expect: Step 1 resolves plain-text `kettlebell` via `:effort{text:kettlebell}` fallback (18 results), and for malformed `:effort{oops` keeps previous results visible while displaying `'Invalid query — showing previous results'` alongside an actionable `:effort{text:...}` syntax hint.
- expect: Step 2 navigates to `/effort/qa-turkish-get-up` and immediately renders the `'QA Turkish Get Up'` Effort detail page without `'not found'` or requiring a hard reload.
- expect: the browser console stays clean.

### Scenario 2: Mobile tag drill-down has zero horizontal overflow, synthesized tonnage widget renders cleanly, and unknown notebook slug shows explicit not-found state

Given a `375×812` mobile viewport:

1. Athlete opens `/t/quality/strength` at `375×812` and inspects page scroll width and the `#tags-new` form, then opens `/t/tag/tonnage` and inspects its synthesized `Dashboard Widget` preview.
2. Athlete opens `/notebook/does-not-exist-qa` and inspects the stream empty state.
- expect: Step 1 renders `/t/quality/strength` with zero horizontal overflow (`scrollWidth <= clientWidth + 1`) and renders `/t/tag/tonnage` with a live `.cm-query-block-preview` widget and zero query syntax errors.
- expect: Step 2 renders an explicit `Notebook “does-not-exist-qa” not found.` state (`notebook-not-found`) with a recovery action to `/notebooks` and no active `+ Add Note` button.
- expect: the browser console stays clean.
