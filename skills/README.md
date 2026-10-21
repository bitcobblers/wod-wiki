# Skills

Agent skills shipped with the WOD Wiki toolchain. One directory per skill:

```
skills/<name>/SKILL.md      # frontmatter: name, description (agentskills.io format)
```

`wod-extraction` is the parsing skill: it teaches an agent to read a workout
description in any form and write correct Whiteboard Script (which metrics a
workout implies, the collectible `?` placeholders, statement structure).

## Install

| Path | Command | Result |
|---|---|---|
| Bundled with the CLI | `wod skills install [--dir <project>] [--force]` | copies every skill into `<project>/.agents/skills/` — no network, no npx |
| Bundled with the CLI | `wod skills list` | what this install ships |
| Any project | `npx skills add bitcobblers/wod-wiki --skill wod-extraction -a claude-code` | per-agent install/link from this repo |
| A project depending on `@bitcobblers/wod-wiki-tools` | `npx skills experimental_sync -y` | links `dist/skills/<name>/SKILL.md` out of the installed package |

`.agents/skills/` is the shared location agent CLIs read; `npx skills` adds
per-agent links (`-a <agent>`) or copies (`--copy`).

The CLI resolves executable symlinks before locating bundled skills, including
installs invoked through `node_modules/.bin/wod` or a global bin directory.

## Editing

`skills/<name>/SKILL.md` is the only source. The playground cannot serve files
from here, so the in-app download button reads a generated copy under
`apps/playground/public/ai-skills/`:

```sh
bun run sync:skills    # regenerate the served copy
bun run check:skills   # fail when it has drifted (CI/build)
```

`scripts/build-cli-assets.ts` runs the sync and stages `skills/` into
`packages/tools/dist/skills/` so the published CLI can install them.
