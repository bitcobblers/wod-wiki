---
dashboard: true
title: Road to a 560 kg Total
dashboard.squatGoal: 200
dashboard.benchGoal: 140
dashboard.deadliftGoal: 220
quality:
  - strength
---

# Road to a 560 kg Total

Strength prebuilt — tonnage, estimated 1RM, and per-lift goal rings. Ring
targets are frontmatter tokens ($squatGoal / $benchGoal / $deadliftGoal);
edit them as the meet approaches. e1RM derives from logged sets via
calc.e1rm (#904), and %1RM intensity (calc.pct1rm) is the Epley-inverse %
of each set's projected max.

```query
title: Squat goal
description: How close to the target?
view: goal-rings
goal: $squatGoal
query: max:calc.e1rm{effort:back-squat}
```

```query
title: Bench goal
description: How close to the target?
view: goal-rings
goal: $benchGoal
query: max:calc.e1rm{effort:bench-press}
```

```query
title: Deadlift goal
description: How close to the target?
view: goal-rings
goal: $deadliftGoal
query: max:calc.e1rm{effort:deadlift}
```

```query
title: Estimated 1RM trend
description: Is strength actually surging?
view: timeseries
span: 2
query: max:calc.e1rm{} by {effort, week}
```

```query
title: Tonnage by week
description: Enough volume for adaptation?
view: bar
query: sum:totalVolume{discipline:strength} by {week}
```

```query
title: Average intensity
description: Neural demand in the right zone?
view: timeseries
query: avg:calc.pct1rm{discipline:strength} by {week}
```

```query
title: Volume by lift
description: Main lifts vs accessories balance?
view: toplist
query: sum:totalVolume{discipline:strength} by {effort}
```

```query
title: Session strain
description: Is fatigue outpacing recovery?
view: timeseries
query: sum:sessionLoad{discipline:strength} by {week}
```
