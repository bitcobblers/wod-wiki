---
search: hidden
template: canvas
route: /
type: home
---
```scroll:chapters
runway: 720vh
screen: editor
typewriter: true
stages:
  - id: basics
    range: [0.0, 0.166]
    screen: editor
    source: wods/examples/syntax/single-movement.md
    caption: "Basics. Statements and metrics — how a workout line reads, from rounds to reps."
    ring:
      tag: Basics example
  - id: protocols
    range: [0.166, 0.333]
    screen: editor
    source: wods/examples/syntax/timers-rest.md
    caption: "Protocols. Countdowns, AMRAPs, EMOMs — the timing protocols that pace a workout."
    ring:
      tag: Protocols example
  - id: structure
    range: [0.333, 0.5]
    screen: editor
    source: wods/examples/syntax/groups-1.md
    caption: "Structure. Rounds, groups, and nesting — how blocks compose a workout."
    ring:
      tag: Structure example
  - id: custom-metrics
    range: [0.5, 0.666]
    screen: editor
    source: wods/syntax/custom-metrics-1.md
    caption: "Custom Metrics. Reps, loads, and custom metrics — what gets tracked per movement."
    ring:
      tag: Custom Metrics example
  - id: dialects
    range: [0.666, 0.833]
    screen: editor
    source: wods/examples/syntax/dialect-climb-bouldering.md
    caption: "Dialects. Run, climb, strength — dialect tags that specialize a block."
    ring:
      tag: Dialects example
  - id: complex
    range: [0.833, 1.0]
    screen: editor
    source: wods/examples/syntax/complex-swimming.md
    caption: "Complex Workouts. Multi-set swimming intervals with rest recovery."
    ring:
      tag: Complex example
```


```chapter
id: home-tour
title: Take the Tour
badge: play
quests: qs-arrive, qs-edit, qs-run, qs-tour-timer, qs-tour-analytics
sections: []
```

```chapter
id: basics
title: Basics
badge: trophy
quests: basics-run, basics-movement, basics-reps, basics-load
sections: []
```

```chapter
id: protocols
title: Protocols
badge: timer
quests: protocols-run, protocols-timer, protocols-rounds, protocols-tag
sections: []
```

```chapter
id: structure
title: Structure
badge: blocks
quests: structure-run, structure-rounds, structure-repscheme
sections: []
```

```chapter
id: custom-metrics
title: Custom Metrics
badge: activity
quests: custom-metrics-run, metrics-custom, metrics-calc
sections: []
```

```chapter
id: dialects
title: Dialects
badge: file-text
quests: dialects-run, dialects-log, dialects-climb
sections: []
```

```chapter
id: complex
title: Complex Workouts
badge: puzzle
quests: complex-run, complex-time, complex-rounds
sections: []
```

```quest
id: qs-arrive
label: Welcome to WOD Wiki
desc: You landed on the playground dashboard.
```

```quest
id: qs-tour-timer
label: See the timer run it
desc: Run the workout — the timer starts in the fullscreen clock.
validation:
  type: run-started
```

```quest
id: qs-tour-analytics
label: Review the session
desc: Scroll to the session insights section of the home page.
```

```quest
id: qs-edit
label: Change the workout
desc: Make any edit to the demo script.
```

```quest
id: qs-run
label: Run it to the finish
desc: Press Run and let the workout complete.
validation:
  type: workout-complete
```

```quest
id: basics-run
label: Run the First Example
validation:
  type: run-started
```

```quest
id: protocols-run
label: Run the First Example
validation:
  type: run-started
```

```quest
id: structure-run
label: Run the First Example
validation:
  type: run-started
```

```quest
id: custom-metrics-run
label: Run the First Example
validation:
  type: run-started
```

```quest
id: dialects-run
label: Run the First Example
validation:
  type: run-started
```

```quest
id: complex-run
label: Run the First Example
validation:
  type: run-started
```
