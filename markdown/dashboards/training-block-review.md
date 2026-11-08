---
dashboard: true
title: Training Block Review
tags:
  - coaching
---

# Training Block Review

The general coaching check-in, re-authored from the retired hardcoded
dashboard page (#899 decision 8). Weekly questions about volume, intensity,
and where the work went.

## Avg TIS
How hard are sessions?

```query:value
:segment{} | :avg{metric:tis} | :value{}
```

## Total volume
How much total work?

```query:value
:segment{} | :sum{metric:totalVolume} | :value{}
```

## Total reps
How many reps?

```query:value
:segment{} | :sum{metric:totalReps} | :value{}
```

## Adherence
Are planned sessions getting done?

```query:value
:segment{} | :avg{metric:calc.adherence} | :value{}
```

## Weekly tonnage
Is volume rising?

```query:timeseries-2
:segment{} | :sum{metric:totalVolume} by {week} | :timeseries{}
```

## TIS trend
Is intensity consistent?

```query:timeseries
:segment{} | :avg{metric:tis} by {week} | :timeseries{}
```

## Volume by effort
Where does the volume go?

```query:toplist
:segment{} | :sum{metric:totalVolume} by {effort} | :toplist{}
```

## Load by intensity
Is training polarized?

```query:stacked-bar
:segment{} | :sum{metric:sessionLoad} by {intensity, week} | :stacked-bar{}
```

## Distance by discipline
Where is the mileage?

```query:bar
:segment{} | :sum{metric:totalDistance} by {discipline} | :bar{}
```

## Session load trend
Is load building?

```query:timeseries
:segment{} | :sum{metric:sessionLoad} by {week} | :timeseries{}
```
