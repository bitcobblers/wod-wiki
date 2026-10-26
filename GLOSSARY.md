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
An interactive query or visualization block embedded inside any Note or Property Note.
_Avoid_: Card, panel, chart embed

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
