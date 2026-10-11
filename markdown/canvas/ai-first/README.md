---
search: hidden
template: canvas
route: /ai-first
type: syntax
---

# AI-First Workouts {sticky dark full-bleed}

Text-based workout scripts are the perfect interface for AI. They're compact, unambiguous, and easy to generate, edit, and share.

```view
name:    ai-demo
state:   note
source:  wods/examples/home/welcome-1.md
runtime: in-memory
launch:  host
align:   right
width:   50%
```

## Why Text Wins {sticky #why-text theme:violet}

- **Portable** — copy-paste into any chat, note, or document
- **Versionable** — diff-friendly, git-friendly, review-friendly
- **Composable** — LLMs can generate, remix, and extend scripts without special tools
- **Executable** — the same text that reads well to humans runs live in the playground

```command
target: ai-demo
pipeline:
  - set-source: wods/examples/home/welcome-1.md
  - set-state: note
```

```button
label:  Try It →
target: ai-demo
pipeline:
  - set-state: track
```

## Parse Skill {sticky #parse-skill theme:emerald}

The canonical WOD Wiki parse skill defines the grammar, examples, and constraints the parser understands. Point any AI assistant at this file and it can generate valid workout scripts on the first try.

```button
label:  Open Parse Skill →
target: ai-demo
pipeline:
  - navigate: /ai-skills/parse.md
```

## Shared AI Apps {sticky #shared-apps theme:sky}

Collaborative workspaces and custom GPTs pre-loaded with the WOD Wiki syntax.

### Gemini

A shared Gemini Gem with the parse skill built in.

```button
label:  Open Gemini Gem →
target: ai-demo
pipeline:
  - navigate: https://gemini.google.com/gem/1sCEfdhn2Bwg53DS6GvPgcFTRrUrJRdV-?usp=sharing
```

### ChatGPT

Custom GPT coming soon.

```button
label:  ChatGPT (coming soon)
target: ai-demo
pipeline:
  - set-state: note
```

### Copilot

Microsoft Copilot integration coming soon.

```button
label:  Copilot (coming soon)
target: ai-demo
pipeline:
  - set-state: note
```

### Claude

Claude project coming soon.

```button
label:  Claude (coming soon)
target: ai-demo
pipeline:
  - set-state: note
```

## Start Building {sticky full-bleed dark}

Open a new note and generate a workout with any AI assistant.

```button
label:  New Workout Note →
target: ai-demo
pipeline:
  - set-source: query:new
  - set-state: note
  - launch: dialog
```

```button
label:  ← Back to Home
target: ai-demo
pipeline:
  - navigate: /
```
