---
dashboard: true
title: Benchmark PR Board
domain: crossfit
---

# Benchmark PR Board

CrossFit / Hyrox prebuilt — benchmark retests and work capacity. Tag
benchmark notes `benchmark` and they land on the board.

```query
title: Benchmark scores
description: Which benchmarks moved this quarter?
view: table
span: 2
query: last:elapsed{tags:benchmark} by {effort}
```

```query
title: Fran trend
description: Closing on the goal time?
view: timeseries
query: last:elapsed{effort:fran} by {week}
```

```query
title: Work capacity
description: Total reps per week rising?
view: timeseries
query: sum:totalReps{} by {week}
```

```query
title: Session intensity
description: Pacing even or blowing up late?
view: bar
query: sum:tis{} by {session, day}
```

```query
title: Training consistency
description: "Sessions logged — gaps visible at a glance."
view: bar
query: count:sessionLoad{} by {day}
```
