---
dashboard: true
title: Polarized Base — Sub-3:30 Marathon
quality:
  - endurance
---

# Polarized Base — Sub-3:30 Marathon

Endurance prebuilt — training-load context from calc.ctl / calc.atl /
calc.tsb (#905, EWMA over session load), the 80/20 intensity split, and
ACWR. The composite PMC chart widget is deferred (widget library map); the
three loads read as value widgets here.

## Fitness (CTL)
42-day chronic load — is base fitness rising?

```query:value
:segment{} | :last{metric:calc.ctl} | :value{}
```

## Fatigue (ATL)
7-day acute load — how deep is this week?

```query:value
:segment{} | :last{metric:calc.atl} | :value{}
```

## Form (TSB)
In the −10…−30 training pocket?

```query:value
:segment{} | :last{metric:calc.tsb} | :value{}
```

## Efficiency factor (calc.ef) is live: running pace ÷ captured avg HR
(capture `hr: <bpm>` in a ```wellness fence on run days).

## Intensity distribution
Actually 80/20 — or stuck in the grey zone?

```query:zone-distribution targets="80 2 18"
:segment{} | :sum{metric:tis} by {intensity} | :zone-distribution{targets:"80 2 18"}
```

## Injury risk (ACWR)
Inside the 0.8–1.3 sweet spot?

```query:timeseries-2
:segment{} | :avg{metric:calc.acwr} by {day} | :timeseries{}
```

## Weekly distance
Mileage building ≤10%/week?

```query:timeseries
:segment{discipline:running} | :sum{metric:totalDistance} by {week} | :timeseries{}
```

## Longest run
Is the long run extending?

```query:value
:segment{discipline:running} | :max{metric:totalDistance} | :value{}
```

## Efficiency factor
More speed per unit of effort?

```query:value
:segment{} | :avg{metric:calc.ef} | :value{}
```
