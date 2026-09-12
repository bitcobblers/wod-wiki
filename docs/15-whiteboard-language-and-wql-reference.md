# Whiteboard Language & WQL — Complete Syntax Reference

Two languages, one document: the **Whiteboard Language** (workout scripts inside `time`/`log`
fences) and **WQL** (the Wod Query Language that reads what those scripts produced).

Every claim below is grounded in the implementation, not in older prose docs. Where a doc and
the code disagreed, the code won and the discrepancy is called out in
[§A9](#a9-verified-behaviour-notes) / [§B9](#b9-deprecated-syntax-advisories-and-errors).

Source of truth:

| Area | Files |
| --- | --- |
| Whiteboard grammar | `packages/lang/src/grammar/whiteboardscript.grammar` |
| Whiteboard AST/classification | `packages/lang/src/parser/{syntax-parser,semantic-classifier,lezer-mapper,parseScript}.ts` |
| Units | `packages/lang/src/metrics/units/UnitRegistry.ts`, `packages/lang/src/dialects/units/fuseUnits.ts` |
| Dialects | `packages/lang/src/dialects/*.ts` |
| WQL grammar / AST | `packages/wql/src/grammar/wql.grammar`, `packages/wql/src/wql.ts` |
| WQL suffixes | `packages/wql/src/wqlSuffix.ts` |
| WQL vocabulary | `packages/wql/src/vocabulary.ts`, `packages/wql/src/disciplines.ts` |
| WQL documents / dashboards | `packages/wql/src/document.ts`, `packages/wql/src/dashboard/*` |
| Fence tags (app) | `apps/playground/src/components/Editor/types/section.ts`, `.../utils/blockDetection.ts` |

Verification: every example in this document was executed against the real parser
(`bun` → `parseScript` / `parseQuery`); see [Appendix V](#appendix-v--verification).

---

# Part A — The Whiteboard Language

## A1. Where a script lives

A script is the body of a fenced block. The application treats exactly two base tags as workout
scripts (`VALID_FENCE_DIALECTS` in `apps/playground/src/components/Editor/types/section.ts`):

| Fence | Meaning in the app | Run affordance |
| --- | --- | --- |
| triple-backtick `time` | the session you intend to run (prescription, template, draft) | `run` |
| triple-backtick `log` | what actually happened (recorded work) | `log` |

An optional `:sport` suffix scopes the dialect stack (§A6): triple-backtick `log:climbing`.

```time
(5 Sets)
  3 Back Squat 225lb
  *2:00 Rest
```

Notes:

- The editor's language resolver additionally maps the aliases `wod` and `whiteboard` onto the
  same language (`resolveCodeLanguage`, `packages/ui/src/extensions/editorPreset.ts`), and `wql`
  / `query` onto WQL. Older docs listing `climb`, `cardio`, `yoga`, `habits` as *fence tags* are
  wrong: those are **dialect ids / `:sport` suffixes**, not base tags.
- Markdown (`#` headings, paragraphs, tables, task lists) lives *outside* the fence. A single
  note may hold many fenced blocks.
- Everything inside the fence is statements. There is no header, no import, no terminator.

## A2. Statement model

```
Statement := (Lap)? Fragment+            -- one per line
Lap       := "+" | "-"
Fragment  := Duration | Rounds | Action | Text | Heading | Quantity | "/" | "|" | Effort | {…}
```

- **One statement per line.** A line break always ends a statement.
- **Indentation is ownership.** A statement indented deeper than the previous one becomes its
  child (its `parent` is set, and it appears in the parent's `children` groups). All intermediate
  ancestors are recorded, not just the immediate one.
- Children are grouped by **lap marker**: a `+` child is appended to the previous group; every
  other child (`-` or no marker) starts a new group. `(3)` with children `+ 5 A`, `+ 5 B`, `10 C`,
  `+ 1 D` yields groups `[[A, B], [C, D]]`.
- Blank lines are ignored by nesting — only indentation decides parenthood, so a blank line
  between two indented statements does not detach the second one.
- Fragment order on a line is flexible; the canonical reading order is
  `[lap] [rounds] [duration] [reps] [effort] [load] [distance]`.

```time
(3)
  (4)
    :20 Work
    :10 Rest
    Burpees
  1:00 Rest
```

The parse above yields: L1 rounds=3 with children `[[2],[3],[4],[5],[6]]`; L2 rounds=4 with
children `[[3],[4],[5]]`; L3–L5 children of L2; L6 a child of L1.

## A3. Fragment reference

### A3.1 Reps

| Syntax | Result |
| --- | --- |
| `10 Pushups` | `Rep(10)` + `Effort("Pushups")` |
| `? Pullups` | `Rep(undefined)` — collectible rep count, athlete fills it in |
| `10 Thrusters 95lb` | reps + load on one statement |

### A3.2 Durations and timer modifiers

| Syntax           | Meaning                                           | Emitted                                     |     |
| ---------------- | ------------------------------------------------- | ------------------------------------------- | --- |
| `5:00`           | 5-minute timer                                    | `Duration(300000 ms)`                       |     |
| `:30`            | 30 seconds (colon prefix required under a minute) | `Duration(30000)`                           |     |
| `1:30:00`        | 90 minutes (`H:MM:SS`)                            | `Duration(5400000)`                         |     |
| `^5:00`          | count **up** to 5:00 instead of down              | `Duration` with trend                       |     |
| `*:30` / `*1:00` | timer cannot be skipped                           | `Duration` + hint `behavior.required_timer` |     |
| `:?`             | collectible timer — records actual elapsed time   | `Duration(undefined)`                       |     |
| `^:?`            | collectible **count-up** timer                    | `Duration(undefined)` with trend            |     |
| `5:00 Run :?`    | fixed 5:00 **plus** a recorded result             | two `Duration` metrics                      |     |

A duration can be the whole line (`5:00`), prefix a movement (`5:00 Run`), or parent a block
(`20:00` + indented children = time cap).

```time
5:00 Run
^5:00 Row
*:30 Rest
:? Max Effort Pushups
```

### A3.3 Rounds, labels and rep ladders

| Syntax | Result |
| --- | --- |
| `(3)` | 3 rounds |
| `(3 Rounds)` | 3 rounds (label ignored once a number is present) |
| `(Warmup)` | **named group** — a rounds metric carrying the label `Warmup` |
| `(21-15-9)` | 3 rounds + rep scheme 21, 15, 9 projected into each round |
| `(10-9-…-1)` | descending ladder — one rep value per round |
| `(5 Sets)` | 5 rounds (the word after the number is a label) |

Rounds may contain rounds; each level keeps its own children.

```time
(21-15-9)
  Thrusters 95lb
  Pullups
```

### A3.4 Lap markers

| Marker | Meaning | Metric |
| --- | --- | --- |
| `+` | composed siblings — performed in the same interval/set | `Group("compose")` |
| `-` | alternates / branch of a superset | `Group("round")` |

```time
(6) :60 EMOM
  - 5 Pullups
  - 8 Pushups
```

### A3.5 Effort text

Free text is an `Effort` metric. Adjacent words separated by a single space merge into one effort
(`Snatch grip deadlift`, `Chest-to-Bar Pull Ups`). Punctuation between word tokens is preserved
in the effort's raw text — apostrophes (`Child's Pose`), commas (`Clean, Jerk`) and ampersands
(`A & B`) all round-trip exactly.

| Example | Result |
| --- | --- |
| `400m Run easy` | distance + effort `Run` + effort `easy` |
| `10 Pull-ups` | `Rep(10)` + `Effort("Pull-ups")` |
| `3 Clean & Jerk 135lb` | reps + `Effort("Clean & Jerk")` + load |

### A3.6 Distance

| Syntax | Result |
| --- | --- |
| `400m Run` | `Distance(400, m)` + residual effort `Run` |
| `400 m Run` | same (whitespace between number and unit is fine) |
| `Bike 10 miles` | `Distance(10, miles)` — the raw spelling is preserved, dimension `length` |
| `?m Run` | collectible distance |
| `5km Run` | `Distance(5, km)` |

Registered length units (canonical spelling → aliases):
`m` (meter/metre…), `km`, `cm`, `mm`, `ft` (foot/feet), `in` (inch/inches), `yd` (yard/yards),
`mi` (mile/miles). Lookup is case-insensitive.

### A3.7 Resistance / load

| Syntax | Result |
| --- | --- |
| `225lb`, `225 lb`, `140kg` | `Resistance(225, lb)` / `Resistance(140, kg)` |
| `@225lb` | `@` binds a load explicitly: `Resistance(225, lb)` |
| `?lb`, `?kg` | collectible load (prompted at runtime) |
| `1.5bw`, `1.5 bodyweight` | bodyweight multiple as a mass unit |
| `5 Deadlifts ? lb` | collectible load, spaced form |

Registered mass units: `kg` (kilo/kilos…), `g`, `lb` (lbs/pound/pounds), `bw` (bodyweight).
**`pood` is not registered** — `2 pood` parses as `Rep(2)` + effort `pood`.

Fusion rule: a bare number (or a `@`-load with an empty unit) fuses with the unit token that
starts the *next* fragment. That is why `10 Dip bw` stays one effort (`bw` is not the leading
token of anything) while `10 Deadlift 1.5bw` fuses.

### A3.8 Energy

`20 cal`, `100 kcal` → `Energy(20, cal)` / `Energy(100, kcal)`. Units: `cal`/`cals`/`calorie(s)`,
`kcal`/`kilocalorie(s)`.

### A3.9 Intensity percentage

`Run 400m 80%` → `Intensity(80, %)`. The `%` symbol is fused by the units dialect, so it is
distinct from a unit token but behaves like one (`Intensity` metric type).

### A3.10 Fractions

`number / number unit` becomes a single decimal measurement:

```time
1/4 mile Run     // Distance(0.25, mile)
1/2 mile Walk    // Distance(0.5, mile)
```

A `/` between **different** metric types is dropped silently (`10 Pull Ups / 20 Push Ups` yields
two rep/effort pairs, not a choice).

### A3.11 Choice groups

A pipe between two alternatives **of the same metric type** produces a `Choice` metric:

| Syntax | Result |
| --- | --- |
| `10 Pull Ups \| Chest-to-Bar Pull Ups` | `Choice([Effort, Effort])` |
| `185 \| 125 lb Deadlift` | `Choice([Resistance(185,lb), Resistance(125,lb)])` |

The runner resolves the choice (first alternative preselected) before the clock starts.
A heterogeneous pipe (`Run | 5`) is dropped.

> **Careful:** `185/125 lb` is *not* a choice — the slash path wins and produces
> `Resistance(1.48, lb)`. Use the pipe form for load choices.

### A3.12 Actions

Square brackets mark non-movement steps. They render as cue cards in the timer and are ordinary
child statements for nesting and lap grouping.

| Syntax | Result |
| --- | --- |
| `[Setup Barbell]` | `Action("Setup Barbell")` |
| `[:!pinned]` | colon-prefixed action, `isPinned = true`, name `pinned` |
| `[Adjust plates]` | action with a space |

Actions are branch-agnostic: they do not consume a round, they are steps.

### A3.13 Comments and in-block headings

| Syntax | Result |
| --- | --- |
| `// coach note` | `Text("coach note")` — passive, never affects the timer |
| `# Warmup` / `## Block` | `Text(<content>, level)` — in-block heading |

Markdown headings normally live outside the fence; inside a block, `#` lines are swallowed as
text statements.

### A3.14 Custom metric objects

An inline JSON object anywhere on a line becomes one metric per key.

```time
5 Back Squat 225lb {"intensity": 80, "rpe": 8, "note": "tough", "flag": true}
```

- Values may be numbers, strings, booleans, or `null`.
- Known keys map to canonical metric types (`rpe` → `session-rpe`, `rir`, `intensity`, `load`,
  `volume`, `work`); any other key stays a `custom` metric.
- Malformed JSON emits no pairs but preserves the raw line.
- The object may appear anywhere on the statement, and several may be combined.

### A3.15 Property lines

A whole-line `key: value` statement attaches a property to the document.

```time
rpe: 8
location: "Garage"
surface: indoor
(5 Sets)
  5 Deadlifts 225lb
  *2:00 Rest
```

| Value form | Parsed as |
| --- | --- |
| `8` | number (no leading sign — `-1.5` degrades to a lap marker plus a rep) |
| `"Garage"` | string (JSON-style escapes honoured) |
| `indoor` | bare identifier → string |
| `true` / `false` / `null` | boolean / null |
| `rpe: 8` / `rpe:abc` / `rpe : 8` | valid; **`rpe:8` is not** — the lexer takes `:8` as a timer and the line parses as duration 8000 ms |

Key mapping (`PROPERTY_KEY_TO_METRIC_TYPE`): `rpe` → SessionRPE, `rir` → RIR,
`intensity` → Intensity, `load` → Load, `volume` → Volume, `work` → Work. Everything else →
`custom`. Property lines are ordinary statements for nesting: they can parent an indented line
(`rpe: 8` followed by an indented movement) and can themselves be indented under a group — write
them at column 0 unless you mean that.

### A3.16 Collectible (`?`) values — summary

| Placeholder | Collects |
| --- | --- |
| `?` | reps |
| `:?` | elapsed time (counts up, records the result) |
| `^:?` | explicit count-up collectible timer |
| `?lb` / `?kg` | resistance |
| `?m` / `?km` / `?mile` | distance |

Prescribed values are written literally (`95lb`, `400m`, `21`); discovered values use `?`.

## A4. Protocol keywords and runtime hints

Keywords are matched case-insensitively inside `Effort`/`Action` text. A dialect turns them into
`Hint` metrics that the compiler and label composer consume
(`packages/lang/src/metrics/hints.ts` → `CONSUMED_HINTS`).

| Keyword | Hints emitted | Consumed by |
| --- | --- | --- |
| `AMRAP` | `behavior.time_bound`, `workout.amrap` | label → **AMRAP** |
| `EMOM` | `behavior.repeating_interval`, `workout.emom` | interval strategy, label → **EMOM** |
| `TABATA` | `behavior.repeating_interval`, `workout.tabata` | interval strategy, label → **Tabata** |
| `FOR TIME` | `behavior.time_bound`, `workout.for_time` | label → **For Time** |
| `STRENGTH` | `domain.wod`, `workout.strength`, `behavior.load_bearing` | analytics only |
| `METCON` / `METABOLIC` | `domain.wod`, `workout.metcon` | analytics only |
| `SKILL` / `SKILLS` / `TECHNIQUE` | `domain.wod`, `workout.skills` | analytics only |
| `WOD` | `domain.wod` | analytics only |
| `SUPERSET` | `domain.wod`, `workout.superset` | analytics only |
| `RUN`, `JOG`, `SPRINT` | `domain.cardio`, `workout.run`, `behavior.aerobic` (+ distance/pace hints if a distance is present) | analytics only |
| `ROW`/`ROWING`, `BIKE`/`CYCLE`/`CYCLING`, `SWIM`/`SWIMMING`, `WALK`/`WALKING` | `domain.cardio`, `workout.<modality>` | analytics only |
| any distance-only statement | `domain.cardio`, `behavior.distance_based`, `behavior.pace_based` | analytics only |
| `*` before a timer | `behavior.required_timer` | cannot be skipped |

Only these are *compiler-consumed*: `behavior.repeating_interval`, `behavior.required_timer`,
`behavior.inject_rest`, plus the four label hints. Everything else is analytics-only.

```time
20:00 AMRAP
  5 Pullups
  10 Pushups
  15 Air Squats
```

## A5. Implicit EMOM

A parent statement carrying **both** a rounds count and a timer, **and** having children, is
compiled as a repeating interval even without the word `EMOM`:

```time
(10) 1:00
  5 Burpees
```

→ `rounds=10`, `duration=60000`, hints `behavior.repeating_interval`, `workout.emom`,
`workout.implicit_emom`. `(10) :60` behaves identically. The keyword form is
`(20) 1:00 EMOM` / `(10) :60 EMOM`.

## A6. Dialect stack and `:sport`

`parseScript` runs the **Dialect Stack** on every statement: the base `UnitsDialect` first (it
fuses numbers with units), then the sport dialects, then any personal overrides.

| Dialect id | `:sport` aliases | Recognises |
| --- | --- | --- |
| `units` | — (always first) | number + unit fusion, `%`, fractions, choice groups |
| `crossfit` | — | AMRAP, EMOM (+ implicit), FOR TIME, TABATA |
| `wod` | — | STRENGTH, METCON, SKILLS, WOD, SUPERSET |
| `cardio` | — | RUN/ROW/BIKE/SWIM/WALK families, distance-only statements |
| `yoga` | — | pose vocabulary, flows (SUN SALUTATION, VINYASA, FLOW, SEQUENCE), breathing, meditation |
| `habits` | — | DAILY / HABIT / STREAK / CHECK / LOG / MORNING / EVENING / ROUTINE |
| `climb` | `climbing` | grades, send types, attempts, high points, disciplines (§A7) |

- No suffix → the full stack runs.
- `<dialect-id>` or a known alias → only `units` + that dialect.
- Unknown suffix → warns once and falls back to the full stack.

```time
Warrior II :60
daily morning routine
```

→ `domain.yoga` + `workout.pose` + `behavior.hold` on the first line;
`domain.habits` + `workout.habit_check` + `behavior.completable` + `behavior.daily` on the second.

## A7. Climbing dialect syntax

| Element | Syntax | Emitted metric |
| --- | --- | --- |
| Route/problem name | `[The Shield]` (the Action metric) | `climb-route-name` |
| Grade | `V7`, `V0-` (V-scale); `7A` (Font, **uppercase only**); `5.11a`, `5.12c` (YDS) | `climb-grade` `{raw, system, normalizedRank}` |
| Send type | `onsight`/`os`, `flash`/`fl`, `redpoint`/`rp`/`sent`/`send`, `repeat`/`resend`, `dogged`/`hangdog`/`a0`, `tr`/`toprope`/`top-rope`, `dnf`/`attempted`, `not sent`, `with falls` | `climb-send-type` |
| Attempts | `@N` (an `@` load with no unit) | `climb-attempt-count` |
| High point | `bolt 6`, `move 9`, `crux 4`, `high point 5` | `climb-high-point` |
| Discipline | `boulder`/`bouldering`, `sport`, `trad`, `top rope`, `hangboard`, `moonboard`/`kilter`/`board` | `climb-discipline` |

Grade systems: `v-scale`, `font`, `yds`, `french` (plus `uiaa`, `ewbank`, `british`, `dankyu`
declared by the type). A V/Font grade implies `bouldering`; a YDS/French grade implies `sport`.
A `dnf`/`attempted` line also hints `climb.project`. Coverage is uneven — see §A9.

```text
date: 2026-05-26
location: "Sender One LAX"
discipline: bouldering

(Warmup)
  [Slab Warmup] V0 flash @1 // quiet feet
  [Jug Ladder] V2 flash @1

(Project)
  [The Shield] V7 redpoint @12 // engage core before crux reach
```

Frontmatter lines (`date:`, `location:`, `discipline:`) are the note's own frontmatter, not the
climb dialect's; inside a fence they parse as property statements.

## A8. Metric vocabulary emitted by the parser

| Metric type (`MetricType`) | Produced by |
| --- | --- |
| `rep` | bare integer, `?` |
| `effort` | free text |
| `duration` | `M:SS`, `:SS`, `H:MM:SS`, `:?` (+ trend/required flags) |
| `rounds` | `(N)`, `(Label)`, `(N Label)`, `(3 Rounds)` |
| `group` | `+` (compose) / `-` (round) lap markers |
| `distance` | number + length unit, `?m` |
| `resistance` | number + mass unit, `@N…`, `?lb`, bodyweight |
| `intensity` | `80%`, `{"intensity":…}`, `intensity:` |
| `energy` | `20 cal`, `100 kcal` |
| `action` | `[…]` (with `isPinned` for `[:!…]`) |
| `text` | `//` comment, `#` heading (carries level) |
| `choice` | pipe-separated same-type alternatives |
| `custom` / `session-rpe` / `rir` / `load` / `volume` / `work` | property lines and JSON metric objects |
| `hint` | dialect markers (`workout.*`, `behavior.*`, `domain.*`, `climb.*`) |
| `climb-*` | ClimbDialect (§A7) |

## A9. Verified behaviour notes

These are observed parser behaviours (executed, not read from prose). They matter when writing
scripts:

1. **Units fuse only as a leading token of the following fragment.** `400 m Run` works, but
   `10 Dip bw` leaves `bw` inside the effort text — bodyweight loads must lead: `1.5bw`.
2. **`pood` is not a registered unit** despite older docs; the same applies to any unlisted unit.
   Unrecognised units degrade to rep + effort text.
3. **`185/125 lb` is a fraction, not a load choice** (`Resistance(1.48, lb)`). Use `185 | 125 lb`.
4. **A slash between different metric types is dropped** (no error).
5. **`(3 Rounds)` drops the word** — the number wins. Only a label with no number (`(Warmup)`,
   `(AMRAP)`) survives as the group's label.
6. **Implicit EMOM needs rounds + timer in the same statement.** `(10)` on the parent and `1:00`
   on a child does not trigger it; write `(10) 1:00` or `(10) :60 EMOM`.
7. **`5x5 Back Squat` is not a set notation** — it parses as `Rep(5)` plus effort `x5 Back Squat`.
   Write `(5 Sets)` with `5 Back Squat`.
8. **Climb-grade coverage is uneven.** V-scale (`V7`, `V0-`), uppercase Font (`7A`) and most YDS
   grades (`5.11a`, `5.12c`) round-trip. But `5.10b` degrades to `5.1b` (the lexer drops the
   trailing zero), and lowercase French/Font (`7a`, `7a+`) is not detected at all.
9. **Action lines double as climb route names** whenever the climb dialect runs — `[Setup Barbell]`
   carries `climb-route-name` even outside a climbing block.
10. **A number inside a group header always wins over its text.** `(3 Rounds)` → 3 rounds;
    `(Warmup: 5min)` → 5 rounds. A label survives only when no number is present (`(Warmup)`,
    `(AMRAP)`).
11. **`?` placeholders are values, not syntax sugar** — `:?` records time, `?lb` records load,
    `?` records reps.
12. **Property lines need whitespace after the colon before a number.** `rpe:8` lexes `:8` as a
    timer (8000 ms) and the line stops being a property; `rpe: 8`, `rpe : 8` and `rpe:abc` are
    fine (§A3.15).

## A10. Worked examples

### AMRAP

```time
20:00 AMRAP
  5 Pullups
  10 Pushups
  15 Air Squats
```

### EMOM (composed children)

```time
(10) :60 EMOM
  + 2 Burpees
  + 5 Push Ups
  + 7 Air Squats
```

### Tabata

```time
(8)
  :20 Air Squats
  :10 Rest
```

### Strength block with rest and a prompt

```time
(5 Sets)
  3 Back Squat ?lb
  *2:00 Rest
```

### Time cap over a ladder

```time
20:00
  (21-15-9)
    Thrusters 95lb
    Pullups
```

### Mixed session

```time
// Warmup
  500m Row
  10 Lunges

// Strength
  5 Back Squat 225lb
  *2:00 Rest

// Conditioning
  10:00 AMRAP
    5 Pullups
    10 Pushups
```

### Long intervals with distance

```time
(4)
  3:00 Run 800m
  2:00 Rest
```

---

# Part B — WQL (Wod Query Language)

WQL is read-only: it queries the unified event store (the projection of every `WorkoutResult`
log) and the content plane (notes, blocks, efforts). It is written in `query` fenced blocks, the
Explorer, the Library composer, and inside dashboard notes.

## B1. Families and dispatch

`parseQuery(raw)` dispatches **textually** on the trimmed head:

| Leading text | Family | AST |
| --- | --- | --- |
| `find:` | content discovery (legacy head, still supported) | `ParsedFindQuery` |
| `rows` followed by `:`/`{`/space/end | raw rows | `ParsedRowsQuery` |
| anything else | aggregate | `ParsedAggregateQuery` |

Every variant carries `family`, `raw`, `filters`, optional `window`, optional `advisories`, and
optional `error` — parsing never throws.

## B2. Shared clause grammar

```
<primary> := <head> {<filters>} [by {<dims>}] [.rollup(<n><d|w>)] [in <unit>] [<window>] [where <join>]
<window>  := last <n><d|w> | from <YYYY-MM-DD> [to <YYYY-MM-DD>]
```

### Filters `{…}`

| Rule | Example |
| --- | --- |
| `key:value` exact match | `{effort:back-squat}` |
| comma = **AND** across keys | `{effort:push-up,discipline:bodyweight}` |
| pipe = **OR** within a key | `{effort:push-up\|air-squat}` |
| `!` negation spans the whole value list | `{!effort:burpee\|box-jump}` |
| trailing `*` prefix wildcard | `{effort:back*}` |
| `"quoted phrase"` for multi-word text | `{text:"300 Air Squats"}` |
| `key:sub:value` compound ids | `{source:collection:crossfit-girls}` |
| no braces = no filters | `count:session` |

The grammar lexes every word with one `Word` token (`[a-zA-Z0-9_-]+`), so parser context — not
keyword precedence — decides meaning. This is deliberate (see the token-discipline note at the
top of `wql.grammar`).

### Window

| Form | Meaning |
| --- | --- |
| `last 6w` / `last 7d` | relative to the anchor (wall clock by default; relative only in `d` or `w`) |
| `from 2026-01-01` | civil-date range start (local midnight) |
| `from 2026-01-01 to 2026-03-31` | inclusive range |

Rules:

- **One window per query.** `last 6w last 3w` and `last` + `from` are parse errors naming both
  spans (`Duplicate 'window' clause: … conflicts with …`). Never rightmost-wins.
- Dates must be real calendar dates — `2026-02-30` is rejected.
- Windows are legal on **all three** families.
- Join halves only accept `last <n>d|w` (`Range windows are not supported on join halves`).

### Group-by, rollup, display unit

| Clause | Applies to | Notes |
| --- | --- | --- |
| `by {week, effort}` | aggregate | dims are virtual dims or fact tag keys |
| `.rollup(<n>d\|w)` | aggregate | read-time bucketing; size defaults to 1; unit must be `d`/`w`; `.rollup(4w)` is legal |
| `in kg` / `in lb` | aggregate | display-unit directive; facts stay in their recorded unit |

Rows queries strip `by`/`.rollup` only to reject them with
`Rows queries return raw statements — no where / by / rollup`.

### Duplicate-clause detection

Each suffix kind may appear once; a second occurrence is a conflict naming both spans. Verified:
`Duplicate 'display-unit' clause: 'in kg' conflicts with 'in lb'`.

### Deprecated spellings (now advisories, not errors)

| Legacy | Rewritten to | Advisory |
| --- | --- | --- |
| `rows:{…}` | `rows:all{…}` | `Bare 'rows:{...}' syntax is deprecated; use 'rows:all{...}' instead.` |
| `find:… in journal` / `rows:… in journal` | `source:journal` filter added | `Legacy 'in <scope>' syntax is deprecated; use 'source:<scope>' filter instead.` |

## B3. Aggregate queries

```
<agg>:<metric>{<filters>} [by {<dims>}] [.rollup(<n><d|w>)] [in <unit>] [<window>] [where find:…]
```

### Aggregators

| Aggregator | Math (see `QueryService.aggregate`) |
| --- | --- |
| `sum` | Σ values |
| `avg` | arithmetic mean |
| `min` / `max` | boundary values |
| `count` | number of observation points in the bucket (independent of the metric's values) |
| `last` | value at the latest metric timestamp (fetch order never decides) |
| `delta` | last − first chronologically; `absent` when a bucket has fewer than two points, `error` on ambiguous tied endpoints |

Empty buckets reduce to `absent` (displayed as a zero-fill, never as an observation).

Unknown aggregators error at parse:
`Unknown aggregator "frob". Try: sum, avg, min, max, count, last, delta`.

### Metric keys

| Kind | Values |
| --- | --- |
| Families | `reps`, `distance`, `resistance`, `elapsed`, `power`, `pace` |
| Tier-2 aggregates | `totalVolume`, `totalDistance`, `tis`, `sessionLoad` |
| Effort-scoped | `<effortSlug>.<family>` — e.g. `thruster.reps` |
| Calculated | `calc.metMinutes`, `calc.acwr`, `calc.monotony`, `calc.strain`, `calc.e1rm`, `calc.ctl`, `calc.atl`, `calc.tsb`, `calc.soreness`, `calc.sleep`, `calc.hrv`, `calc.readiness`, `calc.mvcBw`, `calc.ef`, `calc.adherence`, `calc.pct1rm`, `calc.sends` |
| Structural pseudo metric | `session` (used with `count:session`) |

Dotted namespaces are part of the grammar (`Metric { Word (dot Word)* }`).

### Dimensions

| Kind | Values | Notes |
| --- | --- | --- |
| Virtual | `day`, `week`, `session` | computed by the executor; `day` = local `YYYY-MM-DD`, `week` = local Monday's date, `session` = the result id |
| Virtual (declared, not computed) | `round` | declared in `WQL_VIRTUAL_DIMS` but has no fact field; grouping by it lands in the unassigned bucket |
| Tag keys | `effort`, `discipline`, `intensity`, `note`, `page`, `origin`, `grain`, `metric`, `block`, `result`, `tags` | read off the fact row; `tags` resolves through the note's frontmatter labels |

A group with no value renders as the structural *unassigned* sentinel (never a literal `(none)`).

### Examples

```wql
sum:totalVolume{discipline:strength,!effort:burpee} by {week,effort}.rollup(1w) last 6w
avg:tis{effort:back*} by {session}
max:resistance{effort:back-squat} in kg
sum:tis{} by {week} from 2026-01-01 to 2026-03-31
last:calc.acwr{}
delta:sessionLoad{} by {day}.rollup(4w)
count:session
```

## B4. Find queries (content discovery)

```
find:<target>{<filters>} [<window>] [where <agg>:<metric>{} <op> <number>]
```

- **Targets** (closed enum): `note`, `block`, `effort`. Unknown targets error with the list.
- **Sources** (`source:` filter values): `journal`, `collections`, `feeds`, `guides`,
  `playground`, `all` — plus `collection:<id>` and `feed:<id>`. `all` is the default; omit it.
  Invalid values error: `Unknown source "bogus". Try: journal, collections, feeds, guides, playground, all (or collection:<id>, feed:<id>)`.
- **Filter keys**: `type`, `text`, `has`, `source`, `catalog`, plus every analytics tag key.
- Source-filter validation applies on `find:` and `rows:` heads only (an aggregate head accepts
  any `source:` value syntactically).

```wql
find:note{tags:pr,source:journal} last 8w
find:block{text:"air squats",!source:feeds}
find:effort{discipline:kettlebell,intensity:high}
```

## B5. Rows queries

```
rows:<target>{<scope filters>} [<window>] [| select … | order by … | limit …]
```

- **Targets** (`WQL_ROWS_TARGETS`): content planes `note`, `block`, `effort`; result planes
  `segment`, `system`, `load`, `event`, `compiler`, `completion`, `analytics`, `wellness`;
  and `all` (explicit no-narrowing). Unknown targets error with the full list.
- A **result plane** narrows the store's promoted `outputType` column; a **content plane** scopes
  by content id (`rows:note{note:x}` ≡ `rows:all{note:x}`).
- **Scope keys**: `result:`, `block:`, `note:` (plus `source:`). Values are exact — **no negation,
  no wildcards**.
- A scope key is **required** unless the target is `segment`:
  `Rows query needs a scope: result:, block:, note:.`
- `rows:segment{<any tag key>}` is the **cross-workout** form (tag/metadata filters allowed,
  no scope needed).
- Rows **never aggregate**: `by`, `.rollup`, and `where` are errors.
- `grain:rollup` is retired everywhere:
  `grain:rollup is retired — rollup grains are never stored; compute them with the .rollup suffix`.

### Pipe clauses (presentation only)

The tail after the first **depth-0** `|` (a `|` inside `{}` is an OR value, not a pipe):

| Pipe | Syntax | Notes |
| --- | --- | --- |
| `select` | `select col [in unit], col2, …` | column projection with optional display unit |
| `order by` | `order by col [asc\|desc], col2 …` | applied right-to-left with a deterministic tie-break |
| `limit` | `limit <n> [offset <m>]` | paging |
| `offset` | `offset <n>` | paging |

Pipes never change the match or `totalCount`. Unknown pipes error:
`Unknown pipe "…". Try: select, order by, limit`.

```wql
rows:segment{discipline:strength} last 4w | select result, effort in kg | order by value desc | limit 10 offset 5
rows:all{result:abc123} | limit 5
```

## B6. Cross-store joins (`where`)

`where` glues the content plane to the metrics plane, in either direction:

```wql
// content restricted by a metric predicate
find:note{tags:competition,source:journal} where sum:totalVolume{discipline:strength} > 5000

// metric computed only over content matching a find
sum:totalVolume{} by {week} where find:note{tags:competition,source:journal}
```

Rules:

- Comparison operators: `>`, `>=`, `<`, `<=`, `==`, `!=`.
- A `find:` head must join on a **metric** predicate, and an aggregate head must join on a
  **`find:`** predicate; the opposite errors explicitly.
- `where` is split brace-aware (a `text:where` filter value never starts a join).
- Join halves reuse the same filter grammar; only relative windows are allowed.

## B7. Query documents (the body of a `query` block)

A block body is a **document**. A body with no document constructs is a degenerate document
wrapping a single query — legacy one-liners keep working unchanged.

```
defaults [by {<dim>, …}] [last <n><d|w> | from <date> [to <date>]]
<ident> = <query | formula> [(normalize <bucket>)] [-> <unit>]
show <ident>, <ident>, …
```

| Construct | Rules |
| --- | --- |
| `defaults by {…} last 6w` | merged into every assignment that lacks its own dims/window |
| `<ident> = sum:…` | assignment; recognised as a query when the body starts with `sum\|avg\|min\|max\|count\|last\|delta\|rows\|find` |
| `<ident> = a / b` | formula expression: identifiers, numbers, `+ - * / ( )`, and `corr(a, b)` |
| `(normalize 1w)` | persisted normalization intent |
| `-> kg` | explicit output unit |
| `show a, b` | selection; defaults to every query assignment |
| `// …` | line comment |

Diagnostics (never throws): non-query/non-formula assignment, formula characters a formula cannot
parse, unknown identifier, formula with no references, reference cycle
(`Reference cycle detected: a -> b -> a`), `show` naming an unknown assignment, body that is
neither a query nor a document. Forward references are legal; evaluation follows the reference
graph.

````markdown
```query:timeseries-2
defaults by {week} last 12w
a = sum:totalVolume{discipline:strength}
b = sum:totalVolume{}
share = a / b -> ratio
show a, share
```
````

## B8. Dashboard notes, widget types and tokens

A **dashboard** is a markdown note with `dashboard: true` in frontmatter; its body composes
`query` blocks. The heading above a block becomes its title, the paragraph its coaching question.

- **Widget types** (`DASHBOARD_WIDGET_TYPES`): `table` (default), `value`, `timeseries`, `bar`,
  `toplist`, `stacked-bar`, `goal-rings`, `zone-distribution`.
- **Grid span** rides the fence suffix: `query:timeseries-2` spans 2 of 4 columns; `-full` spans
  the row. Unknown types still parse (renderers badge them); an empty type, a bad span, or a
  `-N-full` combination is a structural error.
- **Tokens**: `dashboard.*` frontmatter keys become controls, referenced in queries as `$name`
  (raw text substitution at execution time). Unknown references stay literal and are reported —
  never silent.

````markdown
---
title: Training Review
dashboard: true
dashboard.intensity:
  - low
  - high
---

## Avg TIS

```query:value
avg:tis{}
```

## Load by intensity

```query:stacked-bar
sum:sessionLoad{intensity:$intensity} by {week}.rollup(1w)
```
````

## B9. Deprecated syntax, advisories and errors

### Advisories (parse succeeds, advisory attached)

- bare `rows:{…}` → `rows:all{…}`
- legacy `in <scope>` on `find:`/`rows:`

### Error catalogue (verified messages)

| Input | `error` |
| --- | --- |
| `frob:x{}` | `Unknown aggregator "frob". Try: sum, avg, min, max, count, last, delta` |
| `find:nope{}` | `Unknown find target "nope". Try: note, block, effort` |
| `rows:bogus{}` | `Unknown rows target "bogus". Try: note, block, effort, segment, system, load, event, compiler, completion, analytics, wellness, all` |
| `rows:all` | `Rows query needs a scope: result:, block:, note:.` |
| `rows:segment{} by {week}` | `Rows queries return raw statements — no where / by / rollup. Got "…"` |
| `… last 6w last 3w` | `Duplicate 'window' clause: 'last 6w' conflicts with 'last 3w'` |
| `… in kg in lb` | `Duplicate 'display-unit' clause: 'in kg' conflicts with 'in lb'` |
| `…{grain:rollup}` | `grain:rollup is retired — rollup grains are never stored; compute them with the .rollup suffix` |
| `rows:all{result:a,!note:b}` | `Unsupported rows filter(s): !note. Rows queries support exact result:, block:, note:, source: values.` |
| `rows:all{result:a*}` | `Unsupported rows filter(s): result. Rows queries support exact result:, block:, note:, source: values.` |
| `… \| frobnicate` | `Unknown pipe "frobnicate". Try: select, order by, limit` |
| `… from 2026-02-30` | `Invalid window date "2026-02-30" — expected a real calendar date YYYY-MM-DD` |
| `… where sum:y{}` on a find head | `Cross-store join on a find query must be agg:metric{} <op> <number>, got "…"` |
| `… where find:block{}` on a find head | same message (a find half may not join a find head) |
| `… where find:block{} from 2026-01-01` | `Range windows are not supported on join halves — use last <n>d\|w` |
| malformed head | `Cannot parse "…". Expected agg:metric{filters} by {dims} .rollup(period)` |
| bad rows head | `Cannot parse "…". Expected rows:all{result:…\|block:…\|note:…}, rows:<plane>{…}, or rows:segment{…} last 8w` |

## B10. Canonical serialization

`serialize(parsed)` renders any variant back to canonical text — total, never throws, and the
fixed point of `parse ∘ serialize`:

| Input | Canonical |
| --- | --- |
| `sum:totalVolume{discipline:strength} by {week,effort}` | `sum:totalVolume{discipline:strength} by {week, effort}` |
| `find:note{tags:pr} in journal last 8w` | `find:note{tags:pr,source:journal} last 8w` |
| `rows:{note:x}` | `rows:all{note:x}` |
| `count:session` | `count:session{}` |

`serializeDocument(doc)` round-trips a document body.

---

# Appendix V — Verification

Both languages were exercised against their real parsers (no mocks):

```bash
# Whiteboard: parse a battery of statements, dump the classified metrics
bun -e 'import {parseScript} from "./packages/lang/src/parser/parseScript"; …'

# WQL: parse a battery of queries, dump AST + canonical form
bun -e 'import {parseQuery} from "./packages/wql/src/wql"; import {serialize} from "./packages/wql/src/serialize"; …'
```

Confirmed by execution:

- statement/nesting/child-group structure for rounds, ladders, laps, time caps, mixed sections;
- metric shapes for reps, collectibles (`?`, `:?`, `^:?`, `?lb`, `?kg`, `?m`), durations,
  trends (`^`), required timers (`*`), units (length, mass, energy), `%`, fractions, choices,
  actions (including `[:!pinned]`), comments, headings, JSON metric objects, property lines;
- protocol hints for AMRAP / EMOM (explicit + implicit) / FOR TIME / TABATA / STRENGTH / METCON /
  SUPERSET / cardio / yoga / habits / climb;
- WQL family dispatch, filters (OR/AND/negation/wildcard/quoted/compound), windows and window
  conflicts, rollup, display units, joins in both directions, rows scopes and pipes, deprecated
  spellings with advisories, and the error messages catalogued in §B9;
- every gotcha in §A9 (leading-token unit fusion, unregistered `pood`, the `185/125 lb` fraction,
  number-wins group headers, implicit-EMOM shape, `5x5` set notation, climb-grade coverage,
  property colon spacing, blank-line nesting).

Known divergence from older prose docs (a doc update should follow this file):
`docs/02-syntax-reference.md` lists `pood` as a unit and `185/125 lb` as a choice group;
`docs/03-dialects.md` lists `climb`/`cardio`/`yoga`/`habits` as fence tags. Both are wrong —
see §A9 and §A1.
