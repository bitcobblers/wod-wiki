# Handoff: Storybook Database Architecture & Real Storage Integration

## Overview

This document provides a comprehensive architectural handover for the database-driven Storybook integration implemented across commits `fa8892ba8` (`storybook`) and `0c4c54c37` (`video scene`).

The primary objective of this work was to enable real database behavior directly within Storybook while adhering strictly to the architectural constraint: **`apps/playground` must never depend on or know about `apps/storybook`**.

---

## 1. High-Level Architecture & Component Map

```
┌────────────────────────────────────────────────────────────────────────┐
│                        apps/storybook                                  │
│                                                                        │
│  DatabaseContext (Provider)                                            │
│    ├── DatabaseSelectionPage (Default landing story)                   │
│    ├── PlaygroundLibraryPage (Command palette + workbench)             │
│    ├── WqlLibrarySearchPage (WQL query composer over active DB)        │
│    ├── DashboardGeneratorPage (Generates scaffold, renders live)       │
│    └── SessionExplorerPage (Inspects runs/events in active DB)         │
│                                                                        │
│  runPersistence.ts (Maps workbench run -> note block -> session row)   │
└───────────────────────┬────────────────────────────────────────────────┘
                        │ imports via `@/` and package aliases
                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        apps/playground/src                             │
│                                                                        │
│  services/storage/                                                     │
│    ├── index.ts: switchActiveLocalDatabase(), storageReady/events      │
│    ├── dataSettings.ts: selectLocalDatabase()                          │
│    └── activeDatabaseCaches.ts: rehydrateActiveDatabaseCaches()        │
│                                                                        │
│  components/organisms/command-palette/                                 │
│    └── PaletteShell, palette-store, paletteDataSources                 │
└───────────────────────┬────────────────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        packages/storage                                │
│                                                                        │
│  src/idb/catalog.ts: listLocalDatabases, createLocalDatabase,           │
│                      deleteLocalDatabase, isValidLocalDatabaseName      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Subsystems & Design Decisions

### A. The Strict Boundary Rule
- `apps/playground` contains no imports or references to `apps/storybook`.
- Shared storage primitives were placed either in `packages/storage` (schema/catalog) or exported from clean boundaries in `apps/playground/src/services/storage`.
- Storybook consumes these via `@/` Vite alias and `@bitcobblers/wod-wiki-*` package exports.

### B. Dynamic IndexedDB Management & Live Switch
- **Catalog Primitives** (`packages/storage/src/idb/catalog.ts`):
  - Enumerates existing databases via `indexedDB.databases()`.
  - Creates auxiliary databases initialized with the canonical schema version and stores.
  - Validates database names (`1..100` chars, alphanumeric plus `.`, `-`, `_`, non-leading punctuation).
- **Active Switcher** (`apps/playground/src/services/storage/index.ts` & `activeDatabaseCaches.ts`):
  - `switchActiveLocalDatabase(dbName)` switches the active storage instance without requiring a full page refresh.
  - Automatically clears and rehydrates query service caches, seed caches, and reference indices.
- **Storybook Context** (`apps/storybook/src/database/DatabaseContext.tsx`):
  - Manages active database state, ensures a default DB (`wodwiki-db`) exists and is seeded on boot, and triggers re-renders on DB mutation.

### C. Benchmark Runs Persisted as Sessions
- **Run Persistence** (`apps/storybook/src/workbench/runPersistence.ts`):
  - Stories specify `runNote={{ id, title, persistRuns: true }}`.
  - Flow:
    1. Reconciles workout blocks in the active database note entry.
    2. Maps the Nth runnable code fence in the editor to the corresponding persisted block ID.
    3. Calls `captureRun(...)` to create an `in-progress` session record.
    4. On timer finish, records output statements and transitions status to `completed`.
- Unit-tested with Vitest mocks in `apps/storybook/test/runPersistence.test.ts`.

### D. Playground Library Page & Command Palette
- Instead of static mock fixtures, `apps/storybook/src/playground/PlaygroundLibraryPage.tsx`:
  - Uses the production command palette (`Ctrl+/` or Find button) backed by `noteSource` in the active DB.
  - Selecting a note parses frontmatter/content and binds it to `LanguageWorkbench`.
  - Allows reloading from disk/IndexedDB and running workouts with persistent session tracking.

### E. Build & Package Resolution Mechanics
- **Root Build Dependency**:
  - `scripts/sync-seed.ts` compiles seeds during Storybook startup/build.
  - Because `sync-seed.ts` imports the seed compiler from `packages/tools`, which resolves `@bitcobblers/wod-wiki-lang` via `dist/`, packages **must** be compiled before building Storybook.
  - Addressed by updating `package.json` (`"build:storybook": "bun run build:packages && bun run --filter '@bitcobblers/wod-wiki-storybook' build"`) and `.github/workflows/_storybook.yml`.
- **Engine Split**:
  - `@bitcobblers/wod-wiki-engine` exports headless contracts at `.` and React bindings at `./react`.
  - Added alias in `apps/storybook/aliases.ts` for `@bitcobblers/wod-wiki-engine/react` pointing to `packages/engine/src/react.ts`.

---

## 3. High-Level Design Review: Open Questions & Seams

When reviewing or refactoring this architecture, the following seams should be evaluated:

### 1. Singleton Mutation vs Dependency Injection for Storage
- **Current State**: Switching active database mutates the singleton `storageService` and triggers manual cache invalidation (`rehydrateActiveDatabaseCaches`).
- **Tradeoff**: Very low diff and full compatibility with existing playground hooks, but introduces hidden global state transitions.
- **Alternative**: Introduce an explicit `StorageContext` / DI container allowing components or stories to receive an isolated storage instance.

### 2. Location of `runPersistence.ts`
- **Current State**: Resides in `apps/storybook/src/workbench/runPersistence.ts`.
- **Tradeoff**: Keeps Storybook-specific persistence glue out of production packages.
- **Review Point**: If headless CLI benchmarks or other applications need the exact same "run-to-session" pipeline without UI, consider extracting this logic to `packages/engine` or `apps/playground/src/services/sessionRunner.ts`.

### 3. Command Palette Coupling in Storybook Playground
- **Current State**: `PlaygroundLibraryPage` directly mounts `PaletteShell` and interacts with `usePaletteStore`.
- **Review Point**: Ensure palette store mutations don't leak keyboard listeners across unrelated Storybook stories. Currently cleaned up via React `useEffect` unmount handlers.

### 4. Seed Sync Execution in CI
- **Current State**: Running `bun run build:packages` before `sync-seed.ts` adds ~10-15s to fresh builds.
- **Optimization Path**: If `packages/tools/src/seedbuild` is updated to allow source-level execution with bun or tsx instead of requiring `dist/index.mjs`, the package pre-build could be made optional in development.

---

## 4. Verification & Validation Commands

All changes have passed verification:

```bash
# 1. Workspace package & static Storybook build from clean state
rm -rf packages/*/dist && bun run build:storybook

# 2. Storybook unit & interaction tests (Vitest browser runner)
bun run test:storybook

# 3. Targeted run persistence test
cd apps/storybook && bun run test test/runPersistence.test.ts

# 4. Storage catalog unit tests
bun test ./packages/storage/tests/catalog.test.ts

# 5. Playwright E2E suite covering landing, multi-DB, sessions, search, mobile (375px), and dark mode
STORYBOOK_URL=http://127.0.0.1:6021 bun x playwright test --config playwright.storybook.config.ts
```

---

## 5. Key File Index

- Documentation: `docs/storybook-database-stories.md`
- E2E Tests: `e2e/storybook.database.e2e.ts`, `e2e/storybook.smoke.e2e.ts`
- Storybook Stories:
  - `apps/storybook/src/Database.stories.tsx`
  - `apps/storybook/src/Playground.stories.tsx`
  - `apps/storybook/src/data/WqlLibrarySearch.stories.tsx`
  - `apps/storybook/src/data/DashboardGenerator.stories.tsx`
  - `apps/storybook/src/sessions/SessionExplorer.stories.tsx`
- Storage Catalog: `packages/storage/src/idb/catalog.ts`
- Switcher & Cache Busting: `apps/playground/src/services/storage/index.ts`, `apps/playground/src/services/storage/activeDatabaseCaches.ts`
- Storybook Workflow: `.github/workflows/_storybook.yml`

---

## 6. Suggested Skills

The incoming agent should invoke the following skills:

1. **`code-review`**: To audit the full diff (`git diff fa8892ba8~1..0c4c54c37`) against repo standards, security invariants, and regressions.
2. **`codebase-design`**: To evaluate the architectural seams (DI vs singleton storage, placement of `runPersistence.ts`, command palette decoupling).
3. **`playwright-cli`**: If modifying UI components, layout, or interaction flows in Storybook or Playground.
4. **`typescript-best-practices`**: When modifying any `.ts` / `.tsx` files in `apps/storybook` or `packages/storage`.
5. **`boss-man-thnk`**: If coordinating multi-step refactoring tasks using subagent delegation.
