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
max:calc.e1rm{effort:back-squat}
```

## Bench goal
How close to the target?

```query:goal-rings goal=$benchGoal
max:calc.e1rm{effort:bench-press}
```

## Deadlift goal
How close to the target?

```query:goal-rings goal=$deadliftGoal
max:calc.e1rm{effort:deadlift}
```

## Estimated 1RM trend
Is strength actually surging?

```query:timeseries-2
max:calc.e1rm{} by {effort, week}
```

## Tonnage by week
Enough volume for adaptation?

```query:bar
sum:totalVolume{discipline:strength} by {week}
```

## Average intensity
Neural demand in the right zone?

```query:timeseries
avg:calc.pct1rm{discipline:strength} by {week}
```

## Volume by lift
Main lifts vs accessories balance?

```query:toplist
sum:totalVolume{discipline:strength} by {effort}
```

## Session strain
Is fatigue outpacing recovery?

```query:timeseries
sum:sessionLoad{discipline:strength} by {week}
```
