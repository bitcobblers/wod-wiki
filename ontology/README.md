# wod.wiki Ontology

The wod.wiki domain model as a formal, machine-checkable ontology: Turtle
modules for meaning, SHACL shapes for contracts, and examples that prove both
directions — valid data conforms, broken data fails with readable reasons.

The model is **modeled on the code as it exists** (`docs/domain-model/*.md` +
the type sources they cite). Where the docs record open design questions, the
ontology models the current state and flags the question in a comment — it
does not silently decide it.

## Layout — split by owning library

The ontology mirrors the codebase: each module models the types its library
owns, so a change in a package has an obvious ontology home.

```
ontology/
  ontology.ttl            root manifest (owl:imports of all modules)
  lang/                   @bitcobblers/wod-wiki-lang
    metrics.ttl             Metric vocabulary, MetricObservation, QUDT units
    efforts.ttl             Effort (slug key, MET, discipline)
    statements.ttl          ScriptBlock, Statement, dialects
  core/                   @bitcobblers/wod-wiki-core
    results.ttl             Session, EventRecord, SegmentEvent, SummaryEvent
    fields.ttl              Field catalog / sources / values, backfill state
  app/                    apps/playground
    content.ttl             Note, NoteSegment (versioned [id, version])
    pages.ttl               Page, PageNote (placement junction)
    taxonomy.ttl            Tag, TagType, NoteTag
    attachments.ttl         Attachment
    library.ttl             BlockIndexRow, Collection, Configuration
  wql/                    @bitcobblers/wod-wiki-wql
    queries.ttl             WQLQuery, AnalyticsDataPoint, Dashboard, widgets
  shapes/                 SHACL contracts, split the same way (lang/core/app/wql)
  examples/               valid + deliberately broken data
  graphs/                 diagrams (regenerate: graphs/make_graphs.py)
  validate.sh             run every example against every shape
```

`packages/engine` executes lang statements (its outputs are what core/results
stores) and `packages/storage` defines the physical stores beneath core/app —
neither owns domain types, so neither has a module.

Diagrams: `graphs/overview.png` (module map by library), `graphs/authoring.png`
(the app side as a class graph), `graphs/shapes.png` (shape inventory),
`graphs/tabata-instance.png` (example data as a graph).

## Validate

```bash
ontology/validate.sh
```

Expected: `tabata-session` and `notebook` conform; `broken-session` and
`broken-notebook` fail with exactly five violations each. Tooling: pySHACL +
rdflib (a local venv; the script merges all modules into the data graph
because validators need the vocabulary and subclass triples present).

## Design rules that hold across modules

1. **Meaning (OWL/Turtle) and contract (SHACL) are separate layers.** The
   ontology says what things are; shapes say what data may claim to follow it.
2. **Closed shapes for small, fully-known records** (MetricObservation);
   **open shapes where the product must grow** (the event stream's
   outputType vocabulary is deliberately unconstrained).
3. **Aggregates are derived, never stored** — a session's total reps is a
   WQL computation, not a field. SummaryEvent rows are the one stored
   exception, and they are system-produced folds, one metric per row.
4. **String-key joins are modeled honestly** — effortSlug, Tag.type,
   blockContentId and FieldSourceRecord's `note:`/`result:` ids are strings
   in storage that the ontology resolves to the records they name.
   blockContentId in particular is a content-hash join, *not* an identity.
5. **Derived things say so** — BlockIndexRow and Collection are projections
   of authored sources, never a second authoring source.
6. **Vocabulary as individuals** (metrics, dialects, query sources), so
   shapes validate against lists and new terms are data, not schema edits.

## Open questions (flagged in the files, undecided)

- Count unit: settle reps' unit against QUDT (today: `wod:CountUnit`
  placeholder in lang/metrics).
- Time policy: repo stores epoch ms (and `timeSpan`s); the ontology uses
  `xsd:dateTime`. Elapsed observations in milliseconds are unresolved.
- Segment identity: editor and persistence mint block ids differently
  (`wblk-` vs `bc-`); canonical contract before cross-source joins rely on it.
- Note kind taxonomy (issue #1026) and collection-page membership (#1031)
  remain the tickets' decisions, not the ontology's.
- Where results join: `result:` → `session:` prefix rename is proposed in the
  field docs; shapes accept both today.
- LinkML (one model generating OWL + SHACL + TypeScript types) is still the
  open bridge back to compile-time type safety.
- This directory currently lives on the `scroll-track-service` branch clone;
  re-home onto main when it is committed.

## History

Spike 1 (2026-10-23) proved the approach on the metric core alone
(Session → EventRecord → MetricObservation) in `~/workspace/wod-wiki-ontology/`.
This directory is its full home: the spike's monolith split by library, the
stubs (Note, NoteSegment) fleshed out, and every other domain-model entity
(Page, PageNote, Tag/TagType/NoteTag, Attachment, BlockIndexRow, the field
subsystem, Configuration, Collection, WQL queries/dashboards) modeled.
