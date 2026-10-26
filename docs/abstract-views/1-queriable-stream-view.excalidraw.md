---
excalidraw-plugin: parsed
tags: [excalidraw, abstract-view, architecture, layout, design-guidelines]
excalidraw-default-mode: view
excalidraw-export-dark: true
---

# Queriable Stream View (Abstract View Architecture)

## 1. Architectural Responsibility & Overview
The **Queriable Stream View** (`QueriableStreamView.tsx`) is the core abstract listing and shelf engine of WOD Wiki. Rather than hard-coding separate list architectures for journals, catalog libraries, collections, movements, and execution results, the application parameterizes a single reactive stream shell via a **StreamProfile** contract (`streamProfile.ts`).

This abstract view manages:
- Dynamic WQL (Workout Query Language) execution against indexed content planes and event stores via `queryService`.
- Real-time tokenized filtering, source scoping, and date-range partitioning.
- Responsive layout switching between **Feed**, **Card Grid**, and **Property Table / Rows** modes.
- Desktop-to-mobile command relocation via `ResponsiveActions`, `MobileQueryFooter`, and thumb-driven floating action clusters.

---

## 2. Desktop Layout Architecture (≥1024px)
On desktop screens, the stream view operates as a high-density triage workstation:

1. **Global Icon Rail (L1, 56px)**:
   - Pinned on the far left (`AppRail.tsx`). Hosts global top-level navigation: Home, Library, Dashboards, Efforts, Search palette trigger, and Settings.
2. **Context Sidebar (L2, 240px)**:
   - Secondary navigational tree (`NavSidebar.tsx`) displaying stream facets, saved queries, tags, and category hierarchies.
3. **Sticky Page Header (`StickyPageHeader.tsx`)**:
   - **Header Title**: Stream identity and result count badge.
   - **WQL Query Bar Slot**: Embedded `StreamQueryBar.tsx` featuring AST token pills (target, scope, time window), inline query composer, live syntax validator, and stage match counter.
   - **Action Bar**: Right-aligned buttons declared via `ResponsiveActions`:
     - *View Settings* button (sliders icon) opening `ViewSettingsDialog.tsx` (layout mode, grouping, column visibility).
     - *New Action* button (e.g. "+ New Effort" on `/efforts`).
     - *Cast* button (Chromecast mirror stream trigger).
     - *Page Options ⋮* dropdown menu (Download Markdown, CSV export).
4. **Primary Content Runway**:
   - Renders matching items through the selected layout strategy:
     - **Rows (`LibraryRow.tsx`)**: Compact table rows. Hovering reveals a persistent action stack: *Open*, *Add to Today*, *Run*, *Compare*.
     - **Feed (`StreamFeed.tsx`)**: Expanded cards showing full markdown workout blocks, round estimates, and execution controls.
     - **Cards**: Tile grid with metadata badges (discipline, MET, duration).
5. **Date Grouping**:
   - Chronological date grouping comes from the stream's own feed (`StreamFeed`). No auxiliary date-jump rail is mounted (the `JournalDateScroll` runway was removed — it was never wired in).

---

## 3. Mobile Layout Architecture (<1024px)
On viewports smaller than 1024px (Tailwind `lg`, `MOBILE_BREAKPOINT_PX = 1023`), desktop top-bar interactions collapse to favor one-handed thumb ergonomics:

1. **Top Navbar Header**:
   - The desktop `StickyPageHeader` is completely suppressed (`max-lg:hidden`).
   - Page identity is conveyed via the compact sticky navbar breadcrumb (`L1 › Title`).
   - Cast trigger is pinned to the top right of the navbar.
2. **Thumb Footer Bar (`MobileQueryFooter`)**:
   - Full-width fixed bottom bar spanning the viewport base.
   - Renders a compact query button strip: Search icon + Active Source Pill + Query preview string.
   - Tapping the footer opens the modal **WQL Palette Dialog**, providing the full-screen touch keyboard and filter typeahead.
3. **Thumb Dock (Floating Action Cluster)**:
   - Floats directly above the thumb footer (offset by `--thumb-dock-lift`).
   - Corner aligned to left or right based on user preference (*Settings → Appearance → Actions Button Position*, `fabAlignment.ts`).
   - **Vertical Action Stack** (lowest to highest):
     - **Search FAB**: Dedicated bottom trigger opening global search (`Ctrl/Cmd+/`).
     - **View Settings FAB**: Secondary trigger opening layout preferences modal.
     - **Primary Action FAB**: Highest button in the stack (e.g., "+ New" on efforts stream).
     - **More Options ⋮ FAB**: Tapping opens a bottom slide-over sheet displaying secondary actions in ≥44px touch-friendly rows.
4. **Content Clearance & Touch Interactions**:
   - Content container enforces `max-lg:pb-48` to prevent floating dock and footer overlap.
   - Hover-revealed action stacks are disabled; items activate immediately on touch tap.

---

## 4. Content Zones & Data Pipeline
```
[Query String / Filter Pills]
          │
          ▼
   [QueryService]  ◄─── IndexedDB Stores (notes, blockIndex, events, sessions, efforts)
          │
          ▼
 [StreamProfile Mapper] ─── Grouping (Date, Category, Tag)
          │
          ▼
 [QueriableStreamView]
   ├── Desktop: StickyPageHeader (QueryBar + View Actions) + Multi-column Runway
   └── Mobile:  App Navbar + Feed Items (pb-48) + Thumb Dock FABs + MobileQueryFooter
```

---

## 5. Typed Views Comparison Matrix
The table below specifies how each concrete route implements the abstract `QueriableStreamView`:

| Typed View | Route Pattern | StreamProfile Key | Default WQL Query | Primary Data Source | Specific Header / Mobile Actions | Layout Defaults |
|---|---|---|---|---|---|---|
| **Journal Stream** | `/journal` | `JOURNAL_STREAM_PROFILE` | `find:note{source:journal} last 4w` | `notes`, `page` (IndexedDB) | View Settings; tap opens `/day/:date` | Chronological date-grouped feed (`StreamFeed`) |
| **Library Catalog** | `/library` | `LIBRARY_STREAM_PROFILE` | `find:note last 2w` | `notes`, `blockIndex` | View Settings; Undated shelf; Multi-select compare | Compact rows with hover action stack (Open/Add/Run) |
| **Notebooks Listing** | `/notebooks` | `NOTEBOOKS_STREAM_PROFILE` | `:notebook{} by {tag}` | `markdown/notebooks/` + seed notes | Sync notice when no library imported; tap opens `/notebook/:slug` | Tag-grouped card grid |
| **Efforts Registry** | `/efforts` | `EFFORTS_STREAM_PROFILE` | `find:effort` | `efforts` store + `useEffortRegistry` | **Primary "+ New Effort"** button (Dock FAB on mobile) | Property table showing MET, discipline, aliases |
| **Notebook Stream** | `/feeds` | `FEEDS_STREAM_PROFILE` | `:notebook{source:notebooks}` | seed library notes (`notebook:` storage identities) | Sync notice when no library imported; "Add to Journal" per card | Note cards |
| **Execution History** | `/results` | `RESULTS_STREAM_PROFILE` | `rows:all{} last 4w` | `sessions` & `events` stores | Time window selector, metric toggles; tap opens session | Log table with duration, rounds, reps, pace |
| **Segment Results** | `/results/segments` | `SEGMENTS_STREAM_PROFILE` | `rows:segment{} last 8w` | `events` output collector | Segment type facet filter; drill-down to statement | Segment split rows with interval timing |


# Excalidraw Data

## Text Elements
QUERIABLE STREAM VIEW: RESPONSIVE ARCHITECTURE & COMMAND RELOCATION ^H4A2ceTV

Desktop Layout (Viewport ≥ 1024px) ^JBKFts0W

L1 RAIL ^hGyblnfd

H ^n5f3tk78

L ^9RtkzBUH

D ^xhHVmn9Z

E ^HrWGLUr2

L2 CONTEXT SIDEBAR ^GJ0ndoQu

All Entries ^Sgmnr9fT

Favorites ^hp0JTAsI

Tagged: #cardio ^M2I1Dx3p

StickyPageHeader: Library Stream ^9C9WtaTG

WQL: find:note{source:journal} last 4w ^vAWac1ws

⚙ View ^IfcE07FM

⋮ ^jfxrys20

⎘ ^EQeaottd

StreamFeed / Rows Runway (Active Profile Content) ^lvebVqAb

2026-09-24 · Cindy Workout ^dgjL3zYE

20 Min AMRAP: 5 Pull-ups, 10 Push-ups, 15 Squats ^CWn2jfEU

[Open] [Run] [Today] ^PHxBFblC

2026-09-22 · 5k Tempo Run ^jVGbGohh

Cardio · Pace: 4:30/km · Total: 22:30 ^H43tarN6

2026-09-20 · Back Squat 5x5 ^f8DpsleY

Strength · Load: 140kg · RPE 8.5 ^VM91MdLN

Mobile Layout (< 1024px) ^WnKnXC3i

☰ ^UTJtrKmB

Library › Journal Stream ^v7aMHziS

⎘ ^eIYgKtWE

Feed items render with max-lg:pb-48 clearance ^TH5ZKuea

2026-09-24 · Cindy Workout ^7KBDAG64

20 Min AMRAP · Full Body · High Intensity ^zBwyddYj

Run ▶ ^5RyFhslV

2026-09-22 · 5k Tempo Run ^syJMHUIS

Cardio · 22:30 · Avg HR 165 ^lrPLEoMw

Thumb Dock ^7lUbrjpL

⚙ ^d7PNDaoI

⋮ ^CY37UxBx

🔍 ^uj4TV0Oh

🔍 ^eHhikedM

{journal} ^Gplw0ll7

find:note last 4w ^2nhymsiQ

Header Query Bar relocates to Mobile Thumb Footer ^Wq7GHiLc

View Settings button relocates to Thumb Dock FAB ^pNW21HHr

Cast relocates to Navbar ^jSfO8hRi

%%
## Drawing
```compressed-json
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
```
%%