# ADR 0007: Python/uv (`rdflib` + `pyshacl`) Stack Exception for Ontology Validation

**Status:** Accepted
**Date:** 2026-11-14

## Context

WOD Wiki is a Bun/TypeScript monorepo (`AGENTS.md` mandates `bun` as the exclusive JavaScript/TypeScript package manager). However, the unified 5-named-graph RDF dataset (`ontology/dataset.trig`, Turtle modules, and SHACL/SHACL-SPARQL contracts in `ontology/shapes/*.ttl`) requires:

1. Full Turtle 1.1 and TriG 1.1 parsing and named-graph dataset validation.
2. Full W3C SHACL Core **and** SHACL-SPARQL (`sh:sparql` / `sh:SPARQLConstraintComponent` with `advanced=True`) execution for semantic constraints such as unit-compatibility checking (`wod:MetricObservationShape` verifying `wod:hasUnit` against `wod:allowedUnit`).
3. Referential integrity checking across `:domain`, `:qa`, `:code`, and `:bridge` graphs.

No mature, zero-config Bun/TypeScript library provides compliant SHACL-SPARQL evaluation equivalent to `pyshacl` + `rdflib`, and requiring a pre-installed local Python virtualenv (`~/opt/ontology-venv`) broke reproducibility across developer machines and CI runners.

## Decision

1. **Explicit Stack Exception**: Accept Python invoked ephemerally via `uv run --with rdflib --with pyshacl` inside `ontology/validate.sh` as a documented, scoped exception to the Bun-only runtime stack, strictly limited to offline ontology/SHACL validation and CI gates.
2. **No Checked-in Python Project or Venv**: Do not add `pyproject.toml`, `requirements.txt`, or virtualenv directories to the repository; `uv` resolves `rdflib` and `pyshacl` on demand.
3. **TypeScript for All Codebase Tooling**: All repository-facing ontology scripts (`scripts/ontology/index-code-graph.ts`, `scripts/ontology/query.ts`, `scripts/ontology/codegen.ts`, `scripts/ontology/changeset.ts`, `scripts/check-test-ids.ts`) remain pure Bun/TypeScript.

## Consequences

- `ontology/validate.sh` runs identically on developer machines and GitHub Actions CI with only `uv` installed.
- Runtime, Playground, Storybook, CLI, and server packages remain 100% Bun/TypeScript with zero Python runtime dependencies.
