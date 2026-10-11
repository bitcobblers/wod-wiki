---
search: hidden
title: "Calculated Metrics"
subtitle: "Document-level formulas derive summary values"
section: document
order: 6
---

# Tuesday — Pull Day

```time
rpe: 8
(5 Sets)
  5 Deadlifts 225lb
  5 Deadlifts ?lb
```

```calculate
totalLoad = sum(reps * weight)
avgRPE = mean(rpe)
setCount = count(reps)
```

The unknown load on the second deadlift set is skipped by the calculator, so the derived total only uses rows with complete inputs.
