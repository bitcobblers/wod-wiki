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
max:calc.mvcBw{}
```

## Max-hang trend
Is the strength block working? Retest every 4–8 weeks.

```query:timeseries-2
last:calc.mvcBw{} by {week}
```

## Grade pyramid
Base wide enough to support the goal grade?

```query:bar
count:calc.sends{} by {grade}
```

## Finger load (ACWR)
Keeping tendons in the safe ramp zone?

```query:timeseries
avg:calc.acwr{} by {day}
```

## Hangboard sessions
Hitting the programmed frequency?

```query:value
count:sessionLoad{tags:hangboard}
```
