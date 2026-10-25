# CONTEXT-MAP

This repo uses a multi-context layout. Skills that read domain language
(`improve-codebase-architecture`, `diagnose`, `tdd`, …) should consult the
shared root `CONTEXT.md` first, then any per-context `CONTEXT.md` relevant to
the surface they're about to touch.

## Shared

- [`CONTEXT.md`](./CONTEXT.md) — shared glossary: Statement, Metric, Origin,
  Unit, Dimension, Unit Registry, Fusion, Block Dialect, Behavior, Strategy,
  Block, Notebook, Feed, Note, Page, Library List, Session, Note Identity,
  Block Content Id, Result Recorder, Workbench Session, Workbench Effect,
  etc. **Read first.**

## Contexts

| Context | Path | Scope |
|---|---|---|
| Library / runtime | [`src/CONTEXT.md`](./src/CONTEXT.md) | Parsing, compilation, runtime stack, behaviors, metrics, dialect stack, grammar — anything in `src/` (the public React component library). |
| Playground app | [`apps/playground/CONTEXT.md`](./apps/playground/CONTEXT.md) | Routes, persistence, cast backends, journal / results UI, workbench, result recording — anything in `apps/playground/`. |

## Decisions

- **System-wide ADRs**: [`docs/adr/`](./docs/adr/)
- **Library ADRs**: `src/docs/adr/` (if/when created)
- **Playground ADRs**: `playground/docs/adr/` (if/when created)

## How to extend

When a new context emerges (e.g. `tools/`, `services/`, `docs-site/`):
1. Add a `CONTEXT.md` next to its top-level directory.
2. Add a row to the **Contexts** table above.
3. Optionally seed a per-context `docs/adr/` for decisions that don't apply repo-wide.