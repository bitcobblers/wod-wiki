# L2 & L3 Space Architecture — Navigation Helper vs. Context Action Panel

Canonical mental model and implementation contract for the app shell's two side columns across **Note pages**, **Library / Stream pages**, and **Dashboard pages**.

---

## 1. Core Mental Model

| Space | Role | Direction | Allowed Content |
|---|---|---|---|
| **L2** (`NavSidebar` / `contextNav`) | **Navigation Helper** | **Outbound** — jumps to related views & entities derived from the current content | `Up` parent link, `Views` / saved shortcuts / date calendar, `Related` content graph (efforts, equipment, notebooks, backlinks, sibling dashboards, example queries). Zero in-page query filters or mutations. |
| **L3** (`SecondaryNav`) | **Context Action Panel** | **Inbound** — modifies, navigates within, or acts on the current page | Strict 3-slot hierarchy rendered by a single `<SecondaryNav />` component across every breakpoint: **1. Modifiers**, **2. Goto ("On this page")**, **3. Context Actions ("Actions")**. |

---

## 2. L3 Three-Slot Anatomy (`SecondaryNav.tsx`)

All L3 writers publish into typed `NavContext` channels (`apps/playground/app/nav/NavContext.tsx`) rather than multiplexing widgets or action buttons into `l3Items`:

1. **Slot 1 — Modifiers (`streamControls` / `analyticsControls`)**
   - `StreamControlsNav` (`streamControls`): `QuerySettingsTrigger`, `WqlWindowPicker`, `Group by` toggles, `Layout` switcher, `Fields` checklist, and `FacetProperties` (`where`-clause tri-state filters).
   - `AnalyticsControlsNav` (`analyticsControls`): `QuerySettingsTrigger` (when configurable), `Date range` (`EXPLORER_RANGE_OPTIONS` on Metric Explorer or `RangeSelector` on Dashboard boards), and `Units` (`kg` / `lb`, locked when pinned by `in <unit>`). Also published automatically (`{ showRange: false, showUnits: true }`) by `useNotePageNav` when a note contains embedded ```` ```query ```` blocks.
2. **Slot 2 — Goto (`secondarySpec` + `l3Items` → `"On this page"`)**
   - Pure structural scroll anchors (`h2`/`h3` headings, ```` ```time ```` / ```` ```log ```` workout blocks with secondary Run/Edit icon affordance, stream group anchors, dashboard widget cards) + scroll-spy active tracking (`usePageScrollSync` / `?h=` / `?s=`).
3. **Slot 3 — Context Actions (`l3Actions` + `pageAction` → `"Actions"`)**
   - Context shortcuts acting on the current entity or query (`Add timer`, `Add widget`, `Save to dashboard`, `Add to dashboard`, `Clone to vault`, `Note placements`, `Upgrade to Page`, `Show Resolved`, `Edit` / `Done`, `Copy link`, `Download Markdown`). Clicking an action row dismisses any open L3 drawer before running.

---

## 3. Unified Responsive Rendering (`SidebarLayout.tsx`)

One `<SecondaryNav />` component powers every viewport width — there is no separate Radix `ActionsMenu` dropdown or mobile thumb-dock `MobileStreamControlsNav` mirror:

| Breakpoint | Surface | Trigger |
|---|---|---|
| `2xl+` (`>= 1520px`) | Inline 240px right `<aside>` rail | Always visible when any L3 slot has content |
| `lg–2xl` (`1024px–1519px`) | `RightL3Drawer` (`w-80` right slide-over sheet) | `L3DrawerTrigger` (`aria-label="Page options"`, `title="Page options (⌘.)"`) mounted automatically inside `StickyPageHeader` (and non-`StickyPageHeader` detail headers) + `⌘.` / `Ctrl+.` shortcut |
| `< lg` (`< 1024px`) | `RightL3Drawer` (`w-full` right slide-over sheet + `Apply` footer) | Mobile navbar sliders button (`aria-label="Open page options"`) + `⌘.` / `Ctrl+.` shortcut |

Both header triggers render an amber active-filter dot (`header-filters-active` / `drawer-filters-active`) whenever `streamControls.query` carries active `find` filters.

---

## 4. Per-Page Family Inventory

| Page Family | L2 (Outbound Navigation Helper) | L3 Slot 1 (Modifiers) | L3 Slot 2 (`On this page`) | L3 Slot 3 (`Actions`) |
|---|---|---|---|---|
| **Note / Detail** (`/note/:id`, `/day/:date`, `/playground/:id`, `/effort/:slug`, `/equipment/:slug`, `/notebook/:slug/:date`, `/t/:type/:tag`, `/feed/:slug`, `/page/:slug`) | `NoteContextNav`: `Up` parent, `CalendarCard` (dated views), `Related` WQL/graph sections | `Units (kg/lb)` when note has ```` ```query ```` fences | Document headings, ```` ```time ```` (with Run), ```` ```log ````, or note/tag section anchors | `Add timer`, `Note placements`, `Upgrade to Page`, `Clone`, `Show Resolved`, `Copy link`, `Download Markdown` |
| **Library / Stream** (`/journal`, `/workouts`, `/notebooks`, `/feeds`, `/efforts`, `/equipment`, `/tags`, `/pages`, `/sessions`) | `ConditionsNavPanel`: scope sub-routes, pinned/saved WQL shortcuts, recent items | `StreamControlsNav` + `FacetProperties` | Dynamic stream group headers (`groupEntriesByDimension`) | `Add to dashboard` (when `dashboardEnabled`) |
| **Dashboard Board** (`/dashboard/:slug`) | `DashboardsNavPanel`: `Explorer` + merged vault/prebuilt `Dashboards` + `New dashboard` | `AnalyticsControlsNav` (`RangeSelector` + `Units`) | Sticky title + standalone markdown headings + widget cards (`widget-<key>`) | `Edit` / `Done`, `Add widget` (vault), `Clone to vault` (prebuilt), `Copy link` |
| **Metric Explorer** (`/dashboards`) | `DashboardsNavPanel`: `Explorer` + `Examples` catalog + saved `Dashboards` + `New dashboard` | `AnalyticsControlsNav` (`Past 4/8/16 weeks` + `Units` + `Query settings`) | Date-group anchors when running a `find` query | `Save to dashboard` |

---

## 5. Key Files to Touch When Extending L2 / L3

- `apps/playground/app/nav/NavContext.tsx` — `l3Items`, `l3Actions`, `streamControls`, `analyticsControls`, `rightDrawerOpen`
- `apps/playground/app/nav/SecondaryNav.tsx` — `StreamControlsNav`, `AnalyticsControlsNav`, and 3-slot `SecondaryNav`
- `apps/playground/src/templates/SidebarLayout.tsx` & `apps/playground/src/panels/page-shells/L3DrawerTrigger.tsx` — `2xl+` rail, `RightL3Drawer`, `L3DrawerTrigger`, `⌘.` shortcut
- `apps/playground/src/panels/page-shells/StickyPageHeader.tsx` — mounts `L3DrawerTrigger` automatically on `lg–2xl`
- `apps/playground/app/pages/shared/useNotePageNav.ts` — note outline (`setL3Items`), helpful actions (`setL3Actions`), and embedded-query unit controls (`setAnalyticsControls`)
- `apps/playground/app/nav/panels/DashboardsNavPanel.tsx`, `apps/playground/app/views/dashboards/DashboardViewPage.tsx`, `apps/playground/app/views/analytics/AnalyticsExplorerPage.tsx` — dashboard L2/L3 wiring
