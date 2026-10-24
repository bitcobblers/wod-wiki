#!/usr/bin/env bash
# Validate every ontology example against every SHACL shape.
# Each example is merged with ALL ontology modules first (validators need
# the vocabulary, unit types, and subclass triples in the data graph),
# then checked with pySHACL against all shapes in shapes/.
#
# Expected: tabata-session  -> Conforms: True
#           notebook        -> Conforms: True
#           broken-session  -> Conforms: False (5 violations)
#           broken-notebook -> Conforms: False (5 violations)
set -u
cd "$(dirname "$0")"
PY=~/opt/ontology-venv/bin/python
SHACL=~/opt/ontology-venv/bin/pyshacl
TMP=$(mktemp -d)
export TMP

$PY - <<'EOF'
from rdflib import Graph
import glob, os
shapes = Graph()
for f in sorted(glob.glob("shapes/*.ttl")):
    shapes.parse(f, format="turtle")
shapes.serialize(os.path.join(os.environ["TMP"], "all-shapes.ttl"), format="turtle")
for name in ["tabata-session", "notebook", "broken-session", "broken-notebook"]:
    g = Graph()
    for f in sorted(glob.glob("*/*.ttl")) + ["ontology.ttl"]:
        if f.startswith(("shapes/", "examples/")):
            continue
        g.parse(f, format="turtle")
    g.parse(f"examples/{name}.ttl", format="turtle")
    g.serialize(os.path.join(os.environ["TMP"], f"{name}-merged.ttl"), format="turtle")
EOF

for name in tabata-session notebook broken-session broken-notebook; do
  echo "================ $name ================"
  $SHACL -s "$TMP/all-shapes.ttl" -f human "$TMP/$name-merged.ttl" 2>&1 \
    | grep -E "Conforms|Focus Node|Message:" | head -30
  echo
done
rm -rf "$TMP"
