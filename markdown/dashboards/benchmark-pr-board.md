---
dashboard: true
title: Benchmark PR Board
domain: crossfit
---

# Benchmark PR Board

CrossFit / Hyrox prebuilt — benchmark retests and work capacity. Tag
benchmark notes `benchmark` and they land on the board.

## Benchmark scores
Which benchmarks moved this quarter?

```query:table-2
:segment{tags:benchmark} | :last{metric:elapsed} by {effort} | :table{}
```

## Fran trend
Closing on the goal time?

```query:timeseries
:segment{effort:fran} | :last{metric:elapsed} by {week} | :timeseries{}
```

## Work capacity
Total reps per week rising?

```query:timeseries
:segment{} | :sum{metric:totalReps} by {week} | :timeseries{}
```

## Session intensity
Pacing even or blowing up late?

```query:bar
:segment{} | :sum{metric:tis} by {session, day} | :bar{}
```

## Training consistency
Sessions logged — gaps visible at a glance.

```query:bar
:segment{} | :count{metric:sessionLoad} by {day} | :bar{}
```
