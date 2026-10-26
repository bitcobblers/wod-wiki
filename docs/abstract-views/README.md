# Abstract Views Architecture & Design Guidelines

This directory houses the architectural blueprints and responsive visual wireframes for the core **Abstract Views** of WOD Wiki. Each abstract view represents a polymorphic layout shell that powers multiple concrete **Typed Views** across the application.

Every view document is an **Obsidian Excalidraw** document (`.excalidraw.md`), combining dual-breakpoint visual diagrams (Desktop ≥1024px vs Mobile <1024px) with comprehensive architectural explanations, data pipeline specs, and design guidelines.

---

## 1. Abstract View Directory & Crosswalk

| Abstract View | Document & Diagram | Core Host Component / Shell | Architectural Responsibility | Concrete Typed Views Powered |
|---|---|---|---|---|
| **Queriable Stream View** | [1-queriable-stream-view.excalidraw.md](./1-queriable-stream-view.excalidraw.md) | `QueriableStreamView.tsx` | Polymorphic listing, catalog, and query feed engine driven by `StreamProfile`. | • Journal Stream (`/journal`)<br>• Library Catalog (`/library`)<br>• Collections Catalog (`/collections`)<br>• Efforts Registry (`/efforts`)<br>• Feeds Stream (`/feeds`)<br>• Execution History (`/results`) |
| **Note Editor & Document View** | [2-note-editor-view.excalidraw.md](./2-note-editor-view.excalidraw.md) | `NoteEditor.tsx`, `JournalPageShell.tsx` | Markdown document authoring, CodeMirror 6 language extensions, and executable block runtime. | • Universal Note (`/note/:noteId`)<br>• Journal Date Stack (`/day/:date`)<br>• Playground Scratchpad (`/playground/:id`)<br>• Named Workout (`/notebook/:c/:w`)<br>• Effort Detail (`/effort/:slug`) |
| **Split-Pane Guide & Canvas** | [3-split-pane-canvas-view.excalidraw.md](./3-split-pane-canvas-view.excalidraw.md) | `MarkdownCanvasPage.tsx`, `CanvasPage.tsx` | Asymmetric dual-panel guide pairing scrolling tutorial prose with an interactive code execution sandbox. | • Interactive Syntax Guides (`/page/guide-start`)<br>• Analytics Tutorials (`/page/guide-wql`)<br>• Collection Landing (`/notebook/:slug`)<br>• Scroll Quest Runway (`/page/:slug`) |
| **Dashboard & Analytics View** | [4-dashboard-analytics-view.excalidraw.md](./4-dashboard-analytics-view.excalidraw.md) | `DashboardView.tsx`, `AnalyticsExplorerPage.tsx` | Parallel analytical query execution, multi-card responsive metric grid, and WQL pipeline introspection. | • Dashboard View Page (`/dashboard/:slug`)<br>• Analytics Explorer (`/dashboards`)<br>• Home Analytics Showcase (`/`) |
| **Wall Clock & Runtime HUD** | [5-wall-clock-runtime-view.excalidraw.md](./5-wall-clock-runtime-view.excalidraw.md) | `WallClockPage.tsx` | Immersive, high-contrast, zero-distraction runtime execution display and real-time interval tracker. | • Standalone Wall Clock (`/run/:runtimeId`)<br>• Inline Block Runner (Embedded)<br>• Fullscreen Date Timer (`/day/:date?autoStart=`)<br>• Chromecast Receiver (`/receiver`) |

---

## 2. Core Responsive Design Guidelines

All abstract views adhere to uniform responsive interaction and command relocation rules codified in `docs/14-command-locations-by-view.md` and `apps/playground/app/nav/ResponsiveActions.tsx`:

### Breakpoints & Dimensions
- **Desktop**: Viewport width $\ge 1024\text{px}$ (Tailwind `lg`).
- **Mobile**: Viewport width $< 1024\text{px}$ (`MOBILE_BREAKPOINT_PX = 1023`).
- **L1 Rail**: Fixed $56\text{px}$ width on desktop; collapses to hamburger drawer on mobile.
- **L2 Sidebar**: $240\text{px}$ width on desktop; lives inside mobile navigation drawer.

### Command Relocation Rules (`ResponsiveActions`)
Pages declare commands once; placement shifts based on viewport:
1. **Sticky Page Header (`StickyPageHeader`)**:
   - **Desktop**: Pinned top bar displaying document/view title, query bar, and action buttons.
   - **Mobile**: Suppressed entirely (`max-lg:hidden`). Page identity is shown via navbar breadcrumb (`L1 › Title`).
2. **Primary Action**:
   - **Desktop**: First control in the header action group.
   - **Mobile**: Relocates to the floating **Thumb Dock Primary FAB** in the bottom thumb corner.
3. **Secondary Actions**:
   - **Desktop**: Inline buttons following the primary action.
   - **Mobile**: Fold into the **Thumb Dock ⋮ Overflow Sheet** (bottom slide-up sheet with $\ge 44\text{px}$ touch rows).
4. **Cast Mirroring**:
   - **Desktop**: Header action button.
   - **Mobile**: Pinned in the top-right of the **App Navbar**.
5. **WQL Stream Query Bar**:
   - **Desktop**: Header `queryBar` slot (full token pills + inline composer).
   - **Mobile**: **Thumb Footer** (`MobileQueryFooter`) — a full-width bottom button row; tapping opens the modal WQL palette dialog.
6. **Search**:
   - **Desktop**: L1 rail icon button or header input (`Ctrl/Cmd+/`).
   - **Mobile**: Dedicated **Search FAB** at the base of the thumb dock stack.
7. **Content Clearance**:
   - Mobile views mandate `max-lg:pb-48` to ensure content can be scrolled clear of the floating dock and thumb footer.

---

## 3. Obsidian Excalidraw Tooling & Format

All `.excalidraw.md` files in this directory are fully compatible with the Obsidian Excalidraw plugin:
- Frontmatter specifies `excalidraw-plugin: parsed`, `excalidraw-default-mode: view`, and `excalidraw-export-dark: true`.
- Human-readable Markdown sections explain architectural decisions, constraints, and typed view matrices.
- Embedded JSON drawing blocks contain vector wireframes, colored UI primitives, and dashed relocation arrows illustrating desktop-to-mobile transitions.
