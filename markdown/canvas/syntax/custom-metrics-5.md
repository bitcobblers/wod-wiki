---
search: hidden
title: "Calculated Metrics"
subtitle: "Derive values from custom metrics across a workout"
section: custom-metrics
order: 5
---
```time
(5 Sets)
  5 Back Squat 225lb {"rpe": 8}
  *2:00 Rest

calculate
  totalLoad = sum(reps * weight)
  avgRPE = mean(rpe)
```
