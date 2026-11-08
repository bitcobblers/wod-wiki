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
:segment{} | :last{metric:calc.readiness} | :value{}
```

## HRV trend
Autonomic balance holding?

```query:timeseries-2
:segment{} | :avg{metric:calc.hrv} by {day} | :timeseries{}
```

## Sleep duration
Hitting the nightly floor?

```query:bar
:segment{} | :avg{metric:calc.sleep} by {day} | :bar{}
```

## Soreness
Subjective load matching objective?

```query:bar
:segment{} | :avg{metric:calc.soreness} by {day} | :bar{}
```

## Monotony
Enough day-to-day variation?

```query:timeseries
:segment{} | :avg{metric:calc.monotony} by {day} | :timeseries{}
```

## Load balance (ACWR)
Inside the 0.8–1.3 sweet spot all block?

```query:timeseries
:segment{} | :avg{metric:calc.acwr} by {day} | :timeseries{}
```
