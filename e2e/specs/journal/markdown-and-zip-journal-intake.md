---
domain: journal
specFile: e2e/live-app/markdown-and-zip-journal-intake.e2e.ts
routes: [/load/journal, /load/journal/:date, /load, /day/:date, /journal]
personas: [Athlete]
viewports: [desktop, mobile-375]
priority: P1
---

# JRN-05 — Markdown & Zip Journal Intake

Compressed `?zip=` URL bundles and direct portable Markdown uploads let an Athlete import dated workouts into `notebook/journal` or the Playground scratchpad without auto-starting execution. Dated journal imports resolve on `/day/:date` and `/journal` and remain durable across full browser reloads, while `/load/journal` without a `?zip=` query renders a recoverable upload fallback that fits mobile `375×812` viewports cleanly.

### Scenario 1: Compressed `/load/journal/:date?zip=` and `/load?zip=` links decode Markdown workouts and persist dated Journal Notes across reload

Given a gzip-compressed URL-safe base64 Markdown workout 'JRN05 Harbor Sprint' targeted at `2099-08-19` and a second compressed workout 'JRN05 Scratchpad Tempo' at 1280×900:

1. Athlete opens `/load/journal/2099-08-19?zip=<encoded>` and follows the redirect to the imported Note editor.
2. Athlete opens `/day/2099-08-19`, reloads the browser, and queries `/journal` across August 2099.
3. Athlete opens `/load?zip=<encoded>` with 'JRN05 Scratchpad Tempo'.
- expect: Step 1 decodes the compressed payload, saves a dated Journal Note for `2099-08-19`, and redirects to `/note/:noteId` rendering 'JRN05 Harbor Sprint'.
- expect: Step 2 renders 'JRN05 Harbor Sprint' on `/day/2099-08-19` before and after reload, and lists 'JRN05 Harbor Sprint' in `/journal`.
- expect: Step 3 decodes the bundle into `/playground/:id` displaying 'JRN05 Scratchpad Tempo' without starting a live timer Session, keeping the browser console clean.

### Scenario 2: `/load/journal` missing-zip fallback accepts direct Markdown upload at 375×812 mobile without horizontal overflow and persists across reload

Given a canonical frontmatter Markdown file 'JRN05 Portable Markdown Entry' (`date: 2099-08-20`) viewed at 375×812:

1. Athlete opens `/load/journal` without `?zip=` on mobile 375×812 and uploads `jrn05-entry.md` via `journal-zip-upload`.
2. Athlete queries `/journal` for 'JRN05 Portable Markdown Entry', opens `/note/:noteId`, and reloads the browser.
- expect: Step 1 keeps `/load/journal` mounted with the missing-bundle fallback, zero horizontal overflow at 375×812, and redirects to `/journal` after importing the Markdown file.
- expect: Step 2 lists 'JRN05 Portable Markdown Entry' in `/journal` without horizontal overflow at 375×812 and preserves the Note content on `/note/:noteId` across a full reload with a clean browser console.
