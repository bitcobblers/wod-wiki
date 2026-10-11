---
search: hidden
template: canvas
route: /
type: home
---
```scroll
runway: 1300vh
screen: editor
typewriter: true
stages:
  - id: editor-blank
    range: [0.0, 0.12]
    screen: editor
    accent: hsl(var(--primary))
    label: Blank Page & Typeahead
    source: wods/examples/home/welcome-1.md
    caption: "Start with a Blank Page. Freeform entry & WOD fences. WOD Wiki notes are freeform Markdown. To get live timer execution and metric tracking, open a fenced block with triple backticks — ```time for workouts or ```wql for queries."
    ring:
      key: editor.window
      tag: "Live Editor"
  - id: editor-metrics
    range: [0.12, 0.24]
    screen: editor
    accent: hsl(var(--primary))
    label: Every Line Collects Metrics
    source: wods/examples/home/welcome-1.md
    caption: "Every Line Collects Metrics. Reps, distance & load. Each line defines the metric types the runtime will collect: rep counts (15 Swings), distance (400m Run), load resistance (24kg, 225lb), and timed rest (*:30 Rest)."
    ring:
      key: editor.wodBlock
      tag: Line Metrics
  - id: editor-run
    range: [0.24, 0.36]
    screen: editor
    accent: hsl(var(--primary))
    label: Press Run to Start
    source: wods/examples/home/welcome-1.md
    caption: "Press Run to start the Clock. Scrolling through the tour never starts a workout. Use Next to advance and Stop to save your results."
    ring:
      key: editor.runButton
      tag: Run Button
  - id: timer-wallclock
    range: [0.36, 0.47]
    screen: timer
    accent: hsl(var(--primary))
    label: What Happens When It Runs
    source: wods/examples/home/welcome-1.md
    caption: "What Happens When It Runs. The script becomes the clock. The Clock runs your exact script — stepping through reps, distance, and load lines at your own pace without forced countdown caps."
    ring:
      key: timer.floor
      tag: Clock
  - id: timer-next
    range: [0.47, 0.57]
    screen: timer
    accent: hsl(var(--primary))
    label: Advance Rounds with Next
    source: wods/examples/home/welcome-1.md
    caption: "Next Advances the Workout. Every click locks a time. Click Next to advance to the next movement or round. Each click records elapsed time as a split. Stop or completion saves the results; the Metrics section shows them when you reach it."
    ring:
      key: timer.nextButton
      tag: Next Button
  - id: timer-cast
    range: [0.57, 0.65]
    screen: timer
    accent: hsl(var(--primary))
    label: Cast to the Big Screen
    source: wods/examples/home/welcome-1.md
    caption: "Cast to the Big Screen. Real-time mirror for the gym floor. Stream the Clock to Chromecast or a shared screen — live rep counters and timers update in real time."
    ring:
      key: timer.castButton
      tag: Cast
  - id: wql-idea
    range: [0.65, 0.72]
    screen: analytics
    accent: hsl(var(--primary))
    label: Query what you just did
    caption: "Query what you just did. Every result is one query away. WQL turns your journal into queryable facts — pick an aggregator and a metric, filter by tag, group by a dimension, roll up over time. The same elements drive every presentation in this window."
    ring:
      key: analytics.vocab
      tag: "WQL elements"
  - id: wql-table
    range: [0.72, 0.79]
    screen: analytics
    accent: hsl(var(--primary))
    label: Read it as a list
    caption: "Read it as a list. One aggregator, one metric, one dimension: sum total reps grouped by effort becomes a ranked table the moment the workout is logged. The chips above the widget are the parsed query — the vocabulary, front and center."
    ring:
      key: analytics.table
      tag: Table list
  - id: wql-graphs
    range: [0.79, 0.86]
    screen: analytics
    accent: hsl(var(--primary))
    label: See it as trends
    caption: "See it as trends. Roll the same facts up by week and they become a timeseries — is tonnage rising, is training polarized? A graph is not a feature you enable; it is a rollup away."
    ring:
      key: analytics.graphs
      tag: Graphs
  - id: wql-dashboard
    range: [0.86, 0.93]
    screen: analytics
    accent: hsl(var(--primary))
    label: Compose a dashboard
    caption: "Compose a dashboard. A dashboard is just N queries on one screen. Mix values, lists, and graphs — each tile its own WQL statement, exactly like the DashboardView you get in the app."
    ring:
      key: analytics.dashboard
      tag: Dashboard
  - id: wql-live
    range: [0.93, 1.00]
    screen: analytics
    accent: hsl(var(--primary))
    label: It's your data
    caption: "Explore labelled example data without adding workouts to your journal. Your recorded runs stay separate. Open Dashboards to query your own training."
```

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
desc: Let the demo timer reach a running state in the Clock stage.
validation:
  type: run-started
```

```quest
id: qs-tour-analytics
label: Review the session
desc: Scroll through the analytics stage of the home tour.
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
