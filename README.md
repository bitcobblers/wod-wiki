# WOD Wiki

**Write workouts as Markdown. Run them on a clock. Analyze what actually happened.**

WOD Wiki is a TypeScript monorepo toolkit for parsing, executing, and analyzing workouts written in Whiteboard Language (`wod` / `time` blocks) embedded in ordinary Markdown. It includes CodeMirror 6 editor integrations, a Just-In-Time compiler, a reactive execution runtime, and a training-analytics engine.

> Documentation: [`docs/`](./docs/README.md), [`docs/domain-model/`](./docs/domain-model/), and [WQL query composition](./docs/prototypes/WQL-Domain-Query-Composition.md).

---

## Getting started

WOD Wiki has two hosting levels. Both run the same playground application; the difference is where your data lives. A container runs server mode, not a third storage mode. The globally installed `wod` CLI includes both apps: `wod init` prepares a database, then `wod server` or `wod playground` hosts either level ([self-host with the `wod` CLI](#self-host-with-the-wod-cli)).

| Hosting level | Data storage | How to run it |
|---|---|---|
| Playground | IndexedDB by default, or direct browser-to-Turso. No WOD Wiki API server required. | [Bun playground](#run-the-playground-with-bun) or `wod playground` |
| Server | SQL behind the Bun API. Browsers connecting to the same server use the same backend data. | [Bun server](#run-the-server-with-bun), [`wod server`](#self-host-with-the-wod-cli), or [container](#run-the-server-in-a-container) |

Choose Playground for browser-local use or your own Turso database. Choose Server to use SQLite, Turso, or PostgreSQL through the WOD Wiki API. Settings > Storage can migrate IndexedDB to an empty Turso database; changing hosting levels does not migrate data to the server.

### Run the playground with Bun

Install [Bun](https://bun.sh/) v1.4 or newer, then run these commands from the repository root:

```bash
bun install
bun run playground
```

Open the Vite URL printed in the terminal, normally [http://localhost:5173](http://localhost:5173). This command builds the packages, lints the playground, and starts the development server with hot reload. It is the development workflow; `wod playground` serves a production build of the same browser-local app without dev tooling ([self-host with the `wod` CLI](#self-host-with-the-wod-cli)). With no data settings, the app uses IndexedDB and imports only the core playground seed. Community catalogs and custom libraries are optional through Settings > Sync.

In **Settings > Storage**, enter your Turso `libsql://` URL and database-scoped auth token. **Test Connection** verifies access without saving credentials. **Connect** uses the remote data as-is; **Migrate & Connect** copies the browser's stores, revision history, attachment bytes, profile, notebooks, query preferences, and user calculations into an empty database. Migration commits atomically, keeps the local copy, and saves the connection only after success. Close other WOD Wiki tabs and avoid edits during migration.

The URL and token stay in this browser's localStorage. Same-origin scripts can read the token; use one scoped to this database. Saved connection failures show recovery controls, never a silent IndexedDB fallback. Switching to **This Browser** restores the last local copy without pulling remote-only changes. Self-hosted connection settings and paid wod.wiki custody are marked coming soon; the existing server deployment remains available.

**Settings > Sync** reports the current source and chunk, committed chunks, imported notes, efforts and block rows, preserved user-owned rows, and removed seed rows. Single-source sync, **Sync All Sources**, and **Add & Sync** share this progress display. Completed work and errors remain visible until the next sync. Failed chunks never advance the bar; Sync All continues with the remaining sources.

### Self-host with the `wod` CLI

Install [Bun](https://bun.sh/) v1.4 or newer, then install the CLI globally. The package includes the API and prebuilt website, so no checkout, frontend build, or development dependencies are needed. The executable requires Bun even when installed through another package manager.

```bash
bun add --global @bitcobblers/wod-wiki-engine
wod init --db ./data/wodwiki.db    # create the SQLite file + schema
wod server --db ./data/wodwiki.db  # app + API at http://127.0.0.1:3000
```

`wod init` prepares the configured database and is idempotent — re-running it preserves existing notes and metrics. It creates the SQLite file and schema; for PostgreSQL it creates the target database when your role is authorized to and otherwise initializes an existing one; for Turso it installs the schema into a database you have already provisioned.

`wod server` requires `wod init` first and refuses to create or silently initialize a database. It serves the packaged app and API from one origin. `wod serve` is an equivalent spelling. `wod playground` serves the packaged IndexedDB-backed app without opening a database. Neither command builds or downloads assets at startup. `--dist` or `PLAYGROUND_DIST` selects an existing custom frontend, resolved relative to the working directory. Hosting binds to `127.0.0.1:3000` by default; override with `--host`/`--port`. Database paths and `.env` are relative to where you run `wod`, not the installation directory.

For a checkout, run `bun install && bun run build:cli` to build the CLI and both hosting apps, then use `bun run wod server`. `bun run playground` remains the Vite development server with hot reload.

The served API is a [trusted single-user deployment without authentication](#before-exposing-a-server): keep it on loopback and add access control before exposing it.

### Run the server with Bun

With Bun installed, run from the repository root:

```bash
bun install
bun run server
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The command builds the packages and API-enabled playground into `apps/playground/dist-api`, then starts [`apps/api`](./apps/api/) to serve both the app and API from one origin. The default database is `./data/wodwiki.db`, a local SQLite file accessed through `@libsql/client`, the same driver used for Turso. This default is unchanged; the `wod` CLI serves the same stack with its own `./wodwiki.db` default and `--db` override.

Keep the `data` directory to preserve your data between launches. After a build, `bun run start:server` starts the server without rebuilding. Ordinary playground builds use `apps/playground/dist`, separate from the server build.

See [database configuration](#configure-the-server-database) to use remote Turso or PostgreSQL, or override the local SQLite path.

### Run the server in a container

Install [Docker Engine](https://docs.docker.com/engine/install/) and [Docker Compose](https://docs.docker.com/compose/install/). From the repository root:

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). Docker builds the API-enabled playground and runs it with the Bun API. Bun is not required on the host. If Bun is installed, `bun run docker` runs the same command.

The default SQLite database is `/data/wodwiki.db` inside the container, persisted in the Compose `wodwiki-data` named volume. Stop the application with `docker compose down`; the volume remains. `docker compose down -v` deletes that volume and its local database.

[`docker-compose.yml`](./docker-compose.yml) reads `DB_DRIVER`, `DATABASE_URL`, `LIBSQL_AUTH_TOKEN`, `SQLITE_PATH`, and the host `PORT` from your shell or a root `.env` file. Copy the settings you need from [`.env.example`](./.env.example). For local SQLite, keep the container path under `/data` so it remains on the persistent volume. For PostgreSQL, the connection URL must point to a database reachable from the container; `localhost` refers to the container itself.

### Configure the server database

Local SQLite is the default. To select another database, set environment variables inline or in your shell, or — with the `wod` CLI — pass flags. For the CLI, precedence is flags, then the process environment, then `.env` (the working directory's file, falling back to the repository root); `--env-file <path>` loads an explicit file and is an error when it is missing. The bundled server reads the process environment only:

```bash
# Local SQLite at a chosen path
SQLITE_PATH=./data/training.db bun run server

# Remote Turso
DB_DRIVER=turso DATABASE_URL=libsql://your-db.turso.io LIBSQL_AUTH_TOKEN=your-token bun run server

# PostgreSQL, using an existing database
DB_DRIVER=postgres DATABASE_URL=postgres://user:password@localhost:5432/wodwiki bun run server
```

The `wod` CLI takes the same settings as flags: `--db <path>` (always selects SQLite, even when the environment names a remote backend), `--db-driver sqlite|postgres|turso`, `--database-url <url>`, `--postgres-host/--postgres-port/--postgres-user/--postgres-password/--postgres-database/--postgres-ssl`, and `--turso-url`/`--turso-auth-token`; `--host`, `--port`, and `--dist` configure hosting (`--dist` resolves relative to the working directory; the server's `PLAYGROUND_DIST` is repo-root relative). Matching variables: `WOD_WIKI_DB` or `SQLITE_PATH` for the SQLite file (`WOD_WIKI_DB` wins for the CLI), `DB_DRIVER`, `DATABASE_URL`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `POSTGRES_SSL`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (or `LIBSQL_AUTH_TOKEN`), and `HOST`, `PORT`, `PLAYGROUND_DIST` for hosting. Labels and error messages never contain credentials. PostgreSQL and hosting need Bun (its built-in driver and HTTP server); Node.js runs the CLI's SQLite and Turso subcommands.

For a container launch, use the same database variables with `docker compose up --build`, or set them in the root `.env` file. Do not commit database credentials. [`.env.example`](./.env.example) also documents `HOST`, `PORT`, and `PLAYGROUND_DIST` for native Bun launches.

A fresh database uses the current schema version. The server refuses incompatible schemas and does not import legacy Rust `wod-wiki-api` databases.

In server mode, durable app data lives in SQL: journal, collections, efforts, sessions, notebooks, query shortcuts, calculators, and telemetry. Theme, audio, onboarding, cast pairing, telemetry consent, and per-route view settings stay browser-local.

### Before exposing a server

The server is a single-user trusted deployment without authentication. Native Bun binds to `127.0.0.1` by default. Docker binds to `0.0.0.0` inside the container, and Compose publishes the port on the host. Add access control before exposing it publicly. Connecting several browsers does not create separate user accounts.

### Development tools and checks

Storybook is a separate component workbench, not another hosting level:

```bash
bun run storybook       # http://localhost:6006
bun run test
bun run check:server
```

`check:server` exercises CRUD, transactions, domain queries, static serving, and database reopen against a temporary SQLite file. To check PostgreSQL or Turso, set `DB_DRIVER`, `DATABASE_URL`, any `LIBSQL_AUTH_TOKEN`, and `WOD_CHECK_ALLOW_REMOTE=1`. Use a disposable database: this check wipes its data.

See [monorepo scripts](#monorepo-scripts) for other commands, [architecture at a glance](#architecture-at-a-glance) for the package map, and the [architecture overview](./docs/architecture/overview.md) for the workout-processing pipeline.

---

## The big idea: everything is a metric

```
Markdown  →  Metrics (the plan)  →  Tracking metrics (what happened)  →  Analyzed metrics (insight)
```

At each stage the system **adds metrics** — it never overwrites. A metric records its `origin` (`parser`, `dialect`, `compiler`, `runtime`, `user`, `analyzed`), and a precedence rule decides which one is shown. That single idea lets the app overlay the **planned** target, the **tracked** actual, and the **analyzed** projection in one view. See [`docs/architecture/metric-lifecycle.md`](./docs/architecture/metric-lifecycle.md).

---

## Using the playground

The home tour starts workouts only when Run is pressed. Each run saves a fresh playground note, and Stop, completion, or leaving the timer saves its results once. Home analytics uses labelled, in-memory example data without adding sessions to your journal; select This run to inspect the current note's results. Desktop, mobile, and reduced-motion layouts share the same run and analytics behavior.

Journal, Collections, Playgrounds, Efforts, and Sessions share an icon ribbon and a filter panel. On mobile, open navigation to use the same ribbon beside the panel. Filter accordions show values supported by the current WQL results; selecting or removing a condition updates `?q=` and refreshes the available filters and result groups. Each selection adds a history entry, so browser Back restores the previous query. Selected conditions remain removable when no results match.

Each filter value has one button that cycles Off, Include, and Exclude. Expanded sections share one scroll container; the section header stays sticky so it can be collapsed while scrolling a long list. Edit `apps/playground/app/nav/panels/conditionsConfig.ts` to configure section labels, ordering, visibility, and expected values. Expected values constrain and label current-result choices; active selections stay visible even when no results match. During query execution, the previous rows remain visible with controls disabled until the new results arrive.

The mobile drawer fills the screen width. Selecting an L1 destination keeps it open for L2 filtering. Filters update immediately; Apply closes the drawer. Full-query shortcuts such as All and Feeds navigate and close it immediately.

Result-identity catalogs are hidden from their own library filters. Supported section headers have a Group checkbox that adds or removes that dimension from the current WQL. Save the query from its toolbar or the Custom navigation item with a label and icon; manage these shortcuts in Settings > Query Defaults. Unmatched queries select Custom above New shortcut. Equivalent queries select the same shortcut regardless of filter or grouping order.

---

## The `wod` block syntax

A workout is plain Markdown; WOD Wiki interprets fenced ` ```time ` (and ` ```log `) blocks. Each line is a statement of `[lap] fragment fragment …`, and **indentation creates hierarchy**.

````markdown
## WOD

```time
(10) :60 EMOM      ← 10 intervals of 60 seconds (Every Minute On the Minute)
  + 2 Burpees      ← composed set performed each interval
  + 5 Push Ups
  + 7 Air Squats
```
````

### Fragments at a glance

| You write | It means |
|---|---|
| `5:00`, `1:00`, `:60`, `:30` | **Duration** — a planned timer |
| `(3)`, `(10)` | **Rounds** — repeat the child block N times |
| `(21-15-9)`, `(100-80-60-40-20)` | **Rep ladder** — a sequence of round sizes |
| `10`, `50` | **Reps** for the effort on the line |
| `400m`, `1000m`, `0.5mile` | **Distance** (units: `m`, `km`, `ft`, `mile`) |
| `16kg`, `225lb`, `bw` | **Load** (units: `kg`, `lb`, `bw` = bodyweight) |
| `Burpees`, `KB Deadlift` | **Effort** — the movement name |
| `?` | an athlete-chosen value to fill in (`10:00 ? KB Snatch 16kg`) |
| `:?` | a **collectible** timer (value recorded, not counted down) |
| `+` / `-` | **lap** markers (compose / superset siblings) |
| `@` | binds a quantity as resistance |
| `*` | a **rest** marker (Tabata-style) |
| `// note` | a comment |

### A few real shapes

```time
(3)                        # 3 rounds of…
  10 Air Squats
  10 Push Ups

10:00 AMRAP                # as many rounds as possible in 10:00
  5 Pull Ups
  10 Push Ups
  15 Air Squats

(8) Power Sprints          # 8 rounds: sprint then rest
  25m Freestyle Sprint
  1:30 Rest

(5)                        # 5×8 kettlebell deadlifts @16kg
  8 KB Deadlift 16kg
  :30 Rest
```

Dialects recognize keywords like `EMOM`, `AMRAP`, `FOR TIME`, `TABATA`, `STRENGTH`, `RUN/ROW/BIKE/SWIM` and tag blocks accordingly. Full reference: [`docs/language/syntax-reference.md`](./docs/language/syntax-reference.md). Sample workout libraries live in the sibling [`wod-wiki-seed`](../wod-wiki-seed) repo (`markdown/collections/` there).

---

## The Plan → Track → Analyze workflow

The app is a continuous loop. The same metric flows through every phase.

### 1. PLAN — author & choose the work
- **Editor** (`/notes/:noteId`, `/playground/:id`) — write Markdown + `wod` blocks with live syntax checking, suggestions, and typed frontmatter tags.
- **Collections** (`/collections`) — browse workout libraries; pick one to run.
- **Efforts** (`/efforts`, `/effort/:slug`) — exercise definitions (MET, discipline, intensity tier) that power analytics and autocomplete.
- **Feeds** (`/feeds`) — date-indexed streams of workouts.

### 2. TRACK — execute on the clock
- **Clock / Run** (`/run/:runtimeId`) — JIT-compiled blocks run on the runtime clock: timers count, rounds advance, sound cues fire, and you log actual reps/load/RPE. Each segment emits statements recorded directly as `EventRecord` rows.

### 3. ANALYZE — review & derive insight
- **Review** (`/review/:runtimeId`, `/sessions/:sessionId`) — per-segment results + derived analytics.
- **Journal** (`/journal`, `/journal/:date`) — long-term training log grouped by date pages.
- **Dashboards** (`/dashboard`, `/dashboard/:slug`) — custom widgets and Datadog-style WQL queries (`<agg>:<metric>{filters} by {dim}`).

Details: [`docs/app/screens-and-workflow.md`](./docs/app/screens-and-workflow.md), [`docs/language/wql-reference.md`](./docs/language/wql-reference.md), and [WQL query composition](./docs/prototypes/WQL-Domain-Query-Composition.md).

---

## Architecture at a glance

```
markdown ─▶ PARSE (lezer grammar)          → CodeStatements   (parser metrics)
         ─▶ SEMANTICS (dialects)            → hints + dialect metrics
         ─▶ COMPILE (JIT strategies)        → runtime blocks + behaviors
         ─▶ RUNTIME (stack + clock)         → OutputStatements (runtime/user metrics)
         ─▶ PERSISTENCE (IndexedDB or SQL)  → events, sessions, notes, page_notes, tags
         ─▶ ANALYTICS (WQL QueryService)    → fact aggregations, rollups, and joins
         ─▶ PRESENTATION (editor/clock/journal/dashboard)
```

| Package / App | NPM Package | Purpose |
|---|---|---|
| `packages/core` | `@bitcobblers/wod-wiki-core` | Shared models (`Metric`, `CodeStatement`, `OutputStatement`, `EventRecord`) |
| `packages/lang` | `@bitcobblers/wod-wiki-lang` | Whiteboard Lezer grammar, dialects, compiler, effort registry |
| `packages/wql` | `@bitcobblers/wod-wiki-wql` | Wod Query Language grammar, AST, and QueryService execution engine |
| `packages/ui` | `@bitcobblers/wod-wiki-ui` | CodeMirror 6 extensions, widgets, preview decorations, themes |
| `packages/engine` | `@bitcobblers/wod-wiki-engine` | Runtime orchestration, CLI runner, and umbrella exports |
| `apps/playground` | *private* | Full React web application (journal, editor, settings, dashboards) |
| `apps/storybook` | *private* | Component workbench and visual testing workshop |
| `apps/api` | *private* | Bun API and static playground hosting with SQLite, Turso, or PostgreSQL |

Full map: [`docs/architecture/overview.md`](./docs/architecture/overview.md).

---

## Monorepo scripts

| Command | Action |
|---|---|
| `bun run build:packages` | Builds ESM/CJS bundles and declaration files for all packages in `packages/*` |
| `bun run build:cli` | Builds packages and stages both prebuilt hosting apps into the engine distribution |
| `bun run playground` | Builds packages, runs linter, and starts Vite dev server (`http://localhost:5173`) |
| `bun run storybook` | Starts Storybook workbench (`http://localhost:6006`) |
| `bun run test` | Runs all test suites: packages (Vitest) + playground (Bun) + storybook + seed |
| `bun run test:packages` | Runs package unit tests via Vitest |
| `bun run test:playground:unit` | Runs playground unit/integration tests via Bun test runner |
| `bun run test:seed` | Tests seed import compiler and manifest integrity |
| `bun run test:e2e` | Runs Playwright browser tests |
| `bun run typecheck:packages` | Type checks all packages |
| `bun run lint:playground` | Lints playground source with ESLint |
| `bun run build` | Compiles packages and production builds of both apps |
| `bun run server` | Builds packages + API SPA (`dist-api`) and starts the Bun API server |
| `bun run start:server` | Starts the API server from an existing build |
| `bun run build:server` | Builds packages + API SPA only (no server launch) |
| `bun run wod` | Runs the `wod` CLI: `init`, `server`, `playground`, `parse`, `run`, `query`, `reset`, … |
| `bun run docker` | Builds and starts the Docker Compose server stack |
| `bun run check:server` | Runs the assert-based API check suite (`apps/api/check.ts`) |
| `bun run typecheck:server` | Type checks `apps/api` |

### Deployed E2E verification

Run the production bundle locally with `bun run build:app` followed by
`E2E_TARGET=preview bun run test:e2e`. Set `E2E_APP_URL` to test a deployed build
without starting a local server. Seed-dependent tests await the bootstrap's
`data-seed-state` and `data-seed-outcome` on `<html>` before checking the route.
Derived seed rows are queued within the existing atomic chunk transaction;
a failed write rolls back both rows and the checkpoint.
Canvas commits before any library fetch; the remaining chunks fetch four at a
time and still commit in manifest order. Failed fetches preserve the committed
checkpoint so the next bootstrap resumes without reapplying completed chunks.
Playwright's pinned Chromium uses SQLite-backed IndexedDB explicitly; its
LevelDB backend took 31.5 seconds for a fresh seed versus 2.8 seconds with SQLite.

PR previews and main run the live-app suite after deployment and wait for the
deployed entry-bundle hash. Reports publish to `https://<branch-slug>.e2e.wod.wiki/`
and [the main report](https://e2e.wod.wiki/), including failed runs. CI summaries
show per-file pass, fail, flaky, and skipped counts. `e2e-run-metadata.json` beside
the report records the tested commit, build hash, deploy URL, timestamp, and run URL.
Failed-test artifacts retain the initial trace, browser console, network, and video.

Quarantines must cite an open issue: unsupported effort actions and the CI
performance budget are tracked in [#719](https://github.com/bitcobblers/wod-wiki/issues/719);
production Chromecast round-trips in [#1067](https://github.com/bitcobblers/wod-wiki/issues/1067);
storage-denial bootstrap recovery in [#1068](https://github.com/bitcobblers/wod-wiki/issues/1068).
Retired routes and widgets are removed from the suite rather than silently skipped.

---

## Repository layout

```
packages/
  core/         Shared metric, statement, and storage contracts
  lang/         Lezer grammar, dialects, JIT compiler, and effort registry
  wql/          WQL query engine, AST, vocabulary, and document runner
  ui/           CodeMirror 6 extensions, widgets, and themes
  engine/       Execution runtime, stack, behaviors, and CLI
apps/
  playground/   Vite + React application (journal, note editor, analytics, settings)
  storybook/    Component Storybook workbench
  api/          Bun API server (SQLite/Turso/PostgreSQL storage, serves dist-api SPA)
scripts/        Seed sync (from the sibling wod-wiki-seed repo), release stampers
docs/           Architecture specs, domain models, and WQL query guides
```

---

## License

See [`LICENSE`](./LICENSE).
