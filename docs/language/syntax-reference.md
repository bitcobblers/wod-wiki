# Whiteboard Language Syntax Reference

Whiteboard Language lets you write workouts as plain text inside fenced code blocks (` ```time ` or ` ```log `) embedded in ordinary Markdown. Indentation creates structural hierarchy.

---

## 1. Core Anatomy of a Statement

Each source line contains metric fragments. Inline rounds can produce a parent and child statement from the same line:

```
[lap marker] [rounds/ladder] [timer] [reps] [effort] [@ load] [distance] [rest] [// comment]
```

### Fragment Types at a Glance

| Fragment | Syntax | Example | Meaning |
|---|---|---|---|
| **Timer / Duration** | `MM:SS`, `:SS` | `5:00`, `:60`, `:30` | Countdown or target duration |
| **Collectible Timer**| `:?` | `:?` | Time is measured/recorded, not pre-planned |
| **Rounds** | `(N)` | `(3)`, `(10)` | Repeat child statements $N$ times |
| **Inline rounds × reps** | `NxM`, `N x M` | `5x5`, `3 x 8` | Repeat the inline exercise $N$ times with $M$ reps per round |
| **Rep Ladder** | `(N-N-...)` | `(21-15-9)`, `(10-8-6-4-2)` | Variable rep rounds sequence |
| **Reps** | Bare integer | `10`, `50` | Repetition count for the effort |
| **Effort** | Words | `Burpees`, `KB Swing` | Exercise or movement name |
| **Load / Resistance**| Number + unit / `@` | `225lb`, `16kg`, `@24kg`, `bw` | Weight or resistance applied |
| **Distance** | Number + unit | `400m`, `5km`, `1000m`, `0.5mile`| Physical distance |
| **Rest** | Keyword or `*` | `1:30 Rest`, `* :30` | Recovery interval between sets |
| **Choice Group** | Slash `/` | `185/125 lb`, `Run/Row` | Athlete choice resolved prior to run |
| **Wildcard** | `?` | `10:00 ? KB Snatch 16kg` | Athlete-chosen parameter to fill in |
| **Lap / Superset** | `+` or `-` | `+ 5 Pull Ups` | Binds siblings into a compound set |
| **Comment** | `//` | `// Keep unbroken` | Annotations ignored by runtime |

---

## 2. Common Workout Structures

### Rounds-Based Circuit
```time
(3)
  10 Air Squats
  10 Push Ups
  10 Ring Rows
```

### Inline Strength Sets
```time
5x5 Back Squat @100kg
```

`5x5`, `5 x 5`, and `(5) 5` are equivalent. Without a timer or indented children, the parser creates a rounds parent and an exercise child. Each set records a separate exercise segment with reps, movement, load, and elapsed time. This example records five sets of five reps at 100kg. `(21-15-9) Thruster` records three segments with 21, 15, and 9 reps.

Statement IDs identify tree nodes, not source lines. Both inline statements retain the original source line and metric offsets; recorded segments carry the exercise child's `sourceStatementId` and original `line` for editor highlights and per-line history.

### Interval Work (EMOM)
```time
(10) :60 EMOM
  + 5 Burpees
  + 10 Kettlebell Swings 24kg
```

### As Many Rounds As Possible (AMRAP)
```time
10:00 AMRAP
  5 Pull Ups
  10 Push Ups
  15 Air Squats
```

### Tabata / Rest Intervals
```time
(8) :20 Work
  * :10 Rest
  KB Snatch 16kg
```

### Rep Ladders
```time
(21-15-9)
  Thrusters 95lb
  Pull-ups
```

### Choice Groups
When an option slash separates identical metric types, a choice group is emitted:
```time
5:00 AMRAP
  10 Power Cleans 135/95 lb
  10 Box Jumps
```
Before starting the clock, the pre-run wizard prompts the user to select the appropriate alternative (`135 lb` or `95 lb`).

---

## 3. Indentation & Execution Rules

1. **Hierarchy**: An unindented line with children (`(3)` or `10:00 AMRAP`) controls the execution of all indented statements beneath it.
2. **Sibling Ordering**: Statements at the same indentation level execute sequentially from top to bottom unless combined with a lap marker (`+`).
3. **Compound Sets (`+`)**: Prepending `+` merges sibling movements into a single composed round interval.

---

## 4. Editor Completions

The editor offers completions inside ` ```time ` and ` ```log ` fence bodies. Both dialects share the same grammar-aware provider, so the sections below apply to each:

- **Structure templates**: an empty body line suggests parse-valid starters such as `Circuit` — accepting one inserts a complete, indented template (e.g. `(3)` with indented children), never a fragment that fails to parse.
- **Structure keywords**: after a timer head such as `10:00 `, keywords like `AMRAP`, `EMOM`, `TABATA`, `FOR TIME`, and `Rest` complete the statement.
- **Units**: after a number, matching units are offered with their dimension as detail (`100 k` → `kg`, detail `mass`); aliases (`kilos`, `lbs`) are offered as their own labels with the same detail. Resistance quantities marked with `@` offer mass units only. Hosts can supply a dialect-extended `UnitSet`, and a number that already has a unit does not offer another.
- **Statement slots**: the Lezer tree limits effort and property suggestions to valid continuations of the current line. Completed efforts and singleton property values do not accept duplicate tokens, and singleton property keys already supplied in the section are not offered again. Choice (`|`), compose (`+`), multiword efforts, repeated statements, and stacked tag references remain available where the grammar allows them.
- **Property keys**: at a property-key prefix, the editor offers unused keys from `effort`, `equipment`, `rpe`, `rir`, `intensity`, `load`, `volume`, `work`, and `sound`.
- **Host catalogs**: when the host supplies them (movement registry, equipment, note tags), those values join the suggestions for effort names, `equipment`, tags, and `sound:` values.

Markdown outside workout fences is untouched: frontmatter offers only frontmatter property/tag suggestions, prose never offers workout or query terms, and a Markdown line starting with backticks offers the fence names themselves (` ```time `, ` ```query `, …).

Keyboard behavior is shared across every completion source: typing filters, arrow keys move the active option, Enter or Tab accepts into the document, and Escape dismisses without inserting.
