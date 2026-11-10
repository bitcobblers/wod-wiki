---
dashboard: true
title: Training Block Review
tags:
  - coaching
---

# Training Block Review

The general coaching check-in, re-authored from the retired hardcoded
dashboard page (#899 decision 8). Weekly questions about volume, intensity,
and where the work went.

```query
title: Avg TIS
description: How hard are sessions?
view: value
query: avg:tis{}
```

```query
title: Total volume
description: How much total work?
view: value
query: sum:totalVolume{}
```

```query
title: Total reps
description: How many reps?
view: value
query: sum:totalReps{}
```

```query
title: Adherence
description: Are planned sessions getting done?
view: value
query: avg:calc.adherence{}
```

```query
title: Weekly tonnage
description: Is volume rising?
view: timeseries
span: 2
query: sum:totalVolume{} by {week}
```

```query
title: TIS trend
description: Is intensity consistent?
view: timeseries
query: avg:tis{} by {week}
```

```query
title: Volume by effort
description: Where does the volume go?
view: toplist
query: sum:totalVolume{} by {effort}
```

```query
title: Load by intensity
description: Is training polarized?
view: stacked-bar
query: sum:sessionLoad{} by {intensity, week}
```

```query
title: Distance by discipline
description: Where is the mileage?
view: bar
query: sum:totalDistance{} by {discipline}
```

```query
title: Session load trend
description: Is load building?
view: timeseries
query: sum:sessionLoad{} by {week}
```
