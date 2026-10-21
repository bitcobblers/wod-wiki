---
name: wod-extraction
description: 'Extract and convert any workout description into WOD Wiki syntax. Understands workout intent to determine which metrics to collect (time, reps, distance, weight) based on the workout type and structure.'
license: MIT
---

# WOD Extraction — Converting Workouts to Whiteboard Script

## Overview

Take any workout description — from a whiteboard photo, a coach's programming post, a competition event description, or a casual text message — and produce well-formed WOD Wiki syntax that captures both the workout structure and the **implied measurements** the athlete cares about.

## When to Use

Use this skill when:

- A user provides a workout in plain English (or any natural language) and wants it converted to WOD Wiki syntax
- A user asks to "write this workout in wod syntax" or "encode this workout"
- A competition workout needs to be transcribed into the project's `wod/` library
- The user wants help understanding what metrics a workout is tracking

---

## Core Concept: What Does the Athlete Want to Measure?

The fundamental insight behind WOD Wiki syntax is that **every workout implies what should be measured**. The syntax encodes both the workout prescription AND the collectible metrics. Understanding the workout's intent lets you choose the right syntax.

| Workout Intent | What the Athlete Measures | Syntax Signal |
|---|---|---|
| "For Time" | **Time** to complete | Use `:?` (collectible timer) or `^:?` (count-up collectible) on the overall set |
| "AMRAP in X minutes" | **Rounds** completed | Use a fixed timer like `20:00` with a label `AMRAP` |
| "EMOM for X minutes" | **Completion** within each interval | Use `(rounds) :60 EMOM` pattern |
| "Run for 20 minutes" | **Distance** covered | Use fixed timer + `?m` or `?mile` (collectible distance) |
| "Run 5K" | **Time** it took | Use distance `5000m` or `5km` + `:?` (collectible timer) |
| "Work up to a heavy single" | **Weight** achieved | Use `?lb` or `?kg` (collectible resistance) |
| "Max reps in 1 minute" | **Reps** performed | Use fixed timer + `?` (collectible reps) |
| "X reps at fixed weight" | **Time** to complete | Reps are specified, weight is specified, time is the unknown |

### The Collectible Rule

When a value is **prescribed** (given to the athlete), write it literally. When a value is the **outcome** (what the athlete discovers by doing the workout), use the `?` placeholder to make it collectible:

- `?` — collectible reps (how many did you do?)
- `:?` — collectible timer (how long did it take?)
- `^:?` — collectible count-up timer (elapsed time, counting up)
- `?lb` / `?kg` — collectible resistance (what weight did you reach?)
- `?m` / `?mile` / `?km` — collectible distance (how far did you go?)

---

## Whiteboard Script Reference

### Statement Structure

Each line in a WOD Wiki script is a **statement**. A statement can contain any combination of these fragments, in any order:

```
[group-prefix] [rounds] [timer] [reps] [effort] [resistance] [distance] [action]
```

Indentation creates parent-child relationships: indented lines are children of the nearest less-indented line above them.

### Fragment Reference

#### Timer — Duration/Time
```
5:00          → 5 minutes (countdown timer)
1:30          → 1 minute 30 seconds
:30           → 30 seconds
1:00:00       → 1 hour
^5:00         → 5 minutes, counting UP (^ modifier)
:?            → collectible timer (athlete records elapsed time)
^:?           → collectible count-up timer
```

#### Reps — Repetition Count
```
21            → 21 reps (when followed by an effort/exercise name)
?             → collectible reps (athlete records how many they did)
```

Note: A bare number is interpreted as reps when it precedes an effort (exercise name). Numbers adjacent to distance/weight units are parsed as part of those fragments instead.

#### Effort — Exercise Name
```
Thrusters     → exercise name (single word)
Clean & Jerk  → exercise name (multi-word, parsed as consecutive identifiers)
Air Squats    → exercise name
KB Swings     → exercise name
Rest          → rest period (when combined with a timer like :30 Rest)
AMRAP         → label (when combined with a timer like 20:00 AMRAP)
EMOM          → label (when combined with rounds+timer like (30) :60 EMOM)
```

#### Resistance — Weight/Load
```
95lb          → 95 pounds
32kg          → 32 kilograms
bw            → bodyweight
1.5bw         → 1.5x bodyweight
?lb           → collectible weight in pounds
?kg           → collectible weight in kilograms
@135lb        → resistance with @ prefix (alternative notation)
```

#### Distance
```
400m          → 400 meters
1000m         → 1000 meters
1mile         → 1 mile
5km           → 5 kilometers
?m            → collectible distance in meters
?mile         → collectible distance in miles
```

#### Rounds — Repetition Structure
```
(3)           → repeat children 3 times
(5)           → repeat children 5 times
(21-15-9)     → 3 rounds, with 21 reps first, then 15, then 9
(50-40-30-20-10) → 5 rounds with descending reps
(10-9-8-7-6-5-4-3-2-1) → 10 rounds descending by 1
(EMOM)        → named round label
(Warmup)      → named round label
```

#### Group Prefix — Child Relationship Type
```
-             → "round" group: each child line runs as a separate step within the round
+             → "compose" group: consecutive + lines are bundled into a single composed set
(no prefix)   → "repeat" group: default when a line is indented under a parent
```

The distinction between `-` and `+`:
- **`-` (round)**: Lines run sequentially as separate steps. Use when exercises are done one at a time in order.
- **`+` (compose)**: Lines are combined into a single logical set. Use for EMOMs, complexes, or supersets where all exercises are done together within each round.

#### Action — Side-Effect Commands
```
[:action-name]  → triggers a named action (e.g., sound, event)
[:!pinned]      → pinned action (persists across rounds)
```

#### Trend — Increment Modifier
```
^               → increment/trend up modifier (when standalone, not before timer)
```

### Indentation Rules

Indentation defines the hierarchical structure of a workout:

```time
(3)                    ← parent: 3 rounds
  400m Run             ← child: runs within each round (implicitly "repeat" group)
  21 KB Swings 53lb    ← child: runs within each round
  12 Pullups           ← child: runs within each round
```

Children inherit the round count from their parent. Deeper indentation creates deeper nesting.

---

## Conversion Patterns

### Pattern 1: "For Time" Workouts

The athlete is prescribed the work. The measurement is **how long it takes**.

**Natural language:**
> Fran: 21-15-9 Thrusters (95lb) and Pullups, for time

**WOD Wiki syntax:**
```time
(21-15-9)
  Thrusters 95lb
  Pullups
```

The time is the collectible — the system tracks it automatically via the round structure. No explicit `:?` is needed because the runtime measures elapsed time for all "for time" workouts by default.

### Pattern 2: AMRAP (As Many Rounds As Possible)

The athlete is given a fixed time. The measurement is **rounds completed**.

**Natural language:**
> 20-minute AMRAP: 5 pullups, 10 pushups, 15 air squats

**WOD Wiki syntax:**
```time
20:00 AMRAP
  5 Pullups
  10 Pushups
  15 Air Squats
```

The timer `20:00` is the prescribed duration. `AMRAP` is an effort label. The round count is the collectible — tracked automatically.

### Pattern 3: EMOM (Every Minute On the Minute)

The athlete is given intervals. The measurement is **completion within each interval**.

**Natural language:**
> EMOM 30 minutes: 5 pullups, 10 pushups, 15 air squats

**WOD Wiki syntax:**
```time
(30) :60 EMOM
  + 5 Pullups
  + 10 Pushups
  + 15 Air Squats
```

The `+` prefix composes the exercises into a single set done each minute. `(30)` is rounds. `:60` is the interval timer. `EMOM` is a label.

### Pattern 4: Timed Intervals with Rest

**Natural language:**
> 4 rounds of 100m swim with 30 seconds rest

**WOD Wiki syntax:**
```time
(4) Warmup
  100m Swim
  :30 Rest
```

### Pattern 5: Single-Modality For Time

**Natural language:**
> 150 wall ball shots at 20lb, for time

**WOD Wiki syntax:**
```time
150 Wall Ball Shots 20lb
```

### Pattern 6: Distance-Based With Known Prescription

**Natural language:**
> Row 1000m, then 50 thrusters at 45lb, then 30 pullups — for time

**WOD Wiki syntax:**
```time
1000m Row
50 Thrusters 45lb
30 Pullups
```

### Pattern 7: Max Weight / Working Up

When the goal is to find a max weight, the weight is the collectible.

**Natural language:**
> Work up to a 1-rep max clean & jerk

**WOD Wiki syntax:**
```time
1 Clean & Jerk ?lb
```

The `?lb` makes weight the collectible — the athlete enters what they achieved.

### Pattern 8: Max Reps in a Time Domain

**Natural language:**
> In 1 minute, do as many pushups as possible

**WOD Wiki syntax:**
```time
1:00 ? Pushups
```

The `?` makes reps the collectible.

### Pattern 9: Run for Time, Measure Distance

**Natural language:**
> Run for 20 minutes, record distance

**WOD Wiki syntax:**
```time
20:00 ?m Run
```

The timer is fixed. The distance `?m` is the collectible.

### Pattern 10: Run a Distance, Measure Time

**Natural language:**
> Run 5K for time

**WOD Wiki syntax:**
```time
5km Run
```

The distance is prescribed. The system automatically tracks time.

### Pattern 11: Complexes and Supersets

When exercises are done together as a unit (barbell complex, superset), use `+` group prefix.

**Natural language:**
> EMOM 20 minutes: 2 cleans, 1 press, 3 front squats

**WOD Wiki syntax:**
```time
(20) 1:00
  + 2 Clean
  + 1 Press
  + 3 Front Squat
```

### Pattern 12: Descending Rep Schemes

**Natural language:**
> 21-15-9 deadlifts at 225lb and handstand pushups

**WOD Wiki syntax:**
```time
(21-15-9)
  Deadlift 225lb
  Handstand Pushups
```

The `(21-15-9)` creates 3 rounds. The rep count for each round is encoded in the sequence. Exercises inherit the rep count from their parent round.

### Pattern 13: Multi-Section Workouts

When a workout has distinct phases (warmup, main set, cooldown), write each section as a separate top-level block.

**Natural language:**
> Warmup: 4x100m swim with 30s rest. Main set: 8x50m kick with 30s rest. Cooldown: 400m easy swim.

**WOD Wiki syntax:**
```time
(4) Warmup
  100m Swim
  :30 Rest

(8)
  50m Kick
  :30 Rest

400m Cooldown
```

### Pattern 14: With Structured Rest Between Rounds

**Natural language:**
> 5 rounds of 20 pullups, 30 pushups, 40 situps, 50 air squats. Rest 3 minutes between rounds.

**WOD Wiki syntax:**
```time
(5)
  + 20 Pullups
  + 30 Pushups
  + 40 Situps
  + 50 Air Squats
  3:00 Rest
```

### Pattern 15: Bodyweight Percentage Loads

**Natural language:**
> 10-9-8-7-6-5-4-3-2-1 of Deadlift at 1.5x bodyweight, Bench Press at bodyweight, Clean at 0.75x bodyweight

**WOD Wiki syntax:**
```time
(10-9-8-7-6-5-4-3-2-1)
  
  Deadlift 1.5bw
  Bench Press 1bw
  Clean 0.75bw
```

### Pattern 16: Timed Sections Within a Workout

**Natural language:**
> 5 minutes: 100 KB Swings at 70lb. 1 minute rest. 10 minutes: 10 Turkish Getups at 70lb.

**WOD Wiki syntax:**
```time
5:00 100 KB Swings 70lb
1:00 Rest
10:00 10 Turkish Getups 70lb
```

### Pattern 17: Competition Events (For Time with Mixed Modality)

**Natural language:**
> For time: Run 800 meters, 100 Pistols, 50 Pull-ups, Run 800 meters

**WOD Wiki syntax:**
```time
800m Run
100 Pistols
50 Pullups
800m Run
```

---

## Decision Framework

When converting a workout, follow this decision tree:

### Step 1: Identify the Workout Type

| Clue in Description | Workout Type | Key Syntax Element |
|---|---|---|
| "For time" | For Time | Reps/distance prescribed, time is outcome |
| "AMRAP", "as many rounds as possible" | AMRAP | `XX:00 AMRAP` with prescribed exercises |
| "EMOM", "every minute on the minute" | EMOM | `(N) :60 EMOM` with `+` grouped children |
| "Max reps", "as many as possible" | Max Reps | Fixed timer + `?` reps |
| "Max weight", "work to a heavy", "find your 1RM" | Max Weight | Exercise + `?lb` or `?kg` |
| "For distance", "run/row for X minutes" | For Distance | Fixed timer + `?m` or `?mile` |
| "Intervals", "X rounds of Y with rest" | Intervals | `(N)` rounds with exercises + `:XX Rest` |
| "Tabata" | Tabata | `(8) :20` work, `:10 Rest` pattern |

### Step 2: Determine What's Prescribed vs Collected

For each element of the workout, ask: **"Is this given to the athlete, or does the athlete discover it?"**

| Element | Prescribed (write literally) | Collected (use ?) |
|---|---|---|
| Time | `5:00`, `20:00`, `:30` | `:?` or `^:?` |
| Reps | `21`, `15`, `9` | `?` |
| Weight | `95lb`, `32kg` | `?lb`, `?kg` |
| Distance | `400m`, `5km` | `?m`, `?km` |

### Step 3: Determine Exercise Grouping

- **Sequential exercises** (done one at a time, in order): use no prefix or `-` prefix
- **Composed exercises** (done together as a set/complex): use `+` prefix
- **Exercises in rounds**: indent under a `(N)` parent

### Step 4: Assemble the Syntax

1. Write the round/time structure first (outermost container)
2. Indent child exercises under their parent
3. Add group prefixes (`+` or `-`) based on grouping intent
4. Include resistance with the exercise on the same line
5. Include distance with the movement on the same line
6. Add rest periods as separate lines when explicitly prescribed

---

## Common Mistakes to Avoid

### DON'T: Add collectible markers when the system tracks automatically
```diff
# BAD: :? is redundant — "for time" workouts track time by default
- (21-15-9)
-   :? Thrusters 95lb
-   Pullups

# GOOD: Just write the prescription
+ (21-15-9)
+   Thrusters 95lb
+   Pullups
```

### DON'T: Use `+` prefix when exercises are sequential (not composed)
```diff
# BAD: These are done one after another, not composed
- (3)
-   + 400m Run
-   + 21 KB Swings 53lb
-   + 12 Pullups

# GOOD: No prefix needed for sequential exercises in rounds
+ (3)
+   400m Run
+   21 KB Swings 53lb
+   12 Pullups
```

Use `+` only when exercises are done together within the same time interval (EMOMs, complexes, supersets).

### DON'T: Forget that rounds define the rep scheme
```diff
# BAD: Redundant reps when rounds already specify the scheme
- (21-15-9)
-   21 Thrusters 95lb
-   21 Pullups

# GOOD: Reps come from the round scheme, not the exercise line
+ (21-15-9)
+   Thrusters 95lb
+   Pullups
```

### DON'T: Mix units without proper syntax
```diff
# BAD: Weight unit with bare number and no unit
- 21 Thrusters 95

# GOOD: Always include the unit
+ 21 Thrusters 95lb
```

### DON'T: Write "For Time" or "For time" as a literal effort
```diff
# BAD: "For Time" is a workout descriptor, not an exercise
- For Time
-   100 Burpees

# GOOD: Just write the exercises — time tracking is implicit
+ 100 Burpees
```

---

## Output Format

When converting a workout, produce a markdown document with this structure:

````markdown
# Workout Name

**Category**: [CrossFit Benchmark | StrongFirst | Competition | Custom]  
**Type**: [For Time | AMRAP | EMOM | Max Weight | Intervals]  
**Difficulty**: [Beginner | Intermediate | Advanced]  

## Description
Brief description of the workout.

```time
[WOD Wiki syntax here]
```

## Breakdown
- **Rounds/Duration**: ...
- **Exercises**: ...
- **Goal**: ...

## Collectible Metrics
- [What this workout measures and why]
````

The `## Collectible Metrics` section should explicitly state what the athlete is expected to record and why, tying back to the workout intent.

---

## Worked Examples

### Example 1: Converting a CrossFit Open Workout

**Input:**
> 24.3: For time — 10 thrusters (95/65), 10 chest-to-bar pull-ups, 10 thrusters (135/95), 10 bar muscle-ups, 10 thrusters (155/105), 10 bar muscle-ups. Time cap: 15 minutes.

**Analysis:**
- Type: For Time (time is the measurement)
- No repeating rounds — each line is a distinct movement at a distinct weight
- Time cap is prescribed context, not part of the syntax (it's metadata)

**Output:**
```time
10 Thrusters 95lb
10 Chest to Bar Pullups
10 Thrusters 135lb
10 Bar Muscle Ups
10 Thrusters 155lb
10 Bar Muscle Ups
```

### Example 2: Converting a Strength Session

**Input:**
> Back Squat: Work up to a heavy set of 3. Then 3x5 at 80% of that weight.

**Analysis:**
- Part 1: Max weight is the goal — weight is collectible
- Part 2: Prescribed reps and sets at a computed weight

**Output:**
```time
3 Back Squat ?lb

(3)
  5 Back Squat 80%
```

### Example 3: Converting a Running Workout

**Input:**
> Run 1 mile, then 50 sandbag over shoulder (100 lbs), then run 1 mile. For time.

**Output:**
```time
1mile Run
50 Sandbag Over Shoulder 100lb
1mile Run
```

### Example 4: Converting a Tabata

**Input:**
> Tabata air squats (8 rounds: 20 seconds on, 10 seconds off). Record lowest round.

**Output:**
```time
(8)
  :20 ? Air Squats
  :10 Rest
```

The `?` on reps makes each round's count collectible.

---

## Edge Cases

### No Equipment / Bodyweight Only
Omit resistance entirely:
```time
100 Burpees
75 Situps
50 Pushups
25 Handstand Pushups
```

### Mixed Modality (Cardio + Lifting)
Different fragments coexist on the same line:
```time
(5)
  400m Run
  15 Overhead Squats 95lb
```

### Asymmetrical Loading (Left/Right)
Write separate lines for each side:
```time
(20)
  + 1 Clean & Press Left
  + 1 Clean & Press Right
  + 2 Front Squat Right
```

### Rest Periods
Rest is just an effort name with a timer:
```time
:30 Rest
1:00 Rest
3:00 Rest
```

### Named Sections
Use labels as effort names on the round line:
```time
(4) Warmup
  100m Swim
  :30 Rest
```
