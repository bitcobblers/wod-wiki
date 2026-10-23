# Glossary

Domain vocabulary for WOD Wiki. Terms are defined here once they are settled;
implementation detail does not belong in this file.

## Tags

**Tag** — A named, reusable piece of configuration that a person creates and
owns. A tag is configured in the database, can be attached to notes, and can be
referenced from a statement inside a workout script. A tag carries
*attachments*; it never carries meaning on its own.

**Tag Type** — The category a tag belongs to, chosen from a vocabulary the
person administers (for example domain, format, equipment, quality, intent).
The type decides what a tag of that kind means and where it is consumed.

**Attachment** — One contribution a tag makes when it is applied: a *metric* it
adds, another *tag* it applies, or a *function* it invokes. A tag's
attachments are its configuration.

## Statements and metrics

**Statement** — A single parsed instruction in a workout script. It carries
metrics and nothing else semantic.

**Metric** — A measured or derived value attached to a statement or a run. A
metric is pure data: it can be stored, queried and aggregated without being
executed.

## Runs

**Run** — One execution of a workout block, producing a *session* when it
completes.

**Session** — The record of a completed (or stopped) run: what was performed,
when, and the metrics it produced.

**Record** — One performed occurrence inside a run — a round, a lap, a single
statement's execution. Records are what per-record aggregation sums over.

## Surface

**Profile** — A named bundle of settings that a runtime consumes to decide how
a run behaves. Profiles are created automatically for the tag kinds that need
them.
