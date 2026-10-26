# Application Screens & Workflow

The WOD Wiki application follows a continuous loop: **Plan → Track → Analyze**. The same metric flows seamlessly from authoring, to live clock execution, to long-term analytics.

## Home tour

Home uses the same hero, sticky runway and chapter picker at every width. The demo and description divide the measured content area 60/40 after navigation, status and padding. Wide contexts place them side by side; tall contexts stack them. Resizing changes layout without replacing the editor or active run. Reduced-motion keeps the flat card layout.

The home tour uses one scroll track. Swipes and wheel gestures over editors,
clocks, results, analytics and captions move the page by default. Editing or
**Scroll panel** enables a panel's native inner scrolling so overflowing text
and actions remain reachable. **Scroll page**, Escape on the control, focus
leaving the panel, or crossing a section boundary releases it. Inner scroll
boundaries chain back to the page; roomy panels do not consume gestures.

Run the browser regression against a running playground with
`bun scripts/check-home-scrolling.mjs`. Set `BASE_URL` for another server and
`CHROMIUM_PATH` when using a system Chromium. It checks touch gestures at
390×844 and 844×390, desktop wheel gestures at 1440×1000, editor capture,
caption access, analytics yielding and forward/reverse section transitions.

Embedded clocks measure their own column and fit their digits into the remaining clock band. Short hosts put the clock beside 48px controls; the metric tracker yields before Stop, Pause or Next can be clipped. Taller narrow panels stack the clock above its controls. Metric-table controls and recorded-result headers stay fixed while their rows scroll.

The hero uses the editor's Run control. The duplicate hero Run action and four chapter-jump buttons are removed; guide, library and journal links remain.

Hero Run keeps the clock and recorded results in the hero viewport on desktop and phone, including workouts opened through `/load?z=`. Learn the Language examples use the normal fullscreen runner. Stop and Exit report partial results; natural completion shows recorded results in place for hero runs and opens review for fullscreen examples.

The middle tour starts the current workout when its timer stage enters view. Write-section Run and Try it move to that timer. Leaving the timer or arriving at results stops and records the partial once; returning does not rerun the recorded identity.

Home analytics mount only while their stage is active and the section is in view. Dashboard query windows stay fixed until the selected week range changes, so scrolling does not rerun queries against a moving timestamp.

Run the homepage control, saved-duration and dashboard regressions with `bun run test:e2e e2e/live-app/home-tour.e2e.ts --project=journal-chromium`.

---

## 1. PLAN — Author & Structure Work

* **Universal Note Editor (`/note/:noteId`, `/playground/:id`)**:
  - Live CodeMirror 6 markdown editor with syntax highlighting, inline button decorations, and real-time linting.
  - Side companion panel for frontmatter metadata, embed previews (YouTube, Strava), and typed tags typeahead chips.
  - Quick-run launcher for any fenced ` ```time ` workout block.
* **Notebooks Library (`/notebooks`, `/notebook/:slug`)**:
  - Curated workout libraries and historical programs (e.g. CrossFit Girls, Steve Cotter Kettlebell, Swim WODs).
  - Inspect workouts, clone them to your personal journal, or launch directly on the clock.
* **Effort Movement Catalog (`/efforts`, `/effort/:slug`)**:
  - Explore movements with physiological MET multipliers, discipline tags, and intensity tiers.


### Journal notes

Use the `+` in the L1 rail or mobile navigation to create a journal note. Choose a date and start blank, from a stored template, or from a collection or feed item. Creation opens the new note in edit mode. Each note has its own identity and content; notes on the same date share one calendar page at `/day/YYYY-MM-DD`.

Date pages also offer **New note**, including on empty dates. Open a note's title to reach its individual editor. **Note relationships** changes or clears its calendar date, named-page link, or source note without changing its identity. Changing a named-page link does not rename the shared page or move other notes.

**Clone** creates an independent copy on another date or named page and links back to the original note. Editing the copy leaves the original unchanged. Workout results and attachments are not copied. Mobile forms use bottom sheets with scrolling fields and fixed actions; template selection reports an empty state when no templates are stored.

### Note editing

Properties inputs suggest registered property names and typed tag values. General tag inputs suggest tags across types and exclude existing chips. Focus and Ctrl+Space open all available suggestions; typing filters them. Arrow keys select an option, Enter or Tab accepts it, and Escape closes the list. Add tag focuses an existing tag input — `tags` first, then `category` — or opens a draft; a note without a tag property is classified with a `category` property. No empty property is saved until a tag commits. Escape cancels the draft, and duplicate tag values are ignored case-insensitively.

The properties table carries persistent **Key** and **Value** column labels, so a placeholder is never the only cue for a field. Every field has a programmatic name (`Property key: <property>`, `Value for <property>`) plus helper text describing how to commit a value, and the value field is a combobox whose suggestion list is a named listbox. The suggestion list floats over the properties panel, anchored to the field it belongs to: it is bounded to the field width, scrolls internally, and flips above the field rather than covering the metadata actions or the saved-history region.

Edit YAML reveals the note's frontmatter source without changing its contents. Moving the caret into the body restores the Properties widget. Raw YAML supports property scaffolds and tag completion. Accepting a property opens its value list; deleting a filter to empty shows all values again. Tab accepts a highlighted completion rather than indenting. Enter on an empty inline or list value creates a newline regardless of completion latency. Enter with a typed filter accepts the selected suggestion. Completion stops at the closing frontmatter fence.

Entering edit mode focuses the editor. Arrow keys move between visual rows, including wrapped paragraphs; Shift+ArrowUp extends selection by one row, and Home on an empty line stays there.

Workout metrics refresh on the current line as it changes. Movement names are parsed live, not autocompleted. Newly saved notes retain exact source fragments, including blank lines, fence spelling, trailing whitespace, and line endings; older notes retain their legacy reconstruction until saved.

---

## 2. TRACK — Execute on the Clock

* **Fullscreen Timer & Clock (`/run/:runtimeId`)**:
  - JIT-compiled execution runtime managing timer countdowns, round increments, and interval transitions.
  - Sound cues (chimes, 3-2-1 countdowns) and casting integration.
  - Live input for completed reps, load adjustments, and subjective RPE ratings.
* **Stream Capture**:
  - Every completed segment emits raw output statements streaming directly into IndexedDB `EventRecord` rows.

---

## 3. ANALYZE — Review & Query

* **Session Detail (`/session/:sessionId`)**:
  - Breakdown of round splits, completed reps, and total elapsed duration.
  - Tabular output statement view and derived session load.
* **Journal History (`/journal`, `/day/:date`)**:
  - Calendar stream grouping workouts onto daily date pages (`/day/YYYY-MM-DD`).
  - Powered by the `page_notes` junction table.
* **Composed Dashboards (`/dashboards`, `/dashboard/:slug`)**:
  - Visual charts (timeseries, bar, toplist, summary cards) powered by embedded WQL queries.
  - Real-time filtering by effort, discipline, or custom tag dimensions.
* **Tags (`/tags`)**:
  - The tag catalogue: every tag a script can point at with `#slug`.
  - Per tag: the name (the slug), the kind, and what it contributes — a metric with a typed value and a unit, another tag, or a function.
  - Filterable by name and kind.
* **Settings (`/settings`, `/settings/tags`)**:
  - Appearance and audio preferences.
  - Registered tag **types** CRUD — the kinds of tag that exist. The tags themselves are authored on `/tags`.

## WQL editing

Find target (`note`, `block`, `effort`, `session`, `segment`, `event`), query kind (Find or Measure), and Where stored (`source:`) are separate choices. Changing storage scope does not change the target. Settings favorites prioritize choices; they do not define valid WQL.

The draft string is authoritative. Chips project its AST; editing one clause preserves unrelated filters, grouping, units, time windows, joins and presentation pipes. Edit WQL retains exact invalid or unsupported text. Invalid drafts cannot execute or save. Kind/target changes that discard incompatible clauses require confirmation.

- Add condition and chip editing use the same searchable value picker. Opening it does not insert an empty clause.
- Arrow keys select an active option; Enter chooses it or the exact typed value. Ctrl/Command+Enter submits the current valid draft. Tab and Shift+Tab move native focus; Escape closes one editor level and returns focus to its opener.
- Empty-input Backspace focuses the preceding chip. Delete/Backspace on that chip removes it; Undo removal restores the previous query.
- Group By is an ordered multi-selection. Move up/down controls change precedence; Done ends field editing without saving a host dialog.
- When WQL supplies grouping, View Settings names the controlling dimensions and offers Edit query. Its saved card-arrangement fallback becomes available again after WQL grouping is removed.

Inline stream edits update the query URL in one scratch history entry per editing spell; subsequent keystrokes replace that entry until an idle checkpoint. Back/Forward restores the explicit URL query without replaying pending text. Stream query dialogs keep a local draft until Apply; Cancel leaves the page unchanged. Explorer Run executes the latest draft, while Save chooses a destination. Widget and note-block editors write only through their final save action; a rejected write leaves the dialog open with its draft and error. Settings saves browser-local defaults and favorites, not the active page query; an explicit URL query takes precedence.

Mobile query dialogs use the existing sheet host: non-input initial focus, explicit Search, large selection targets, and final actions outside the scrolling body. Browser emulation checks layout and focus; it does not establish real iOS/Android keyboard or screen-reader behavior.
