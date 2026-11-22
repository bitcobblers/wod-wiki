# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Co-primary audiences:

- **Self-directed athletes:** Athletes training at home, in a garage gym, or at a box/pool who author or pick workouts in Markdown, run them on a phone or TV clock, and review their own training history and analytics.
- **Coaches and gym owners:** Practitioners programming workouts for members, curating and publishing shared `Notebook`s via `Feed`s, and running gym-wall TV timers and member programming workflows.

## Product Purpose

WOD Wiki turns plain-text Markdown workouts into an executable training system in one continuous **Plan → Track → Analyze** loop:

- **Plan:** Author `Note`s with Whiteboard Language (`wod` / `time` blocks), frontmatter `Metric`s/`Summary Metric`s, and `Property Note`s (`Tag`s, `Effort`s, `Equipment`), or subscribe to distributed `Feed`s.
- **Track:** Execute JIT-compiled workout blocks on a live step-through clock across phone, desktop, and Chromecast TV while capturing reps, loads, splits, and RPE.
- **Analyze:** Persist immutable execution streams (`Session`s and `EventRecord`s) and query them across `Journal` pages, `Session` reviews, and WQL `Dashboard Widget`s.

Success means athletes and coaches can write workouts once in durable plain text, execute them cleanly mid-workout, keep full ownership of their data, and query what actually happened over time.

## Positioning

Everything in WOD Wiki is a layered, immutable `Metric`:

- Plain-text Markdown (`wod` / `time` blocks) JIT-compiles directly into a unified live `SessionClockProjection` without leaving plain text as the source of truth.
- Each lifecycle stage appends typed `Metric`s (`parser → dialect → compiler → runtime → user → analyzed`) without overwriting earlier layers, so planned targets, tracked actuals, and analyzed projections coexist in one view.
- Training libraries distribute as versioned, content-addressed static Markdown `Feed`s (`Seed` bundles) that browsers subscribe to and sync locally.
- The entire domain is local-first and offline-capable in the browser with zero account required, while exposing identical structured capabilities to humans and AI agents across Browser WebMCP, MCP (`wod mcp` / `/api/mcp`), and the `wod` CLI.

## Operating Context

- **Authoring and analysis surfaces:** Desktop, laptop, tablet, and phone web browser at `wod.wiki` (or self-hosted `wod playground` / `wod server`), including CodeMirror 6 editing, WQL query editing, `Journal` daily pages, `Notebook` streams, and `Dashboard Widget`s.
- **Active workout surfaces:** Phone and tablet on the gym floor (portrait and landscape, touch swipe/tap and keyboard controls) and gym-wall TVs via Chromecast Android TV receiver (`apps/playground/receiver-rpc.html`), with compact phones acting as pocket remotes and TV controls fading after D-pad idle.
- **Storage and hosting tiers:**
  - **Browser-local (default):** IndexedDB in the user's browser; offline-capable with zero account or server.
  - **Browser + user-owned Turso backup/sync (optional):** IndexedDB remains the data plane with background backup/sync to a user-provided Turso database.
  - **Self-hosted API server (optional):** `wod server` / `apps/api` / Docker serving the app and SQL backend (SQLite, Turso, or PostgreSQL) as a trusted single-user deployment without built-in authentication.

## Capabilities and Constraints

- **Local-first & offline-capable by default:** Core authoring, timing, tracking, and querying must work offline in the browser with zero account or server requirement; data ownership remains with the user.
- **Canonical domain vocabulary (`GLOSSARY.md`):** Use canonical terms consistently across UI, docs, and APIs — `Note` (not Document/entry/article), `Property Note`, `Tag Category`, `Tag`, `Effort` (not Exercise row/movement record), `Equipment`, `Dashboard Widget` (not Card/panel/chart embed), `Entity Scope`, `Notebook` (not Collection/catalog/folder), `Note Provenance`, `Scoped Property Override`, `Feed`, `Seed`, `Session` (not Workout result/run row), `Publication Visibility`, `Metric`, `Summary Metric`, `Metric Shake-Out Queue`, `Skipped-Dependency Diagnostic`, `Session Clock Projection`, and `Live Session Telemetry`.
- **Mid-workout & distance ergonomics:** Touch, keyboard, and sweaty-hand controls; glanceable phone timers and across-the-room TV legibility across the three container-driven timer tiers (`Minimal`, `General`, `Detail` + Cast) backed by one unified `SessionClockProjection` (ADR 0003).
- **First-class agent parity:** Domain capabilities stay aligned across Browser WebMCP (`navigator.modelContext`), MCP (`wod mcp` and self-hosted `/api/mcp`), and the `wod` CLI (`--json`), with destructive confirmation gates and deterministic browser readiness signals.
- **Chromecast Android TV receiver compatibility:** `apps/playground/receiver-rpc.html` and `apps/playground/app/receiver-rpc.tsx` must remain compatible with Chromium 92 (`apps/playground/vite.receiver.config.ts`) and stateless `RpcSessionFrame` projection.
- **Self-hosted server trust boundary:** The bundled API server is a trusted single-user deployment without authentication (binds to loopback by default); operators must add access control before public exposure.
- **Explicitly unshipped / undecided product facts:**
  - **Managed hosting ("Wod-Wiki hosted"):** Individual managed database/public profile/cross-device sync and team/gym coach portals, leaderboards, and gym branding are interest-validation only (via survey) and are **not shipped**.
  - **Pricing & commercial licensing:** Undecided; do not invent pricing tiers, plans, or SLAs.
  - **Formal WCAG conformance tier:** Undecided (no specific WCAG level has been mandated beyond the confirmed ergonomic needs below).

## Brand Commitments

- **Canonical name:** `WOD Wiki` (domain: `wod.wiki`). Note: `apps/playground/index.html` currently renders `Wod.Wiki` in `<title>` and OG metadata; future metadata updates should align on `WOD Wiki` while keeping `wod.wiki` as the domain.
- **Voice:** Direct, honest, practitioner-first — concrete about mechanics, transparent about storage trade-offs and unshipped features, avoiding hype or fabricated claims.
- **Binding taglines:**
  - `Write it. Time it. Track it. Own it.`
  - `Write workouts as Markdown. Run them on a clock. Analyze what actually happened.`
- **Existing brand assets:** Light and dark logos at `apps/playground/public/images/wod-wiki-logo-light.png` and `apps/playground/public/images/wod-wiki-logo-dark.png`.

## Evidence on Hand

- **Live product & interactive demo:** Hosted web app (`https://wod.wiki/`), interactive home demo (`wods/examples/home/welcome-1.md`), seeded workout `Notebook`s and `Effort` catalog (`markdown/`), and two demo community `Feed`s.
- **Visual & brand assets:** Light/dark logos (`apps/playground/public/images/wod-wiki-logo-light.png`, `apps/playground/public/images/wod-wiki-logo-dark.png`) and product screenshots (`apps/playground/public/images/hero/{editing,journal,results,timer}.png`).
- **Public links & discovery docs:** Open-source repository (`https://github.com/bitcobblers/wod-wiki`), hosted-feature interest survey (`https://forms.gle/6YHpxwAJh6PAsyAQ6`), and agent discovery manifests (`apps/playground/public/llms.txt`, `apps/playground/public/llms-full.txt`, `apps/playground/public/.well-known/agent-capabilities.json`).
- **Absences — must not be fabricated:**
  - No final "Why Wod Wiki?" explainer video yet (`apps/playground/app/tour/TourWhyVideo.tsx` currently uses a `dQw4w9WgXcQ` placeholder).
  - No customer testimonials, gym case studies, user counts, press quotes, third-party benchmarks, or published pricing tiers.
  - No shipped managed-cloud hosting service.

## Product Principles

1. **Plain text is the durable source of truth.** Workouts, notes, and community feeds stay human-readable Markdown that remains portable outside any single host.
2. **Layer truth rather than overwriting it.** Planned targets, live clock events, user edits, and derived analytics stack as immutable `Metric` origins so nothing performed is lost.
3. **Earn trust on the gym floor and at the desk.** Authoring and WQL depth must coexist with zero-friction, glanceable, sweaty-hand-proof execution on phones and gym-wall TVs.
4. **Own your data from the first second.** Full product value begins offline in the browser with no account; backup, sync, self-hosting, and feeds are opt-in layers.
5. **One capability contract for humans and agents.** Canonical glossary concepts and domain operations stay consistent across the UI, WebMCP, MCP, and `wod` CLI.

## Accessibility & Inclusion

- **Confirmed ergonomic needs:** Reliable mid-workout touch, keyboard, and sweaty-hand controls; glanceable phone timers and across-the-room TV legibility (including Chromecast D-pad navigation).
- **Existing codebase behavior:** Reduced-motion layout support (`prefers-reduced-motion`) is implemented in the home tour (`apps/playground/app/tour/HomeTour.tsx`).
- **Open decision:** Formal WCAG conformance target level is undecided.
