# Language Correctness Fixes — Design

**Status:** Proposed; no parser, compiler, runtime, or storage changes are implemented by this document.

**Scope:** Whiteboard Language in `@bitcobblers/wod-wiki-lang`, WQL in
`@bitcobblers/wod-wiki-wql`, and their editor, runtime, and documentation consumers.

This design supersedes the correctness recommendations in the
[complexity proposal](./16-language-complexity-review-and-simplification.md), particularly
P1, P2, P5, and W1. The proposal's corpus counts are historical evidence, not a current
coverage guarantee. Related designs:

- [Behavior-preserving cleanup](./18-language-behavior-preserving-cleanup-design.md): removal of redundant implementation only after correctness is established.
- [Language redesign](./19-language-redesign-design.md): deliberate changes to syntax, query populations, and metadata scope.

## 1. Decision and boundaries

Fix wrong interpretation and unsafe execution independently of language simplification.
A bug fix may intentionally change an incorrect result; it must identify that change rather
than claim equivalence with the faulty implementation.

Preserve valid authoring constructs, statement-local Metrics, choice selection, timer
modifiers, and arbitrary valid indentation. This category does **not** remove property
syntax, JSON Metrics, fractions, `@` loads, dialects, query heads, or nested groups.
It does not introduce `emom 7 x 1:00`, a new timer notation, or a two-level nesting limit.

Deliverable boundaries:

| Workstream         | Correction                                                        | Not a prerequisite                        |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------- |
| Statement identity | Unique identities and a well-formed ownership tree                | Moving properties to frontmatter          |
| Protocol selection | Explicit protocol precedence and deterministic implicit selection | Reserving protocol words in a new grammar |
| Diagnostics        | No recovered malformed input silently becoming runnable           | Rejecting every unfamiliar effort name    |
| Shipped examples   | Examples matching supported parser and executor contracts         | Accepting every possible clause order     |

## 2. Evidence and affected seams

The following observations describe the reviewed implementation, not the proposed outcome.

| Evidence                                                                                                                                     | Consequence                                                                                      | Source                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Properties and Blocks receive `id` from their source line                                                                                    | Multiple Statements on one line can collide                                                      | [syntax-parser.ts](../packages/lang/src/parser/syntax-parser.ts)                                                                                                                   |
| Nesting adds a Statement to every ancestor's child list while assigning its last ancestor as parent                                          | Parent pointers and direct-child ownership need reconciliation, not only a self-parent assertion | [applyIndentationNesting](../packages/lang/src/parser/syntax-parser.ts)                                                                                                            |
| `ParseOptions.strict` is declared but not consulted; a returned syntax tree is mapped and reported without errors unless an exception occurs | A successful parse return does not prove complete source acceptance                              | [parseScript.ts](../packages/lang/src/parser/parseScript.ts)                                                                                                                       |
| AMRAP matches duration plus rounds; interval logic also matches a repeating-interval Hint                                                    | An explicit EMOM can match both logic strategies                                                 | [AMRAP](../packages/lang/src/runtime/compiler/strategies/logic/AmrapLogicStrategy.ts), [interval](../packages/lang/src/runtime/compiler/strategies/logic/IntervalLogicStrategy.ts) |
| CrossFit keyword detection uses substring matching                                                                                           | Free text can influence protocol interpretation                                                  | [CrossFitDialect.ts](../packages/lang/src/dialects/CrossFitDialect.ts)                                                                                                             |
| Timer direction and skip requirements live outside the numeric duration value                                                                | Numeric Metric equality misses meaningful differences                                            | [DurationMetric.ts](../packages/lang/src/runtime/compiler/metrics/DurationMetric.ts)                                                                                               |
| Inline objects map `rpe` and `rir` to typed Metrics on their owning Statement                                                                | Moving them to note metadata is not a correctness fix                                            | [semantic-classifier.ts](../packages/lang/src/parser/semantic-classifier.ts)                                                                                                       |

The preceding review executed these examples: `date: 2026-05-26` produced an identity
collision; `emom (7) 1:00` matched both protocol strategies; `emom 7 x 1:00` produced
seven reps rather than seven rounds; `^5:00` and `5:00 :?` produced different Metrics.
Those observations establish regression cases, not a completed implementation test suite.

## 3. Statement identity and ownership

### Contract

1. Every Statement has a unique numeric ID within one parsed Script snapshot. Allocate IDs
   after syntax recovery has finalized the Statement list and before linking ownership.
2. `line` and source offsets remain source-location fields. An ID is never interpreted as a
   line number. Identical source and parse options produce deterministic IDs; edits are not
   required to preserve ordinal IDs across reparses.
3. Each non-root Statement has exactly one immediate parent. A parent's ordered child groups
   contain only its direct children, each exactly once. `+` retains its current grouping order.
4. All references resolve in the same snapshot; no self-edge, cycle, duplicate ownership, or
   dangling child is allowed. `isLeaf` agrees with direct-child groups.
5. Each Statement is reachable from exactly one root. Root order and child-group order follow
   source order; traversing the Script never duplicates a descendant through an ancestor list.

Build ownership with an indentation stack: pop entries at equal or greater indentation,
link to the nearest remaining ancestor, then push the current Statement. Build the ID lookup
once per parse, not once per parent. Validate in linear time over Statements and ownership
edges; do not put repeated whole-tree scans on editor keystrokes.

Changing ancestor-expanded child lists to immediate-child lists is an **intentional correction**.
Before modifying it, inspect every hierarchy consumer for an undocumented dependency on the
expanded representation. Consumers needing descendants must traverse explicitly; no second,
ambiguous meaning of `children` remains.

### Source recovery and identity are separate fixes

Unique IDs prevent collisions but cannot make a partially recovered property semantically valid.
The whole `date: 2026-05-26` span must either become one losslessly represented property or
produce a blocking diagnostic. Never keep the numeric prefix as a valid property and execute
its recovered tail as another exercise.

### Reparse and persistence boundary

Choice selections and editor state must refer to the current snapshot, not assume that an old
ordinal still identifies the same Statement. Reapply an edit-time selection only when the
existing reconciliation mechanism establishes the same owner and alternatives; otherwise
require selection again rather than moving a choice to another exercise.

Stored outputs retain their recorded `sourceStatementId` and original snapshot association.
Do not reparse historical workouts and rewrite old IDs using new ordinals. Audit
[ChoiceResolution](../packages/lang/src/runtime/compiler/metrics/ChoiceResolution.ts) and
[stored output conversion](../packages/lang/src/conversion/toStoredOutputStatement.ts), then
follow their editor/runtime/persistence callers before implementation. If a persisted reference
lacks enough snapshot information for safe reconciliation, report it as unresolved; guessing is
not a migration strategy.

## 4. Protocol precedence without new syntax

### Resolution contract

Resolve protocol semantics for each compiled group before competing logic strategies apply.
Use the existing Metric/Hint channel, not a parallel mutable protocol registry.

| Recognized input situation                                   | Proposed decision                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Explicit `EMOM` with duration and numeric rounds             | Repeating intervals; stated rounds govern completion; AMRAP logic cannot also apply                               |
| Explicit `AMRAP` with duration                               | One time-bound AMRAP; incidental rounds do not switch it to intervals                                             |
| Multiple different explicit protocol directives in one group | Blocking conflict diagnostic identifying both spans                                                               |
| No explicit protocol, numeric rounds + duration + children   | Preserve the implicit interval interpretation declared by `CrossFitDialect`; resolve it once                      |
| No explicit protocol, timer only or rounds only              | Preserve generic timer/rounds behavior                                                                            |
| `TABATA` or `FOR TIME`                                       | Preserve their current supported parameterized behavior; do not invent missing work/rest phases or timer defaults |

Recognize whole protocol words/phrases in supported directive positions, not substrings inside
unrelated effort names. Keep existing prefix/suffix and Action spellings that actually express
protocols; this is not a new group-head-only requirement. Exact exercise names that collide
with directive syntax need an explicit diagnostic when context cannot distinguish intent;
reserved-word/escaping syntax belongs in the redesign.

Keep AMRAP/interval resolution mutually exclusive without relying on registration order of
equal-priority strategies. Do not suppress generic behaviors needed for output, sound,
completion, or Metric promotion. Cleanup may later remove redundant keyword branches once
the same supported inputs emit sufficient Hints.

### Parameters and timer invariants

- `emom (7) 1:00` means seven one-minute intervals, not the fallback ten rounds. Do not reinterpret
  the bare rep in `emom 7 x 1:00` as rounds to make an unsupported spelling appear valid.
- A finite timer target, `forceCountUp`, `required`, and collectible status are independent
  semantics. Preserve `^`, `*`, and `:?`; `5:00 :?` is not a replacement for `^5:00`.
- Multiple primary durations with no defined combination rule produce an ambiguity diagnostic,
  not first-Metric-wins execution. This must not reject a documented, explicitly scoped secondary timer.
- Missing interval parameters retain documented existing defaults. Invalid explicit parameters
  must not fall through to those defaults. Distinguish absent from zero, non-finite, or malformed.

## 5. Diagnostics that do not guess author intent

Collect syntax-recovery and semantic errors at the source-owning layer. Preserve complete
spans so the editor, CLI, and runtime agree about which authored text is invalid. Extend the
existing error contract rather than replacing it with unrelated editor-only validation.

Proposed diagnostic information: stable code, severity, source range, message, and optional
replacement edit. A replacement is offered only when meaning is known. Exact wording is not
a test contract; location, error category, and blocked execution are.

| Input class | Required outcome |
| --- | --- |
| `(25 each leg)` | Do not silently promote 25 to rounds; diagnose ambiguity with count versus annotation alternatives |
| `(3 Rounds)` and `(21-15-9)` | Continue to produce the supported count/rep scheme |
| Partially parsed property, such as the reviewed date line | Consume the complete value or report the complete invalid span; no runnable recovered tail |
| `rpe:8` interpreted as an eight-second timer | Recognize the property context or diagnose it; do not change the intended property into duration |
| Fraction and choice collision such as `185/125 lb` | Preserve source and surface ambiguity where intent is not distinguishable; never auto-rewrite to a guessed load or choice |
| Valid fraction such as `1/4 mile` | Preserve its supported numerical meaning; removal is redesign work |
| Unknown number-plus-word text | Preserve valid reps plus effort; unknown effort names alone are not errors |
| Unit in an unambiguously dimensioned position | Resolve through the active unit catalog or report unsupported unit; no invented conversion |
| Recognized `bw` or climbing-grade text | Preserve contextual-unit requirements and lexical grade precision; no guessed body mass or floating-point reconstruction of a grade label |

A standalone bare `bw` effort suffix is not automatically a load merely because it resembles
a unit. New recognition rules need to disambiguate effort text; unsupported shorthand can be
an advisory rather than a guessed Metric. Likewise, preserve free-text names with spaces and
Unicode. Diagnostics must not be implemented as a blanket ban on unfamiliar text.

Editor recovery may retain partial Statements for highlighting, but a Script with blocking
diagnostics is not runnable. Honor `strict` as rejection of recovered/ambiguous input at
execution/import boundaries; relaxed editor parsing exposes the same diagnostics rather than
reporting unconditional success. Audit the run action, CLI, import, and direct RuntimeFactory
entry points so none execute a partially valid Script by accident.

## 6. Repair shipped examples against current WQL

Correct the examples, not the language, in this category. The canonical existing window
position is on the primary query **before** `where`:

```wql
find:note{tags:pr,source:journal} last 8w where sum:totalVolume{} > 5000
```

Audit [analytics joins](../markdown/canvas/analytics/joins.md), its
[README](../markdown/canvas/analytics/README.md), and syntax guides for the same broken tail.
Parse complete query documents through the document entry point; do not validate assignments,
formulas, dashboard suffixes, or unbound parameters as standalone resolved queries.

A suffix after `where` that the current parser cannot assign safely should receive a useful
error, not be silently attached to the primary or joined query. Supporting extra clause orders
and typed parameter binding is covered by the redesign, not this example repair.

Document `find:` content discovery and `rows:` recorded-result retrieval as different
populations. A successful parse does not prove equivalent results. Similarly, do not replace
fixed `.rollup(1w)` with calendar `by {week}` in examples claiming identical semantics.

## 7. Delivery sequence and ownership

| Step | Affected seam | Completion evidence |
| --- | --- | --- |
| Establish focused reproductions | Existing parser, strategy, and WQL suites | Cases expose the specific collision, overlap, or wrong interpretation |
| Repair identity and tree ownership | Syntax facts, nesting, hierarchy consumers | Unique IDs, direct ownership, one traversal visit per Statement, no replay ID remapping |
| Resolve protocols and preserve timer parameters | Dialect, compiler logic, runtime behaviors | Deterministic explicit/implicit behavior under timer ticks and user-next |
| Propagate diagnostics to execution boundaries | Parser mapping, editor, CLI/import/run entry points | Invalid recovered input remains editable but cannot start execution |
| Correct and exercise shipped examples | Markdown guides and query-document consumers | Examples parse at their intended entry point and return the intended population |

Identity and WQL example repair can proceed independently. Protocol correctness must land
before protocol-channel cleanup. Diagnostic producers and run guards must ship together;
otherwise diagnostics are merely decorative.

## 8. Acceptance and verification

Use the existing [syntax parser](../packages/lang/tests/parser/syntax-parser.test.ts),
[parseScript](../packages/lang/tests/parseScript.test.ts),
[interval](../packages/lang/tests/runtime/IntervalLogicStrategy.test.ts),
[AMRAP](../packages/lang/tests/runtime/AmrapLogicStrategy.test.ts), and
[WQL](../packages/wql/tests/wql.test.ts) suites where their contracts fit. Keep new regression
cases only for plausible failures; do not pin private method calls or behavior class lists.

| Scenario | Observable acceptance |
| --- | --- |
| Property recovery followed by nested workout | Full diagnostic or lossless property; no duplicate ID, cycle, or ghost exercise |
| Three nested groups including a `+` sibling | Original nesting supported; each exercise runs once per prescribed ownership path |
| Explicit seven-round EMOM | Exactly seven intervals; intermediate expiry advances/resets rather than ending as an AMRAP |
| Explicit AMRAP and implicit interval | AMRAP ends at its overall limit; implicit interval obeys finite rounds |
| Required and count-up timers | User-next cannot skip required work; count-up display and completion policy retain their contract |
| Choice selection followed by edit/reparse | Selection never transfers to a different Statement; stored historical output remains unchanged |
| Malformed dimension/property or conflicting protocols | Error points to the source; no runtime or analytics output is produced for a rejected run |
| Valid custom effort and statement JSON Metrics | No false-positive rejection; owner and typed values remain intact |
| WQL join/window guide example | Query parses; controlled notes inside/outside the window and threshold yield the intended matches |

Exercise the actual parser-to-runtime path with a controlled clock, user-next events, and
persisted outputs; strategy predicate checks alone cannot establish runtime correctness.
Compare unaffected outputs using the [cleanup contract](./18-language-behavior-preserving-cleanup-design.md).
Record each intentional correction separately with source, old observation, new expectation,
and reason. An allow-list is not permission to discard unrelated output differences.

## 9. Release and rollback

Ship corrections separately from syntax migrations. Update the source examples and release
notes with changed interpretations and diagnostics. Do not bulk-rewrite user-authored notes.
Rebuild bundled content through its existing seed path after correcting its sources.

Rollback restores the previous implementation, not a lossy rewrite of stored sessions.
Historical recorded outputs remain readable. If a correction needs persisted schema changes,
stop and define the explicit migration before shipping; none is assumed by this design.
