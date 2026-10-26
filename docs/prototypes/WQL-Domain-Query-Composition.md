---
title: "WQL Evolution & Query Composition Guide"
date: 2026-09-27
status: architectural-guide
tags:
  - wql
  - domain-model
  - query-composition
  - typed-tags
  - block-efforts
  - architecture
---

# WQL Evolution & Query Composition Guide

This guide details how **WQL (Wod Query Language)** operates under the unified domain structure:
1. **Dynamic Typed Tags as Filter Drivers & Typeahead Engines**: How `domain`, `format`, `equipment`, `quality`, and `intent` drive declarative query filtering and interactive typeahead.
2. **Multi-Level Query Joins**: How searches across `Page`, `Note`, `Block`, and `Session` (events) execute their relational intersections.
3. **Block $\leftrightarrow$ Effort Cross Table (`block_efforts`)**: An inverted index connecting parsed workout movements directly to notes and blocks for $O(1)$ exercise containment queries without scanning raw text or relying on execution history.

---

## 1. Domain Foundations & Relational Cardinality

The unified domain cleanly separates placement, authored containers, structural script blocks, exercise containment, and telemetry:

```
[Page] (placement & routing anchor: date or slug)
   │
   ▲ (N:M via `page_notes`)
   │
[Note] (canonical authored document)
   ├── [BlockRevision] (immutable saved actionable-block states)
   ├── [BlockIndexRow] (searchable parsed blocks: wod, headings)
   │      │
   │      ▲ (N:M via `block_efforts`)
   │      │
   │   [Effort] (exercise definition: thruster, pull-up, snatch)
   ├── [Session] (workout execution metadata)
   └── [EventRecord] (output telemetry facts)
   │
   ▲ (N:M via `note_tags`)
   │
[Tag] ─── (N:1) ───► [TagType] (`domain`, `format`, `equipment`, `quality`, `intent`)
```

### Core Invariants
1. **Dynamic Typed Tags**: Frontmatter keys (`domain`, `format`, `equipment`, `quality`, `intent`) synchronize into `Tag` (with `type: TagType`) and `NoteTag` rows.
2. **Effort Containment is Static**: A workout's exercise composition is known at compile/save time from the AST (`parseScript`), independent of whether the workout has ever been executed.
3. **Pages are Pure Placements**: Pages contain no content or telemetry; they group notes via `page_notes`.
4. **Notes Own Telemetry**: `sessions` and `events` link directly to `noteId` and `blockContentId`.

---

## 2. Dynamic Tags as WQL Filter Drivers & Typeahead

Every registered tag type (`TagTypeRecord.name`) becomes an immediate, first-class filter key in WQL without requiring custom grammar keywords.

### A. Supported Filter Keys

| Filter Syntax | Tag Type Target | Example Query | Resolution Mechanism |
|---|---|---|---|
| `domain:<slug>` | `domain` | `find:note{domain:crossfit}` | Matches `Tag.type == 'domain'` AND `Tag.label == 'crossfit'` via `note_tags` |
| `format:<slug>` | `format` | `find:note{format:for-time}` | Matches `Tag.type == 'format'` AND `Tag.label == 'for-time'` |
| `equipment:<slug>` | `equipment` | `find:note{equipment:kettlebell}` | Matches `Tag.type == 'equipment'` (multi-valued per note) |
| `quality:<slug>` | `quality` | `find:note{quality:strength}` | Matches `Tag.type == 'quality'` (multi-valued per note) |
| `intent:<slug>` | `intent` | `find:note{intent:benchmark}` | Matches `Tag.type == 'intent'` AND `Tag.label == 'benchmark'` |
| `tags:<label>` | Any / Untyped | `find:note{tags:girl}` | Matches any `Tag.label` regardless of type |

### B. Compound Filter Logic
Within a query, filters follow standard WQL Boolean algebra:
- **Comma (AND across dimensions)**:
  ```wql
  find:note{domain:crossfit, equipment:barbell, format:for-time}
  ```
  Resolves: $\text{Notes}(\text{domain}=\text{crossfit}) \cap \text{Notes}(\text{equipment}=\text{barbell}) \cap \text{Notes}(\text{format}=\text{for-time})$.
- **Pipe (OR within a dimension)**:
  ```wql
  find:note{equipment:kettlebell|clubs}
  ```
  Resolves: $\text{Notes}(\text{equipment}=\text{kettlebell}) \cup \text{Notes}(\text{equipment}=\text{clubs})$.

### C. Typeahead & Autocompletion Engine

In `@bitcobblers/wod-wiki-wql` (`language.ts`), the CodeMirror extension dynamically supplies completions:

1. **Filter Key Typeahead**:
   When the cursor is before a colon inside a filter block (`{...}`):
   - In addition to static keys (`source:`, `text:`, `has:`), query `IStorage.getAllTagTypes()` or `IFieldCatalog`.
   - Suggests all registered tag type names: `domain:`, `format:`, `equipment:`, `quality:`, `intent:`.
2. **Filter Value Typeahead**:
   When typing after a typed key (e.g. `equipment:` or `format:`):
   - Look up the matching `TagTypeRecord`.
   - Query `tagsStore.getAllFromIndex('by-type', tagTypeName)`.
   - Suggests all existing distinct values:
     - `equipment:` $\to$ `kettlebell`, `barbell`, `dumbbell`, `pullup-bar`, `clubs`, `sandbag`
     - `format:` $\to$ `for-time`, `amrap`, `emom`, `intervals`, `complex`, `circuit`, `skill`
     - `domain:` $\to$ `crossfit`, `parkour`, `swimming`, `triathlon`, `climbing`, `girevoy-sport`
     - `intent:` $\to$ `benchmark`, `competition`, `sport`

---

## 3. The Block $\leftrightarrow$ Effort Cross Table (`block_efforts`)

### The Problem
Historically, finding which notes contain an exercise (e.g. `thruster` or `pull-up`) required:
1. Scanning raw script text with regex/substrings (unreliable, misses aliases/synonyms), or
2. Querying historical session telemetry events (fails entirely for unperformed seed wods).

### Proposed Schema: `block_efforts`

A dedicated relational junction indexed in IndexedDB:

```ts
export interface BlockEffort {
  id: string;               // UUID or deterministic hash
  noteId: string;           // Parent Note UUID
  blockId: string;          // Positional block ID within note
  blockContentId: string;   // Structural content hash (SHA-256 of parsed block AST)
  effortSlug: string;       // Canonical exercise slug (e.g. 'thruster', 'pull-up')
  reps?: number;            // Nominal reps if statically declarable
  load?: string;            // Nominal load string (e.g. '95lb')
}
```

#### Object Store Indexes (`block_efforts`):
- `by-effort` (key: `effortSlug`) $\to$ Instant lookup of all `noteId`s and `blockContentId`s containing the exercise.
- `by-note` (key: `noteId`) $\to$ Instant lookup of all exercises contained within a note.
- `by-block` (key: `blockContentId`) $\to$ All exercises within a specific block.

### Materialization Points
1. **Seed Compiler (`scripts/generate-seed.ts`)**:
   During build, for every `wod` section parsed by `parseDocumentSections()`:
   - Extract statement AST efforts: `section.scriptBlock.statements.map(s => s.effortSlug)`.
   - Emits precomputed `block-efforts.<n>.json` chunks alongside `block-index`.
2. **User Save (`IndexedDBContentProvider.ts`)**:
   When saving a user note:
   - Run `parseDocumentSections(rawContent)`.
   - Clear existing `block_efforts` for `noteId`.
   - Insert new rows for each detected effort statement.

---

## 4. Multi-Level Search Hierarchy & Join Algebra

WQL queries operate across 4 distinct target planes:

```
Level 1: Page    (Placements & Groupings)     find:page
Level 2: Note    (Authored Workouts)          find:note
Level 3: Block   (Script Sections / WODs)     find:block
Level 4: Fact    (Telemetry & Executions)     rows:all / rows:segment / sum:
```

### Join Execution Matrix

```
┌─────────────────┐       page_notes
│    find:page    │ ◄─────────────────────┐
└─────────────────┘                       │
                                          │
┌─────────────────┐       note_tags       ▼       block_efforts
│    find:note    │ ◄────────────────── [Note] ────────────────► [Effort]
└─────────────────┘                                                ▲
         │                                                         │
         │ block_index                                             │
         ▼                                                         │
┌─────────────────┐                                                │
│   find:block    │ ───────────────────────────────────────────────┘
└─────────────────┘
         │
         │ blockContentId / noteId
         ▼
┌─────────────────┐
│ rows: / agg:    │ (Analytics Events & Telemetry)
└─────────────────┘
```

### 1. Level 1: `find:page` (Page Searches)
Finds collections, dashboards, or daily journal pages containing notes with specific tags, efforts, or metadata.
- **Example**:
  ```wql
  find:page{domain:crossfit, intent:benchmark}
  find:page{effort:clean-and-jerk}
  ```
- **Join Resolution**:
  $$\text{Query Predicate } \{k: v\} \xrightarrow{\text{note\_tags} \text{ or } \text{block\_efforts}} \text{Candidate Note IDs } \xrightarrow[\text{by-note}]{\text{page\_notes}} \text{Page IDs}$$

### 2. Level 2: `find:note` (Note Searches)
Finds authored workout notes by tag dimensions and exercise containment.
- **Example**:
  ```wql
  find:note{effort:thruster, equipment:barbell, format:for-time}
  ```
- **Join Resolution**:
  1. $\text{Notes}_{\text{tags}} = \text{note\_tags}(\text{equipment}=\text{barbell}) \cap \text{note\_tags}(\text{format}=\text{for-time})$.
  2. $\text{Notes}_{\text{effort}} = \text{block\_efforts}(\text{effort}=\text{thruster})$.
  3. $\text{Result} = \text{Notes}_{\text{tags}} \cap \text{Notes}_{\text{effort}}$.

### 3. Level 3: `find:block` (Block Searches)
Discovers specific workout blocks within notes matching structural or note-level criteria.
- **Example 1: Direct Effort Containment**:
  ```wql
  find:block{effort:pull-up}
  ```
  Resolves directly via `block_efforts.getAllFromIndex('by-effort', 'pull-up')` $\to$ returns matching `blockContentId`s in $O(1)$ time.
- **Example 2: Cross-Store Note Join**:
  ```wql
  find:block where find:note{domain:parkour, format:intervals}
  ```
  Resolves:
  1. Subquery $\text{find:note} \to \{ \text{noteId}_1, \text{noteId}_2, \dots \}$.
  2. Scans `block_index` where `noteId IN (candidateNoteIds)`.

### 4. Level 4: `rows:` and Analytics Aggregates (Session Telemetry)
Computes performance metrics across workouts filtered by note metadata or exercise containment.
- **Example 1: Scoped Rows**:
  ```wql
  rows:segment{effort:snatch} where find:note{format:emom} last 8w
  ```
  Resolves:
  1. Subquery $\text{find:note\{format:emom\}} \to \{ \text{noteId}_k \}$.
  2. Filters `events` table where `noteId IN (noteIds) AND effortSlug == 'snatch' AND timestamp >= now - 8w`.
- **Example 2: Cross-Store Metric Join**:
  ```wql
  sum:totalVolume{effort:thruster} where find:note{domain:crossfit, intent:benchmark}
  ```
  Calculates cumulative thruster tonnage strictly across benchmark CrossFit workouts.

---

## 5. Query Translation Matrix

| Analytical Question | Old WQL (V10-V20) | New WQL (V24+ with Typed Tags & Block Efforts) | Internal Execution Optimization |
|---|---|---|---|
| **Find all workouts using a kettlebell** | `find:note{tags:kettlebell}` | `find:note{equipment:kettlebell}` | Indexed typed tag lookup via `note_tags`. |
| **Find benchmark workouts with thrusters** | `find:note{text:thruster, tags:benchmark}` | `find:note{effort:thruster, intent:benchmark}` | Set intersection between `block_efforts` and `note_tags`; zero regex scanning. |
| **Find all EMOM workouts containing pullups** | `find:block{text:emom}` *(fragile)* | `find:block{effort:pull-up} where find:note{format:emom}` | Exact effort containment joined with note `format` tag. |
| **Find collections containing swimming workouts** | *Not expressible* | `find:page{domain:swimming}` | Joins `note_tags('domain', 'swimming')` $\to$ `page_notes` $\to$ `page`. |
| **Total volume on benchmark days** | `sum:totalVolume{tags:benchmark}` | `sum:totalVolume{} where find:note{intent:benchmark}` | Joins telemetry fact stream to candidate notes. |

---

## 6. Implementation Roadmap

1. **`block_efforts` Table & Compiler**:
   - Add `block_efforts` store to `IndexedDBStorage.ts` and `FeedImportStorage.ts`.
   - Update `scripts/generate-seed.ts` to emit precomputed `block-efforts.<n>.json` chunks.
   - Update `IndexedDBContentProvider.ts` to sync `block_efforts` on note edit/save.
2. **WQL Grammar & Vocabulary Update**:
   - In `packages/wql/src/vocabulary.ts`, promote `domain`, `format`, `equipment`, `quality`, `intent` to canonical filter keys.
   - Update `QueryService.ts` to resolve `find:note{effort:...}` and `find:block{effort:...}` using the `block_efforts` store.
3. **Typeahead Completion Service**:
   - In `packages/wql/src/language.ts`, update `tagValueOptions` to query distinct values from the `tags` store dynamically based on the active key.
