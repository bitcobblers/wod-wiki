# ADR 0005: Portable Data Formats, Publication Visibility, and Distributed Feed Planes

**Status:** Accepted
**Date:** 2026-11-10
**Amends:** [ADR 0001](0001-feed-seed-data-contract.md), [ADR 0002](0002-feed-lifecycle.md)

## Context

WOD Wiki previously split Note portability, Feed publishing, and Library browsing across divergent implementations:

1. **Divergent Note & Telemetry Formats**: Browser export wrapped Notes in a synthetic `## Metadata` / `## Content` envelope (`NoteMarkdownSerializer.ts`) alongside three export-only CSVs (`NoteCsvFormatter.ts`), whereas CLI `exchange.ts` and `wod-wiki-feed-repository` used YAML frontmatter (`wod-note-id`) plus Session CSVs or `.jsonl` bundles. Exported browser files could not drop into a Feed repository, and `.md` / `.jsonl` / `.csv` lacked symmetry across surfaces.
2. **Asymmetric Publishing Across Hosting Modes**: `seedbuild/compiler.ts` depended on `node:fs` and `git rev-list`, `cli/publish.ts` emitted partial chunks without `NotebookIndex` or `index.html`, `wod server` (`server/app.ts`) had no Feed publishing or `/feed/*` routes, and non-self-hosted IndexedDB browsers had no path to export a `wod-wiki-feed-repository`.
3. **Hardcoded Library Catalog & Bespoke Browser**: `feedSources.ts` hardcoded 35 `NOTEBOOKS` in TypeScript while `QueryService.runFindNotebook()` returned member Notes rather than Notebook containers, forcing `/notebooks` to mount an 808-line bespoke `NotebookLibraryBrowser.tsx` that could not list or preview individual Notebooks from custom distributed Feeds prior to full import.

## Decision

1. **Strict Portable Codec (`PortabilityCodec`) with Zero Legacy Shims**:
   - **Note = `.md`**: Canonical Markdown with YAML frontmatter (`wod-note-id`, `title`, `date`, `notebook`, typed tags) and verbatim Markdown body. Identical across browser import/export, CLI `wod import`/`export`, and `wod-wiki-feed-repository`. The synthetic `## Metadata` wrapper and one-way CSV formatters are deleted.
   - **Telemetry = `.jsonl` ↔ `.csv` (`TelemetryBundle`)**: Execution, loading, and parsing data (`BlockRevision` snapshots, parse/load events, `Session` headers with `public?: boolean`, and `EventRecord`s) round-trip losslessly and symmetrically through both `.jsonl` (canonical companion `<stem>.jsonl` in Feed repositories) and `.csv` (tabular equivalent).

2. **Derived `Publication Visibility` (`Notebook.public` + `Session.public`)**:
   - User-owned Notebook landing Notes (`notebook/:slug`) carry `public?: boolean` (default `false`).
   - Individual `Session` rows carry `public?: boolean` (default `false`).
   - Effective `Publication Visibility` on any Note is **derived**, never stored:
     - `Private`: owning Notebook is not public.
     - `Published Note`: owning Notebook is public and `0` Sessions on the Note are marked `public`.
     - `Published Note + Data`: owning Notebook is public and `>= 1` Session on the Note is marked `public` (publishing only those opted-in Sessions, their pinned `BlockRevision`s, and their `EventRecord`s).
   - Subscribed upstream Feed Notebooks (`origin: 'feed'`) remain read-only mirrors; users may record private Sessions against them, while publishing a Note or its Sessions in the user's own Feed requires owning the Note inside a `public` user Notebook via Clone/Fork.

3. **Universal `FeedTree` Seam & Runtime-Agnostic `FeedPublisher`**:
   - One pure `FeedPublisher` in `packages/engine` compiles all `public` user Notebooks, referenced user-authored Effort/Equipment Property Notes, and `public` Sessions from `IStorage` into a `FeedTree` (`HttpFeedTree`, `ZipFeedTree`, `DirectoryHandleFeedTree`, `NodeFsFeedTree`, `MemoryFeedTree`).
   - **Self-Hosted (`wod server`)**: Explicit Publish Snapshot (`POST /api/v1/feed/publish`) compiles and serves the instance's outbound Feed at `/feed/*` and reports unpublished local changes via `GET /api/v1/feed/status`.
   - **Non-Self-Hosted (Browser IndexedDB)**: Invokes the same `FeedPublisher` against `ZipFeedTree` or `DirectoryHandleFeedTree` to export a complete `wod-wiki-feed-repository` (`markdown/notebooks/<slug>/*.md`, companion `.jsonl`, Effort/Equipment `.md`, GitHub Actions workflow, and compiled `dist/` static Seed artifacts).

4. **First-Class WQL `:feed{}` and `:notebook{}` Planes & Zero-Import Preview**:
   - `:feed{}` queries distributed Feed sources (*My Published Feed*, *Core*, *Built-in Feeds*, and *Custom Peer/Self-Hosted URLs*).
   - `:notebook{}` queries Notebook containers across those sources using manifest-derived `NotebookIndexSummary` catalog records persisted in `IStorage` (retiring hardcoded `NOTEBOOKS` special-casing and bespoke `NotebookLibraryBrowser.tsx`).
   - Opening an unsubscribed remote Notebook fetches `indexes/notebooks/<id>.json` (and individual compiled record `.json` on demand) via `HttpFeedTree`, rendering zero-import previews and 1-click Note Clone directly inside `QueriableStreamView`.

## Domain models

```yaml
model: PublicationVisibility
source: packages/core/src/publication.ts
values: [Private, Published Note, Published Note + Data]
depends_on: [Note, Session]
lifecycle:
  derived_from: "notebookLanding.public && count(sessions where session.noteId === note.id && session.public === true)"
  surfaced_on: [PublicationPill in Note Editor header, LibraryRow metadata, FeedPublisher filter]
```

```yaml
model: FeedTree
source: packages/engine/src/feed/tree.ts
methods:
  read:   "(path: string) => Promise<Uint8Array>"
  stat:   "(path: string) => Promise<{ bytes: number; sha256?: string } | undefined>"
  write:  "(path: string, bytes: Uint8Array) => Promise<void> (writable adapters)"
  delete: "(path: string) => Promise<void> (writable adapters)"
adapters: [MemoryFeedTree, NodeFsFeedTree, HttpFeedTree, ZipFeedTree, DirectoryHandleFeedTree]
depends_on: [SeedManifest, NotebookIndex, SeedRow]
lifecycle:
  produced_by: "FeedPublisher.publish(storage, tree, options)"
  consumed_by: [wod server /feed/*, Browser Feed Repo Export, wod build/publish, Remote Notebook Preview, FeedImporter]
```

## Consequences

- Every surface (Browser, CLI, `wod server`, GitHub Pages Feed repositories) speaks one Markdown Note format and one symmetric `.jsonl`/`.csv` TelemetryBundle format.
- Deleting `NoteMarkdownSerializer`, `NoteMarkdownDeserializer`, `NoteCsvFormatter`, `cli/publish.ts`'s divergent chunk builder, and `NotebookLibraryBrowser.tsx` concentrates layout, codec, and query logic behind deep, in-memory-testable interfaces.
- Browsing `/feeds`, `/notebooks`, and `/notebook/:slug` (subscribed or unsubscribed preview) uses the exact same `QueriableStreamView` + WQL architecture as every other Library page.
