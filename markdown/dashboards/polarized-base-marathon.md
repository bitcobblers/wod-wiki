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
last:calc.ctl{}
```

## Fatigue (ATL)
7-day acute load — how deep is this week?

```query:value
last:calc.atl{}
```

## Form (TSB)
In the −10…−30 training pocket?

```query:value
last:calc.tsb{}
```

## Efficiency factor (calc.ef) is live: running pace ÷ captured avg HR
(capture `hr: <bpm>` in a ```wellness fence on run days).

## Intensity distribution
Actually 80/20 — or stuck in the grey zone?

```query:zone-distribution targets="80 2 18"
sum:tis{} by {intensity}
```

## Injury risk (ACWR)
Inside the 0.8–1.3 sweet spot?

```query:timeseries-2
avg:calc.acwr{} by {day}
```

## Weekly distance
Mileage building ≤10%/week?

```query:timeseries
sum:totalDistance{discipline:running} by {week}
```

## Longest run
Is the long run extending?

```query:value
max:totalDistance{discipline:running}
```

## Efficiency factor
More speed per unit of effort?

```query:value
avg:calc.ef{}
```
