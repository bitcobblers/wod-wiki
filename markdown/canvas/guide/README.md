# Learning Collection — Design Review & Page Map

> **Status: SHIPPED (2026-10).** The eight chapters in this directory are the production guide: each carries `template: canvas` + `route: /guide/<slug>` frontmatter and renders as a live canvas page. The six editor chapters (start, protocols, structure, metrics, clock, sessions) have the sticky workout editor, chapter/quest gameplay, and Run; **wql and dashboards are sandbox chapters** — no workout editor or quests, but the sticky panel holds a live, editable ```query sandbox (wql: preset query tabs; dashboards: the real seeded boards loaded with live widgets). The old 18 routed learning pages (`syntax/*` hubs and routed chapters, `behaviors/*`, `analytics/*`) were deleted in the same cutover — §7 is the migration map that was applied, with no redirects left behind.
>
> Shipped vs contract, precisely: **§3.1–§3.3 (fresh note per Run, record exactly once including Stop, reset snapshots) are implemented in the canvas runtime and exercised for real** (first Run/Stop verified inline on a guide page). **§3.4–§5 (stage-driven run, sticky stage flow, reduced-motion runways) remain the homepage-rebuild contract** — these guide pages use the standard canvas sticky panel, not the stage machine. §1's counts and fixtures table are the **pre-cutover inventory** (historical: 18 routed learning pages then; today this directory's 8).

**The shared example.** Every chapter from [First Workout](/guide/start) through Dashboards reuses one workout, `markdown/canvas/home/sample-script.md` verbatim:

```time
(3)
  10 Kettlebell Swings 24kg
  *:30 Rest
```

You edit it, run it, watch what the clock records (Metrics), query the records (WQL), and pin the query to a dashboard.

---

## 1. Design review of the pre-cutover learning surface (historical)

**Exact routed count.** A route-frontmatter search across `markdown/` finds **20 routed pages**: syntax 8, analytics 6, behaviors 4, plus the homepage `canvas/home/README.md` (`/`) and `canvas/ai-first/README.md` (`/ai-first`). That gives **18 learning pages**. The inventory report's "19 routed" counted the homepage row but missed that `/ai-first` also carries `route:` frontmatter. Per scope, **homepage and `/ai-first` are product/marketing, not learning pages**, and are excluded from the collection (ai-first stays linked from First Workout as "generate with AI").

**Orphans.** 65 of the 73 files in `markdown/canvas/syntax/` are non-routed tab-page fixtures (`search: hidden`, scroll-stage sources). They are compiled by tests and rendered only as scroll stages — several contradict their own routed captions. The collection de-orphans every unique topic without keeping the dead scroll plumbing.

**Duplicates merged (unique topics preserved).**

| Topic | Duplicates | Resolution |
|---|---|---|
| Calculated metrics ×3 | syntax/calculated-metrics.md (section document), custom-metrics-5.md (section custom-metrics), custom-and-calculated-metrics.md (section advanced) | one [Calculated](/guide/metrics?h=calculated) section in metrics.md |
| AMRAP ×2 | protocols-1.md `20:00 (AMRAP)` vs classic-amrap.md `20:00 AMRAP` | keep the caption-blessed canonical `20:00 AMRAP` |
| EMOM ×4 | protocols-2 `10:00 (EMOM)`, protocols-5 implicit, basic-emom `(10) :60 EMOM`, alternating/longer/custom variants | keep canonical `(10) :60 EMOM` + longer-interval + alternating branches |
| Actions ×2 | supplemental-1 vs actions-comments | merged into [start.md#actions-comments](/guide/start?h=actions-comments) |
| Rest ×2 | supplemental-2 vs timers-4 (both `*:30 Rest`) | merged into [protocols.md#required-rest](/guide/protocols?h=required-rest) |
| Comments ×2 | supplemental-3 vs actions-comments | merged into start.md |
| Unknown loads ×2 | supplemental-4 vs metrics-5 (`?lb`) | merged into [metrics.md#capture](/guide/metrics?h=capture) |
| Cheatsheets ×2 | /guide/syntax/cheatsheet + /guide/analytics/cheatsheet | **no separate cheat-sheet page** — compact reference tables fold into [start.md#reference](/guide/start?h=reference) and [wql.md](/guide/wql?h=aggregate); 8 pages max |
| Idioms tables | behaviors/README vs timers.md vs rounds.md (near row-for-row) | behaviors/README absorbed into [clock.md#run-next](/guide/clock?h=run-next) |
| Prototype copies | root tour-redesign.prototype.html ≡ apps/playground copy | out of scope for markdown (IntegratedPrototype's); noted for cleanup |

**Contradictions — resolved or flagged.** Ground truth = `packages/lang` parser/runtime + `packages/wql` vocabulary (verified in source, not from docs).

| # | Docs say | Source says | Resolution in this collection |
|---|---|---|---|
| 1 | "wrap your workout in a `wod` block"; dialects page implies ```` ```wod ````/```` ```plan ````/```` ```climb ```` fences | runtime affords `time` (run) and `log` (record) fences only; dialect fixtures themselves use ```` ```time ````/```` ```log:climbing ```` | teach `time`/`log`/`log:climbing`; `wod`/`plan`/`climb` kept as *intent* vocabulary, flagged **needs validation** ([sessions.md#intent](/guide/sessions?h=intent)) |
| 2 | home caption + prototypes: "```` ```wql ```` for queries"; cookbook shows ```wql copy blocks | real in-note fence is ```` ```query ````; no ```wql handling exists | use ```query everywhere; cookbook's ```wql snippet blocks flagged **needs validation** |
| 3 | analytics/README + anatomy document `source:all` | parser hard-errors: "source:all is retired — omit the source: filter" | omitting `source:` **is** the all-sources default; never write `source:all` |
| 4 | filters.md teaches singular `source:collection`/`source:feed` | `WQL_SOURCE_VALUES` = plural `journal, feeds, guides, playground, dashboards, efforts`; `source:collections` retired (parser errors) | teach plural; pin one catalog with `catalog:<id>`; `source:collection:<id>` remains a storage-identity literal |
| 5 | structure.md caption: name groups `(Warmup)`; named-groups/mixed-sections fixtures use `// Warmup` | classifier emits a labeled group node for `(Warmup)` (`RoundsMetric(label)`); `//` is a text comment — different mechanisms, both legal | both documented with the difference ([structure.md#named-sections](/guide/structure?h=named-sections)) |
| 6 | `:?` placement: timers-3 prefixes (`:? Max Effort`), capture/cheatsheet append (`5:00 Run :?`) | `:?` is a standalone collectible-duration token; both positions parse | append taught as the convention; prefix noted as equally legal ([metrics.md#capture](/guide/metrics?h=capture)) |
| 7 | behaviors/timers.md: movement without duration counts up; timers-5.md: "no timer — stopwatch mode" | `DurationMetric.direction`: value 0/undefined/collectible → **up** | same behavior, two descriptions: a bare movement runs a count-up stopwatch ([clock.md](/guide/clock)) |
| 8 | capture.md queries `avg:wod.rpe by {week}` | no `wod.rpe` key exists anywhere; session RPE is typed metric `session-rpe` | corrected to `avg:session-rpe{} by {week}` ([metrics.md#session-rpe](/guide/metrics?h=session-rpe)) |
| 9 | anatomy.md lists `metMinutes` as a base metric | vocabulary registers it as `calc.metMinutes` (engine-published) | listed under calculated metrics ([metrics.md#calculated](/guide/metrics?h=calculated)) |
| 10 | prototypes use `{tag:benchmark}`, `{intensity:zone4}`, `since:2026-01-01` | real keys: `tags:`; intensity tiers `low|moderate|high`; windows `last <n>d|w` / `from … to …` | corrected vocabulary shipped in wql.md; IntegratedPrototype notified |
| 11 | behaviors/README idiom `AMRAP 10` (label-first) | fixtures only show duration-first `20:00 AMRAP` (canonical per caption) | duration-first everywhere; label-first order flagged **needs validation** |
| 12 | home/README still carries a retired 720vh ```scroll:chapters spec; HomeView error cites nonexistent routes/home.md | dead plumbing | out of scope here — flagged for the homepage rebuild owner |
| 13 | behaviors/capture.md: `5:00 Run :?` asks for "actual distance covered in the 5 minutes"; "prompt for load **before** the first squat" | `:?` is a collectible **timer**: it mounts a count-up timer whose elapsed time is recorded on completion (compliance suites `timer.compliance`/`countup.compliance`; parse skill's collectible rule: prescribed time → collect distance with `?m`, prescribed distance → collect time with `:?`). No runtime evidence schedules a load prompt "before the first rep" — prompt timing is a capture-surface concern | metrics.md teaches the collectible family (`?` reps, `:?` time, `?lb`/`?kg` load, `?m`/`?km`/`?mile` distance) with prescribed-vs-outcome rule; prompt timing not asserted |

**Honesty rules carried into every chapter.** No invented HR/trend numbers; calculated metrics document only real prerequisites (e.g. `calc.readiness` publishes a value for a day only when soreness, sleep, and HRV were all captured that day — verified in `calc/seeds.ts`). Unlanded `calc.*` surfaces render a labeled "proposed" placeholder in the app; dashboards label sample answers as sample.

---

## 2. The eight proposed pages

| # | File | Proposed title | Sticky stages | Absorbs |
|---|---|---|---|---|
| 1 | [start.md](/guide/start) | First Workout | editor → runtime | basics.md, syntax/README hub, core syntax tab pages, the printable cheat sheet |
| 2 | [protocols.md](/guide/protocols) | Timers & Protocols | editor → runtime | protocols.md, all timer/protocol tab pages, the timer half of behaviors/timers.md |
| 3 | [structure.md](/guide/structure) | Structure & Rounds | editor → runtime | structure.md, group tab pages, behaviors/rounds.md |
| 4 | [metrics.md](/guide/metrics) | Metrics: Planned, Recorded, Calculated | editor → runtime (results focus) | custom-metrics.md, metric/calculated tab pages, behaviors/capture.md |
| 5 | [clock.md](/guide/clock) | Run, Track & Capture (the Clock) | editor → runtime (runtime is the subject) | behaviors/README.md, the runtime halves of timers.md/capture.md |
| 6 | [wql.md](/guide/wql) | Query Your Training (WQL) | editor → WQL table (data focus) | analytics/README, anatomy, filters, joins |
| 7 | [dashboards.md](/guide/dashboards) | Dashboards & Cookbook | WQL table → dashboard (data focus) | analytics/cookbook, the query-block half of analytics/cheatsheet, the 6 seeded boards |
| 8 | [sessions.md](/guide/sessions) | Dialects & Complex Sessions | editor → runtime | dialects.md, complex.md, dialect/complex tab pages |

The stages column is mirrored verbatim in each page's chapter banner. Chapters 1–3 and 8 **run and save**; chapter 5 documents the runtime itself; chapters 4, 6, 7 focus on **reading the data** runs produce. No chapter defines its own result policy — every run saves under the one contract in [§3](#run-contract).

### Common page model

Every chapter uses the same skeleton: `# Title`, chapter banner (chapter number, **Sticky stages** line, replaced routes, homepage placements), the teaching sections with their existing anchors, exactly one `## Try it {#try-it}`, and a one-line chapter footer (`**Next:** … · [Overview](/guide/start)`). A Try it block has three labeled parts — **Run** (what to paste/press), **Observe** (what the runtime should show), **Result query** where the chapter reads data — and any caption buttons reuse existing action labels only (`Run`, preset names, `Cast`); no invented controls, no duplicated nav prose.

Entry and deep-link anchors (used by the homepage and the prototype's learn links):

| Page | Entry anchor | Try it | Key deep anchors |
|---|---|---|---|
| start.md | `#first-workout` | `#try-it` | `#reference`, `#measurements` |
| protocols.md | `#countdown-countup` | `#try-it` | `#amrap`, `#required-rest` |
| structure.md | `#rounds` | `#try-it` | `#named-sections`, `#rep-schemes` |
| metrics.md | `#planned-vs-recorded` | `#try-it` | `#capture`, `#calculated`, `#session-rpe` |
| clock.md | `#run-next` | `#try-it` | `#casting`, `#provenance`, `#pause-skip`, `#capture-prompts` |
| wql.md | `#planes` | `#try-it` | `#aggregate`, `#filters`, `#sources`, `#windows`, `#joins` |
| dashboards.md | `#note-frontmatter` | `#try-it` | `#widgets`, `#cookbook`, `#seeded-boards`, `#composer` |
| sessions.md | `#intent` | `#try-it` | `#full-session` |

Reading order is the numbered order; 1–3 teach writing, 4–5 teach what running records, 6–7 teach querying, 8 composes everything.

---

## 3. Run & save contract — today vs proposed {#run-contract}

> **Everything in §3–§5 is PROPOSED** for the homepage rebuild and these eight chapters. "Today" statements come from source review of the intake/recorder seams, run refs, reset paths, and scroll drivers — no runtime behavior has been exercised, and nothing here is implemented. The eight drafts above carry **no `route:` frontmatter** and no runtime wiring.

### 3.1 One active workspace, immutable run archive

**Today.** One active persisted Note per *surface*: `ensurePlaygroundEntry` (`createPlaygroundPage.ts`) creates once, then **updates in place** under reuseKey `'home'`, `'chapter-<id>'`, or `canvas:<route>` (`getCanvasNoteId`, `canvasUtils.ts`) — deliberately, so the library doesn't fill with duplicate experiment entries. Fresh notes are minted only by explicit New/Reset page buttons, ZIP import, templates, and journal→playground copies (each named via `formatPlaygroundTimestampId`). Reset is in-memory only: `HomeTour.startNewSession` and `useCanvasRuntime.closeRun` unmount without recording — in-flight results are silently dropped.

**Proposed.** Keep exactly one active **editable workspace** per surface — the hero editor remains the single authoring surface, sticky through its stage. Nothing overwrites the draft in place, and nothing is ever activated in place of a new note: **every Run creates a fresh note, and every Reset creates a separate fresh unstarted draft snapshot — both retained** (the extra archive entries are intentional; the user explicitly asked for clones of both). Reset finalizes the active run partial, restores the template content in the editor, and mints a fresh draft snapshot (status `reset-unstarted`) as its archive record; the next Run still mints its own fresh note — a reset draft is never activated. Snapshot name = `<page label> — <section label> — <formatPlaygroundTimestampId>`: labels taken verbatim from the page H1 and the section heading the run launched from; section is optional (hero runs use the section label `Run`); run state (`running` / `completed` / `stopped` / `reset-unstarted`) is note metadata, not a second naming scheme. One workspace ≠ one saved note — **all session data is always recorded**: the archive retains every run and reset snapshot; retention is §3.6.

### 3.2 Create before run; capture identity at start

**Today.** Runs already persist before execution: `ensurePlaygroundEntry` completes before the runtime mounts, and save failure = toast + abort — no execution without a saved note. Run identity `{noteId, resultId, block}` is captured once at start and never re-derived (`activeRun.current`, `useCanvasRuntime.ts:56`; `playgroundEntryRef`/`playgroundBlockRef`, `HomeTour.tsx:602-616`). Recording resolves `segmentId = runBlock?.id ?? blockId`, `blockContentId = runBlock?.contentId`, origin `'playground'` for playground notes (`resultRecorder.ts:104-133`); segment **version** is deferred to the persistence adapter at write time.

**Proposed.** Unchanged mechanics, new target: the captured triple points at the run's **snapshot** note — minted fresh at every Run (never a reused reset draft) — and the snapshot **source** is captured at start the same way — captured results can never retroactively bind to a later-edited draft. Editing the draft mid-run is a *try-edit*: finalize the active run partial, halt, let the editor change live; the edited content becomes a snapshot only at the next Run.

### 3.3 Record once — partial or full — with failure guards

**Today.** `playgroundRecorder.record` is the only result seam; natural completion and Stop both record (Stop sends `completed:false`). But `handleWorkoutComplete` never consumes the captured run — a second completion call would re-record the same resultId — and reset paths drop without recording. Other sourced races: two concurrent same-reuseKey `ensureEntry` calls can mint two same-slug notes; `completeWorkout` (workbench) is a non-atomic two-write pair whose result-write failure is only console-logged.

**Proposed.** One finalization path shared by **natural completion, Stop, and metrics-stage arrival** (entering the metrics stage stops the runtime and finalizes). Record **exactly once** per run — partial (`completed:false`) or full — by consuming the captured run on record (clear `activeRun.current` / generation check, or an id-keyed guard in the recorder). Guards:

- **Reset while running:** finalize the partial first and **retain the snapshot — always, even with zero outputs**, marked reset/unstarted, with no fabricated performance rows (a zero-output note honestly records "attempted, nothing captured"; nothing is silently dropped). Reset then mints a **separate fresh unstarted draft snapshot** as its archive record; the next Run still creates its own fresh note — prepared/reset drafts are never activated (explicit user policy: each run creates a new note; the extra archive entry is requested).
- **Save failure:** persist-before-run stays; a failed save must **never clear recorded output nor auto-start a new run** — the run and its results stay, retry is explicit.
- Per-run snapshots retire the reuseKey race surface entirely (each run mints its own note; no shared-slug ensure).
- In the HTML prototype, session recording stays **page-memory only** and is labelled visibly as such; production records through the recorder seam.

### 3.4 No fullscreen; stage-driven run

**Today.** Run mounts a fullscreen overlay (`TourTimerScreen` tour-side, `FullscreenTimer` canvas-side) with autostart gated in `RuntimeTimerPanel` (`(autoStart||pendingStart)&&ready&&idle`).

**Proposed.** Run scrolls to the **inline runtime stage** — no fullscreen. Arrival autostarts **once per run**. Captions offer existing actions only, as optional explicit buttons (`Run`, `Next`, `Stop`, `Cast` — real control labels/testids, no hidden auto-Next, no auto-cast; the autoplay entrance is user-scroll-triggered). A previous runtime resumes only via explicit **Run** (which always mints a new snapshot).

### 3.5 Stage observers are idempotent

Backward scroll never restarts a run nor replays a one-shot stage effect (renormalized progress + reached-once guards, the `useReachedOnce` pattern). Forward **fast scroll** that resolves straight to a later stage cannot launch the skipped runtime stage: the stage machine emits one discrete stage per frame (`resolveScrollStage`), so skipped stages' enter effects (autostart included) never fire. Every stage-enter effect runs once per run, not once per direction.

### 3.6 Bounded seams and cleanup scope

All changes are bounded to existing seams — no new subsystem:

1. **Snapshot naming** — a policy inside `createPlaygroundIntake` (the single note-minting seam); callers (`HomeTour`, `useCanvasRuntime`) keep their signatures. Explicit New/Reset page buttons keep today's `createPage` semantics.
2. **Record-once** — a guard at the recorder or the run hooks (consume captured run / id-keyed guard), closing the double-record race before any autostart re-runs exist.
3. **Partial finalize on reset** — a `completed:false` record at the two reset points (`HomeTour.startNewSession`, `useCanvasRuntime.closeRun`), retained even at zero outputs, then a separate fresh unstarted draft snapshot is minted (Run never activates it).
4. **One active session owner** — generalize the `useCanvasRuntime` pattern instead of scattered refs (HomeTour refs vs canvas `activeRun` vs workbench store). **The workbench keeps its own multi-note session store** (`completeWorkout`, autosave, `resetStore`): it serves journal/workbench routes and promotion — one-active is a *playground-surface policy*, not a storage policy. Don't delete general workbench multi-note session support because the homepage is one-active.
5. **Retention** — snapshot growth is handled by the existing promotion invariant (`movePlaygroundToJournal` — moved notes can never be hijacked by a later same-key ensure) and `find:note{source:playground}` scoping, not new deletion logic.

**Cleanup scope when the collection is approved** (not before — nothing here routes the eight drafts or retires any `/guide/*` route):

- Safe to retire with their routed parents: the 65 non-routed syntax tab-page fixtures and their ```scroll stage plumbing (they exist as scroll-stage sources for routed pages), the duplicate prototype HTML copy (keep one canonical), the `ProtoTimerMobile` throwaway (`?proto-timer`), the retired 720vh ```scroll:chapters spec in `canvas/home/README.md`.
- **Out of scope:** workbench/journal session store and its wiring, collections/feeds/journal surfaces, promotion, chapter-run reuse — multi-note session support serves routes beyond the homepage and survives a one-active homepage.

---

## 4. Sticky stage flow (desktop & mobile)

Four sticky stages in page order: **editor → runtime → WQL table → dashboard**. Desktop is native **sticky push-off**: each stage is a tall section whose card sticks at the nav offset (`STICKY_NAV_HEIGHT` = 104px, card `h-[calc(100vh-104px)]` — the `TourSectionRunway` pattern) and is pushed off by the next stage's sticky card, driven by the existing pure stage machine (`resolveScrollStage` with clamp01/renormalize over a capture-phase scroll listener). The hero editor is **one reused instance** sticking through stage 1. Run scrolls editor→runtime; **Stop (or metrics arrival) slides the metrics view in**; the **WQL table stage** sticks bound to the **current run's facts**, with caption query actions (real queries, `ParsedQueryChips` vocabulary) and a floating **"Revert current session"** that re-binds the table to the current run — discarding view-state (query tweaks, sample overlay) only; the **dashboard stage** sticks a board with **load buttons** for the seeded boards.

Mobile (≤1023px, `MOBILE_BREAKPOINT_PX`): **bounded sticky stage windows** — one stage card at a time in the reading zone (top 65px window, `MOBILE_STICKY_TOP`), captions **below** the card, card-visibility IntersectionObserver as the stage driver (the `TourMobileRunway` pattern). Same stage order, same run contract.

Reduced motion wins everywhere (`RunwayAdapter`: reduced > mobile > desktop): flat card stack, no push-off, no scroll scrub; stage arrival is visibility-based and still once-per-run.

Guarantees on every form factor:

- Runtime arrival autostarts once; backward scroll never restarts; fast scroll to a later stage cannot launch the skipped runtime (§3.5).
- Caption actions are explicit buttons using existing labels; no hidden auto-Next/auto-cast.
- Sample fallbacks are badged **sample**; sample datasets and dashboard/board edits never mutate saved session results; **Revert** restores view only.

---

## 5. System organization

| Term | Purpose | Scope / storage |
|---|---|---|
| **Note** | the markdown document + identity (uuidv7 id, slug, sourceId, type) | one IndexedDB store (notes + results + attachments + analytics) |
| **Page** | a note bound to a surface (routed guide page, playground home/canvas) | bindings via reuseKey / `getCanvasNoteId` |
| **Block** | one addressable fenced unit in a note; the run target | Block Content Id = content hash, stable across reorders/clones |
| **Effort** | named workout registry entry (e.g. *fran*) | content-plane query target; aggregates `by {effort}` |
| **Session** | one recorded run | `{noteId, resultId, block}` triple; results join `Session.noteId` |
| **Journal** | your saved notes | `source:journal`; promotion target |
| **Playground** | experiment surface (home/canvas, learning runs) | `source:playground`; run snapshots archive here until promoted |
| **Catalog** | catalog of benchmark sessions | `source:feeds`; clone into journal |
| **Feed** | dated posts | — |
| **Dashboard** | a note with `dashboard: true`; its query blocks render as widgets | vault (editable) vs prebuilt (read-only, clone) |

**`source:` scope.** Plural values — `journal, feeds, guides, playground` (plus `dashboards`, `efforts`); omitting `source:` searches all; pin one catalog with `catalog:<id>`. Learning runs record with origin `'playground'` until promotion re-homes the note to the journal — a query pinned to `source:journal` excludes playground experiments by design.

**Session vs template vs sample dataset vs revert.**

- **Session** — immutable recorded facts from one run against its snapshot note.
- **Template** — read-only source content (`sample-script.md`, `WORKOUT_PRESETS`, catalog sessions, seeded boards). Running a template copies it into the active workspace/snapshot; **templates never mutate**.
- **Sample dataset** — the SAMPLE fallback (`SAMPLE_HOME_ANALYTICS`, `SampleDataPrompt`) shown when the store has no facts; always badged sample; never persisted as your results.
- **Revert** ("Revert current session") — discards view-state only (query tweaks, sample overlay) and re-binds the stage to the current run's recorded facts; never deletes saved sessions.

---

## 6. Homepage placements (existing slots only)

| Homepage slot | Proposed links |
|---|---|
| Hero / editor-blank caption | "Start Lesson 1" → start.md#first-workout; add "See the full syntax" → start.md#reference |
| 01 Write — editor-metrics caption | add "What each line collects" → metrics.md |
| 01 Write — WORKOUT_PRESETS | each preset mirrors a protocols.md / structure.md example |
| 02 Run — behaviors caption | point "Read the behaviors explainer" → clock.md |
| 02 Run — timer-cast caption | clock.md#casting |
| 03 Own — metrics-d ("Measures ride along") | add action → metrics.md |
| 03 Own — metrics-c ("Efforts × measures compound") | add teaser → wql.md |
| 04 Explore (currently no inline analytics links; `home:analytics_guide_opened` telemetry declared but never fired) | header actions: "WQL in depth" → wql.md, "Copy-paste queries" → dashboards.md#cookbook; wql-dashboard/wql-live captions → dashboards.md#seeded-boards |
| CelebrationBridge ("Now learn the language") | render the 8-chapter map as the card row |
| TourChapterPicker / TourLearnSection | CHAPTER_ROUTES gains the 8 files |
| Footer "Where to next?" | add Learn column: start.md, wql.md, dashboards.md |
| /ai-first | stays a standalone marketing page, linked from start.md ("Generate with AI") |

## 7. Old route → new page/anchor map

Concrete migration map for the 18 currently routed learning pages. Slugs follow the current routed files under `markdown/canvas/`; the eight targets are §2's files. **Both cheatsheets are absorbed into existing pages — there is no ninth page.** Nothing routes or redirects until the collection is approved; until then both trees coexist.

| Old location (routed file) | New target |
|---|---|
| `syntax/README.md` (hub) | [start.md](/guide/start) header + [sessions.md#intent](/guide/sessions?h=intent) |
| `syntax/basics.md` | [start.md#first-workout](/guide/start?h=first-workout) |
| `syntax/protocols.md` | [protocols.md#countdown-countup](/guide/protocols?h=countdown-countup) |
| `syntax/structure.md` | [structure.md#rounds](/guide/structure?h=rounds) |
| `syntax/custom-metrics.md` | [metrics.md#planned-vs-recorded](/guide/metrics?h=planned-vs-recorded) |
| `syntax/dialects.md` | [sessions.md#intent](/guide/sessions?h=intent) |
| `syntax/complex.md` | [sessions.md#full-session](/guide/sessions?h=full-session) |
| `syntax/cheatsheet.md` | [start.md#reference](/guide/start?h=reference) — **cheatsheet #1 absorbed** |
| `behaviors/README.md` | [clock.md#run-next](/guide/clock?h=run-next) |
| `behaviors/timers.md` | [protocols.md](/guide/protocols) (syntax forms) + [clock.md#pause-skip](/guide/clock?h=pause-skip) (runtime) |
| `behaviors/rounds.md` | [structure.md#rep-schemes](/guide/structure?h=rep-schemes) + [clock.md#run-next](/guide/clock?h=run-next) |
| `behaviors/capture.md` | [metrics.md#capture](/guide/metrics?h=capture) + [clock.md#capture-prompts](/guide/clock?h=capture-prompts) |
| `analytics/README.md` | [wql.md#planes](/guide/wql?h=planes) |
| `analytics/anatomy.md` | [wql.md#aggregate](/guide/wql?h=aggregate) |
| `analytics/filters.md` | [wql.md#filters](/guide/wql?h=filters) · [#sources](/guide/wql?h=sources) · [#windows](/guide/wql?h=windows) |
| `analytics/joins.md` | [wql.md#joins](/guide/wql?h=joins) |
| `analytics/cookbook.md` | [dashboards.md#cookbook](/guide/dashboards?h=cookbook) |
| `analytics/cheatsheet.md` | [wql.md#aggregate](/guide/wql?h=aggregate) tables + [dashboards.md#widgets](/guide/dashboards?h=widgets) — **cheatsheet #2 absorbed** |

The 65 non-routed tab-page fixtures follow their routed parents (their unique content is already merged — §8). `canvas/home/README.md` (homepage) and `canvas/ai-first/README.md` stay product pages, out of the collection.

## 8. Source coverage

Every routed learning page (18) and every underlying non-routed lesson source (65 syntax tab pages + 2 home sources), mapped to its target. Merged duplicates list only once with their union.

| Current source (routed unless marked) | Topics kept | → New page |
|---|---|---|
| syntax/README.md (hub) | core concepts map, dialect intro, new-note CTA | start.md (header/TOC), sessions.md#intent |
| syntax/basics.md | fences, one-thing-per-line, indentation, measurements, `?lb`, effort words, actions, comments | start.md |
| syntax/protocols.md + timers-rest, timer-modifiers, timers-1..5, longer-duration, mixed-timers, classic-amrap, time-cap, multiple-amrap-windows, basic-emom, longer-intervals, alternating-emom, protocols-1..5, custom-intervals, distance-intervals, supplemental-2 | countdown/countup/`^`/`*`/`:?`, H:MM:SS, AMRAP, caps, EMOM family, Tabata, intervals, rest | protocols.md |
| syntax/structure.md + groups-1..4, named-groups, mixed-sections, multiple-sets | rounds, rep schemes, nesting, named sections, sets | structure.md |
| syntax/custom-metrics.md + custom-metrics-1..5, calculated-metrics, custom-and-calculated-metrics, metrics-1..5, supplemental-4 | inline JSON, rpe/rir, multi-metric lines, calculate blocks, JSON rules, unknown loads `?lb`/`?kg` | metrics.md |
| syntax/dialects.md + dialect-wod/log/plan, dialect-climb-bouldering/hangboard/sport | intent distinction, `log:climbing`, climbing signals | sessions.md |
| syntax/complex.md + complex-nested-protocols, complex-full-session, complex-barbell-cycling, complex-partner-workout, complex-swimming | nested protocols, full session, EMOM chains, partner windows, swimming | sessions.md |
| syntax/cheatsheet.md (routed) | one-page syntax | start.md#reference + per-page tables (no separate page) |
| syntax/single-movement, core-rules, measurements, effort-notes, actions-comments, supplemental-1, supplemental-3, document-1..4, welcome-1 (home/), sample-script.md (home/) | smallest workout, three rules, headers/checklists/equipment-table document patterns, actions/comments | start.md |
| behaviors/README.md | script→parse→compile→track, 3 behavior families, idioms | clock.md |
| behaviors/timers.md | timer strategy selection, sound/pause/skip/required-rest | clock.md (+ protocols.md for syntax forms) |
| behaviors/rounds.md | round behavior, rep math, supersets, interval groups, rounds↔timers | structure.md (+ clock.md) |
| behaviors/capture.md | `:?`, `?lb`/`?kg`, session RPE, trendlines, fact origins | metrics.md (+ clock.md for prompt behavior) |
| analytics/README.md | 3 WQL surfaces, 2 query planes, where-join | wql.md |
| analytics/anatomy.md | aggregators, base/calc metrics, dimensions, rollups, find targets | wql.md |
| analytics/filters.md | tag filters (negation/OR/substring), source filters, time windows, Library tri-state toggles | wql.md |
| analytics/joins.md | where joins, Block Content Id mechanics | wql.md |
| analytics/cookbook.md | 5 canonical queries, ```query embeds, dashboard notes, widget types/spans | dashboards.md (+ wql.md) |
| analytics/cheatsheet.md | WQL one-pager | wql.md tables + dashboards.md#widgets (no separate page) |
| markdown/dashboards/training-block-review.md | widget exemplars (see dashboards.md#seeded-boards) | dashboards.md |
| markdown/dashboards/road-to-560-total.md | strength PR board exemplar | dashboards.md#seeded-boards |
| markdown/dashboards/polarized-base-marathon.md | endurance polarization exemplar | dashboards.md#seeded-boards |
| markdown/dashboards/finger-strength-v8.md | climbing board exemplar (wellness capture, `calc.mvcBw`) | dashboards.md#seeded-boards |
| markdown/dashboards/benchmark-pr-board.md | benchmark table exemplar (`last:elapsed{tags:benchmark}`) | dashboards.md#seeded-boards |
| markdown/dashboards/recovery-readiness.md | ```wellness capture + readiness exemplar | dashboards.md#seeded-boards (+ metrics.md#calculated) |

Not counted as learning sources: `canvas/home/README.md` (product walkthrough — the homepage itself stays), `canvas/ai-first/README.md` (AI marketing, linked as an aside). Orphaned scroll plumbing (```scroll blocks, getTabExamples/getHomeExample, protocols-1's `(AMRAP)` spelling) is dropped, not migrated.

## 9. Review method

Each chapter ends with a **Try it** block: what to paste/press, what the runtime should show, and — for data chapters — the result query — a reviewer checklist, not a test report. Every syntax, behavior, and query claim in this collection comes from **source review only** (parser grammar, compiler metrics, WQL vocabulary/seeds, shipped fixtures). That was true at review time; since the cutover the chapters are production pages — the §3.1–§3.3 run/save behavior is implemented and exercised, while §3.4–§5 (stage flow) stay contract-only (see the status block).
