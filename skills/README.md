# Skills

Agent skills shipped with the WOD Wiki toolchain. One directory per skill:

```
skills/<name>/SKILL.md      # frontmatter: name, description (agentskills.io format)
```

- `wod-extraction` — the parsing skill: teaches an agent to read a workout description in any form and write Whiteboard Script (which metrics a workout implies, the collectible `?` placeholders, statement structure).
- `wod-cli` — the CLI & MCP execution skill: teaches an agent to drive `wod --json`, `wod mcp`, and `/api/mcp` across notes, journal scheduling, notebooks, headless sessions, catalog/tags, feeds, and Tier 2 `--yes` confirmation gates.
- `wod-wql` — the WQL query skill: teaches an agent to write, validate, and run WQL `find` and `aggregate` queries across all three surfaces.
- `wod-agent-parity` — the repository feature-parity skill: enforces action parity across `@bitcobblers/wod-wiki-engine/agent`, Playground WebMCP (`@mcp-b/react-webmcp`), `wod server` `/api/mcp`, and `wod --json` whenever new UI or domain features are developed.
- `wod-wiki-testing` — the 3-tier repo testing skill: routes agents across Tier 1 domain scenarios (`@bitcobblers/wod-wiki-core/testing` + `DomainScenarioHarness`), Tier 2 Storybook `parameters.domainState` + `storyActions` and Playground `@/testing/host`, and Tier 3 two-level Markdown specs (`e2e/specs/`) + Playwright `PlaygroundTestActor` (`e2e/fixtures/playgroundActor.ts`), mirrored into `.agents/skills/wod-wiki-testing/`.
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
