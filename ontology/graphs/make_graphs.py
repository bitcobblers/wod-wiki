#!/usr/bin/env python3
"""Render graph views of the wod.wiki ontology (repo copy).

Produces, next to this script:
  overview.png   - module map: every ontology file grouped by owning library
  authoring.png  - class graph of the app modules (notes/pages/taxonomy/...)
  shapes.png     - the SHACL shape inventory, parsed from shapes/*.ttl
  tabata-instance.png - the Tabata example data graph (parsed from examples/)

Re-run after editing the .ttl files:
  ~/opt/ontology-venv/bin/python ontology/graphs/make_graphs.py
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from rdflib import Graph, Namespace, RDF
import glob
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WOD = Namespace("https://wod.wiki/ontology#")
SOSA = Namespace("http://www.w3.org/ns/sosa/")
SH = Namespace("http://www.w3.org/ns/shacl#")
BG = "#FAF8F4"
INK = "#1A1A1A"
plt.rcParams["font.family"] = "DejaVu Sans"

LIB_COLORS = {
    "lang": ("#FDEBD0", "#B26A00"),
    "core": ("#DCE9F7", "#33608C"),
    "app": ("#E4F0DC", "#4A7C3A"),
    "wql": ("#F3EFFF", "#6A5ACD"),
}


def canvas(w, h, xlim, ylim, title, subtitle=None):
    fig, ax = plt.subplots(figsize=(w, h), dpi=200)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.axis("off")
    ax.text(xlim[0] + 0.25, ylim[1] - 0.35, title, fontsize=16, fontweight="bold",
            color=INK, va="top")
    if subtitle:
        ax.text(xlim[0] + 0.25, ylim[1] - 0.95, subtitle, fontsize=10.5,
                color="#555555", va="top")
    return fig, ax


def node(ax, x, y, w, h, title, sub=None, face="#DCE9F7", edge="#33608C",
         dashed=False, tsize=11, ssize=8.6):
    ls = (0, (4, 3)) if dashed else "solid"
    ax.add_patch(FancyBboxPatch((x - w / 2, y - h / 2), w, h,
                                boxstyle="round,pad=0.06,rounding_size=0.12",
                                linewidth=1.4, edgecolor=edge, facecolor=face,
                                linestyle=ls, zorder=3))
    if sub:
        ax.text(x, y + h * 0.18, title, fontsize=tsize, fontweight="bold",
                ha="center", va="center", color=INK, zorder=4)
        ax.text(x, y - h * 0.24, sub, fontsize=ssize, ha="center", va="center",
                color="#333333", zorder=4)
    else:
        ax.text(x, y, title, fontsize=tsize, fontweight="bold",
                ha="center", va="center", color=INK, zorder=4)


def edge(ax, p1, p2, label=None, color="#33608C", style="solid", rad=0.0,
         lw=1.3, lsize=8.6, loff=(0, 0.14), shrink=6):
    ls = (0, (4, 3)) if style == "dashed" else "solid"
    ax.add_patch(FancyArrowPatch(p1, p2, arrowstyle="-|>", mutation_scale=13,
                                 linewidth=lw, color=color, linestyle=ls,
                                 connectionstyle=f"arc3,rad={rad}",
                                 shrinkA=shrink, shrinkB=shrink, zorder=2))
    if label:
        mx, my = (p1[0] + p2[0]) / 2 + loff[0], (p1[1] + p2[1]) / 2 + loff[1]
        if rad:
            my += rad * 1.2
        ax.text(mx, my, label, fontsize=lsize, ha="center", va="center",
                color=color, zorder=5,
                bbox=dict(boxstyle="round,pad=0.18", fc=BG, ec="none", alpha=0.9))


def load_all():
    g = Graph()
    for f in sorted(glob.glob(os.path.join(ROOT, "*", "*.ttl"))):
        if "/shapes/" in f or "/examples/" in f or "/graphs/" in f:
            continue
        g.parse(f, format="turtle")
    g.parse(os.path.join(ROOT, "ontology.ttl"), format="turtle")
    return g


# --------------------------------------------------------------- overview ---
def overview_graph():
    fig, ax = canvas(16.5, 11.4, (0, 16.5), (-0.55, 11.4),
                     "wod.wiki ontology — module map by library",
                     "ontology/ mirrors the codebase: each file models the types its library owns · arrows = the load-bearing cross-library links")
    bands = [
        ("lang — packages/lang", 8.55, [
            ("lang/metrics.ttl", "Metric · MetricObservation\n+ QUDT units & allowedUnit"),
            ("lang/efforts.ttl", "Effort (slug, MET, discipline)"),
            ("lang/statements.ttl", "ScriptBlock · Statement · Dialect"),
        ]),
        ("core — packages/core", 5.95, [
            ("core/results.ttl", "Session · EventRecord\nSegmentEvent · SummaryEvent"),
            ("core/fields.ttl", "FieldCatalogEntry · FieldSourceRecord\nFieldValueRecord · CatalogBackfillState"),
        ]),
        ("app — apps/playground", 3.35, [
            ("app/content.ttl", "Note · NoteSegment"),
            ("app/pages.ttl", "Page · PageNote"),
            ("app/taxonomy.ttl", "Tag · TagType · NoteTag"),
            ("app/attachments.ttl", "Attachment"),
            ("app/library.ttl", "BlockIndexRow · Collection · Configuration"),
        ]),
        ("wql — packages/wql", 1.15, [
            ("wql/queries.ttl", "WQLQuery · AnalyticsDataPoint · Dashboard · Widget"),
        ]),
    ]
    xs = {"lang": [2.9, 8.25, 13.6], "core": [3.8, 11.5], "app": [1.85, 4.95, 8.05, 11.15, 14.25],
          "wql": [8.25]}
    widths = {"lang": [5.2, 5.2, 5.2], "core": [6.4, 8.2], "app": [2.9, 2.9, 2.9, 2.9, 3.4],
              "wql": [9.5]}
    for lib, y, files in bands:
        face, ec = LIB_COLORS[lib.split(" ")[0]]
        ax.add_patch(FancyBboxPatch((0.25, y - 1.02), 16.0, 1.78,
                                    boxstyle="round,pad=0.05,rounding_size=0.15",
                                    linewidth=1.0, edgecolor=ec, facecolor=face,
                                    alpha=0.35, zorder=1))
        ax.text(0.5, y + 0.62, lib, fontsize=11.5, fontweight="bold", color=ec, va="center")
        for (fname, classes), x, w in zip(files, xs[lib.split(" ")[0]], widths[lib.split(" ")[0]]):
            node(ax, x, y - 0.18, w, 1.15, fname, classes, face="#FFFFFF", edge=ec,
                 tsize=10 if w > 3.2 else 8.8, ssize=8.2 if w > 3.2 else 7.4)
    # cross-library links: short vertical arrows in the gaps between bands
    edge(ax, (13.6, 7.5), (13.6, 6.78), None, color="#33608C", lw=1.2, shrink=1)
    ax.text(13.6, 7.14, "  engine executes statements → stored as EventRecords", fontsize=8.8,
            color="#33608C", ha="left")
    edge(ax, (2.2, 4.9), (2.2, 4.14), None, color="#4A7C3A", lw=1.2, shrink=1)
    ax.text(2.35, 4.52, "sessions & events join through the Note (aboutNote)", fontsize=8.8,
            color="#4A7C3A", ha="left")
    ax.text(8.25, 2.12, "↑ WQL (below) projects core EventRecords into query facts · field contributions (core/fields) derive from app notes & core sessions",
            fontsize=8.8, color="#6A5ACD", ha="center")
    ax.text(8.25, -0.3, "packages/engine executes lang statements · packages/storage holds the physical stores — neither owns domain types, so neither has a module",
            fontsize=9.0, color="#555555", ha="center")
    fig.savefig(os.path.join(HERE, "overview.png"), facecolor=BG, bbox_inches="tight")
    plt.close(fig)


# -------------------------------------------------------------- authoring ---
def authoring_graph():
    fig, ax = canvas(16.0, 10.4, (0, 16.0), (0, 10.8),
                     "The authoring side — app modules (with core/lang/wql neighbours)",
                     "apps/playground types: content, placement, classification, attachments, library · dashed = defined in another library")
    G = "#E4F0DC"; GE = "#4A7C3A"
    node(ax, 1.9, 8.8, 2.7, 1.0, "wod:Page", "address only: date xor slug", face=G, edge=GE)
    node(ax, 7.9, 8.8, 2.9, 1.0, "wod:ScriptBlock", "lang/statements", face="#FDEBD0", edge="#B26A00", dashed=True)
    node(ax, 13.9, 8.8, 2.9, 1.0, "wod:Configuration", "opaque kv (meta store)", face=G, edge=GE)
    node(ax, 1.9, 6.7, 2.7, 1.0, "wod:PageNote", "placement junction", face=G, edge=GE)
    node(ax, 5.2, 6.7, 3.0, 1.15, "wod:Note", "owning unit of content\nkind · title · provenance", face=G, edge=GE)
    node(ax, 10.3, 6.7, 2.9, 1.0, "wod:Tag", "a SKOS concept", face=G, edge=GE)
    node(ax, 13.9, 6.7, 2.7, 1.0, "wod:TagType", "dynamic dimension", face=G, edge=GE)
    node(ax, 1.9, 4.5, 2.7, 1.0, "wod:Session", "core/results", face="#DCE9F7", edge="#33608C", dashed=True)
    node(ax, 5.2, 4.5, 3.2, 1.15, "wod:NoteSegment", "versioned chunk · key [id, version]\ndataType · isHistory", face=G, edge=GE)
    node(ax, 10.3, 4.5, 2.9, 1.0, "wod:NoteTag", "classification junction", face=G, edge=GE)
    node(ax, 13.9, 4.5, 2.9, 1.0, "wod:Attachment", "blob record · note (+ session)", face=G, edge=GE)
    node(ax, 5.2, 2.0, 3.1, 1.0, "wod:Collection", "DERIVED · corpus grouping", face=G, edge=GE)
    node(ax, 10.3, 2.0, 3.1, 1.0, "wod:BlockIndexRow", "DERIVED search projection", face=G, edge=GE)

    edge(ax, (1.9, 8.25), (1.9, 7.25), "placementPage", color=GE)
    edge(ax, (3.3, 6.7), (3.62, 6.7), "placementNote", color=GE)
    edge(ax, (5.2, 6.07), (5.2, 5.12), "hasSegment", color=GE)
    edge(ax, (6.6, 5.1), (7.55, 8.28), "hasScriptBlock", color="#B26A00", rad=0.25, loff=(0.3, 0.5))
    edge(ax, (6.62, 7.12), (8.8, 6.95), "hasTag (via NoteTag)", color=GE, rad=-0.2, loff=(0, 0.3))
    edge(ax, (11.78, 6.7), (12.5, 6.7), "hasTagType", color=GE)
    edge(ax, (10.3, 6.15), (10.3, 5.05), "noteTagTag", color=GE)
    edge(ax, (8.82, 4.7), (6.3, 6.1), "noteTagNote", color=GE, rad=0.2, loff=(0.1, 0.42))
    edge(ax, (13.4, 3.95), (6.65, 6.08), "attachedToNote", color=GE, rad=0.3, loff=(0.4, -1.6))
    edge(ax, (9.6, 2.52), (6.6, 3.92), "projectsSegment", color=GE, rad=0.15, loff=(0.55, -0.05))
    edge(ax, (9.2, 2.5), (5.6, 6.08), "projectsNote", color=GE, rad=-0.3, loff=(0.35, 0.55))
    ax.text(5.2, 1.22, "seed items materialize as Notes (catalog = collection id)", fontsize=8.6,
            color=GE, ha="center")
    ax.text(1.9, 3.48, "Attachment → attachedToSession\n(when the run is known)", fontsize=8.4,
            color="#33608C", ha="center")
    fig.savefig(os.path.join(HERE, "authoring.png"), facecolor=BG, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------- shapes ---
def shapes_graph():
    g = Graph()
    order = {"lang": 0, "core": 1, "app": 2, "wql": 3}
    files = sorted(glob.glob(os.path.join(ROOT, "shapes", "*.ttl")),
                   key=lambda f: order[os.path.basename(f).split("-")[0]])
    data = []
    for f in files:
        gg = Graph()
        gg.parse(f, format="turtle")
        names = sorted({str(s).split("#")[-1] for s in gg.subjects(RDF.type, SH.NodeShape)})
        data.append((os.path.basename(f), os.path.basename(f).split("-")[0], names))
    fig, ax = canvas(16.0, 9.8, (0, 16.0), (0, 10.2),
                     "SHACL shapes — the contract layer, split by library",
                     "shapes/*.ttl · every shape names its target class · validate with ontology/validate.sh")
    xs = [2.25, 6.15, 10.05, 13.95]
    for (fname, lib, names), x in zip(data, xs):
        face, ec = LIB_COLORS[lib]
        h = 1.25 + 0.44 * len(names)
        y = 8.9 - h / 2
        ax.add_patch(FancyBboxPatch((x - 1.8, y - h / 2), 3.6, h,
                                    boxstyle="round,pad=0.06,rounding_size=0.12",
                                    linewidth=1.4, edgecolor=ec, facecolor=face, zorder=3))
        ax.text(x, y + h / 2 - 0.42, fname, fontsize=10.5, fontweight="bold",
                ha="center", va="center", color=INK, zorder=4)
        ax.text(x, y + h / 2 - 1.05, "\n".join(n.replace("Shape", "") for n in names),
                fontsize=9.3, ha="center", va="top", color="#333333", zorder=4, linespacing=1.65)
    ax.text(8.0, 0.6,
            "Closed where the record is small and fully known (MetricObservation); open where the product must grow\n"
            "(the event stream). Unit compatibility lives in lang-shapes as a SPARQL rule over the allowedUnit table.",
            fontsize=9.5, color="#555555", ha="center")
    fig.savefig(os.path.join(HERE, "shapes.png"), facecolor=BG, bbox_inches="tight")
    plt.close(fig)


# --------------------------------------------------------------- instance ---
def instance_graph():
    g = load_all()
    ex = Graph()
    ex.parse(os.path.join(ROOT, "examples", "tabata-session.ttl"), format="turtle")
    g += ex
    session = next(g.subjects(RDF.type, WOD.Session))
    events = sorted(g.objects(session, WOD.hasEvent),
                    key=lambda e: int(next(g.objects(e, WOD.seqInSession))))
    fig, ax = canvas(17.5, 12.6, (0, 17.5), (0, 13.0),
                     "Example data — the canonical Tabata session as a graph",
                     "examples/tabata-session.ttl parsed and laid out by type · totals are derived by queries, never stored")
    node(ax, 1.9, 6.4, 3.1, 1.5, "wod:Session", "Tabata · 2026-10-20\nstatus: completed", tsize=12)
    node(ax, 1.9, 10.3, 3.1, 1.1, "wod:Effort", 'slug "burpees" · MET 8.0', face="#FDEBD0", edge="#B26A00")
    ys = [10.3 - i * 1.18 for i in range(len(events))]
    for ev, y in zip(events, ys):
        seq = int(next(g.objects(ev, WOD.seqInSession)))
        node(ax, 6.3, y, 2.9, 0.92, f"SegmentEvent R{seq}", "outputType: segment",
             face="#FFF3D6", edge="#B26A00", tsize=10.5, ssize=8.2)
        edge(ax, (3.55, 6.9), (4.8, y + 0.2), None, color="#33608C", lw=0.9, shrink=2)
        edge(ax, (4.9, y + 0.42), (3.3, 9.85), None, color="#D9A441", lw=0.8, shrink=2)
        for obs in g.objects(ev, WOD.hasMetric):
            metric = next(g.objects(obs, SOSA.observedProperty))
            value = next(g.objects(obs, SOSA.hasSimpleResult))
            is_reps = metric == WOD.mReps
            oy = y + (0.3 if is_reps else -0.33)
            node(ax, 10.3, oy, 2.7, 0.56, f"{'reps' if is_reps else 'elapsed'} = {value}",
                 None, face="#EFEFEF", edge="#777777", tsize=9.6)
            edge(ax, (7.8, y), (8.9, oy), None, color="#777777", lw=0.9, shrink=2)
            tgt = (15.6, 9.2) if is_reps else (15.6, 7.6)
            edge(ax, (11.7, oy), (tgt[0] - 1.15, tgt[1]), None, color="#D9A441", lw=0.7, shrink=2)
            uu = (15.6, 4.4) if is_reps else (15.6, 2.9)
            edge(ax, (11.7, oy), (uu[0] - 1.15, uu[1]), None, color="#9DBE8C", lw=0.7, shrink=2)
    node(ax, 15.6, 9.2, 2.3, 0.8, "wod:mReps", face="#FDEBD0", edge="#B26A00")
    node(ax, 15.6, 7.6, 2.3, 0.8, "wod:mElapsed", face="#FDEBD0", edge="#B26A00")
    node(ax, 15.6, 4.4, 2.3, 0.8, "wod:CountUnit", face="#E4F0DC", edge="#4A7C3A")
    node(ax, 15.6, 2.9, 2.3, 0.8, "unit:SEC", face="#E4F0DC", edge="#4A7C3A")
    ax.text(6.3, 11.3, "wod:hasEvent →", fontsize=9.5, color="#33608C", ha="center")
    ax.text(3.6, 11.3, "wod:observesEffort →", fontsize=9.0, color="#B26A00", ha="center")
    ax.text(10.3, 11.3, "wod:hasMetric →", fontsize=9.5, color="#777777", ha="center")
    ax.text(14.2, 11.3, "sosa:observedProperty →", fontsize=9.0, color="#B26A00", ha="center")
    ax.text(13.6, 5.6, "wod:hasUnit →", fontsize=9.0, color="#4A7C3A", ha="center")
    total = sum(int(next(g.objects(o, SOSA.hasSimpleResult)))
                for ev in events for o in g.objects(ev, WOD.hasMetric)
                if next(g.objects(o, SOSA.observedProperty)) == WOD.mReps)
    ax.text(1.9, 0.5, f"Derived check (query-time, not stored): total reps across the session = {total}",
            fontsize=10, color="#555555", ha="left")
    fig.savefig(os.path.join(HERE, "tabata-instance.png"), facecolor=BG, bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    overview_graph()
    authoring_graph()
    shapes_graph()
    instance_graph()
    print("wrote overview.png, authoring.png, shapes.png, tabata-instance.png")
