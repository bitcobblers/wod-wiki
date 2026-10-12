# Frontmatter & Typed-Tag Architecture

**Status:** Landed (2026-09-27)
**Date:** 2026-09-27
**Corpus:** `markdown/` — 888 files: `collections/` 728, `canvas/` 87, `efforts/` 53, `feeds/` 14, `dashboards/` 6.
**Related:** `docs/prototypes/seed-data-unification.md`, `apps/playground/src/lib/frontmatter.ts`, `apps/playground/src/services/seed/SeedImporter.ts`

---

## 1. Overview & Ground Truth

All workout classification across the codebase is unified under **namespaced typed tags**. The previous three competing classification mechanisms (flat frontmatter `tags:`, frontmatter `category:`, and body pseudo-frontmatter `Type`/`Difficulty`) have been consolidated directly in markdown frontmatter.

The markdown files are the single source of truth. Seed compilation (`scripts/generate-seed.ts`) bundles files byte-faithfully into JSON chunks, and runtime import (`SeedImporter.ts`) extracts typed tags using the native `extractTypedFrontmatterTags` parser.

---

## 2. Canonical Frontmatter Structure

Workout notes (`markdown/collections/**` and `markdown/feeds/**`) carry structured frontmatter with typed keys matching registered tag types:

```yaml
---
domain: crossfit
format: for-time
equipment:
  - barbell
  - pullup-bar
quality:
  - conditioning
intent: benchmark
date: 2012-09-29
original_url: "https://example.com/wod"
wayback_url: "https://web.archive.org/web/.../wod"
---
```

### Frontmatter Key Allocation

| Key | Type / Value | Purpose | Indexed As |
|---|---|---|---|
| `domain` | String / List (`crossfit`, `parkour`, `swimming`, etc.) | Sport or training discipline | `Tag` (`type: 'domain'`) |
| `format` | String / List (`for-time`, `amrap`, `emom`, `intervals`, etc.) | Session execution shape & time domain | `Tag` (`type: 'format'`) |
| `equipment` | String / List (`kettlebell`, `barbell`, `clubs`, etc.) | Gear required for the workout | `Tag` (`type: 'equipment'`) |
| `quality` | String / List (`strength`, `endurance`, `conditioning`, etc.) | Target physical adaptation / stimulus | `Tag` (`type: 'quality'`) |
| `intent` | String / List (`benchmark`, `competition`, `sport`) | Protocol role or testing status | `Tag` (`type: 'intent'`) |
| `tags` | String / List | Unclassified / general user tags | `Tag` (`type: undefined`) |
| `date` | `YYYY-MM-DD` | Calendar anchor | `Note.date` (epoch ms at 12:00 UTC) |
| `original_url` / `wayback_url` | String | Provenance links | Frontmatter metadata (verbatim) |
| `template`, `collection`, `feed`, `dashboard` | Boolean / String | Document page-type discriminators | Page routing / UI hierarchy |

### Fields Excluded from Tags

- **`difficulty`**: Dropped. 488/495 ZombieFit files carried the boilerplate string `Beginner / Advanced / Expert`, while other collections used 12 incompatible ad-hoc scales. Contains no normalized signal.
- **`category`**: Retired from workouts. The collection chunk (`catalog` on `Note`) already provides folder grouping; discipline semantics moved to `domain`.
- **`dashboard` / `template` / `collection` / `feed`**: Page discriminators; never tagged.

---

## 3. Tag Taxonomy & Normalization

### A. `domain` (Discipline / Ecosystem)
- `crossfit`
- `parkour`
- `swimming`
- `triathlon`
- `climbing`
- `girevoy-sport`

### B. `format` (Protocol & Time Architecture)
Replaces 80 free-text `Type` and `Format` prose strings with normalized kebab-case slugs:
- `for-time` (from `For Time`, `For Time / Volume Training`)
- `amrap` (from `AMRAP`, `AMRAP (As Many Rounds As Possible)`)
- `emom` (from `EMOM`, `EMOM (Every Minute on the Minute)`)
- `intervals` (from `Intervals`, `Distance Intervals`)
- `skill` (from `Skill`, `Technique Focus`, `Skill Development`)
- `max-weight` (from `Max Weight`)
- `max-reps` (from `Max Reps`, `Max Reps Endurance Test`)
- `complex` (from `Strength Complex`, `Progressive Strength Complex`, `Advanced Complex`)
- `circuit` (from `Double Kettlebell Circuit`, `High-Intensity Circuit`)
- `finisher` (from `High-Intensity Finisher`)
- `individual-medley` (from `Individual Medley`, `Elite Individual Medley`)
- `program` (from multi-day training block overviews)

### C. `equipment` (Gear & Implements)
Composable across multiple pieces of gear per workout:
- `kettlebell`
- `barbell`
- `dumbbell`
- `pullup-bar`
- `rings`
- `clubs`
- `macebell`
- `sandbag`
- `unconventional`
- `minimalist`
- `bodyweight`

### D. `quality` (Physical Stimulus / Capacity)
- `strength`
- `endurance`
- `conditioning` (`cardio` merged into `conditioning`)
- `power` (from `Speed/Power`, `Maximum Velocity`, `Anaerobic Power`)
- `recovery` (from `Recovery`, `Mobility and Recovery`)

### E. `intent` (Status / Tier)
- `benchmark` (e.g. CrossFit Girl WODs, standardized benchmarks)
- `competition` (e.g. Games events, Girevoy Sport competition sets)
- `sport`

---

## 4. Runtime & Storage Architecture

### Storage Layer (`tag_types`, `tags`, `note_tags`)

1. **`tag_types` store** (`TagTypeRecord`):
   Pre-seeded by `StorageService.DEFAULT_TAG_TYPES` and `SeedImportStorage`:
   - `domain` (#10b981)
   - `format` (#8b5cf6)
   - `equipment` (#3b82f6)
   - `quality` (#f59e0b)
   - `intent` (#ec4899)
   - Backwards compatibility: `category` (#6366f1), `type` (#a855f7), `discipline` (#14b8a6)

2. **`tags` store** (`Tag`):
   Indexed by `by-label` (unique label) and `by-type` (`type?: TagType`).

3. **`note_tags` store** (`NoteTag`):
   N:M junction table indexed by `by-note` (`noteId`) and `by-tag` (`tagId`).

### Extraction Pipeline

Both user note saves (`IndexedDBContentProvider.ts`) and seed imports (`SeedImporter.ts`) share the same parser in `apps/playground/src/lib/frontmatter.ts`:

```ts
const KNOWN_TAG_TYPES = DEFAULT_TAG_TYPES.map((t) => t.name);

// Native extraction: matches frontmatter keys to known tag types
const tags = extractTypedFrontmatterTags(rawContent, KNOWN_TAG_TYPES);
```

- Keys matching known types (`domain: crossfit`) yield `{ label: 'crossfit', type: 'domain' }`.
- `tags:` values yield `{ label: 'name' }` (untyped general tag).
- Duplicate labels resolve in favor of the typed record.
- Frontmatter lives in `Note.rawContent`, stored byte-identically with no synthetic re-serialization.

---

## 5. Migration History

1. **Hoisting (2026-09-27)**: Lifted body-level pseudo-frontmatter (`Type`, `Difficulty`, `Category`, URLs) into leading YAML frontmatter across 662 collection workout files.
2. **Taxonomy Migration (2026-09-27)**: Ran `scripts/migrate-corpus-tags.ts` across 888 markdown files (748 modified):
   - Parsed flat `tags:` and normalized `type:` into canonical typed keys (`domain`, `format`, `equipment`, `quality`, `intent`).
   - Merged `cardio` into `conditioning`.
   - Dropped empty `category:` and `difficulty:` values.
3. **Seed Importer Cutover (2026-09-27)**: Removed the legacy category-munging code in `SeedImporter.ts` in favor of direct `extractTypedFrontmatterTags()`.
4. **Seed Compilation (2026-09-27)**: Re-generated seed artifacts under `apps/playground/public/seed/` via `scripts/generate-seed.ts` (78 chunks, 889 files, 9262 KB).
