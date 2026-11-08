---
dashboard: true
title: Road to a 560 kg Total
dashboard.squatGoal: 200
dashboard.benchGoal: 140
dashboard.deadliftGoal: 220
quality:
  - strength
---

# Road to a 560 kg Total

Strength prebuilt — tonnage, estimated 1RM, and per-lift goal rings. Ring
targets are frontmatter tokens ($squatGoal / $benchGoal / $deadliftGoal);
edit them as the meet approaches. e1RM derives from logged sets via
calc.e1rm (#904), and %1RM intensity (calc.pct1rm) is the Epley-inverse %
of each set's projected max.

## Squat goal
How close to the target?

```query:goal-rings goal=$squatGoal
:segment{effort:back-squat} | :max{metric:calc.e1rm} | :goal-rings{goal:"$squatGoal"}
```

## Bench goal
How close to the target?

```query:goal-rings goal=$benchGoal
:segment{effort:bench-press} | :max{metric:calc.e1rm} | :goal-rings{goal:"$benchGoal"}
```

## Deadlift goal
How close to the target?

```query:goal-rings goal=$deadliftGoal
:segment{effort:deadlift} | :max{metric:calc.e1rm} | :goal-rings{goal:"$deadliftGoal"}
```

## Estimated 1RM trend
Is strength actually surging?

```query:timeseries-2
:segment{} | :max{metric:calc.e1rm} by {effort, week} | :timeseries{}
```

## Tonnage by week
Enough volume for adaptation?

```query:bar
:segment{discipline:strength} | :sum{metric:totalVolume} by {week} | :bar{}
```

## Average intensity
Neural demand in the right zone?

```query:timeseries
:segment{discipline:strength} | :avg{metric:calc.pct1rm} by {week} | :timeseries{}
```

## Volume by lift
Main lifts vs accessories balance?

```query:toplist
:segment{discipline:strength} | :sum{metric:totalVolume} by {effort} | :toplist{}
```

## Session strain
Is fatigue outpacing recovery?

```query:timeseries
:segment{discipline:strength} | :sum{metric:sessionLoad} by {week} | :timeseries{}
```
