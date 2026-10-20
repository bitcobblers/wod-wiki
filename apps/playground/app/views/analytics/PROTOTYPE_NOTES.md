# Prototype Verdict & Research Notes: Analytics Explorer Query Builder (V2 Refinement)

> **Prototype File:** [`playground/src/views/analytics/PROTOTYPE_analytics_query_builder.html`](./PROTOTYPE_analytics_query_builder.html)  
> **Date:** July 26, 2026  
> **Status:** Validated & Refined for Existing Wod-Wiki Log Data Streams & Analytics Store Architecture

---

## 1. The Core Question Answered

**Question:** *How can non-technical athletes and coaches compose analytics queries intuitively in `wod-wiki` without needing to memorize cryptic Datadog-flavored WQL syntax (e.g. `sum:totalVolume{discipline:strength} by {week}.rollup(1w)`) — while preserving raw WQL efficiency for power users?*

### The Problem with Current WQL UX
1. **Cryptic Syntax Barrier**: Mandatory colons, curly braces, negated filters (`!discipline:recovery`), `by {}` clauses, and `.rollup()` method calls require developer-level syntax precision.
2. **Vocabulary Discoverability**: Non-technical users do not know which Canonical Metric Keys (`totalVolume`, `tis`, `sessionLoad`, `totalReps`, `calc.acwr`) or Tag Keys (`discipline`, `effort`, `intensity`, `note`, `origin`) exist in the store.
3. **Lack of Semantic Reassurance**: Users who write or click a query cannot easily verify if the result actually answers their real-world training question ("Is my strength volume increasing week-over-week?").

---

## 2. Real Data Architecture Mapping in Wod-Wiki

Our refined prototype directly models the two-layer derivation architecture documented in `CONTEXT.md` and `src/services/analytics/workoutDerivation.ts`:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. WORKOUT RESULT LOG STREAM (WorkoutResult.data.logs)                       │
│    Single stream holding StoredOutputStatement[]                             │
│    - Tier 0: outputType = 'segment' (raw metrics: duration, rep, resistance)│
│    - Tier 1: outputType = 'segment' + origin = 'analyzed' (pace, power)     │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │  deriveWorkoutFromLogs()
                                      ▼  normalizeSummaryFacts()
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. INDEXEDDB ANALYTICS STORE (AnalyticsDataPoint Fact Rows)                  │
│    Cross-workout summary facts table (grain: 'summary' | 'rollup')           │
│    Indexed by: type, effortSlug, discipline, intensityTier, timestamp       │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │  QueryService.runQuery()
                                      ▼  wql.ts Lezer Parser
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. WQL EXPRESSION & DUAL-MODE COMPOSER                                      │
│    sum:totalVolume{discipline:strength} by {week}.rollup(1w)                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Supported Metric Tiers in Wod-Wiki:
1. **Tier 2 Summary Facts (Whole Workout Engines)**:
   - `totalVolume`: Weight Volume (`VolumeProjectionEngine`)
   - `tis`: Time-in-Motion in seconds (`TISProcessor`)
   - `sessionLoad`: RPE × Duration Strain (`SessionLoadProjectionEngine`)
   - `totalReps`: Total Repetitions Count (`RepProjectionEngine`)
   - `totalDistance`: Total Distance in meters (`DistanceProjectionEngine`)
   - `metMinutes`: Energy Expenditure in MET-min (`MetMinuteProjectionEngine`)
2. **Rollup Window Fact Rows (Lazy Rollup Driver)**:
   - `calc.acwr`: Acute-to-Chronic Workload Ratio (Injury Risk)
   - `calc.monotony`: Daily Workload Monotony
   - `calc.strain`: Weekly Workload Strain Index
3. **Tier 0/1 Segment Log Data Points**:
   - `elapsed`: Segment Duration
   - `pace`: Realtime Pace (`PaceEnrichmentProcess` sec/km)
   - `power`: Realtime Power (`PowerEnrichmentProcess` watts)

---

## 3. Tested Composition Paradigms

We created an interactive prototype ([`PROTOTYPE_analytics_query_builder.html`](./PROTOTYPE_analytics_query_builder.html)) testing 3 distinct UX models, with a primary focus on refining **Model C (Dual Mode)**:

### Model A: Guided Natural Language / Mad-Libs Sentence Composer
- **Concept:** A fill-in-the-blanks human sentence builder:
  > *"Show me the **[Sum]** of **[Total Volume]** for **[Strength Workouts]** grouped by **[Week]** rolled up every **[1 Week]**."*
- **Pros:** Zero learning curve; 100% syntax-safe dropdowns; immediately understandable by non-technical athletes.
- **Cons:** Linear flow can be verbose for complex multi-filter queries.

### Model B: Visual Form & Pill Query Builder
- **Concept:** Structured form sections separating:
  1. **Function & Metric** (Aggregator pills + Human-labeled Canonical Metric dropdown)
  2. **Tag Filters** (Dynamic filter rows with `IS` / `NOT` toggle pills and add/remove buttons)
  3. **Grouping & Rollup** (Group-by dimension pills + Rollup period pills)
- **Pros:** Highly flexible; easy to add/remove multiple tag filters; clear visual structure.
- **Cons:** Requires slightly more UI vertical space.

### Model C: Refined Dual-Mode Hybrid Model (Recommended Architecture)
- **Concept:** A unified, single-source-of-truth query state engine with bidirectional live sync:
  - Changing controls in **Visual Form Controls** (or Guided Question) live-compiles to canonical WQL syntax.
  - Typing or pasting raw WQL in the **Raw Editor** parses into the AST in real-time, instantly updating the Visual Form controls and generating a **Human English Translation Banner**.
  - Includes a **Log Stream ➔ Analytics Fact Lineage Inspector** showing how raw `StoredOutputStatement` logs get normalized into `AnalyticsDataPoint` store rows and matched by WQL.
- **Pros:** Best of all worlds — onboarding beginners with zero friction while empowering coaches and power users with fast raw WQL typing.

---

## 4. Cross-Surface Integration Architecture

```
                       ┌──────────────────────────────┐
                       │   useQueryComposerState()    │
                       │  (Bidirectional WQL AST)     │
                       └──────────────┬───────────────┘
                                      │
           ┌──────────────────────────┼──────────────────────────┐
           ▼                          ▼                          ▼
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│  Analytics Explorer  │   │  Wayfinder Command   │   │  ```dashboard Block │
│  (/analytics/explorer│   │  Palette (Issue #725)│   │  Widget Inspector    │
└──────────────────────┘   └──────────────────────┘   └──────────────────────┘
│ Visual / Code / Dual │   │ Quick Query Launcher │   │ Visual/Raw Modal for │
│ search bar tabs      │   │ + Natural Presets    │   │ Markdown dashboards  │
└──────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

### Surface 1: Analytics Explorer Search (`/analytics/explorer`)
- Replace single static input with `<WqlQueryComposer mode="dual" />`.
- Provide mode switcher tabs above the search bar (`Visual`, `Code`, `Dual`, `Guided`).
- Sidebar selections (Metric keys, Tag keys) populate visual pills or raw query field seamlessly.

### Surface 2: Wayfinder Integration (Issue #725 - Command Palette & Search)
- Wayfinder (`Cmd+/`) registers an Analytics Search extension:
  - Detects inputs starting with `sum:`, `avg:`, `count:`, `last:`, `metric:`, or `query:`.
  - Renders inline compact visual pill composer inside the Wayfinder modal.
  - Presets appear as instant searchable actions (*"Is strength volume rising?"*).
  - Pressing `Enter` launches directly into `/analytics/explorer?q=...` or previews inline charts within Wayfinder.

### Surface 3: ` ```dashboard ` Block & Widget Editor
- Markdown notes and the Coaching Dashboard (`/analytics/dashboard`) use ` ```dashboard ` fenced blocks.
- Add an **"Edit Widget Query"** button / CodeMirror gutter action over ` ```dashboard ` blocks:
  - Opens a modal containing `<WqlQueryComposer mode="dual" />`.
  - Non-technical users edit widget queries via visual pills (Metric, Discipline, Effort, Rollup).
  - Serializes back into YAML/WQL block source automatically:
    ```time
    ```dashboard
    widgets:
      - title: Weekly Strength Volume
        query: sum:totalVolume{discipline:strength} by {week}.rollup(1w)
    ```

---

## 5. Comparative Evaluation Matrix

| Metric / Dimension | Raw WQL String (Current) | Guided Sentence Builder | Visual Form / Pills | Bidirectional Hybrid (Refined Dual Mode) |
|---|---|---|---|---|
| **Target Audience** | Developers / Analysts | Beginners / Athletes | Coaches / Regular Users | **All Personas** |
| **Learning Curve** | High (Syntax rules) | **Zero (Natural English)** | Low (Self-explanatory) | **Progressive (Adapts to user)** |
| **Syntax Error Rate** | High (Typo-prone) | **0% (Dropdowns)** | **0% (Structured pills)** | **0% (Validated AST + Live Parser)** |
| **Discoverability** | Low (Requires docs/sidebar) | High (Human labels) | High (Category lists) | **Maximum (Interactive UI + Catalog Dropdowns)** |
| **Power & Speed** | High for experts | Medium | High | **Maximum** |
| **Recommendation** | Keep in Dual View | Great default mode | Primary visual editor | **★ WINNING ARCHITECTURE** |

---

## 6. Implementation Roadmap for Production (`src/` / `playground/src/`)

1. **Extract AST State Hook (`useQueryComposerState`)**:
   - Create a reusable hook wrapping `parseQuery` and `serializeQuery` from `@/services/analytics/query/wql`.
2. **Build `<WqlQueryComposer />` Shared Organism**:
   - Create `src/components/organisms/analytics/WqlQueryComposer.tsx` supporting `mode="visual" | "code" | "dual" | "guided"`.
3. **Build `<WqlHumanTranslationBanner />` Molecule**:
   - Create `src/components/molecules/analytics/WqlHumanTranslationBanner.tsx`.
4. **Integrate into Analytics Explorer (`/analytics/explorer`)**:
   - Replace static field in `AnalyticsExplorerPage.tsx` with `<WqlQueryComposer mode="dual" />`.
5. **Integrate into Wayfinder (`Cmd+/` - Issue #725)**:
   - Add WQL query provider and preset launcher actions into Wayfinder command palette.
6. **Integrate into ` ```dashboard ` Block Inspector**:
   - Mount "Edit Widget Query" inspector modal using `<WqlQueryComposer mode="dual" />` inside markdown editor and `AnalyticsDashboardPage.tsx`.
