---
domain: properties
specFile: e2e/live-app/efforts-catalog-and-alias-lifecycle.e2e.ts
routes: [/efforts, /effort/:slug, /effort/new]
personas: [Athlete, Coach]
viewports: [desktop]
priority: P1
---

# PRP-01 — Efforts Catalog & Alias Lifecycle

`Effort` definitions on `/efforts` and `/effort/:slug` filter deterministically across text, discipline, and origin WQL predicates, surface frontmatter `Metric`s, alias chips, and authored Markdown prose inside the aligned `Note` editor shell, clone or auto-clone on inline edit without mutating bundled definitions, and link unknown movement slugs as durable aliases that subsequently resolve to the target `Effort`.

### Scenario 1: Athlete filters the Efforts stream across text, discipline, and origin predicates and opens an Effort detail

Given bundled Effort fixtures are seeded in the workspace:

1. Athlete opens '/efforts' and inspects the WQL query bar and stream rows.
2. Athlete queries ':effort{text:burpee}', ':effort{discipline:kettlebell}', ':effort{text:xyznonexistent}', and ':effort{origin:bundled}' in sequence.
3. Athlete clicks the 'Burpee' row in the stream.
- expect: Step 1 displays the WQL query bar, '+ Add' button, and bundled Effort rows including 'Burpee' and 'Rowing'.
- expect: Step 2 narrows to the 'Burpee' family while excluding 'Rowing', narrows kettlebell discipline to 'Kettlebell Swing' while excluding 'Burpee', renders the 'No efforts match' empty state for unmatched text, and restores bundled rows on ':effort{origin:bundled}'.
- expect: Step 3 navigates to '/effort/burpee' with 'Burpee' rendered as the detail heading and a clean browser console.

### Scenario 2: Bundled Effort detail renders frontmatter Metrics, alias chips, and seeded Markdown prose

Given bundled Effort fixtures with frontmatter Metrics, aliases, and Markdown prose are seeded:

1. Athlete opens '/effort/rowing' and expands frontmatter property details.
2. Athlete opens '/effort/burpee' and inspects the Note editor body.
- expect: Step 1 displays 'Rowing' with source badge 'Bundled', 'Clone' visible and legacy 'Edit' absent, frontmatter 'slug' = 'rowing', 'metrics.met' = 7, 'intensityTier' = 'high', and resolved alias chips ('row', 'rower', 'concept2 row') linking to the Rowing page.
- expect: Step 2 renders the seeded Markdown prose ('Burpees are a full-body conditioning effort that combine a squat, plank, and jump.') inside the Note editor with a clean browser console.

### Scenario 3: Explicit Clone and inline edit on bundled Efforts persist isolated Custom copies across reload without mutating bundled definitions

Given bundled 'burpee' and 'thruster' Effort definitions are seeded:

1. Athlete opens '/effort/burpee', clicks 'Clone', updates frontmatter 'label' to 'Burpee training notes', reloads, and re-checks '/effort/burpee'.
2. Athlete opens '/effort/thruster', expands property details, updates 'metrics.met' from '8' to '9', reloads '/effort/thruster-custom', and re-checks '/effort/thruster'.
3. Athlete queries '/efforts' with ':effort{origin:user}'.
- expect: Step 1 navigates to '/effort/burpee-custom' ('Custom'), autosaves 'Burpee training notes' across reload with Markdown prose preserved, and leaves '/effort/burpee' untouched ('Bundled').
- expect: Step 2 auto-clones without save-conflict errors to '/effort/thruster-custom' ('Custom') with 'metrics.met' = '9' persisted across reload while '/effort/thruster' stays 'Bundled' at '8'.
- expect: Step 3 lists the Custom Efforts under ':effort{origin:user}' while excluding purely bundled rows like 'Rowing', and the browser console stays clean.

### Scenario 4: Athlete creates a Custom Effort from not-found create mode and links an unknown Effort slug as a resolving alias

Given a hydrated workspace:

1. Coach opens an unknown '/effort/:slug' route, clicks 'Create Effort Page', switches to 'Edit YAML', pastes a Custom Effort Note ('Sled Drive QA'), clicks 'Create Effort', and reloads the resulting detail route.
2. Coach opens '/efforts', navigates in-app to a second unknown '/effort/:slug' route, clicks 'Link as Alias', selects 'Sled Drive QA', confirms the link, and then reopens the alias route from a fresh navigation.
- expect: Step 1 transitions from 'effort-not-found' to create mode, commits the Custom Effort Note, navigates to '/effort/:slug' with source 'Custom', and preserves its authored body across reload.
- expect: Step 2 links the unknown slug as an alias of 'Sled Drive QA', navigates to its detail page, and resolves subsequent full navigations to the alias URL directly to 'Sled Drive QA' without errors.

### Scenario 5: Athlete deletes a Custom Effort from the detail surface without affecting bundled Efforts

Given a hydrated workspace with bundled Effort definitions:

1. Athlete creates a Custom Effort ('Delete Me QA') via '/effort/new?mode=create' and confirms it appears under ':effort{origin:user}' on '/efforts'.
2. Athlete opens '/effort/burpee', verifies 'Delete' is hidden on bundled Effort definitions, then reopens the Custom Effort detail page, clicks 'Delete', and confirms deletion.
3. Athlete queries ':effort{origin:user}' on '/efforts', reloads the browser, re-queries ':effort{origin:user}' and ':effort{origin:bundled}', and visits the deleted '/effort/:slug' route.
- expect: Step 1 persists 'Delete Me QA' as a Custom Effort visible under ':effort{origin:user}'.
- expect: Step 2 hides 'Delete' on bundled 'Burpee', exposes 'effort-detail-delete-btn' on 'Delete Me QA', removes the Custom Effort Note on confirmation, and returns to '/efforts'.
- expect: Step 3 excludes 'Delete Me QA' from ':effort{origin:user}' before and after reload, renders 'effort-not-found' on the deleted '/effort/:slug' route, and keeps bundled Efforts ('Burpee', 'Rowing') intact with a clean browser console.
