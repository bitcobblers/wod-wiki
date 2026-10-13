---
name: omf
description: Inventory, prune, and normalize frontmatter across the seed markdown corpus using scripts/omf.mjs. Use when editing collection frontmatter, merging or deleting frontmatter properties, auditing seed metadata (markdown/**), or the user mentions omf.
allowed-tools: Read Write Edit Bash
---

# omf — seed-corpus frontmatter tool

`scripts/omf.mjs`, alias `npm run omf -- <cmd>` from repo root. Default corpus is
`markdown/`; scope collection work with `--dir markdown/collections`. Mutation
commands accept `--dry`.

```text
omf ls [--dir D]                   all properties: per-value file counts
omf crosswalk [--dir D]            dir × property matrix (cells = file counts)
omf read p1 [p2 ...] [--dir D]     values grouped by property -> owning files
omf delete PROP [--dir D] [--dry]  remove PROP everywhere
omf merge TARGET SRC... [--dry]    move SRC values into TARGET, drop SRC tags
omf selftest                       fixture-based assert check
```

## Keys, not values

`merge` and `delete` operate on frontmatter **keys**, never on values.
`omf merge format for-max-weight` matches a *key* named `for-max-weight` —
it will not normalize a *value* like `format: for-max-weight` (dry-runs 0 files).
Before proposing a merge, run `omf read <prop> --dir <scope>` to see whether the
drift is key-shaped or value-shaped. Value rewrites are manual edits or a future
`omf rewrite`; do not fake them with merge.

Merge semantics: list values union deduped (TARGET first, then SRCs in argument
order); scalars — existing TARGET wins, else first source wins; discards print
as `warn:`. TARGET is created where absent, at the first removed tag's slot.

## Dry first

Any `delete`/`merge` on the corpus: run `--dry`, read the file count and every
warning, then run for real. Completion criterion for the dry step is the count
matching what `omf read` showed for the source key — a dry-run of 0 means you
have a key/value confusion, not an empty corpus.

## Skips are on stderr

Only `key: value` scalars and `key:` + `- item` lists are rewritten. Anything
else skips the file with `skipped: <path> (<line>)` on **stderr** — always check
stderr on `ls`/`crosswalk`/`read` (e.g. `2>&1 | grep skipped`), and never bulk-edit
a skipped shape with sed; extend omf's parser instead.

## After any mutation

1. `grep -rl "<key>" <scope>` → must be 0 for deleted/merged sources.
2. `grep -rn "<key>" --include=*.ts --include=*.tsx` → runtime readers must be none.
   Inline fixture objects in `*.test.*` constructing their own workout items are
   self-contained and safe; leave them unless the test loads real markdown.
3. If a runtime reader exists, run its tests from the owning package:
   `cd apps/playground && bun test <file>` — running `bun test <path>` from the
   repo root misresolves the path filter and silently runs nothing.

Frontmatter changes flow into the app via the seed compiler; regenerate with
`bun run generate:seed` (or the next playground build) before shipping.

## Reading the crosswalk

`omf crosswalk --dir markdown/collections` is the starting point for taxonomy
work: one row per collection directory, columns sorted by corpus-wide usage.
The `template`/`collection`/`category` 1s are each directory's README, not
workout entries. Cells short of the row's file count mark coverage gaps
(e.g. a directory where half the files lack `format`).

## Corpus conventions

- `url` holds the working archive.org link (provenance for imported feeds).
  Do not resurrect `original_url` — dead source links, removed 2026-10.
- `date` is `YYYY-MM-DD`, shared by same-day competition events, sorted by the
  `event-NN` filename suffix.

## Related gap: validating `time` blocks

Do not use `wod parse` exit 0 as content validation for ` ```time ` blocks: the
grammar accepts arbitrary prose (`@@@###` parses clean), and a `(N)` rounds
header at block start is silently dropped (known parser bug in
`@bitcobblers/wod-wiki-lang`). `errors.length === 0` on a standalone block is
vacuous — in-file context (the fence line before the header) is what makes
rounds bind. A trustworthy block validator does not exist yet; see retro notes
in conversation history for the full evidence chain.
