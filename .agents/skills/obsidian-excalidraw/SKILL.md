---
name: obsidian-excalidraw
description: Creates and edits Obsidian-flavored Excalidraw diagram documents (.excalidraw.md) combining visual UI/system wireframes with rich Markdown architectural documentation. Use when asked to generate Excalidraw diagrams, visual wireframes, or layout architecture in Obsidian vaults.
allowed-tools: Read Write Edit Bash
---

# Obsidian Excalidraw Skill

This skill defines conventions and generation standards for Obsidian Excalidraw documents (`.excalidraw.md`), which blend Obsidian-native Markdown documentation with embedded Excalidraw visual canvas payloads.

## 1. Document Structure

Obsidian Excalidraw files must follow the dual-layer markdown format expected by the `obsidian-excalidraw-plugin`:

```markdown
---
excalidraw-plugin: parsed
tags: [excalidraw, architecture, layout]
excalidraw-default-mode: view
excalidraw-export-dark: true
---
# Architectural Documentation & Specifications
... markdown sections detailing guidelines, responsive layouts, data flows ...

# Text Elements
^text-elements

# Drawing
```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [...],
  "appState": {
    "gridSize": null,
    "viewBackgroundColor": "#18181b"
  },
  "files": {}
}
```
%%
```

## 2. Frontmatter Conventions

- `excalidraw-plugin: parsed` — Mandatory plugin identifier.
- `excalidraw-default-mode: view` — Starts in view mode so the diagram is immediately legible.
- `excalidraw-export-dark: true` — Sets dark mode rendering matching the application's dark palette.
- `tags: [...]` — Categorization tags (e.g. `[excalidraw, abstract-view, responsive-design]`).

## 3. Visual Wireframing Standard for App Layouts

When diagramming abstract views and responsive designs:

1. **Side-by-Side Comparison**:
   - Left side: **Desktop Wireframe (≥1024px)** with L1 icon rail (56px), optional L2 sidebar (240px), Sticky Header with inline actions, main content runway, and secondary TOC rail.
   - Right side: **Mobile Wireframe (<1024px)** with App Navbar, breadcrumb title, mobile-adapted body runway, fixed Thumb Dock (FAB stack), and optional Thumb Footer (WQL Composer).
2. **Relocation & Data Flow Arrows**:
   - Use dashed arrows (`strokeStyle: "dashed"`, `strokeColor: "#f59e0b"` or `"#38bdf8"`) connecting desktop controls to their mobile counterparts (e.g. Header primary action -> Mobile Dock FAB; Header query bar -> Mobile Thumb Footer).
3. **Color Palette Hierarchy (Dark Mode)**:
   - Frame / Canvas Background: `#0f172a` or `#18181b`
   - Window / Container Shells: `#1e293b` with `#334155` border
   - Header & Nav Rails: `#334155` with `#475569` border
   - Interactive Controls / Primary Affordances: `#3b82f6` (blue) or `#10b981` (green)
   - Accent / Highlighted States: `#f59e0b` (amber) or `#a855f7` (purple)
   - Labels / Text: `#f8fafc` (high contrast white) and `#94a3b8` (subdued gray)

## 4. Minimum Excalidraw Element Schema

Every element in the `elements` array must contain:
- `id`: unique alphanumeric string (e.g. `"el_desk_shell"`)
- `type`: `"rectangle"` | `"text"` | `"arrow"` | `"line"`
- `x`, `y`, `width`, `height`: integer coordinates
- `strokeColor`: hex color string
- `backgroundColor`: hex color string or `"transparent"`
- `fillStyle`: `"solid"` | `"hachure"`
- `strokeWidth`: `1` | `2`
- `strokeStyle`: `"solid"` | `"dashed"`
- `roughness`: `0` (clean lines) | `1` (sketchy)
- `opacity`: `100`
- `groupIds`: `[]`
- `roundness`: `{ "type": 3 }` (rounded corners) or `null`
- `seed`: integer
- `version`: `1`
- `versionNonce`: `1`
- `isDeleted`: `false`
- `boundElements`: `null`
- `updated`: `1`
- `link`: `null`
- `locked`: `false`

Text elements additionally require:
- `text`: display text string
- `fontSize`: integer (`12`, `14`, `16`, `20`, `24`)
- `fontFamily`: `2` (Clean sans-serif) or `3` (Monospace)
- `textAlign`: `"left"` | `"center"` | `"right"`
- `verticalAlign`: `"top"` | `"middle"` | `"bottom"`
- `baseline`: integer
- `containerId`: `null`
- `originalText`: identical to `text`
- `lineHeight`: `1.25`

Arrow elements require:
- `points`: array of `[dx, dy]` coordinate tuples, starting at `[0, 0]`
- `endArrowhead`: `"arrow"`
