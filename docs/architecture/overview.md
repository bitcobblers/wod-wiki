# Architecture Overview

WOD Wiki is a TypeScript monorepo workspace for parsing, compiling, running, and analyzing workouts written in Whiteboard Language embedded in Markdown.

---

## 1. System Pipeline at a Glance

The processing lifecycle turns Markdown text into immutable, origin-stamped metrics:

```
Markdown ─▶ PARSE (Lezer grammar)          → CodeStatements   (parser metrics)
         ─▶ SEMANTICS (Dialects & Units)   → Hints + dialect metrics + fused units
         ─▶ COMPILE (JIT strategies)       → Runtime blocks + behaviors
         ─▶ RUNTIME (Stack + clock)        → OutputStatements (runtime/user metrics)
         ─▶ PERSISTENCE (IStorage)         → Events, sessions, notes, page_notes, tags
         ─▶ ANALYTICS (WQL QueryService)   → Fact aggregations, rollups, and joins
         ─▶ PRESENTATION (Editor/clock/journal/dashboard)
```

---

## 2. Monorepo Package Topology

```
packages/
  core/      (@bitcobblers/wod-wiki-core)
             Canonical data models: Metric, CodeStatement, OutputStatement, EventRecord.
             Storage schema definitions and result projections. Zero external runtime deps.

  lang/      (@bitcobblers/wod-wiki-lang)
             Whiteboard Lezer grammar, semantic Dialects (time, climb, cardio, yoga, habits),
             unit registry and fusion, and JIT compilation strategies.

  wql/       (@bitcobblers/wod-wiki-wql)
             Wod Query Language (Datadog-flavored) Lezer grammar, AST compiler,
             fact pipeline, and QueryService execution engine.

  ui/        (@bitcobblers/wod-wiki-ui)
             CodeMirror 6 extensions: preview decorations, whiteboard autocomplete,
             section tracking, inline buttons, and theme definitions.

  engine/    (@bitcobblers/wod-wiki-engine)
             Runtime orchestration, stack transition machine, CLI execution runner,
             and umbrella re-exports.

apps/
  playground/
             Full-featured React web application (Vite): Journal stream, universal
             note editor, settings management, and composed dashboards.

  storybook/
             Isolated component workbench and visual testing workshop.
```

---

## 3. Storage architecture

Persistence crosses the shared `IStorage` seam through IndexedDB, direct browser Turso, or the HTTP adapter for a SQL-backed WOD Wiki server. Browser Turso and the server share the SQL store and WQL projection module; the server supports SQLite, Turso, and PostgreSQL. See [persistence interfaces](./interfaces.md#istorage-and-persistence) for provider selection and migration. Every adapter preserves the same ownership invariants:

$$\text{Page } \xleftarrow{1:N} \text{ PageNote } \xrightarrow{N:1} \text{ Note } \xrightarrow{1:N} \{\text{Segment, Session, EventRecord, Attachment}\}$$

* **`notes`**: Canonical container of authored content and exercise logic. Holds identity, type (`journal`, `template`, `playground`, `collection`, `dashboard`, `page`), and provenance.
* **`segments`**: Versioned markdown and script fragments (`[id, version]`). Every edit creates a new version; superseded rows are flagged `isHistory`.
* **`page` & `page_notes`**: Lightweight placement and routing anchors (`date` for calendar pages, `slug` for custom pages). `page_notes` joins notes to pages.
* **`sessions`**: Pure execution metadata (start/end timestamps, elapsed duration, completion status, total rounds/reps).
* **`events`**: Archival statement and metric stream (`EventRecord`). The single source of truth for execution logs and query facts.
* **`tags` & `tag_types`**: Normalized classification. `tag_types` defines dynamic dimensions (`category`, `type`, `equipment`, `discipline`) with frontmatter synchronization.
* **`efforts`**: Movement definitions (`IEffort`) with MET values, intensity tiers, and discipline classifications.
* **`block_index`**: Disposable derived projection of non-history segments for fast WQL content discovery (`find:block`).

---

## 4. Extension Seams

1. **`IDialect`** (`packages/lang`): Recognizes workout patterns, provides sport-specific unit sets, and emits hints.
2. **`IRuntimeBlockStrategy`** (`packages/lang`): Compiler rules attaching capabilities to parsed statements.
3. **`IRuntimeBehavior`** (`packages/engine`): Lifecycle hooks (`onMount`, `onTick`, `onNext`, `onUnmount`) for clock timers, rep counting, and audio cues.
4. **`QueryService` & Custom Dimensions** (`packages/wql`): Fact projection over `EventRecord` with dynamic tag filtering and cross-store joins.
