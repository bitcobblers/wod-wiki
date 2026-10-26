---
excalidraw-plugin: parsed
tags: [excalidraw, abstract-view, architecture, layout, design-guidelines]
excalidraw-default-mode: view
excalidraw-export-dark: true
---

# Dashboard & Analytics View (Abstract View Architecture)

## 1. Architectural Responsibility & Overview
The **Dashboard & Analytics View** (`DashboardView.tsx` inside `DashboardViewPage.tsx` and `AnalyticsExplorerPage.tsx`) is the analytical computation and visual metrics engine of WOD Wiki. It bridges authored workout logs and event statement streams to reactive visual representations via Workout Query Language (WQL).

Key architectural responsibilities include:
- **Declarative Note-Backed Dashboards**: Reading and writing dashboard definitions directly as Markdown notes with YAML frontmatter (`dashboard: true`) and fenced ```query``` blocks (`packages/wql/src/dashboard/model.ts`).
- **Parallel Query Execution**: Orchestrating independent, asynchronous queries per widget card against the unified event and session stores via `queryService`.
- **Polymorphic Widget Rendering**: Mapping query result datasets to specialized presentation components: `WqlBars` (volume/frequency distributions), `WqlTimeseries` (pace/load progressions), `RowsTable` (tabular records), and `QueryValue` (single-metric hero stats).
- **Interactive Pipeline Introspection**: Parsing and exposing AST tokens, field catalogs, and underlying fact statement streams for deep data auditability.

---

## 2. Desktop Layout Architecture (≥1024px)
On desktop screens, the dashboard layout maximizes horizontal information density:

1. **Global Icon Rail (L1, 56px)** & **Context Sidebar (L2, 240px)**:
   - Lists saved user dashboards, metric presets, and categorized field schemas.
2. **Sticky Page Header (`StickyPageHeader.tsx`)**:
   - **Dashboard Title**: Document name and live calculation timestamp.
   - **Time Window Filter**: Dropdown or pill selector (*Last 4w*, *Last 12w*, *YTD*, *All Time*).
   - **Unit Preference**: Imperial / Metric switch (kg/lbs, km/miles).
   - **Action Bar (ResponsiveActions)**:
     - *+ Add Widget* button (launches `WidgetComposerDialog.tsx`).
     - *Edit Layout* toggle (enables drag reordering and query fence mutation).
     - *Cast* button (streams dashboard cards to TV displays).
     - *Page Options ⋮* dropdown menu (Export CSV, Download Dashboard Markdown).
3. **Multi-Column Responsive Grid Canvas**:
   - Organized in a 12-column or 3-column responsive CSS grid.
   - Individual widget cards span 1, 2, or 3 columns based on their query directive.
   - Each card encapsulates:
     - Header: Widget title, query chip, and card-level *Edit Query* pencil.
     - Body: Live chart with interactive hover scrubbers, date crosshairs, and legends.
     - Footer: Min/Max/Avg statistics and data point count.
4. **Explorer Mode Split (Analytics Explorer)**:
   - On `/dashboard`, an interactive `ExplorerCommandBar` crowns the view with syntax pills, followed by a dynamic chart frame and side-by-side or bottom tabs for *Inspect Pipeline* (AST tokens) and *Records* (raw fact statement logs).

---

## 3. Mobile Layout Architecture (<1024px)
On mobile displays (<1024px), the multi-card grid restructures into an ergonomic, swipeable feed:

1. **Top App Navbar**:
   - Desktop `StickyPageHeader` is hidden (`max-lg:hidden`).
   - Navbar displays the dashboard title and active time range badge.
   - Cast trigger remains in the top right.
2. **Single-Column Full-Width Card Stack**:
   - Multi-column grids collapse into a single-column vertical feed (`grid-cols-1`).
   - Widget cards expand to full screen width.
   - Hover tooltips switch to touch-activated scrubbers (tapping and dragging a finger across the chart reveals data points).
3. **Primary Thumb Dock FAB & Overflow Sheet**:
   - Floating primary FAB acts as **+ Add Widget** or **Edit Grid**.
   - Time window selection, unit preference toggles, and dashboard markdown export fold into the **⋮ overflow sheet**.
   - Base of the stack hosts the dedicated Search FAB.
4. **Touch Ergonomics & Clearance**:
   - Cards enforce touch margins and touch targets ≥44px for card action pills.
   - Page container enforces `max-lg:pb-48` clearance.

---

## 4. Query Pipeline & Store Execution
```
   [Dashboard Note (Markdown with ```query fences)]
                         │
                         ▼
        [useDashboardSource / Parse AST]
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   [Widget 1 WQL]   [Widget 2 WQL]   [Widget 3 WQL]
        │                │                │
        └────────────────┼────────────────┘
                         ▼
             [WQL QueryService Engine]
                         │
                         ▼
             [UnifiedEventStore / IndexedDB]
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   [WqlTimeseries]   [WqlBars]       [RowsTable]
   (Pace Progression) (Volume Dist)   (Raw Records)
```

---

## 5. Typed Views Comparison Matrix
The table below specifies how each concrete route implements the abstract **Dashboard & Analytics View**:

| Typed View | Route Pattern | Host Component | Data Document Format | Primary Mode / Purpose | Key Desktop Actions | Mobile Dock Relocation |
|---|---|---|---|---|---|---|
| **Dashboard View Page** | `/dashboard/:slug` | `DashboardViewPage.tsx` | Markdown Note with `dashboard: true` & ```query``` fences | Multi-card dashboard grid for long-term tracking | + Add Widget, Edit Layout, Time Window, Unit Toggle | FAB: + Widget; ⋮ Sheet: Time Filter, Units, Export |
| **Analytics Explorer** | `/dashboard` | `AnalyticsExplorerPage.tsx` | Ephemeral WQL input + Catalog Backfill | Ad-hoc query authoring, AST inspection & experimentation | Execute Query, Save to Dashboard, Inspect Pipeline | FAB: Execute; Bottom Accordion: AST & Raw Facts |
| **Home Analytics Section** | `/` (Tour Section) | `HomeAnalyticsSection.tsx` | Curated showcase query set | App walkthrough demonstration of analytical power | Sample data toggle, interactive chart scrubbers | Integrated into sequential vertical mobile tour stack |


# Excalidraw Data

## Text Elements
DASHBOARD & ANALYTICS VIEW: RESPONSIVE GRID ARCHITECTURE ^txt_title

Desktop Layout (Viewport ≥ 1024px) — Multi-Column Grid ^txt_desk_header

StickyPageHeader: Performance Analytics Dashboard ^txt_desk_hdr_title

Last 12w ▾ ^txt_time_pill

kg / km ^txt_unit_pill

+ Add Widget ^txt_btn_add

✎ Layout ^txt_btn_edit

⎘ ^txt_btn_cast

⋮ ^txt_btn_opt

WqlTimeseries: 5k Pace Progression over Time ^txt_w1_t

📈 Pace Trend Line Chart [ 4:45/km ─── 4:32/km ─── 4:18/km ] ^txt_w1_c

Avg: 4:26/km   Best: 4:18/km   Data points: 14 sessions ^txt_w1_stat

QueryValue: Total Volume ^txt_w2_t

142,500 ^txt_w2_val

kg lifted (last 12w) ^txt_w2_sub

▲ +14% vs prior period ^txt_w2_trend

WqlBars: Weekly Discipline Distribution (Cardio vs Gymnastics vs Weightlifting) ^txt_w3_t

📊 [==Cardio==] [====Strength====] [==Gymnastics==] [====Cardio====] ^txt_w3_bars

Total sessions: 48   Weekly Avg: 4.0 sessions/week ^txt_w3_f

DASHBOARD & ANALYTICS VIEW: RESPONSIVE GRID ARCHITECTURE ^cofH2kXB

Desktop Layout (Viewport ≥ 1024px) — Multi-Column Grid ^cHoTIilR

StickyPageHeader: Performance Analytics Dashboard ^sUVtxps1

Last 12w ▾ ^y7v5dHYE

kg / km ^tNwDLieX

+ Add Widget ^PaOwdE1c

✎ Layout ^lw6NIEGN

⎘ ^d3DH4bty

⋮ ^f1IETX8N

Avg: 4:26/km   Best: 4:18/km   Data points: 14 sessions ^mCx7tizB

142,500 ^gXAT2LM3

kg lifted (last 12w) ^MyoOIxt4

▲ +14% vs prior period ^kaecblPY

📊 [==Cardio==] [====Strength====] [==Gymnastics==] [====Cardio====] ^n5DUwq2N

Mobile Layout (< 1024px) — Single-Column Feed ^0PmYP64e

☰ ^055ld9uh

Dashboards › Performance ^XxqI7lji

12 Weeks ^0wgzkuS1

⎘ ^BYhUq1Vk

5k Pace Progression ^eotwUXGW

📈 Touch Scrubber [ 4:32/km @ Week 6 ] ^KW6hGEPX

Best: 4:18/km · 14 sessions ^YyGs3Ov4

Total Volume (Last 12w) ^n8q2NaI5

142,500 kg ^xgxalFLu

▲ +14% vs prior ^spfeRjZN

Discipline Distribution ^EnOMFbWs

📊 [==Cardio==] [====Strength====] ^JuOdNSdC

48 sessions total ^OPUYGG2X

Thumb Dock ^biB0aomy

+ ^EPqxNRrO

⋮ ^eDiVGUL7

🔍 ^DK8ezqVV

Add Widget button relocates to Primary Thumb FAB ^i1iqFPqq

Time Window & Unit options fold into Mobile ⋮ Sheet ^zinJO2iB

%%
## Drawing
```compressed-json
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
```
%%