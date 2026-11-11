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

```query
title: Fitness (CTL)
description: "42-day chronic load — is base fitness rising?"
view: value
query: last:calc.ctl{}
```

```query
title: Fatigue (ATL)
description: "7-day acute load — how deep is this week?"
view: value
query: last:calc.atl{}
```

```query
title: Form (TSB)
description: In the −10…−30 training pocket?
view: value
query: last:calc.tsb{}
```

## Efficiency factor (calc.ef) is live: running pace ÷ captured avg HR
(capture `hr: <bpm>` in a ```wellness fence on run days).

```query
title: Intensity distribution
description: "Actually 80/20 — or stuck in the grey zone?"
view: zone-distribution
targets: [80, 2, 18]
query: sum:tis{} by {intensity}
```

```query
title: Injury risk (ACWR)
description: Inside the 0.8–1.3 sweet spot?
view: timeseries
span: 2
query: avg:calc.acwr{} by {day}
```

```query
title: Weekly distance
description: Mileage building ≤10%/week?
view: timeseries
query: sum:totalDistance{discipline:running} by {week}
```

```query
title: Longest run
description: Is the long run extending?
view: value
query: max:totalDistance{discipline:running}
```

```query
title: Efficiency factor
description: More speed per unit of effort?
view: value
query: avg:calc.ef{}
```
