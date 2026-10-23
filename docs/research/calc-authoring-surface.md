# Calc authoring surface: expressiveness today, and reuse for tag-carried functions

Research for [#1099](https://github.com/bitcobblers/wod-wiki/issues/1099) (map #1089). 2026-10-23.
All paths relative to repo root; every claim carries a `file:line` anchor.

## Question

Can a person today author, without writing code, a calculation that sums over records or over the
completed workout — how far does that surface reach — and can it be reused for tag-carried functions?

## TL;DR

1. **In form, yes; in effect, only inside the preview.** Calc lines are a small text DSL authored at
   `/settings/library/calcs` with typeahead, registration-grade static checks, and live preview over a
   fixture workout. Workout-scope sums (`total = sum(reps)`) are squarely expressible. But saved user
   calcs are **never loaded back into the pipeline** — `hydrateUserCalcs`
   (`apps/playground/src/stores/userCalcStore.ts:112`) has zero callers repo-wide — so outside the
   preview only the built-in suite computes.
2. **Store scope (cross-workout rollups) is expressible and seeded but has no production evaluator** (§4).
3. **A tag cannot carry a function today.** `CalculationDefinition` has no attachment axis, `Effort`
   has no calc slots, scope is a global property of the definition; applicability is only
   `when`-predicates + fence filters. The glossary names the missing concept ("Attached Calculation",
   root `CONTEXT.md:190-192`) but nothing implements it (§5).
4. **The UI's editor/diagnostics/preview organisms are reusable for tag configuration; its persistence
   and scope model are not** (§6).

## 1. The definition shape

`packages/lang/src/analytics/calc/types.ts` (57 lines total):

```ts
// types.ts:11
export type CalcScope = 'segment' | 'workout' | 'store';

// types.ts:13-24
export interface CalcNode {
  id: string;
  kind: 'metric' | 'lookup' | 'builtin' | 'wql' | 'expr';
  expression?: string;
  ast?: ExprNode;
  unit?: string;          // named zero-vector casts (AU, pts, MET-min, ratio)
}

// types.ts:26-35
export interface CalcVariant {
  id: string;
  priority: number;       // higher wins; ties broken by registration order (registry.ts:49-51)
  when?: string;          // per-variant applicability predicate
  origin: CalcOrigin;     // 'analyzed' | 'analyzed-estimated' | 'user' (types.ts:10)
  nodes: Record<string, CalcNode>;
  nodeDims?: Record<string, DimVector>;
}

// types.ts:37-57
export interface CalculationDefinition {
  id: string;
  kind: 'output' | 'library';   // output emits facts; library publishes nodes for other calcs
  scope: CalcScope;
  fences?: string[];            // block dialects it applies to, e.g. ['time','log']
  when?: string;                // definition-level applicability predicate
  variants: CalcVariant[];
  output?: {
    nodeId: string | string[];
    key?: string;               // canonical metric key, e.g. 'calc.e1rm'
    emitType?: string; unit?: string;
    isGrouped?: boolean; groupBy?: string[];   // e.g. ['effort']
    publishMetadataNodes?: string[];
    label?: string;
  };
}
```

Seeded example (Epley e1RM, `packages/lang/src/analytics/calc/seeds.ts:89-109`):

```ts
{
  id: 'e1rm', kind: 'output', scope: 'segment', fences: ['time', 'log'],
  when: 'has(reps) and has(resistance) and reps > 0 and resistance > 0',
  variants: [{
    id: 'default', priority: 10, origin: 'analyzed',
    nodes: {
      repFactor: expr('repFactor', 'reps / 30', 'ratio'),       // ratio cast so 1 + reps/30 type-checks
      value: expr('value', 'round(resistance * (1 + repFactor), 1)'),
    },
  }],
  output: { nodeId: 'value', emitType: 'calc.e1rm', key: 'calc.e1rm', unit: 'auto', label: 'Estimated 1RM' },
}
```

## 2. What a non-programmer can express today

### The authoring surface

- **Route**: `/settings/library/calcs` renders `<CalcAuthoringPanel />`
  (`apps/playground/app/App.tsx:191`); a research prototype lives at `/proto/calc-authoring`
  (`App.tsx:175`).
- **The panel** (`apps/playground/src/components/organisms/calc-authoring/CalcAuthoringPanel.tsx`):
  scope pill selector `['segment','workout','store']` (`:29`, default `segment` at `:39`), CM6 editor
  with syntax highlighting + typeahead (header `:2-5`), static diagnostics strip, live preview,
  Save (`:70-80`) / Delete / Load over the user-calc store, and a "Saved user calcs" list. Starter
  template: `segmentVolume = reps * resistance (library) when has(reps) and has(resistance)` (`:40-42`);
  ids derive from the first compiled def or the `name =` LHS (`:31-37`).
- **The line DSL** (`packages/lang/src/analytics/calc/lineform.ts`): two styles — a scope header
  `segment on [time, log] when P: name = …` or a bare `name = …` inheriting the default scope
  (`:44-46`); `SCOPE_RE = /^(segment|workout|store)\b/` (`:39`). The syntax is a superset of the seed
  records: `(library)` markers, `key`/`grouped`/`label`/`emit`/`meta` output clauses, `|` variant sugar
  with optional `estimated` origin, `where` bindings (`:1-17`). Round-trip is a guarantee:
  `compile(print(def))` deep-equals `def` (`:12`), acceptance-tested against all seeds
  (`packages/lang/tests/analytics/lineform.test.ts:92-96`).
- **Vocabulary** (`calc-authoring/calcVocabulary.ts`): functions `convert, lookup, has, round, floor,
  ceil, abs, clamp, min, max, sum, avg, count, last, windowMean, windowSum, windowSd, mean` (`:24-29`);
  segment atoms `elapsed, reps, resistance, distance, effort, effortLabel` (`:32-39`); workout context
  atoms `sessionRpe, session.duration, profile.vo2max` (`:42-46`); lookup tables `effort` (met,
  disciplineFactor, discipline, intensityTier, resolvedFrom), `rpe-labels`, `profile`, `disciplines`
  (`:55-59`); clause words `when, where, key, grouped, label, emit, meta, estimated, library, on, by,
  without` (`:18-21`).
- **Static checks are registration-grade**: diagnostics compile the draft through the real
  `CalculationRegistry` against `BUILTIN_CALCS + STORE_CALCS`
  (`calc-authoring/calcDiagnostics.ts:88-90`); unknown symbols, dimension mismatches, bad convert
  targets, invalid output units fail at registration, never at runtime
  (`packages/lang/src/analytics/calc/registry.ts:1-15`).
- **Live preview** drives the real headless `CalcEngine` over a stored fixture: segment scope shows
  per-segment annotations, workout scope running totals, store scope a fixture series ("last 7 of 28
  fixture days" vs "Fran (fixture)", `CalcPreviewPanel.tsx:1-4,37-38`; backend `calcPreview.ts:1-12`).
- **The prototype** (`apps/playground/app/pages/CalcAuthoringPrototypePage.tsx:1-5`) compared three
  authoring models: `?v=text` (recommended), `?v=slots` (token-slot pills), `?v=guided` (dropdown-only;
  "expected to collapse on TIS"). The shipped panel adopted `text`.
- **Docs**: there is **no authored calc-authoring page** — `markdown/canvas/analytics/` does not exist,
  and no markdown mentions `CalculationDefinition`, "calc authoring", or user calcs (repo grep).
  Nearest neighbors: `markdown/canvas/guide/metrics.md` §calculated (engine-published `calc.*` keys),
  `markdown/canvas/syntax/calculated-metrics.md:9-17` (the runtime ```calculate block — a different,
  document-level feature), `docs/language/wql-reference.md:66` (calc.* as queryable keys). Known UX gap
  on record: typeahead suggests a static effort list, not registry-live (`docs/effort-crosswalk.md:209`).

### Per scope

- **segment** (Tier-1 annotations, per leaf segment): arithmetic over segment atoms with unit
  conversion and dimension checking — pace (`reps / convert(elapsed, min)`), power
  (`reps * resistance / convert(elapsed, s)`), e1RM, %1RM, effort/RPE lookups (`seeds.ts:25-175`).
- **workout** (Tier-2, recompute-all over segment history): sums/averages over records — `sum(reps)`,
  `sum(distance)`, `sum(segmentVolume)` — grouped emission `by {effort}` with
  `without: rest|pause|rest-*` exclusions, variant fallbacks (captured → label-derived → default RPE),
  MET-minutes, session load, TIS (`seeds.ts:177-388`). This answers "sums over records / the completed
  workout": **one line, no code**.
- **store** (cross-workout rollups): WQL-selection nodes (`kind: 'wql'`, e.g.
  `sum:sessionLoad{} by {day}`) feeding trailing-window math (`windowMean(daily, 7d)`); 13 seeded
  outputs — acwr, monotony, strain, ctl/atl/tsb, wellness composites (`seeds.ts:390-618`). Expressible
  and statically checked; **not executable in the app today** (§4).

## 3. Which calc node kinds exist

Declared: `'metric' | 'lookup' | 'builtin' | 'wql' | 'expr'` (`types.ts:15`). Exercised: only `'expr'`
(expression string compiled to AST) and `'wql'` (store-scope WQL selection, `ast.ts:26-27`,
`seeds.ts:397`). `'metric'`, `'lookup'`, `'builtin'` have no construction sites (repo grep) and the
engine evaluates nodes purely via `node.ast` (`engine.ts:275-279`) — dead branches of the union.

## 4. How `scope` is chosen — and what each scope can actually do

**Authored**: the writer picks it — scope header in the line source (`lineform.ts:39,44-46`) or the
panel's pills, defaulting to `segment` (`CalcAuthoringPanel.tsx:29,39`; header-less stored lines
hydrate as segment, `userCalcStore.ts:66-67,119`). It is static on the definition (`types.ts:40`), not
inferred.

**Executed**:
- `CalculationRegistry.byScope(scope)` buckets definitions (`registry.ts:29-31`); the `CalcEngine`
  constructor snapshots segment/workout calcs filtered by the block's fence dialect
  (`engine.ts:67-74`).
- **segment** runs per leaf output statement in `process()` (Phase 1, `engine.ts:78-79`), appending
  annotations with effort/discipline/grade metadata so facts group `by {effort}` / `by {grade}`
  (`engine.ts:84-110`).
- **workout** runs at `summarize()` (Phase 2) recompute-all over accumulated history with grouped
  emission and priority-based variant resolution (`engine.ts:14-18`).
- **store** is not implemented in the engine: "Store scope (Phase 3) lives in the rollup driver
  replacement (#877)" (`engine.ts:20`). Concretely: the evaluator computes `wql` nodes only when the
  context supplies `resolveWql`, else throws "WQL atom … is store-scope only"
  (`evaluator.ts:32-33,48-50`); the only supplier in the repo is a test stub
  (`packages/lang/tests/analytics/evaluator.test.ts:131-134`). The WQL side has a host hook —
  `QueryDocumentRunner` calls `rollupEnsure()` once per document consuming acwr/monotony/strain
  (`packages/wql/src/queryDocumentRunner.ts:84-85,99,133-135`), `DashboardView` accepts an optional
  `onEnsureRollupFacts` prop (`packages/ui/src/widgets/DashboardView.tsx:35-36,281`) — but **no app
  code supplies it** (repo grep: zero suppliers). `calc.acwr` facts exist only in the homepage tour
  fixture via the legacy Foster-window math (`apps/playground/app/tour/homeAnalyticsData.ts:304-308`,
  `apps/playground/src/services/analytics/rollup/workloadRollup.ts:56-95`). WQL pins its target list
  to the seeds by contract test (`packages/wql/src/vocabulary.ts:9-11,70-92`,
  `packages/wql/tests/contract/wql-calc-seeds.test.ts`).

**The user-calc loop is half-wired**: the panel persists raw line-form source
(`userCalcStore.ts:1-11,87-101`) so edits survive compiler changes; hydration compiles stored lines
into registerable records (`:112-126`). The injection seam exists — `createCalcStack` registers
`options.calcs` after the built-ins (`factory.ts:35-38`), fed from `AnalyticsProfileContext.calcs`
(`StandardAnalyticsProfile.ts:50-55` via `createAnalyticsEngineForBlock.ts:69-71`;
`workoutDerivation.ts:50-52,91-95`). **But nothing calls `hydrateUserCalcs`** — repo-wide grep finds
only its definition — so a saved calc never reaches a live workout run; only the authoring preview
evaluates drafts (`calcPreview.ts:96-101`). The panel header comment ("user calcs are injected via the
analytics profile's `calcs`", `CalcAuthoringPanel.tsx:4-5`) describes the designed seam, not a wired
reality.

## 5. What is missing for a tag to carry a function

1. **No attachment axis on the definition.** `CalculationDefinition` (`types.ts:37-57`) carries
   id/kind/scope/fences/when/variants/output — nothing binds it to an effort, tag, or dialect
   instance. `fences` filters by block dialect; `when` is a data predicate. Closest existing behavior:
   effort-identity metadata rides annotations (`engine.ts:84-99`) and calcs branch on
   `lookup("effort", effort, …)` (`seeds.ts:147`) — applicability is still global.
2. **The Effort entity has no calc slots.** `EffortBaseAttributes` is
   met/discipline/disciplineFactor/intensityTier (`packages/lang/src/effort-registry/types.ts:75-84`);
   "calc" appears nowhere in the effort registry except prose ("discipline-factor calculation",
   `:247`). Same for `docs/domain-model/Effort.md`.
3. **Scope is per-definition, not per-consumer** (`types.ts:40`); a tag-carried function needs run
   scope + applicability from the attachment ("The attachment selects where it applies",
   `CONTEXT.md:191`).
4. **The glossary names the concept without an implementation.** "Attached Calculation: a reusable
   custom calculation associated with an Effort or Block Dialect… The attachment selects where it
   applies; the Dialect analyzer itself does not execute the calculation" (`CONTEXT.md:190-192`),
   distinct from read-time "Query Formula" (`:193-195`). No attach field, no attach clause in the DSL
   (`lineform.ts:18-21`), no attach registry exists.
5. **Even the free-floating user-calc path is unwired** (§4): some loader must compile + register
   stored calcs before attachment semantics can matter.
6. **Store scope needs its evaluator** (§4): a production `resolveWql` provider and an app-side
   `rollupEnsure` implementation, or store-scope tag calcs stay paper.

Minimum shape implied by the evidence: an attachment record (effort/tag slug + calc id or inline
line-form + scope), storage on the effort/tag side (the efforts IDB store already exists,
`docs/prototypes/seed-data-unification.md:27`), a registry pass injecting attached calcs per resolved
effort, and predicate-time binding of the `effort` atom to the attached tag.

## 6. Is the authoring UI reusable as-is for tag configuration?

**The organisms: yes.** `CalcAuthoringPanel` is parameterized (`defaultScope`, `initialId`,
`CalcAuthoringPanel.tsx:22-27`) and composes `CalcLineEditor` + `CalcDiagnosticsStrip` +
`CalcPreviewPanel`, which take analysis/scope as data; diagnostics reuse registration-grade checking
(`calcDiagnostics.ts:88-90`), so a tag-configuration surface can embed the same editor + checks +
preview against a different persistence target.

**As-is: no.** Gaps:
- **Persistence**: `userCalcStore` is a flat personal library (`wodwiki-user-calcs` / `user-calc:*`
  meta rows, `userCalcStore.ts:9-11,24`) with no notion of "belongs to effort X"; a tag surface needs
  per-tag records (or frontmatter on the effort page).
- **Attachment selection**: no picker for "which tag(s) this applies to"; scope pills would need
  constraining/deriving from the attachment.
- **Preview fixtures are hardcoded** to Fran and a 28-day wellness fixture
  (`CalcPreviewPanel.tsx:37-38`, `calcPreview.ts:10-12`) — a tag surface should preview against
  workouts containing that effort.
- **Audience**: the shipped surface is a text DSL with typeahead — power-user-ish, not "no code". The
  prototype's slot/guided variants were the form-first answer; guided collapsed on TIS-shaped formulas
  (`CalcAuthoringPrototypePage.tsx:1-5`); slots remain the unexplored middle.

## Sources

`packages/lang/src/analytics/calc/{types,seeds,lineform,registry,engine,factory,evaluator,ast,parser}.ts`;
`apps/playground/src/stores/userCalcStore.ts`; `apps/playground/src/components/organisms/calc-authoring/*`;
`apps/playground/app/App.tsx`; `apps/playground/app/pages/CalcAuthoringPrototypePage.tsx`;
`packages/lang/src/analytics/{StandardAnalyticsProfile,createAnalyticsEngineForBlock}.ts`;
`packages/lang/src/effort-registry/types.ts`; `packages/wql/src/{vocabulary,queryDocumentRunner}.ts`;
`packages/ui/src/widgets/DashboardView.tsx`; root `CONTEXT.md`; docs cited inline.
