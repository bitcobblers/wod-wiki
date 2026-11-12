---
name: wod-cli
description: 'Drive WOD Wiki locally or against a running wod server using the wod CLI (--json), wod mcp (stdio), or /api/mcp (HTTP). Covers notes, journal scheduling, notebooks, headless workout sessions, WQL queries, catalog management, and exit code 4 confirmation gates.'
license: MIT
---

# WOD CLI & MCP Agent Guide (`wod`)

## Overview

The `wod` CLI exposes every WOD Wiki domain capability with structured `--json` output, deterministic exit codes, and 1:1 parity with the `wod mcp` stdio server and `/api/mcp` HTTP MCP endpoint.

## Quick Diagnostics

```bash
wod doctor --json
wod tools list --json
```

If the local SQLite database is not initialized yet:
```bash
wod init --db ./wodwiki.db
```

To target a running `wod server` instance instead of a local database file, pass `--server <url>` to any noun-verb command:
```bash
wod note list --server http://127.0.0.1:3000 --json
```

---

## Core Workflows

### 1. Parse & Verify Whiteboard Script (Dry Run)
Always validate authored workout syntax before saving when drafting from unstructured text:
```bash
printf "(21-15-9)\n  Thrusters @95lb\n  Pull-ups\n" | wod parse - --no-save --json
```

### 2. Author, Read, Clone, and Delete Notes
```bash
# List notes (optional filters: --notebook, --tag, --search, --limit)
wod note list --limit 20 --json

# Create a note from inline Markdown or stdin
wod note create --title "Fran" --tags "benchmark,girl" --markdown $'# Fran\n\n```time\n(21-15-9)\n  Thrusters @95lb\n  Pull-ups\n```' --json

# Read full note Markdown, blocks, and recent sessions
wod note get <noteId> --json

# Clone a template note onto a calendar date
wod note clone <sourceNoteId> --date 2026-11-11 --notebook journal --json

# Delete a note (Tier 2 — requires --yes <noteId>, exits 4 if omitted)
wod note delete <noteId> --yes <noteId> --json
```

### 3. Schedule & Inspect the Daily Journal
```bash
# Read scheduled workouts + logged sessions for a date (YYYY-MM-DD or today)
wod journal day today --json

# Schedule a new workout or clone a template onto a date
wod journal add today --source-note <templateNoteId> --json
wod journal add 2026-11-12 --title "Morning 5K" --markdown $'```time\n5000m Run :?\n```' --json
```

### 4. Manage Notebooks
```bash
wod notebook list --json
wod notebook save strength-cycle --title "Strength Cycle" --description "8-week squat block" --json
wod notebook delete strength-cycle --yes strength-cycle --json
```

### 5. Execute Headless Sessions & Inspect Ledgers
```bash
# Run a saved note's workout block headlessly and record session + events
wod session run --note <noteId> --json
# Equivalent shorthand on legacy verb:
wod run --note <noteId> --json

# List and inspect recorded sessions
wod session list --limit 10 --json
wod session get <sessionId> --json

# Delete a recorded session (Tier 2 — requires --yes <sessionId>)
wod session delete <sessionId> --yes <sessionId> --json
```

### 6. Catalog & Tag Management
```bash
wod catalog lookup effort --search thruster --json
wod catalog upsert effort "Dumbbell Snatch" --category weightlifting --tags dumbbell --json
wod tag list --type equipment --json
wod tag upsert kettlebell --type equipment --json
```

### 7. Feeds & Portability
```bash
wod feed list --json
wod feed status --json
wod export note <noteId> -o -
```

---

## Exit Codes & Confirmation Safety

| Exit Code | Meaning | Agent Recovery Action |
|---|---|---|
| `0` | Success | Parse JSON stdout (`{ "ok": true, "tool": "...", "data": ... }`). |
| `1` | Runtime / IO / Missing Target | Inspect `error` field and verify IDs via `list` / `lookup`. |
| `2` | Syntax Error (Whiteboard Script or WQL) | Fix script or query syntax using `wod parse --no-save` or `wod query --validate-only`. |
| `3` | Language Pack Load Error | Check `--pack` module specifier. |
| `4` | Tier 2 Confirmation Required | Destructive command lacked `--yes <targetId>`. Confirm intent with the user before re-running with `--yes <targetId>`. |

---

## Starting the Official MCP Server

- **Stdio (Claude Code / Cursor / Codex)**:
  ```bash
  wod mcp --db ./wodwiki.db
  wod mcp --readonly --db ./wodwiki.db
  ```
- **HTTP Streamable MCP**:
  `wod server` automatically mounts `/api/mcp` (`POST`, `GET`, `DELETE`) and `/.well-known/agent-capabilities.json`. Set `WOD_MCP_READONLY=1` or `--mcp-readonly` to expose only Tier 0 read-only tools, and `WOD_MCP_TOKEN=<secret>` to require `Authorization: Bearer <secret>`.
