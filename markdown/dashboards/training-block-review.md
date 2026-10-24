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
avg:tis{}
```

## Total volume
How much total work?

```query:value
sum:totalVolume{}
```

## Total reps
How many reps?

```query:value
sum:totalReps{}
```

## Adherence
Are planned sessions getting done?

```query:value
avg:calc.adherence{}
```

## Weekly tonnage
Is volume rising?

```query:timeseries-2
sum:totalVolume{} by {week}
```

## TIS trend
Is intensity consistent?

```query:timeseries
avg:tis{} by {week}
```

## Volume by effort
Where does the volume go?

```query:toplist
sum:totalVolume{} by {effort}
```

## Load by intensity
Is training polarized?

```query:stacked-bar
sum:sessionLoad{} by {intensity, week}
```

## Distance by discipline
Where is the mileage?

```query:bar
sum:totalDistance{} by {discipline}
```

## Session load trend
Is load building?

```query:timeseries
sum:sessionLoad{} by {week}
```
