---
dashboard: true
title: Recovery & Readiness
quality:
  - recovery
---

# Recovery & Readiness

Recovery prebuilt — readiness, HRV, sleep, and subjective wellness against
objective load (monotony, ACWR). Capture the wellness inputs in a journaling
tion ```wellness fence on a daily note:

```wellness
soreness: 7
sleep: 7.5h
hrv: 62
```

Readiness is the composite (soreness-inverted 40% / sleep 30% / HRV 30%).

## Readiness today
Green-light for intensity?

```query:value
last:calc.readiness{}
```

## HRV trend
Autonomic balance holding?

```query:timeseries-2
avg:calc.hrv{} by {day}
```

## Sleep duration
Hitting the nightly floor?

```query:bar
avg:calc.sleep{} by {day}
```

## Soreness
Subjective load matching objective?

```query:bar
avg:calc.soreness{} by {day}
```

## Monotony
Enough day-to-day variation?

```query:timeseries
avg:calc.monotony{} by {day}
```

## Load balance (ACWR)
Inside the 0.8–1.3 sweet spot all block?

```query:timeseries
avg:calc.acwr{} by {day}
```
