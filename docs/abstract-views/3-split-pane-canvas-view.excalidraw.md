---
excalidraw-plugin: parsed
tags: [excalidraw, abstract-view, architecture, layout, design-guidelines]
excalidraw-default-mode: view
excalidraw-export-dark: true
---

# Split-Pane Guide & Canvas View (Abstract View Architecture)

## 1. Architectural Responsibility & Overview
The **Split-Pane Guide & Canvas View** (`MarkdownCanvasPage.tsx` hosted inside `CanvasPage.tsx`) is the interactive teaching, documentation, and showcase engine of WOD Wiki. It coordinates an asymmetric layout that couples rich explanatory narrative prose with an interactive code execution sandbox.

Key architectural responsibilities include:
- **Dual-Pane Choreography**: Binding a scrolling prose narrative on one panel to a persistent, reactive CodeMirror sandbox on the companion panel.
- **Interactive Syntax Quests**: Tracking real-time user progress through challenges (`useScrollQuests.ts`, `useChapterProgress.ts`, `ChallengeHeaderBadge`) as the reader types and runs code.
- **Dynamic Fenced Controls**: Parsing custom markdown directives including ```view``` fences (declaring initial code and runner presets) and inline ```button``` action triggers.
- **Responsive Geometry Transformation**: Elegantly morphing from a desktop side-by-side split screen into a mobile vertically-pinned sticky cockpit without duplicating state.

---

## 2. Desktop Layout Architecture (≥1024px)
On desktop displays (≥1024px), the view splits the screen into complementary halves:

1. **Global Icon Rail (L1, 56px)** & **Context Sidebar (L2, 240px)**:
   - Provides chapter-by-chapter table of contents, collection groupings, and fast navigation.
2. **Sticky Page Header (`StickyPageHeader.tsx`)**:
   - **Page Title & Subtitle**: Guide name and chapter progression counter.
   - **Quest Badge**: `ChallengeHeaderBadge` indicating active quest completion percentage; clicking smooth-scrolls directly to the current quest block.
   - **Header Controls**: Cast button and Page Options ⋮ menu.
3. **Left Column — Scrolling Prose Runway (`CanvasProse.tsx`)**:
   - Standard readable-width typography.
   - Explanatory copy, syntax anatomy callouts, and inline action buttons (```button``` fences) that load specific snippets into the companion editor panel.
4. **Right Column — Sticky Editor Sandbox (`CanvasEditorPanel variant="desktop"`)**:
   - Pinned full-height alongside the scrolling prose (`hidden lg:flex`).
   - Hosts the live `EditorWindow.tsx` / CodeMirror workspace.
   - **Control Bar**:
     - *Run Workout* button (launches runtime or updates live visualizer).
     - *Reset* button (reverts user edits back to the initial tutorial seed).
     - Live validation status pill (syntax check indicator).

---

## 3. Mobile Layout Architecture (<1024px)
On mobile displays (<1024px), a side-by-side split would compromise text legibility and editor usability. The view automatically transforms into a stacked, sticky-pinned experience:

1. **Top App Navbar**:
   - The desktop `StickyPageHeader` is hidden (`max-lg:hidden`).
   - The compact navbar houses the chapter title, hamburger menu, and `ChallengeHeaderBadge`.
2. **Sticky Pinned Editor Panel (`CanvasEditorPanel variant="mobile"`)**:
   - Renders as a fixed sticky viewport pinned directly below the navbar (`top: 65px`, minimum height 18rem).
   - Keeps the live code example and *Run* / *Reset* controls permanently accessible to the user while reading.
3. **Under-Scrolling Prose Runway**:
   - The narrative tutorial prose scrolls smoothly *underneath* the sticky editor panel.
   - As the user scrolls through different sections, scroll-spy hooks (`usePageScrollSync`) can dynamically swap the code snippet loaded in the pinned editor above.
4. **Thumb Dock & Floating Controls**:
   - Search FAB and ⋮ overflow sheet float in the bottom corner with safe bottom padding (`max-lg:pb-48`).

---

## 4. Dual-Pane Data & Quest Pipeline
```
  [Markdown Source with ```view & ```button fences]
                     │
                     ▼
         [parseCanvasMarkdown.ts]
         ├── Prose AST ───────────► CanvasProse (Scrolling narrative)
         └── View Definition ─────► CanvasEditorPanel (Sandbox code)
                     │
                     ▼
         [Live CodeMirror 6 Window]
                     │
          (User edits & runs code)
                     │
                     ▼
       [syntaxChallengeValidator] ──► useScrollQuests ──► ChallengeHeaderBadge
```

---

## 5. Typed Views Comparison Matrix
The table below specifies how each concrete route implements the abstract **Split-Pane Guide & Canvas View**:

| Typed View | Route Pattern | Content Focus | Left Panel / Under Runway | Right Panel / Sticky Window | Primary Action |
|---|---|---|---|---|---|
| **Interactive Syntax Guide** | `/page/guide-start`, `/page/guide-protocols` | Syntax training & language dialect tutorial | Chapter explanations, grammar callouts, interactive quest challenges | Live CodeMirror runner, validation indicator, *Run* & *Reset* | *Run Code* (validates challenge & advances quest) |
| **Analytics Tutorial** | `/page/guide-wql`, `/ai-first` | WQL query language & aggregation training | Analytical concept narrative, dataset schema docs | Live WQL query editor with instant chart preview frame | *Execute Query* (generates live timeseries/bar chart) |
| **Collection Landing** | `/notebook/:slug` | Curated workout set showcase & dispatch | Collection README markdown, category badges, author attribution | Interactive `CollectionWorkoutsList` + CodeMirror workout preview | *Schedule* / *Add to Today* / *Run* selected workout |
| **Scroll Quest Runway** | `/page/:slug`, `ScrollCanvasPage` | Step-by-step sequential tutorial runway | Staged tutorial cards (`TourSectionRunway`) | Pinned typewriter runner with auto-advancing challenge steps | *Next Challenge* / *Complete Quest* |


# Excalidraw Data

## Text Elements
SPLIT-PANE CANVAS VIEW: DUAL-PANE TO STICKY-PINNED ADAPTATION ^zjDq21q0

Desktop Layout (Viewport ≥ 1024px) — Side-by-Side Split ^l2XwtpIQ

StickyPageHeader: Guide › Syntax & Language ^d2hGDm7c

🏆 Quest 2/5 (40%) ^H8QUroXC

⎘ ^xrRIL8G6

⋮ ^Dnve4Hjx

SCROLLING PROSE RUNWAY (CanvasProse) ^zUKZVa8E

## Section 2: Building AMRAPs ^Hrk8WQvm

An AMRAP defines a timed interval where
athletes complete as many rounds as possible.
Notice how each movement specifies reps and
load parameters. ^CEg8nyto

Load AMRAP Example ▶ ^tYwspg4I

### Challenge Checklist:
✓ Define 20-minute cap
• Add 5 Kettlebell Swings (24kg)
• Add 10 Burpees ^wN8sK3uk

CanvasEditorPanel (variant='desktop') ^VG18NOO3

Run ▶ ^lQk7qRKf

Reset ^RUSGNnbS

20 min AMRAP
  5 Pull-ups
  10 Push-ups
  15 Air Squats ^9Wxdjz3T

Live Execution Preview & Validation ^DqwCT1Rv

Status: VALID SYNTAX
Estimated Pace: 18 rounds
Target MET: 11.2 (Cardiovascular High) ^i4KV74cw

Mobile Layout (< 1024px) — Vertically Stacked & Pinned ^3LETPwIU

☰ ^YWh8Ozka

Guide › Syntax ^wTqJufLw

🏆 Q2 (40%) ^9au9Cj9J

Sticky Mini-Editor (top: 65px) ^LVCPqPlN

Run ▶ ^bZdkES7c

↺ ^ylYZg3lY

20 min AMRAP
  5 Pull-ups
  10 Push-ups
  15 Air Squats ^Te2giQzw

Prose scrolls underneath the sticky editor: ^1YdWcT5J

## Section 2: Building AMRAPs ^3q6xRWyn

An AMRAP defines a timed interval where
athletes complete as many rounds as possible.
Read here while code stays visible above! ^MEoA7yAf

⋮ ^lOJ2YpHm

🔍 ^Gg0lLthw

Right Side Panel transforms into Sticky Mobile Top Cockpit ^uwwyxQM2

%%
## Drawing
```compressed-json
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
```
%%