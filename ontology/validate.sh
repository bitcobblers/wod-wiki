#!/usr/bin/env bash
# Validate all ontology Turtle/TriG files for syntax and run pySHACL
# (with advanced=True / SPARQL support) against every example in examples/.
#
# Uses `uv run --with rdflib --with pyshacl` so no local venv is required.
#
# Expected:
#   tabata-session    -> Conforms: True
#   notebook          -> Conforms: True
#   unified-qa-bridge -> Conforms: True
#   broken-session    -> Conforms: False (5 violations)
#   broken-notebook   -> Conforms: False (5 violations)
#   broken-bridge     -> Conforms: False (5 violations)

set -euo pipefail
cd "$(dirname "$0")"

uv run --with rdflib --with pyshacl python3 - <<'EOF'
import glob
import os
import sys
from rdflib import Dataset, Graph
from rdflib.namespace import SH
import pyshacl

errors = 0

# 1. Syntax-check all .ttl and .trig files
ttl_files = sorted(glob.glob("**/*.ttl", recursive=True))
trig_files = sorted(glob.glob("**/*.trig", recursive=True))

print(f"Checking syntax for {len(ttl_files)} .ttl and {len(trig_files)} .trig files...")
for path in ttl_files:
    try:
        Graph().parse(path, format="turtle")
    except Exception as exc:
        print(f"SYNTAX ERROR in {path}: {exc}")
        errors += 1

for path in trig_files:
    try:
        Dataset().parse(path, format="trig")
    except Exception as exc:
        print(f"SYNTAX ERROR in {path}: {exc}")
        errors += 1

if errors:
    sys.exit(1)
print("All Turtle and TriG files parsed cleanly.\n")

# 2. Load all SHACL shapes
shapes = Graph()
for path in sorted(glob.glob("shapes/*.ttl")):
    shapes.parse(path, format="turtle")

# 3. Load all schema/ontology modules (excluding shapes/, examples/, generated/, changesets/)
schema = Graph()
schema_dirs = ("patterns/", "lang/", "engine/", "core/", "app/", "wql/", "qa/", "code/", "bridge/")
schema_files = ["ontology.ttl"]
for d in schema_dirs:
    schema_files.extend(sorted(glob.glob(f"{d}*.ttl")))

for path in schema_files:
    if os.path.exists(path):
        schema.parse(path, format="turtle")

# 4. Validate examples
cases = [
    ("tabata-session", True, 0),
    ("notebook", True, 0),
    ("unified-qa-bridge", True, 0),
    ("broken-session", False, 5),
    ("broken-notebook", False, 5),
    ("broken-bridge", False, 5),
]

for name, expected_conforms, expected_min_violations in cases:
    print(f"================ {name} ================")
    data = Graph()
    for triple in schema:
        data.add(triple)
    data.parse(f"examples/{name}.ttl", format="turtle")

    conforms, results_graph, results_text = pyshacl.validate(
        data,
        shacl_graph=shapes,
        advanced=True,
    )
    results = list(results_graph.subjects(predicate=SH.resultSeverity))
    count = len(results)
    print(f"Conforms: {conforms} (violations: {count})")

    if conforms != expected_conforms:
        print(f"FAIL: {name} expected conforms={expected_conforms}, got {conforms}")
        print(results_text)
        errors += 1
    elif not expected_conforms and count < expected_min_violations:
        print(f"FAIL: {name} expected >= {expected_min_violations} violations, got {count}")
        print(results_text)
        errors += 1
    elif not expected_conforms:
        for line in results_text.splitlines():
            if any(k in line for k in ("Focus Node:", "Message:")):
                print(line)
    print()

if errors:
    print(f"Validation FAILED with {errors} error(s).")
    sys.exit(1)

print("All ontology syntax and SHACL validation checks PASSED.")
EOF
