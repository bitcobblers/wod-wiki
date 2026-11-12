# WOD Wiki

Authoring, execution, and analytical querying of structured workout notes, movements, equipment, and performance telemetry.

## Language

### Authored Content & Classification

**Note**:
The single owning document of authored Markdown prose, frontmatter properties, executable workout blocks, and dashboard widgets.
_Avoid_: Document, entry, article

**Property Note**:
A Note at `/t/:category` or `/t/:category/:slug` that defines either a Tag Category or an individual Tag within a category, combining Markdown prose and Dashboard Widgets with frontmatter `metrics:` and `summaries:` that stack onto referencing notes and blocks.
_Avoid_: Reference note, definition row, metadata page

**Tag Category**:
A Property Note at `/t/:category` defining a classification dimension (`effort`, `equipment`, `tag`, `domain`, `format`, `discipline`, `intensity`, or any user-defined category) that renders a list of its child Tags, drives frontmatter and WQL typeahead, and contributes category-wide default `metrics:` and `summaries:`.
_Avoid_: TagType, tag kind, tag dimension

**Tag**:
A Property Note at `/t/:category/:slug` addressable by `#slug`, frontmatter classification, or statement reference that stacks its `metrics:`, `summaries:`, and nested Tags onto any Note or statement that references it. Raw untyped tags live under `/t/tag/:slug`.
_Avoid_: Label row, contribution bundle

**Effort**:
A Tag under the prebuilt `effort` Tag Category (`/t/effort/:slug`) whose slug and aliases also match movement names inside workout blocks.
_Avoid_: Exercise row, movement record

**Equipment**:
A Tag under the prebuilt `equipment` Tag Category (`/t/equipment/:slug`) whose slug and aliases also match apparatus references inside workout blocks and Effort definitions.
_Avoid_: Gear, apparatus record

**Dashboard Widget**:
An interactive WQL query or visualization block embedded inside any Note, Property Note, or Dashboard, or stacked onto a Note from its referenced Tags and Summary Metrics.
_Avoid_: Card, panel, chart embed

**Entity Scope**:
The canonical WQL query predicates and `$scope` tokens associated with a Note, Property Note, Notebook, or Feed, selecting the Notes, Sessions, and statement records belonging to that entity.
_Avoid_: Route filter, ad-hoc query string

**Notebook**:
A named container of Notes and promoted Sessions (`notebook/:slug`): read-only base primitives (`notebook/defaults`), personal overrides (`notebook/custom`), the private user training log (`notebook/journal`, tracking all created Notes and Sessions across its `journal` and `playground` filters with Agenda default view), pre-subscribed or peer read-only Feed mirrors (`origin: 'feed'`), or publishable user Notebooks (`origin: 'user'`) linked many-to-many via `NotebookLink`.
_Avoid_: Collection, catalog, folder

**Note Provenance**:
The structured lineage (`sourceNoteId`, `sourceVersion`, `sourceCommit`, `feedSourceId`, `sourceNotebookId`, `sourcePath`) stamped onto a Journal or user Notebook clone when snapshotting a read-only Note, linking live to the upstream Note while it exists in storage.
_Avoid_: Raw URL string, loose template ref

**Scoped Property Override**:
A Notebook-scoped Property Note definition (`(notebookId, kind, slug)`) that layers subscribed Feed Notebook overrides, shared user Notebook overrides, and personal `notebook/custom` runtime overrides over `notebook/defaults` primitives on the same canonical slug, promoting referenced overrides into user Notebooks upon publication.
_Avoid_: `-custom` slug fork, global overwrite
**Feed**:
A distributed source URL (hosted statically via `wod-wiki-feed-repository` or dynamically on a self-hosted `wod server`) that publishes one or more Notebooks, Property Notes, and optional Session telemetry for others to browse, preview, or subscribe to.
_Avoid_: Library repo, seed package, remote catalog

**Seed**:
The versioned, content-addressed publication bundle (`manifest.json`, per-Notebook indexes, compiled chunks, and landing page) emitted by a Feed Publisher from authored Markdown Notes and companion JSONL Session logs.
_Avoid_: Static bundle, dump

**Session**:
A recorded execution of a pinned workout block on a Note, owning its runtime, loading, and parsing EventRecords and carrying its own `public` opt-in controlling whether that Session's telemetry is published when its Note belongs to a public Notebook.
_Avoid_: Workout result, run row

**Publication Visibility**:
The effective exposure state derived across all user Notebooks linked to a Note and its Sessions: `Private` when zero linked user Notebooks are public, `Published Note` when one or more linked user Notebooks are public and zero Sessions on the Note are marked public, or `Published Note + Data` when one or more linked user Notebooks are public and one or more Sessions on the Note are marked public.
_Avoid_: Share flag, public toggle
### Metrics, Summaries & Evaluation

**Metric**:
A statement-level typed, unit-aware value or equation authored under `metrics:` in frontmatter or parsed from workout text, carrying an origin and precedence layer.
_Avoid_: Fragment, attribute, field

**Summary Metric**:
A workout-level or WQL query-level equation authored under `summaries:` in frontmatter that aggregates or combines Metrics across a logged block, workout, or WQL query window.
_Avoid_: Calc block, projection script

**Metric Shake-Out Queue**:
The dependency-ordered evaluation pass that collects static Metrics and statement-level equations from a statement and all stacked Property Notes, resolving equations in waves as required inputs become available.
_Avoid_: Enrichment pass, post-compile hook

**Skipped-Dependency Diagnostic**:
A record emitted by the Metric Shake-Out Queue onto a logged statement when a Metric equation cannot evaluate because a required input Metric remains absent after execution.
_Avoid_: Parse error, silent skip

**Session Clock Projection**:
The unified live runtime projection of primary, session, and deduplicated secondary clocks, semantic Work/Rest/Final-5s/Paused/Overrun visual polarity, required-timer lock state, immediate lookahead, and Effort rep targets for an active Session across Minimal, General, Detail, and Cast views.
_Avoid_: Surface model fork, proxy block state

**Live Session Telemetry**:
The ephemeral in-run snapshot of typed Summary Metrics and round-over-round Effort split deltas derived from an active Session prior to finalization.
_Avoid_: Positional label pair, regex metric guess
