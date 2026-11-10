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

```query
title: Max-hang goal
description: Finger strength vs the benchmark cohort?
view: goal-rings
span: 2
goal: $hangGoal
query: max:calc.mvcBw{}
```

```query
title: Max-hang trend
description: Is the strength block working? Retest every 4–8 weeks.
view: timeseries
span: 2
query: last:calc.mvcBw{} by {week}
```

```query
title: Grade pyramid
description: Base wide enough to support the goal grade?
view: bar
query: count:calc.sends{} by {grade}
```

```query
title: Finger load (ACWR)
description: Keeping tendons in the safe ramp zone?
view: timeseries
query: avg:calc.acwr{} by {day}
```

```query
title: Hangboard sessions
description: Hitting the programmed frequency?
view: value
query: count:sessionLoad{tags:hangboard}
```
