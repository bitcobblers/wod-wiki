---
dashboard: true
title: Finger Strength → V8
dashboard.hangGoal: 35
domain: climbing
---

# Finger Strength → V8

Climbing prebuilt — max-hang strength against a %BW goal, send pyramid,
and tendon load. calc.mvcBw = hang ÷ bodyweight, and calc.sends counts
completed sends by grade. Capture a hang test / bodyweight in a
```wellness fence (`hang: 30kg`, `weight: 80kg`) on strength days; the
ring target is the frontmatter $hangGoal token.

## Max-hang goal
Finger strength vs the benchmark cohort?

```query:goal-rings-2 goal=$hangGoal
:segment{} | :max{metric:calc.mvcBw} | :goal-rings{goal:"$hangGoal"}
```

## Max-hang trend
Is the strength block working? Retest every 4–8 weeks.

```query:timeseries-2
:segment{} | :last{metric:calc.mvcBw} by {week} | :timeseries{}
```

## Grade pyramid
Base wide enough to support the goal grade?

```query:bar
:segment{} | :count{metric:calc.sends} by {grade} | :bar{}
```

## Finger load (ACWR)
Keeping tendons in the safe ramp zone?

```query:timeseries
:segment{} | :avg{metric:calc.acwr} by {day} | :timeseries{}
```

## Hangboard sessions
Hitting the programmed frequency?

```query:value
:segment{tags:hangboard} | :count{metric:sessionLoad} | :value{}
```
