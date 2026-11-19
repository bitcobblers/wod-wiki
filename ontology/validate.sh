#!/usr/bin/env bash
# Two-stage multi-graph RDF/SHACL ontology validator for wod.wiki.
#
# Usage:
#   bash ontology/validate.sh [--require-generated]
#
# Uses `uv run --with rdflib --with pyshacl` so no local venv is required.
#
# Pipeline:
#   0. Syntax-check all ontology/**/*.ttl and ontology/**/*.trig files.
#   1. Stage 1 — System Meta-Ontology & Cross-Graph Dataset Quad Gate:
#      - Validate ontology/system/*.ttl against ontology/shapes/system-shapes.ttl.
#      - Dynamically discover all sys:OntologyGraph and sys:BridgeGraph globs
#        from ontology/system/meta.ttl + ontology/system/registry.ttl
#        (excluding archived ontology/changesets/).
#      - Enforce all 4 sys:OntologyKind rules (Meta, Global, Local, Generated),
#        sys:GraphBridge endpoint contracts, sys:LinkContract inbound contracts
#        under rdfs:subPropertyOf* closure, and live vs historical missing-target
#        policy (sys:allowHistoricalMissingTarget).
#      - Verify negative fixture ontology/examples/broken-cross-graph.trig fails
#        Stage 1 with all 4 violation categories.
#   2. Stage 2 — pySHACL Shape Gate (advanced=True):
#      - Validate positive/negative example fixtures against all shapes/*.ttl.

set -euo pipefail
cd "$(dirname "$0")"

uv run --with rdflib --with pyshacl python3 - "$@" <<'EOF'
import argparse
import glob
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from rdflib import Dataset, Graph, Literal, Namespace, URIRef
from rdflib.namespace import OWL, RDF, RDFS, SH
import pyshacl

SYS = Namespace("https://wod.wiki/ontology/system#")


@dataclass
class NodeKindSpec:
    uri: URIRef
    kind_slug: str
    selector_mode: URIRef
    target_classes: Set[URIRef]


@dataclass
class OntologyGraphSpec:
    uri: URIRef
    graph_iri: URIRef
    slug: str
    ontology_kind: URIRef
    layer_order: int
    schema_globs: List[str]
    generated_globs: List[str]
    node_kinds: List[NodeKindSpec] = field(default_factory=list)


@dataclass
class BridgeGraphSpec:
    uri: URIRef
    graph_iri: URIRef
    slug: str
    schema_globs: List[str]
    generated_globs: List[str]


@dataclass
class GraphBridgeSpec:
    uri: URIRef
    label: str
    predicate: URIRef
    source_graph: URIRef
    target_graph: URIRef
    source_classes: Set[URIRef]
    target_classes: Set[URIRef]
    allow_historical: bool = False


@dataclass
class LinkContractSpec:
    uri: URIRef
    label: str
    predicate: URIRef
    target_graph: URIRef
    target_classes: Set[URIRef]
    allow_historical: bool = False


@dataclass
class SystemRegistry:
    managed_namespaces: List[str]
    external_namespaces: List[str]
    ontology_graphs: Dict[URIRef, OntologyGraphSpec]
    bridge_graphs: Dict[URIRef, BridgeGraphSpec]
    graph_bridges: List[GraphBridgeSpec]
    link_contracts: List[LinkContractSpec]


@dataclass
class QuadViolation:
    category: str
    graph_iri: URIRef
    subject: URIRef
    predicate: URIRef
    obj: URIRef
    message: str


@dataclass
class QuadGateReport:
    violations: List[QuadViolation] = field(default_factory=list)
    historical_drift: List[Tuple[URIRef, URIRef, URIRef, URIRef]] = field(default_factory=list)
    cross_graph_checked: int = 0


def parse_bool(graph: Graph, subject: URIRef, predicate: URIRef) -> bool:
    for val in graph.objects(subject, predicate):
        if isinstance(val, Literal):
            if isinstance(val.toPython(), bool):
                return bool(val.toPython())
            return str(val).lower() == "true"
    return False


def load_system_registry(system_graph: Graph) -> SystemRegistry:
    systems = list(system_graph.subjects(RDF.type, SYS.OntologySystem))
    if not systems:
        raise RuntimeError("No sys:OntologySystem found in ontology/system/*.ttl")
    sys_node = systems[0]

    managed_ns = sorted(str(o) for o in system_graph.objects(sys_node, SYS.managedNamespace))
    external_ns = sorted(str(o) for o in system_graph.objects(sys_node, SYS.externalNamespace))

    ontology_graphs: Dict[URIRef, OntologyGraphSpec] = {}
    for g_node in system_graph.objects(sys_node, SYS.hasOntologyGraph):
        graph_iri = next(system_graph.objects(g_node, SYS.graphIri))
        slug = str(next(system_graph.objects(g_node, SYS.slug)))
        kind = next(system_graph.objects(g_node, SYS.ontologyKind))
        layer_order = int(next(system_graph.objects(g_node, SYS.layerOrder)).toPython())
        schema_globs = sorted(str(x) for x in system_graph.objects(g_node, SYS.schemaGlob))
        generated_globs = sorted(str(x) for x in system_graph.objects(g_node, SYS.generatedGlob))

        node_kinds: List[NodeKindSpec] = []
        for nk in system_graph.objects(g_node, SYS.hasNodeKind):
            kind_slug = str(next(system_graph.objects(nk, SYS.kindSlug)))
            selector_mode = next(system_graph.objects(nk, SYS.selectorMode))
            target_classes = {o for o in system_graph.objects(nk, SYS.targetClass) if isinstance(o, URIRef)}
            node_kinds.append(NodeKindSpec(nk, kind_slug, selector_mode, target_classes))

        ontology_graphs[graph_iri] = OntologyGraphSpec(
            uri=g_node,
            graph_iri=graph_iri,
            slug=slug,
            ontology_kind=kind,
            layer_order=layer_order,
            schema_globs=schema_globs,
            generated_globs=generated_globs,
            node_kinds=node_kinds,
        )

    bridge_graphs: Dict[URIRef, BridgeGraphSpec] = {}
    for bg_node in system_graph.objects(sys_node, SYS.hasBridgeGraph):
        graph_iri = next(system_graph.objects(bg_node, SYS.graphIri))
        slug = str(next(system_graph.objects(bg_node, SYS.slug)))
        schema_globs = sorted(str(x) for x in system_graph.objects(bg_node, SYS.schemaGlob))
        generated_globs = sorted(str(x) for x in system_graph.objects(bg_node, SYS.generatedGlob))
        bridge_graphs[graph_iri] = BridgeGraphSpec(
            uri=bg_node,
            graph_iri=graph_iri,
            slug=slug,
            schema_globs=schema_globs,
            generated_globs=generated_globs,
        )

    graph_bridges: List[GraphBridgeSpec] = []
    for gb_node in system_graph.objects(sys_node, SYS.hasGraphBridge):
        label_node = next(system_graph.objects(gb_node, RDFS.label), gb_node)
        graph_bridges.append(
            GraphBridgeSpec(
                uri=gb_node,
                label=str(label_node),
                predicate=next(system_graph.objects(gb_node, SYS.bridgePredicate)),
                source_graph=next(system_graph.objects(gb_node, SYS.sourceGraph)),
                target_graph=next(system_graph.objects(gb_node, SYS.targetGraph)),
                source_classes={o for o in system_graph.objects(gb_node, SYS.sourceClass) if isinstance(o, URIRef)},
                target_classes={o for o in system_graph.objects(gb_node, SYS.targetClass) if isinstance(o, URIRef)},
                allow_historical=parse_bool(system_graph, gb_node, SYS.allowHistoricalMissingTarget),
            )
        )

    link_contracts: List[LinkContractSpec] = []
    for lc_node in system_graph.objects(sys_node, SYS.hasLinkContract):
        label_node = next(system_graph.objects(lc_node, RDFS.label), lc_node)
        link_contracts.append(
            LinkContractSpec(
                uri=lc_node,
                label=str(label_node),
                predicate=next(system_graph.objects(lc_node, SYS.linkPredicate)),
                target_graph=next(system_graph.objects(lc_node, SYS.targetGraph)),
                target_classes={o for o in system_graph.objects(lc_node, SYS.targetClass) if isinstance(o, URIRef)},
                allow_historical=parse_bool(system_graph, lc_node, SYS.allowHistoricalMissingTarget),
            )
        )

    return SystemRegistry(
        managed_namespaces=managed_ns,
        external_namespaces=external_ns,
        ontology_graphs=ontology_graphs,
        bridge_graphs=bridge_graphs,
        graph_bridges=graph_bridges,
        link_contracts=link_contracts,
    )


def compute_closure(direct_map: Dict[URIRef, Set[URIRef]], start: URIRef) -> Set[URIRef]:
    visited: Set[URIRef] = {start}
    stack = [start]
    while stack:
        cur = stack.pop()
        for parent in direct_map.get(cur, ()):
            if parent not in visited:
                visited.add(parent)
                stack.append(parent)
    return visited


def is_in_namespaces(uri: URIRef, namespaces: List[str]) -> bool:
    s = str(uri)
    return any(s.startswith(ns) for ns in namespaces)


def validate_dataset_quads(
    ds: Dataset,
    registry: SystemRegistry,
    only_quads: Optional[Set[Tuple[URIRef, URIRef, URIRef, URIRef]]] = None,
) -> QuadGateReport:
    report = QuadGateReport()

    # 1. Build RDFS subClassOf / subPropertyOf maps and property metadata across all graphs
    sub_class_direct: Dict[URIRef, Set[URIRef]] = defaultdict(set)
    sub_prop_direct: Dict[URIRef, Set[URIRef]] = defaultdict(set)
    historical_predicates: Set[URIRef] = set()
    prop_ranges: Dict[Tuple[URIRef, URIRef], Set[URIRef]] = defaultdict(set)
    defined_props_in_graph: Dict[URIRef, Set[URIRef]] = defaultdict(set)
    subjects_in_graph: Dict[URIRef, Set[URIRef]] = defaultdict(set)
    direct_types_in_graph: Dict[URIRef, Dict[URIRef, Set[URIRef]]] = defaultdict(lambda: defaultdict(set))

    prop_types = {OWL.ObjectProperty, OWL.AnnotationProperty, OWL.DatatypeProperty, RDF.Property}

    all_graph_iris = list(registry.ontology_graphs.keys()) + list(registry.bridge_graphs.keys())
    for g_iri in all_graph_iris:
        g = ds.graph(g_iri)
        for s, p, o in g:
            if isinstance(s, URIRef):
                subjects_in_graph[g_iri].add(s)
            if p == RDFS.subClassOf and isinstance(s, URIRef) and isinstance(o, URIRef):
                sub_class_direct[s].add(o)
            elif p == RDFS.subPropertyOf and isinstance(s, URIRef) and isinstance(o, URIRef):
                sub_prop_direct[s].add(o)
            elif p == RDF.type and isinstance(s, URIRef) and isinstance(o, URIRef):
                direct_types_in_graph[g_iri][s].add(o)
                if o in prop_types:
                    defined_props_in_graph[g_iri].add(s)
            elif p == RDFS.range and isinstance(s, URIRef) and isinstance(o, URIRef):
                prop_ranges[(g_iri, s)].add(o)
            elif p == SYS.allowHistoricalMissingTarget and isinstance(s, URIRef) and isinstance(o, Literal):
                if str(o).lower() == "true" or o.toPython() is True:
                    historical_predicates.add(s)

    subclass_cache: Dict[URIRef, Set[URIRef]] = {}
    subprop_cache: Dict[URIRef, Set[URIRef]] = {}

    def get_subclass_closure(c: URIRef) -> Set[URIRef]:
        if c not in subclass_cache:
            subclass_cache[c] = compute_closure(sub_class_direct, c)
        return subclass_cache[c]

    def get_subprop_closure(p: URIRef) -> Set[URIRef]:
        if p not in subprop_cache:
            subprop_cache[p] = compute_closure(sub_prop_direct, p)
        return subprop_cache[p]

    def expanded_types_in_graph(g_iri: URIRef, node: URIRef) -> Set[URIRef]:
        result: Set[URIRef] = set()
        for t in direct_types_in_graph[g_iri].get(node, ()):
            result.update(get_subclass_closure(t))
        return result

    # 2. Identify GeneratedOntology node-kind classes and instance IRI prefixes
    generated_graphs = [
        spec for spec in registry.ontology_graphs.values()
        if spec.ontology_kind == SYS.GeneratedOntology
    ]
    generated_kind_classes: Dict[URIRef, URIRef] = {}  # class_iri -> generated graph_iri
    generated_prefixes: List[Tuple[str, URIRef]] = []
    for gen_spec in generated_graphs:
        for nk in gen_spec.node_kinds:
            for tc in nk.target_classes:
                generated_kind_classes[tc] = gen_spec.graph_iri
        for mns in registry.managed_namespaces:
            base = mns if mns.endswith("/") else f"{mns}/"
            generated_prefixes.append((f"{base}{gen_spec.slug}/", gen_spec.graph_iri))

    # Identify MetaOntology predicates (e.g. sys:*) so meta annotations are exempt
    meta_graphs = {
        spec.graph_iri for spec in registry.ontology_graphs.values()
        if spec.ontology_kind == SYS.MetaOntology
    }
    meta_predicates: Set[URIRef] = set()
    for mg in meta_graphs:
        meta_predicates.update(defined_props_in_graph[mg])

    # 3. Compute node ownership (iri -> owning sys:OntologyGraph IRI)
    # Priority:
    #   (a) Emitted inside a GeneratedOntology graph -> owned by that GeneratedOntology.
    #   (b) Typed in an OntologyGraph matching one of that graph's NodeKind target classes
    #       (skipping stubs whose type is exclusively a GeneratedOntology NodeKind class).
    #   (c) Any remaining typed subject in an OntologyGraph (e.g. owl:Ontology, properties,
    #       qa:Step, qa:Beat), again excluding stubs whose type belongs to a GeneratedOntology.
    owner_graph: Dict[URIRef, URIRef] = {}
    ordered_ont_graphs = sorted(registry.ontology_graphs.values(), key=lambda x: x.layer_order)

    # Pass (a): GeneratedOntology emitted nodes
    for gen_spec in generated_graphs:
        g_iri = gen_spec.graph_iri
        for s in direct_types_in_graph[g_iri]:
            owner_graph[s] = g_iri

    # Pass (b): NodeKind-matched nodes in non-Generated graphs
    for spec in ordered_ont_graphs:
        if spec.ontology_kind == SYS.GeneratedOntology:
            continue
        g_iri = spec.graph_iri
        nk_classes: Set[URIRef] = set()
        has_defined_class_selector = False
        for nk in spec.node_kinds:
            nk_classes.update(nk.target_classes)
            if nk.selector_mode == SYS.DefinedClassSelector:
                has_defined_class_selector = True

        for s in direct_types_in_graph[g_iri]:
            if s in owner_graph:
                continue
            types = expanded_types_in_graph(g_iri, s)
            # Do not let a Local graph claim ownership of an inline :code stub
            if types and types.issubset(generated_kind_classes.keys()):
                continue
            if (types & nk_classes) or (has_defined_class_selector and (OWL.Class in types or RDFS.Class in types)):
                owner_graph[s] = g_iri

    # Pass (c): Remaining typed subjects in OntologyGraphs (e.g. owl:Ontology, qa:Step, qa:Beat, properties)
    for spec in ordered_ont_graphs:
        if spec.ontology_kind == SYS.GeneratedOntology:
            continue
        g_iri = spec.graph_iri
        for s in direct_types_in_graph[g_iri]:
            if s in owner_graph:
                continue
            types = expanded_types_in_graph(g_iri, s)
            if types and types.issubset(generated_kind_classes.keys()):
                continue
            owner_graph[s] = g_iri

    def infer_generated_target_graph(uri: URIRef, pred_closure: Set[URIRef]) -> Optional[URIRef]:
        s_uri = str(uri)
        for prefix, gen_iri in generated_prefixes:
            if s_uri.startswith(prefix):
                return gen_iri
        for lc in registry.link_contracts:
            if lc.predicate in pred_closure:
                return lc.target_graph
        return None

    # 4. Walk every quad across all active OntologyGraphs and BridgeGraphs
    for g_iri in all_graph_iris:
        g = ds.graph(g_iri)
        for s, p, o in g:
            if not isinstance(s, URIRef) or not isinstance(o, URIRef):
                continue
            if only_quads is not None and (g_iri, s, p, o) not in only_quads:
                continue
            if is_in_namespaces(p, registry.external_namespaces) or p in meta_predicates:
                continue
            if not is_in_namespaces(s, registry.managed_namespaces) or not is_in_namespaces(o, registry.managed_namespaces):
                continue

            s_graph = owner_graph.get(s)
            o_graph = owner_graph.get(o)

            # Skip meta-ontology triples (e.g. registry declarations)
            if s_graph in meta_graphs or o_graph in meta_graphs:
                continue

            pred_closure = get_subprop_closure(p)

            # If subject isn't owned by any active ontology graph, check if it's an unemitted generated node
            if s_graph is None:
                continue

            # Resolve dangling object target graph if o is not owned by any graph
            target_exists_in_owner = o_graph is not None
            if o_graph is None:
                inferred_gen = infer_generated_target_graph(o, pred_closure)
                if inferred_gen is not None:
                    o_graph = inferred_gen
                else:
                    # Check if p matches a GraphBridge from s_graph -> target_graph (dangling Local target!)
                    matching_bridges = [
                        gb for gb in registry.graph_bridges
                        if gb.source_graph == s_graph and gb.predicate in pred_closure
                    ]
                    if matching_bridges:
                        report.cross_graph_checked += 1
                        gb = matching_bridges[0]
                        if gb.allow_historical or (pred_closure & historical_predicates):
                            report.historical_drift.append((g_iri, s, p, o))
                        else:
                            report.violations.append(
                                QuadViolation(
                                    category="dangling-bridge-target",
                                    graph_iri=g_iri,
                                    subject=s,
                                    predicate=p,
                                    obj=o,
                                    message=(
                                        f"Dangling target <{o}> on bridge predicate <{p}> "
                                        f"(expected node in <{gb.target_graph}>)."
                                    ),
                                )
                            )
                    continue

            # Intra-slice edge: allowed (Stage 2 SHACL validates intra-slice constraints)
            if s_graph == o_graph:
                continue

            report.cross_graph_checked += 1
            o_spec = registry.ontology_graphs[o_graph]
            o_kind = o_spec.ontology_kind

            # Rule A: Target is GlobalOntology (e.g. :patterns)
            if o_kind == SYS.GlobalOntology:
                if p not in defined_props_in_graph[o_graph]:
                    report.violations.append(
                        QuadViolation(
                            category="global-undeclared-predicate",
                            graph_iri=g_iri,
                            subject=s,
                            predicate=p,
                            obj=o,
                            message=(
                                f"Predicate <{p}> targeting Global ontology :{o_spec.slug} "
                                f"is not defined in <{o_graph}>."
                            ),
                        )
                    )
                    continue
                if o not in subjects_in_graph[o_graph]:
                    report.violations.append(
                        QuadViolation(
                            category="global-missing-target",
                            graph_iri=g_iri,
                            subject=s,
                            predicate=p,
                            obj=o,
                            message=f"Target <{o}> does not exist in Global ontology :{o_spec.slug}.",
                        )
                    )
                    continue
                ranges = prop_ranges.get((o_graph, p), set())
                if ranges:
                    o_types = expanded_types_in_graph(o_graph, o)
                    if not (o_types & ranges):
                        report.violations.append(
                            QuadViolation(
                                category="global-range-mismatch",
                                graph_iri=g_iri,
                                subject=s,
                                predicate=p,
                                obj=o,
                                message=(
                                    f"Target <{o}> does not satisfy rdfs:range {sorted(str(r) for r in ranges)} "
                                    f"of Global predicate <{p}>."
                                ),
                            )
                        )
                continue

            # Rule B: Target is GeneratedOntology (e.g. :code)
            if o_kind == SYS.GeneratedOntology:
                matching_lcs = [
                    lc for lc in registry.link_contracts
                    if lc.target_graph == o_graph and lc.predicate in pred_closure
                ]
                if not matching_lcs:
                    report.violations.append(
                        QuadViolation(
                            category="undeclared-code-link",
                            graph_iri=g_iri,
                            subject=s,
                            predicate=p,
                            obj=o,
                            message=(
                                f"Predicate <{p}> targeting Generated ontology :{o_spec.slug} (<{o}>) "
                                f"does not match any sys:LinkContract via rdfs:subPropertyOf*."
                            ),
                        )
                    )
                    continue

                allow_hist = any(lc.allow_historical for lc in matching_lcs) or bool(pred_closure & historical_predicates)

                if target_exists_in_owner:
                    allowed_target_classes: Set[URIRef] = set()
                    for lc in matching_lcs:
                        allowed_target_classes.update(lc.target_classes)
                    o_types = expanded_types_in_graph(o_graph, o)
                    if not (o_types & allowed_target_classes):
                        report.violations.append(
                            QuadViolation(
                                category="code-link-class-mismatch",
                                graph_iri=g_iri,
                                subject=s,
                                predicate=p,
                                obj=o,
                                message=(
                                    f"Target <{o}> in :{o_spec.slug} has types {sorted(str(t) for t in o_types)}, "
                                    f"none matching LinkContract targetClass {sorted(str(c) for c in allowed_target_classes)}."
                                ),
                            )
                        )
                else:
                    # Target is missing from GeneratedOntology
                    if allow_hist:
                        expected_prefixes = [pref for pref, giri in generated_prefixes if giri == o_graph]
                        if not any(str(o).startswith(pref) for pref in expected_prefixes):
                            report.violations.append(
                                QuadViolation(
                                    category="historical-invalid-prefix",
                                    graph_iri=g_iri,
                                    subject=s,
                                    predicate=p,
                                    obj=o,
                                    message=(
                                        f"Historical link target <{o}> on <{p}> does not match "
                                        f":{o_spec.slug} prefix {expected_prefixes}."
                                    ),
                                )
                            )
                        else:
                            report.historical_drift.append((g_iri, s, p, o))
                    else:
                        report.violations.append(
                            QuadViolation(
                                category="live-dangling-code-target",
                                graph_iri=g_iri,
                                subject=s,
                                predicate=p,
                                obj=o,
                                message=(
                                    f"Live dangling target <{o}> on <{p}>: node not emitted in "
                                    f"Generated ontology :{o_spec.slug} (and predicate does not allow historical missing targets)."
                                ),
                            )
                        )
                continue

            # Rule C: Target is LocalOntology (Local <-> Local or Generated -> Local)
            matching_bridges = [
                gb for gb in registry.graph_bridges
                if gb.source_graph == s_graph
                and gb.target_graph == o_graph
                and gb.predicate in pred_closure
            ]
            if not matching_bridges:
                s_slug = registry.ontology_graphs[s_graph].slug
                report.violations.append(
                    QuadViolation(
                        category="unauthorized-local-bridge",
                        graph_iri=g_iri,
                        subject=s,
                        predicate=p,
                        obj=o,
                        message=(
                            f"Unauthorized cross-graph edge :{s_slug} -> :{o_spec.slug} "
                            f"via <{p}> (<{s}> -> <{o}>): no matching sys:GraphBridge declared."
                        ),
                    )
                )
                continue

            s_types = expanded_types_in_graph(s_graph, s)
            o_types = expanded_types_in_graph(o_graph, o)
            endpoint_ok = any(
                (s_types & gb.source_classes) and (o_types & gb.target_classes)
                for gb in matching_bridges
            )
            if not endpoint_ok:
                expected_src = sorted({str(c) for gb in matching_bridges for c in gb.source_classes})
                expected_tgt = sorted({str(c) for gb in matching_bridges for c in gb.target_classes})
                report.violations.append(
                    QuadViolation(
                        category="wrong-slice-endpoint-class",
                        graph_iri=g_iri,
                        subject=s,
                        predicate=p,
                        obj=o,
                        message=(
                            f"Endpoint class mismatch on sys:GraphBridge <{p}>: "
                            f"subject <{s}> types={sorted(str(t) for t in s_types)} (expected {expected_src}), "
                            f"object <{o}> types={sorted(str(t) for t in o_types)} (expected {expected_tgt})."
                        ),
                    )
                )

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Two-stage wod.wiki ontology validator")
    parser.add_argument(
        "--require-generated",
        action="store_true",
        help="Fail if any sys:generatedGlob declared in ontology/system/registry.ttl matches 0 files.",
    )
    args = parser.parse_args()

    errors = 0

    # =========================================================================
    # Step 0: Syntax-check all .ttl and .trig files
    # =========================================================================
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

    # =========================================================================
    # Stage 1: System Meta-Ontology & Cross-Graph Dataset Quad Gate
    # =========================================================================
    print("================ Stage 1: System Meta-Ontology & Dataset Quad Gate ================")
    system_graph = Graph()
    system_files = sorted(glob.glob("system/*.ttl"))
    if not system_files:
        print("FAIL: No ontology/system/*.ttl files found.")
        sys.exit(1)
    for path in system_files:
        system_graph.parse(path, format="turtle")

    system_shapes = Graph()
    system_shapes.parse("shapes/system-shapes.ttl", format="turtle")
    sys_conforms, sys_results_graph, sys_results_text = pyshacl.validate(
        system_graph,
        shacl_graph=system_shapes,
        advanced=True,
    )
    if not sys_conforms:
        print("FAIL: ontology/system/*.ttl failed shapes/system-shapes.ttl validation:")
        print(sys_results_text)
        sys.exit(1)
    print(f"System Meta-Ontology SHACL check PASSED ({len(system_files)} file(s)).")

    registry = load_system_registry(system_graph)
    print(
        f"Loaded registry: {len(registry.ontology_graphs)} OntologyGraph(s), "
        f"{len(registry.bridge_graphs)} BridgeGraph(s), "
        f"{len(registry.graph_bridges)} GraphBridge(s), "
        f"{len(registry.link_contracts)} LinkContract(s)."
    )

    # Load active dataset from registry globs (ontology/changesets/ is naturally excluded)
    live_ds = Dataset()
    schema_ds = Dataset()
    schema_union = Graph()

    missing_generated: List[str] = []

    for spec in sorted(registry.ontology_graphs.values(), key=lambda x: x.layer_order):
        live_g = live_ds.graph(spec.graph_iri)
        schema_g = schema_ds.graph(spec.graph_iri)
        for pattern in spec.schema_globs:
            matches = sorted(glob.glob(pattern, recursive=True))
            if not matches:
                print(f"NOTE: schemaGlob '{pattern}' for slice ':{spec.slug}' matched 0 files.")
            for path in matches:
                live_g.parse(path, format="turtle")
                schema_g.parse(path, format="turtle")
                schema_union.parse(path, format="turtle")
        for pattern in spec.generated_globs:
            matches = sorted(glob.glob(pattern, recursive=True))
            if not matches:
                if args.require_generated:
                    missing_generated.append(f":{spec.slug} ({pattern})")
                else:
                    print(f"NOTE: optional generatedGlob '{pattern}' for slice ':{spec.slug}' not present.")
            for path in matches:
                live_g.parse(path, format="turtle")

    for bg_spec in registry.bridge_graphs.values():
        live_g = live_ds.graph(bg_spec.graph_iri)
        schema_g = schema_ds.graph(bg_spec.graph_iri)
        for pattern in bg_spec.schema_globs:
            matches = sorted(glob.glob(pattern, recursive=True))
            if not matches:
                print(f"NOTE: schemaGlob '{pattern}' for bridge graph ':{bg_spec.slug}' matched 0 files.")
            for path in matches:
                live_g.parse(path, format="turtle")
                schema_g.parse(path, format="turtle")
                schema_union.parse(path, format="turtle")
        for pattern in bg_spec.generated_globs:
            matches = sorted(glob.glob(pattern, recursive=True))
            if not matches:
                if args.require_generated:
                    missing_generated.append(f":{bg_spec.slug} ({pattern})")
                else:
                    print(f"NOTE: optional generatedGlob '{pattern}' for bridge graph ':{bg_spec.slug}' not present.")
            for path in matches:
                live_g.parse(path, format="turtle")

    if missing_generated:
        print("FAIL (--require-generated): Missing required generated ontology files:")
        for item in missing_generated:
            print(f"  - {item}")
        sys.exit(1)

    live_report = validate_dataset_quads(live_ds, registry)
    print(
        f"Live Dataset Quad Gate: checked {live_report.cross_graph_checked} cross-graph edge(s), "
        f"{len(live_report.violations)} violation(s), "
        f"{len(live_report.historical_drift)} non-fatal historical missing-target drift edge(s)."
    )
    if live_report.historical_drift:
        drift_by_pred: Dict[str, int] = defaultdict(int)
        for _, _, p, _ in live_report.historical_drift:
            drift_by_pred[str(p)] += 1
        for pred_str, count in sorted(drift_by_pred.items()):
            print(f"  Historical drift (non-fatal): {count} edge(s) on <{pred_str}>")

    if live_report.violations:
        print("FAIL: Stage 1 Dataset Quad Gate violations in live ontology dataset:")
        by_cat_pred: Dict[Tuple[str, str], int] = defaultdict(int)
        for v in live_report.violations:
            by_cat_pred[(v.category, str(v.predicate))] += 1
        for (cat, pred_str), count in sorted(by_cat_pred.items()):
            print(f"  Summary: [{cat}] {count} edge(s) on <{pred_str}>")
        for v in live_report.violations[:20]:
            print(f"  [{v.category}] {v.message}")
        if len(live_report.violations) > 20:
            print(f"  ... and {len(live_report.violations) - 20} more violation(s).")
        errors += 1

    # Negative cross-graph fixture check: examples/broken-cross-graph.trig
    print("\n================ broken-cross-graph (Stage 1 Negative Fixture) ================")
    fixture_ds = Dataset()
    fixture_ds.parse("examples/broken-cross-graph.trig", format="trig")
    fixture_quads: Set[Tuple[URIRef, URIRef, URIRef, URIRef]] = set()
    for s, p, o, g_ctx in fixture_ds.quads((None, None, None, None)):
        g_id = g_ctx.identifier if hasattr(g_ctx, "identifier") else g_ctx
        if isinstance(g_id, URIRef) and isinstance(s, URIRef) and isinstance(p, URIRef) and isinstance(o, URIRef):
            fixture_quads.add((g_id, s, p, o))

    broken_ds = Dataset()
    for g_iri in list(registry.ontology_graphs.keys()) + list(registry.bridge_graphs.keys()):
        dst_g = broken_ds.graph(g_iri)
        for triple in schema_ds.graph(g_iri):
            dst_g.add(triple)
    broken_ds.parse("examples/broken-cross-graph.trig", format="trig")

    broken_report = validate_dataset_quads(broken_ds, registry, only_quads=fixture_quads)
    expected_categories = {
        "unauthorized-local-bridge",
        "wrong-slice-endpoint-class",
        "undeclared-code-link",
        "live-dangling-code-target",
    }
    found_categories = {v.category for v in broken_report.violations}
    print(
        f"broken-cross-graph violations: {len(broken_report.violations)} "
        f"(categories: {sorted(found_categories)}), "
        f"historical drift: {len(broken_report.historical_drift)}"
    )
    for v in broken_report.violations:
        print(f"  [{v.category}] {v.message}")

    missing_cats = expected_categories - found_categories
    if missing_cats:
        print(f"FAIL: broken-cross-graph.trig did not trigger expected violation categories: {sorted(missing_cats)}")
        errors += 1
    if len(broken_report.violations) != 4:
        print(f"FAIL: broken-cross-graph.trig expected exactly 4 violations, got {len(broken_report.violations)}")
        errors += 1
    if len(broken_report.historical_drift) != 1:
        print(f"FAIL: broken-cross-graph.trig expected exactly 1 non-fatal historical drift edge, got {len(broken_report.historical_drift)}")
        errors += 1
    print()

    if errors:
        print(f"Stage 1 FAILED with {errors} error(s) (continuing to Stage 2 for full diagnostics).\n")
    else:
        print("Stage 1 Dataset Quad Gate PASSED.\n")

    # =========================================================================
    # Stage 2: pySHACL Shape Gate (advanced=True)
    # =========================================================================
    print("================ Stage 2: pySHACL Shape Gate ================")
    shapes = Graph()
    shape_files = sorted(glob.glob("shapes/*.ttl"))
    for path in shape_files:
        shapes.parse(path, format="turtle")
    print(f"Loaded {len(shape_files)} SHACL shape file(s).\n")

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
        for triple in schema_union:
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

    print("All Stage 1 (System & Cross-Graph Quad Gate) and Stage 2 (pySHACL) checks PASSED.")


if __name__ == "__main__":
    main()
EOF
