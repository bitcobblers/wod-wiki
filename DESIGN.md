---
name: WOD Wiki
description: "Geological survey clarity meets gym-floor precision: Mineral light and Arctic Frost dark palettes for plain-text workouts, live clocks, and WQL analytics."
colors:
  mineral-background: "hsl(40 20% 96%)"
  mineral-foreground: "hsl(30 16% 15%)"
  mineral-card: "hsl(40 38% 98%)"
  mineral-popover: "hsl(38 32% 95%)"
  mineral-primary: "hsl(212 32% 42%)"
  mineral-primary-foreground: "hsl(40 38% 98%)"
  mineral-secondary: "hsl(212 22% 88%)"
  mineral-secondary-foreground: "hsl(212 32% 32%)"
  mineral-muted: "hsl(38 18% 90%)"
  mineral-muted-foreground: "hsl(30 13% 37%)"
  mineral-accent: "hsl(46 42% 85%)"
  mineral-accent-foreground: "hsl(46 52% 28%)"
  mineral-border: "hsl(36 14% 76%)"
  mineral-field-border: "hsl(30 12% 50%)"
  mineral-field-placeholder: "hsl(30 12% 42%)"
  mineral-destructive: "hsl(0 34% 48%)"
  mineral-success: "hsl(140 34% 34%)"
  mineral-warning: "hsl(46 52% 37%)"
  frost-background: "hsl(222 16% 21%)"
  frost-foreground: "hsl(218 22% 76%)"
  frost-card: "hsl(222 17% 28%)"
  frost-primary: "hsl(210 35% 64%)"
  frost-primary-foreground: "hsl(222 16% 18%)"
  frost-muted: "hsl(222 18% 18%)"
  frost-muted-foreground: "hsl(219 14% 72%)"
  frost-border: "hsl(218 17% 30%)"
  metric-time: "hsl(212 36% 42%)"
  metric-rep: "hsl(30 48% 38%)"
  metric-effort: "hsl(140 32% 36%)"
  metric-rounds: "hsl(270 28% 45%)"
  metric-distance: "hsl(180 40% 34%)"
  metric-resistance: "hsl(0 36% 43%)"
  metric-action: "hsl(46 54% 33%)"
  metric-rest: "hsl(172 34% 34%)"
  metric-equipment: "hsl(215 20% 38%)"
  signal-positive: "hsl(160 74% 40%)"
  signal-caution: "hsl(38 92% 50%)"
  signal-negative: "hsl(350 78% 52%)"
  brand-slate: "#5980a8"
  brand-frost: "#d6e4f0"
  brand-deep: "#3d5c7a"
typography:
  display:
    fontFamily: "\"Geist Sans\", \"SF Pro Display\", Switzer, \"Helvetica Neue\", system-ui, -apple-system, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "\"Geist Sans\", \"SF Pro Display\", Switzer, \"Helvetica Neue\", system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  title:
    fontFamily: "\"Geist Sans\", \"SF Pro Display\", Switzer, \"Helvetica Neue\", system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  body:
    fontFamily: "\"Geist Sans\", \"SF Pro Display\", Switzer, \"Helvetica Neue\", system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "\"Geist Sans\", \"SF Pro Display\", Switzer, \"Helvetica Neue\", system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.065em"
  mono:
    fontFamily: "\"JetBrains Mono\", ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.06em"
    fontFeature: "\"tnum\" 1"
  editorial:
    fontFamily: "Newsreader, \"Instrument Serif\", Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "4px"
  ui: "0.5rem"
  md: "calc(1rem - 2px)"
  lg: "1rem"
  xl: "1.25rem"
  2xl: "1.5rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.mineral-primary}"
    textColor: "{colors.mineral-primary-foreground}"
    rounded: "{rounded.ui}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-outline:
    backgroundColor: "{colors.mineral-card}"
    textColor: "{colors.mineral-foreground}"
    rounded: "{rounded.ui}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-secondary:
    backgroundColor: "{colors.mineral-secondary}"
    textColor: "{colors.mineral-secondary-foreground}"
    rounded: "{rounded.ui}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-destructive:
    backgroundColor: "{colors.mineral-destructive}"
    textColor: "#ffffff"
    rounded: "{rounded.ui}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  card-surface:
    backgroundColor: "{colors.mineral-card}"
    textColor: "{colors.mineral-foreground}"
    rounded: "{rounded.lg}"
    padding: "1.5rem"
  input-field:
    backgroundColor: "{colors.mineral-card}"
    textColor: "{colors.mineral-foreground}"
    rounded: "{rounded.ui}"
    height: "2.5rem"
    padding: "0.5rem 0.75rem"
  badge-default:
    backgroundColor: "{colors.mineral-primary}"
    textColor: "{colors.mineral-primary-foreground}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.625rem"
---

# Design System: WOD Wiki

## Overview

**Creative North Star: "The Geological Field Notebook"**

WOD Wiki is an operational training workspace that bridges two demanding environments: calm, focused plain-text authoring and WQL analysis at a desk, and high-legibility, sweaty-hand-proof live workout execution on a phone or gym-wall TV. The visual system draws from geological survey palettes and technical field notebooks—warm, paper-like cream surfaces in light mode (**Mineral**) and low-glare polar night surfaces in dark mode (**Arctic Frost**)—so color is reserved for meaning rather than decoration.

Every parsed workout fragment (`Time`, `Rep`, `Effort`, `Rounds`, `Distance`, `Resistance`, `Action`, `Rest`, `Equipment`) maps deterministically to one of nine calibrated semantic metric hues. Surfaces stay quiet and flat by default; interaction state, live clock polarity, and metric origin carry the visual signal. All design tokens live in a single canonical stylesheet (`packages/ui/src/styles.css`) consumed identically by Playground, Storybook, and the `@bitcobblers/wod-wiki-ui` package.

**Key Characteristics:**
- Dual calibrated palettes: warm geological **Mineral** (light) and Nord-inspired **Arctic Frost** (dark), flipped exclusively via `<html class="dark">`
- Nine WCAG AA-calibrated Whiteboard Language metric tokens shared across CodeMirror syntax, inline previews, live timers, and WQL analytics
- Tactile, touch-safe `@ui-sdk/react` primitives (`40px` default, `44px` icon/mobile targets) with browser top-layer overlays
- Tabular monospace numerals (`tabular-nums`) for all timers, splits, loads, and telemetry tables
- Three container-driven timer tiers (Minimal phone, General 16:9 TV, Detail desktop workbench) backed by one `SessionClockProjection`

## Colors

Restrained earth-tone neutrals establish calm paper-and-slate surfaces so the primary interactive slate blue, semantic metric hues, and vivid chart signal accents read immediately without visual fatigue.

### Primary
- **Mineral Slate** (`--primary`, light) / **Nord Frost Blue** (`--primary`, dark): Primary interactive actions, active navigation states, focus rings, and duration/time accents.
- **Brand Slate / Frost / Deep** (`--color-brand`, `--color-brand-light`, `--color-brand-deep`): Reserved for the Executable Fence mark, wordmark, and brand identity lockups.

### Secondary
- **Soft Slate Tint** (`--secondary` / `--secondary-foreground`): Secondary buttons, inactive filter pills, and subtle badge containers.
- **Ochre Highlight** (`--accent` / `--accent-foreground`): Hover highlights, action indicators, and warm callout states.

### Tertiary
- **Whiteboard Metric Palette (9 tokens)**: Deterministic semantic hues for parsed `IMetric` fragments (`--metric-time`, `--metric-rep`, `--metric-effort`, `--metric-rounds`, `--metric-distance`, `--metric-resistance`, `--metric-action`, `--metric-rest`, `--metric-equipment`). Each clears WCAG AA (≥4.5:1) against both `--card` and `--background`.
- **Signal & Data-Viz Accents**: Vivid status hues (`--signal-positive`, `--signal-caution`, `--signal-negative`), RPE intensity ramp (`--color-rpe-easy` through `--color-rpe-max`), and palette-independent statement-type accents (`--color-type-segment` through `--color-type-analytics`).

### Neutral
- **App Canvas** (`--background`): Warm cream in Mineral light mode; Polar Night 1 in Arctic Frost dark mode.
- **Focus Surface** (`--card`, `--popover`): Slightly lifted warm white in light mode; Polar Night 3 in dark mode.
- **Muted Wells & Secondary Text** (`--muted`, `--muted-foreground`): Recessed wells, sidebar surfaces, and de-emphasized captions.
- **Structural Chrome & Accessible Field Boundaries** (`--border`, `--input`, `--field-border`, `--field-placeholder`): Structural hairlines use `--border`; interactive input/outline boundaries use `--field-border` (≥3:1 contrast); placeholders use `--field-placeholder` (≥4.5:1 contrast).

### Named Rules
**The Root-Host Dark Mode Rule.** The `.dark` class lives strictly on `<html>` (`document.documentElement`), never on an inner wrapper `<div>`. Because `@theme inline` emits `hsl(var(--token))` per element, root toggling guarantees portals, top-layer dialogs, and Storybook canvases flip atomically.

**The Semantic Token Only Rule.** Never hardcode hex values or raw Tailwind grays (`bg-slate-900`, `text-zinc-400`, `rgba(128,128,128,...)`) in components or stylesheets. Every surface, text, border, and metric badge resolves through semantic CSS custom properties.

## Typography

**Display & UI Font:** Geist Sans (with SF Pro Display, Switzer, Helvetica Neue, system-ui fallback)
**Body Font:** Geist Sans (with system-ui fallback)
**Editorial Font:** Newsreader (with Instrument Serif, Georgia fallback)
**Label / Code / Timer Font:** JetBrains Mono (with ui-monospace, SFMono-Regular fallback)

**Character:** Crisp neo-grotesque clarity for operational UI controls paired with high-legibility tabular monospace for Whiteboard Language scripts, WQL queries, and live gym clocks. Editorial serif appears selectively in long-form guides and marketing canvases.

### Hierarchy
- **Display** (700, 2.25rem / 36px, 1.1 line-height, -0.04em tracking): Page hero titles and brand headers.
- **Headline** (700, 1.25rem / 20px, 1.25 line-height, -0.03em tracking): Section and view headers.
- **Title** (600, 1rem / 16px, 1.35 line-height, -0.015em tracking): Card titles, dialog headers, and notebook headings.
- **Body** (400, 0.875rem / 14px, 1.5 line-height, 65–75ch prose measure): Primary UI copy, note previews, and descriptions.
- **Label** (600, 0.75rem / 12px, 1.25 line-height, +0.065em tracking): Compact uppercase section headers, badges, and metadata chips. Minimum readable size is 12px (`0.75rem`).
- **Mono / Timer** (500–900, 0.875rem–4rem, `font-variant-numeric: tabular-nums`): Whiteboard Language code blocks, WQL expressions, telemetry tables, and live countdown/elapsed clocks.

### Named Rules
**The Tabular Numerals Rule.** Every live clock, split time, rep count, load value, and numeric table column must apply `tabular-nums` so digits never jitter horizontally during workout execution.

**The 16px Mobile Input Floor.** On viewports below `1024px`, CodeMirror editors and text inputs render at a minimum `16px` font size to prevent iOS Safari auto-zoom mid-workout.

## Layout

WOD Wiki uses a **4-Zone Operational Shell** across desktop and mobile:
1. **Zone 1 — Primary Icon Rail (`AppRail`)**: Fixed `56px` left rail on desktop for L1 destinations.
2. **Zone 2 — Context Sidebar (`NavSidebar` / `ConditionsNavPanel`)**: Route-scoped L2 panel with calendar pinned first, saved WQL shortcuts, and notebook trees.
3. **Zone 3 — Main Content & Sticky Header (`StickyPageHeader` / `ResponsiveActions`)**: Primary working canvas with compact `34px` desktop toolbar controls that collapse into a mobile thumb-zone FAB and overflow sheet below `1024px`.
4. **Zone 4 — Secondary Rail (`SecondaryNav` / `StreamControlsNav`)**: Right-hand L3 rail on wide screens (`2xl+`, `95rem` / `1520px`) for layout switching, filters, and in-page outlines.

Responsive breakpoints follow `sm` (640px), `md` (768px), `lg` (1024px — mobile/desktop shell switch), `xl` (80rem / 1280px), `2xl` (95rem / 1520px), and `3xl` (112.5rem / 1800px). Active workout timers use container queries and `PanelSizeContext` across three tiers: Minimal (`375×812` portrait phone), General (`1920×1080` 16:9 Chromecast TV), and Detail (desktop workbench).

## Elevation & Depth

Surfaces are flat and tonally layered by default. Depth is communicated through surface step (`--background` → `--card` → `--popover`) and `1px` `--border` hairlines rather than heavy drop shadows. Shadows appear only for floating overlays (dialogs, popovers, toasts) and the 10-foot TV spatial-navigation focus halo (`.tv-focusable[data-nav-focused="true"]`).

### Shadow Vocabulary
- **Subtle Card Hairline** (`shadow-2xs` / `0 1px 2px rgba(0, 0, 0, 0.04)`): Optional micro-separation on interactive token swatches or floating badges.
- **TV 10-Foot Focus Halo** (`0 0 0 3px hsl(var(--card) / 0.9), 0 0 0 6px hsl(var(--primary) / 0.7), 0 0 20px 4px hsl(var(--primary) / 0.35)`): High-contrast D-pad spatial focus indicator on Chromecast receivers.

### Named Rules
**The Flat-By-Default Rule.** Rest-state containers use tonal contrast and `1px` borders—never combine heavy drop shadows with borders on standard cards.

## Shapes

Form geometry balances tactile warmth with operational precision:
- **Interactive Controls & Inputs**: `0.5rem` (`8px`, `--ui-radius`) for buttons, inputs, selects, and compact toolbar controls.
- **Cards & Dialog Surfaces**: `1rem` (`16px`, `--radius-lg`) for primary panels, cards, and modals; `1.25rem`–`1.5rem` for hero containers.
- **Badges, Status Chips & Metric Pills**: Full pill (`9999px`, `--radius-pill`) for badges and status tags; `4px`–`6px` (`--radius-sm`) for inline monospace metric tokens.

## Components

Every interactive primitive is built on `@ui-sdk/react` and exported from `@bitcobblers/wod-wiki-ui/primitives`, inheriting `--ui-*` tokens from `packages/ui/src/styles.css`.

### Buttons
- **Character:** Crisp, touch-safe, and immediately distinguishable by hierarchy.
- **Shape:** Gently rounded (`8px` / `--ui-radius`).
- **Variants:** `default`/`solid` (`--primary`), `secondary` (`--secondary`), `outline` (`--card` + `--field-border`), `ghost` (transparent → `--muted` on hover), `destructive` (`--destructive`), and `link` (`--primary` underline on hover).
- **Sizes:** `sm` (`36px`), `default` (`40px`), `lg` (`44px`), `icon` (`44×44px` minimum touch target).
- **Focus & Disabled:** `2px` `--ring` outline with `2px` offset on `:focus-visible`; `50%` opacity and `pointer-events: none` when disabled.

### Badges & Metric Pills
- **Character:** High-contrast semantic micro-labels.
- **Style:** Pill radius (`9999px`) for `Badge` (`default`, `secondary`, `destructive`, `outline`); compact `6px` rounded monospace pills with `15%` tinted fill + `40%` border for the 9 Whiteboard Metric types.

### Cards / Containers
- **Character:** Quiet, flat focus planes lifted tonally from the warm canvas.
- **Corner Style:** `16px` (`--radius-lg`).
- **Background:** `--card` on `--background`, separated by a `1px` `--border` hairline.
- **Internal Padding:** `16px`–`24px` (`p-4` to `p-6`).

### Inputs / Fields
- **Character:** Accessible, high-contrast form fields that remain legible in gym lighting.
- **Style:** `--card` background, `1px` `--field-border` (≥3:1 contrast), `--field-placeholder` (≥4.5:1 contrast), `8px` radius.
- **Focus:** `2px` `--ring` focus outline.
- **Error / Disabled:** `--ui-destructive` (lifted in dark mode to `hsl(354 68% 76%)` for ≥4.5:1 readability on `--card`).

### Overlays (Dialogs, AlertDialogs, Drawers, Popovers, Menus, Toasts)
- **Character:** Browser top-layer primitives that escape `overflow: hidden` containers without fragile z-index stacks.
- **Coordination:** Global `WodOverlayHost` mounts toast regions; on mobile (`<1024px`), bottom toasts automatically yield to the top safe area when the mobile editor deck is active.

### Navigation
- **Character:** Persistent 4-zone operational chrome sharing a single `MenuSpec` contract.
- **States:** Inactive items use `--muted-foreground`; hover and active states shift to `--primary` over a `12%` `--primary` tonal pill.

## Do's and Don'ts

### Do:
- **Do** toggle dark mode strictly on `<html>` (`document.documentElement.classList.toggle('dark')`) so `@theme inline` tokens and top-layer overlays stay synchronized.
- **Do** use `@bitcobblers/wod-wiki-ui/primitives` for all buttons, fields, selects, switches, tabs, dialogs, drawers, popovers, menus, and toasts.
- **Do** apply `tabular-nums` to all clocks, durations, rep counts, weights, and analytics KPIs.
- **Do** keep `packages/ui` state-free and storage-agnostic (inject `QueryExecutor` and callbacks via props).
- **Do** respect `prefers-reduced-motion: reduce` (and `[data-reduced-motion="true"]` in Storybook) for all non-essential animations.

### Don't:
- **Don't** place `.dark` on an inner wrapper `<div>`—it breaks top-layer portals and `@theme inline` inheritance.
- **Don't** hardcode raw Tailwind grays (`bg-slate-900`, `text-zinc-400`), hex colors, or `font-family: "Inter"` in components or app CSS.
- **Don't** invent ad-hoc badge colors for workout fragments—always map through the 9 `--metric-*` semantic tokens.
- **Don't** drop interactive touch targets below `44×44px` on mobile or active workout timer surfaces.
- **Don't** render modal dialogs for tasks that can be handled inline or via progressive disclosure.
