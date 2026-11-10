---
dashboard: true
title: Recovery & Readiness
quality:
  - recovery
---

# Recovery & Readiness

Recovery prebuilt — readiness, HRV, sleep, and subjective wellness against
objective load (monotony, ACWR). Capture the wellness inputs in a daily
note's ```wellness fence:

```wellness
soreness: 7
sleep: 7.5h
hrv: 62
```

Readiness is the composite (soreness-inverted 40% / sleep 30% / HRV 30%).

```query
title: Readiness today
description: Green-light for intensity?
view: value
query: last:calc.readiness{}
```

```query
title: HRV trend
description: Autonomic balance holding?
view: timeseries
span: 2
query: avg:calc.hrv{} by {day}
```

```query
title: Sleep duration
description: Hitting the nightly floor?
view: bar
query: avg:calc.sleep{} by {day}
```

```query
title: Soreness
description: Subjective load matching objective?
view: bar
query: avg:calc.soreness{} by {day}
```

```query
title: Monotony
description: Enough day-to-day variation?
view: timeseries
query: avg:calc.monotony{} by {day}
```

```query
title: Load balance (ACWR)
description: Inside the 0.8–1.3 sweet spot all block?
view: timeseries
query: avg:calc.acwr{} by {day}
```
