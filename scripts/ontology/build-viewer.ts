#!/usr/bin/env bun
/**
 * Layered Ontology Graph Walker — Static HTML Compiler & Viewer Builder
 *
 * Compiles `window.__ONTOLOGY_BUNDLE__` purely from `scripts/ontology/system-loader.ts`
 * (zero hardcoded WOD Wiki slice or kind branches, byte-deterministic output) and emits
 * a self-contained, zero-dependency, `file://` + S3 static HTML report implementing
 * Variant B (Spatial Walked DAG Canvas + Minimap) + Meta Constellation over the pure
 * `WalkerEngine` reducer.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  type EdgeCategory,
  type LoadDatasetOptions,
  type MaterializedNode,
  type MissingGeneratedGlob,
  MultiGraphStore,
  OWL,
  type OntologyKind,
  RDF,
  RDFS,
  type RegisteredDataset,
  SH_NS,
  SYS,
  type SelectorMode,
  loadRegisteredDataset,
} from './system-loader';

const REPO_ROOT = path.resolve(import.meta.dir, '../..');
const DEFAULT_OUT_HTML = path.join(REPO_ROOT, 'ontology/generated/explorer.html');

export const READABLE_HASH_MAX_LEN = 320;

const SH = {
  NodeShape: `${SH_NS}NodeShape`,
  targetClass: `${SH_NS}targetClass`,
  property: `${SH_NS}property`,
  path: `${SH_NS}path`,
  minCount: `${SH_NS}minCount`,
  maxCount: `${SH_NS}maxCount`,
  datatype: `${SH_NS}datatype`,
  class: `${SH_NS}class`,
  in: `${SH_NS}in`,
  pattern: `${SH_NS}pattern`,
  message: `${SH_NS}message`,
  minInclusive: `${SH_NS}minInclusive`,
  maxInclusive: `${SH_NS}maxInclusive`,
} as const;

// ── Public Bundle Interfaces ───────────────────────────────────────────────

export interface DrawerRow {
  readonly label: string;
  readonly badge?: string;
  readonly detail?: string;
  readonly meta?: string;
  readonly jumpNodeIds?: string[];
}

export interface DrawerSection {
  readonly id: string;
  readonly title: string;
  readonly kind: 'chain' | 'constraints' | 'list';
  readonly items: DrawerRow[];
}

export interface ExternalLink {
  readonly kind: 'vscode' | 'playground' | 'storybook' | 'external';
  readonly label: string;
  readonly target: string;
  readonly line?: number;
}

export interface BundleSliceStats {
  readonly nodeCount: number;
  readonly kindCount: number;
  readonly outgoingEdges: number;
  readonly incomingEdges: number;
}

export interface BundleSlice {
  readonly slug: string;
  readonly graphIri: string;
  readonly ontologyKind: OntologyKind;
  readonly label: string;
  readonly comment: string;
  readonly layerOrder: number;
  readonly accentToken: string;
  readonly modules: string[];
  readonly stats: BundleSliceStats;
}

export interface BundleNodeKind {
  readonly kindSlug: string;
  readonly sliceIdx: number;
  readonly badgeLabel: string;
  readonly selectorMode: SelectorMode;
}

export interface BundlePredicate {
  readonly curie: string;
  readonly iri: string;
  readonly forwardLabel: string;
  readonly inverseLabel: string;
  readonly navPriority: number;
  readonly edgeCategory: EdgeCategory;
}

export type GhostReason = 'historical-missing-target' | 'stale-deep-link';

export interface BundleNode {
  readonly id: string;
  readonly iri: string;
  readonly sliceIdx: number;
  readonly kindIdx: number;
  readonly label: string;
  readonly summary: string;
  readonly props: Array<[string, string]>;
  readonly drawerSections: DrawerSection[];
  readonly links: ExternalLink[];
  readonly ghost?: boolean;
  readonly ghostReason?: GhostReason;
}

export type BundleEdge = [sourceNodeIdx: number, predIdx: number, targetNodeIdx: number];

export interface BundleMetaEdge {
  readonly sourceSliceIdx: number;
  readonly targetSliceIdx: number;
  readonly kind: 'localBridge' | 'global' | 'generatedLink';
  readonly predicateCurie: string;
  readonly forwardLabel: string;
  readonly inverseLabel: string;
  readonly navPriority: number;
  readonly assertionCount: number;
  readonly sourceClasses: string[];
  readonly targetClasses: string[];
}

export interface HistoricalMissingTargetRecord {
  readonly sourceId: string;
  readonly predicateCurie: string;
  readonly targetIri: string;
  readonly ghostNodeId: string;
}

export interface BundleHealth {
  readonly totalSlices: number;
  readonly totalNodeKinds: number;
  readonly totalNodes: number;
  readonly totalRealNodes: number;
  readonly totalGhostNodes: number;
  readonly totalEdges: number;
  readonly totalBridges: number;
  readonly totalLinkContracts: number;
  readonly edgeCategoryCounts: Record<string, number>;
  readonly missingGeneratedGlobs: MissingGeneratedGlob[];
  readonly historicalMissingTargets: HistoricalMissingTargetRecord[];
  readonly unclassifiedEdgeCount: number;
  readonly loadedFiles: number;
}

export interface OntologyBundle {
  readonly version: string;
  readonly system: {
    readonly iri: string;
    readonly label: string;
    readonly versionInfo?: string;
  };
  readonly slices: BundleSlice[];
  readonly nodeKinds: BundleNodeKind[];
  readonly predicates: BundlePredicate[];
  readonly nodes: BundleNode[];
  readonly edges: BundleEdge[];
  readonly metaEdges: BundleMetaEdge[];
  readonly health: BundleHealth;
}

export interface CompileBundleOptions extends LoadDatasetOptions {
  readonly repoRoot?: string;
  readonly dataset?: RegisteredDataset;
  readonly shapesDir?: string;
}

export interface BuildViewerOptions extends CompileBundleOptions {
  readonly outPath?: string;
  readonly silent?: boolean;
}

export interface BuildViewerResult {
  readonly outPath: string;
  readonly html: string;
  readonly bundle: OntologyBundle;
  readonly byteLength: number;
}

// ── Compilation Helpers (Zero Hardcoded Slice/Kind Branches) ───────────────

function localNameOf(iri: string): string {
  const hash = iri.lastIndexOf('#');
  const slash = iri.lastIndexOf('/');
  const idx = Math.max(hash, slash);
  return idx >= 0 ? iri.slice(idx + 1) : iri;
}

function humanizeLocalName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
}

function loadRegisteredDatasetSmart(
  repoRoot: string,
  options?: LoadDatasetOptions,
): RegisteredDataset {
  const primary = loadRegisteredDataset(repoRoot, options);
  const nonMetaLoaded = primary.files.filter((f) => f.sourceKind !== 'system');
  if (nonMetaLoaded.length > 0) {
    return primary;
  }
  const ontologyDir = path.join(repoRoot, 'ontology');
  if (!fs.existsSync(ontologyDir)) {
    return primary;
  }
  const metaPath = options?.metaPath
    ? path.isAbsolute(options.metaPath)
      ? options.metaPath
      : path.join(repoRoot, options.metaPath)
    : path.join(ontologyDir, 'system/meta.ttl');
  const registryPath = options?.registryPath
    ? path.isAbsolute(options.registryPath)
      ? options.registryPath
      : path.join(repoRoot, options.registryPath)
    : path.join(ontologyDir, 'system/registry.ttl');

  if (!fs.existsSync(registryPath)) {
    return primary;
  }
  return loadRegisteredDataset(ontologyDir, {
    ...options,
    metaPath,
    registryPath,
  });
}

function loadShaclStore(dataset: RegisteredDataset, shapesDirOverride?: string): MultiGraphStore {
  const shapeStore = new MultiGraphStore();
  shapeStore.addPrefixes(dataset.store.getPrefixes());

  // Include any sh:NodeShape quads already present in the dataset store
  for (const q of dataset.store.quads()) {
    if (
      q.predicate.value.startsWith(SH_NS) ||
      (q.object.termType === 'NamedNode' && q.object.value.startsWith(SH_NS)) ||
      q.predicate.value === RDF.first ||
      q.predicate.value === RDF.rest
    ) {
      shapeStore.addQuad(q);
    }
  }

  // Also load any sibling shapes/*.ttl files if present
  const candidateDirs = [
    shapesDirOverride,
    path.join(dataset.repoRoot, 'shapes'),
    path.join(dataset.repoRoot, 'ontology/shapes'),
  ].filter((d): d is string => Boolean(d));

  const seenDirs = new Set<string>();
  let seq = 0;
  for (const dir of candidateDirs) {
    const resolved = path.resolve(dir);
    if (seenDirs.has(resolved) || !fs.existsSync(resolved)) continue;
    seenDirs.add(resolved);
    const entries = fs
      .readdirSync(resolved)
      .filter((f) => f.endsWith('.ttl'))
      .sort((a, b) => a.localeCompare(b));
    for (const file of entries) {
      seq++;
      const raw = fs.readFileSync(path.join(resolved, file), 'utf8');
      shapeStore.loadTurtle(raw, { graph: 'shapes', bnodePrefix: `sh${seq}_` });
    }
  }
  return shapeStore;
}

function buildShaclSectionsByTargetClass(shapeStore: MultiGraphStore): Map<string, DrawerSection> {
  const rowsByClass = new Map<string, DrawerRow[]>();
  const shapes = shapeStore
    .subjects(RDF.type, SH.NodeShape)
    .sort((a, b) => a.localeCompare(b));

  for (const shapeIri of shapes) {
    const targetClasses = shapeStore.iriValues(shapeIri, SH.targetClass);
    if (targetClasses.length === 0) continue;

    const propShapes = shapeStore.objects(shapeIri, SH.property);
    const rows: DrawerRow[] = [];

    for (const propTerm of propShapes) {
      if (propTerm.termType === 'Literal') continue;
      const pNode = propTerm.value;
      const pathIri = shapeStore.iriValue(pNode, SH.path);
      const pathLabel = pathIri ? shapeStore.compact(pathIri) : localNameOf(pNode);
      const minCount = shapeStore.literalValue(pNode, SH.minCount);
      const maxCount = shapeStore.literalValue(pNode, SH.maxCount);
      const dt = shapeStore.iriValue(pNode, SH.datatype);
      const cls = shapeStore.iriValue(pNode, SH.class);
      const pattern = shapeStore.literalValue(pNode, SH.pattern);
      const minInc = shapeStore.literalValue(pNode, SH.minInclusive);
      const maxInc = shapeStore.literalValue(pNode, SH.maxInclusive);
      const msg = shapeStore.literalValue(pNode, SH.message);

      const inHead = shapeStore.objects(pNode, SH.in)[0];
      const allowedValues = inHead
        ? shapeStore.readList(inHead).map((t) => (t.termType === 'Literal' ? t.value : shapeStore.compact(t.value)))
        : [];

      const parts: string[] = [];
      if (minCount !== undefined || maxCount !== undefined) {
        parts.push(`[${minCount ?? '0'}..${maxCount ?? '*'}]`);
      }
      if (dt) parts.push(shapeStore.compact(dt));
      if (cls) parts.push(`class ${shapeStore.compact(cls)}`);
      if (minInc !== undefined) parts.push(`>= ${minInc}`);
      if (maxInc !== undefined) parts.push(`<= ${maxInc}`);
      if (pattern) parts.push(`/${pattern}/`);
      if (allowedValues.length > 0) parts.push(`in (${allowedValues.join(', ')})`);

      rows.push({
        label: pathLabel,
        badge: parts.join(' · ') || 'constraint',
        ...(msg ? { detail: msg } : {}),
        meta: shapeStore.compact(shapeIri),
      });
    }

    rows.sort((a, b) => a.label.localeCompare(b.label) || (a.badge ?? '').localeCompare(b.badge ?? ''));

    for (const tc of targetClasses) {
      const existing = rowsByClass.get(tc) ?? [];
      existing.push(...rows);
      rowsByClass.set(tc, existing);
    }
  }

  const out = new Map<string, DrawerSection>();
  for (const [tc, rows] of rowsByClass.entries()) {
    if (rows.length === 0) continue;
    const dedup = new Map<string, DrawerRow>();
    for (const r of rows) {
      dedup.set(`${r.label}\0${r.badge ?? ''}\0${r.detail ?? ''}`, r);
    }
    out.set(tc, {
      id: 'shacl-constraints',
      title: 'SHACL Constraints (sh:NodeShape)',
      kind: 'constraints',
      items: [...dedup.values()].sort(
        (a, b) => a.label.localeCompare(b.label) || (a.badge ?? '').localeCompare(b.badge ?? ''),
      ),
    });
  }
  return out;
}

function extractNestedChildSections(
  store: MultiGraphStore,
  nodeIri: string,
  walkableByIri: ReadonlyMap<string, MaterializedNode>,
): DrawerSection[] {
  const byPred = new Map<string, string[]>();

  for (const q of store.outgoing(nodeIri)) {
    if (q.object.termType === 'Literal') continue;
    if (q.predicate.value === RDF.type) continue;
    const target = q.object.value;
    if (walkableByIri.has(target)) continue;

    // Only treat as a nested child resource if it has its own outgoing statements in the store
    const childQuads = store.outgoing(target);
    if (childQuads.length === 0) continue;

    // Skip pure vocabulary/ontology metadata targets (e.g. owl:Class, rdf:List nodes)
    const childTypes = store.typesOf(target);
    if (childTypes.includes(OWL.Ontology) || childTypes.includes(SH.NodeShape)) continue;

    let list = byPred.get(q.predicate.value);
    if (!list) {
      list = [];
      byPred.set(q.predicate.value, list);
    }
    if (!list.includes(target)) list.push(target);
  }

  const sections: DrawerSection[] = [];
  const sortedPreds = [...byPred.keys()].sort((a, b) => a.localeCompare(b));

  for (const predIri of sortedPreds) {
    const childIris = byPred.get(predIri)!;
    const predLabel = store.literalValue(predIri, RDFS.label) ?? store.compact(predIri);

    interface OrderedRow {
      order: number;
      sortKey: string;
      row: DrawerRow;
    }

    const ordered: OrderedRow[] = childIris.map((childIri) => {
      const childQuads = store.outgoing(childIri);
      const label = store.literalValue(childIri, RDFS.label) ?? localNameOf(childIri);
      const comment = store.literalValue(childIri, RDFS.comment);

      let order = Number.MAX_SAFE_INTEGER;
      let badge: string | undefined;
      const metaParts: string[] = [];
      const jumpSet = new Set<string>();

      for (const cq of childQuads) {
        if (cq.predicate.value === RDF.type || cq.predicate.value === RDFS.label || cq.predicate.value === RDFS.comment) {
          continue;
        }
        const pLocal = localNameOf(cq.predicate.value);
        if (cq.object.termType === 'Literal') {
          if (/order|index/i.test(pLocal)) {
            const n = Number(cq.object.value);
            if (!Number.isNaN(n) && n < order) order = n;
          } else {
            metaParts.push(`${pLocal}: ${cq.object.value}`);
          }
        } else if (cq.object.termType === 'NamedNode') {
          const targetWalkable = walkableByIri.get(cq.object.value);
          if (targetWalkable) {
            jumpSet.add(targetWalkable.id);
          } else if (!badge && /beat|phase|kind|stage|status|type/i.test(pLocal)) {
            badge = store.literalValue(cq.object.value, RDFS.label) ?? localNameOf(cq.object.value);
          }
        }
      }

      if (!badge) {
        const directTypes = store.typesOf(childIri);
        if (directTypes[0]) {
          badge = store.literalValue(directTypes[0], RDFS.label) ?? localNameOf(directTypes[0]);
        }
      }

      const jumpNodeIds = [...jumpSet].sort((a, b) => a.localeCompare(b));
      metaParts.sort((a, b) => a.localeCompare(b));

      return {
        order,
        sortKey: label,
        row: {
          label,
          ...(badge ? { badge } : {}),
          ...(comment ? { detail: comment } : {}),
          ...(metaParts.length > 0 ? { meta: metaParts.join(' · ') } : {}),
          ...(jumpNodeIds.length > 0 ? { jumpNodeIds } : {}),
        },
      };
    });

    ordered.sort((a, b) => a.order - b.order || a.sortKey.localeCompare(b.sortKey));
    const isChain = ordered.some((o) => o.order < Number.MAX_SAFE_INTEGER);

    sections.push({
      id: `nested-${store.compact(predIri).replace(/[^a-zA-Z0-9_-]+/g, '-')}`,
      title: `${predLabel} (${ordered.length})`,
      kind: isChain ? 'chain' : 'list',
      items: ordered.map((o) => o.row),
    });
  }

  return sections;
}

const FILE_PATH_VALUE_RE = /^(packages|apps|ontology|scripts|docs|e2e|skills)\/[^\s]+\.[a-zA-Z0-9]+$/;

function extractExternalLinks(
  store: MultiGraphStore,
  nodeIri: string,
): ExternalLink[] {
  const links: ExternalLink[] = [];
  const seen = new Set<string>();
  const addLink = (link: ExternalLink): void => {
    const key = `${link.kind}\0${link.target}\0${link.line ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };

  let lineHint: number | undefined;
  for (const q of store.outgoing(nodeIri)) {
    if (q.object.termType !== 'Literal') continue;
    const pLocal = localNameOf(q.predicate.value);
    if (/^(line|lineHint|startLine|lineNumber)$/i.test(pLocal)) {
      const n = Number(q.object.value);
      if (!Number.isNaN(n) && n > 0) lineHint = n;
    }
  }

  for (const q of store.outgoing(nodeIri)) {
    const pLocal = localNameOf(q.predicate.value);
    if (q.object.termType === 'Literal') {
      const val = q.object.value.trim();
      if (!val) continue;
      if ((/path|file/i.test(pLocal) && val.includes('/') && !val.startsWith('http')) || FILE_PATH_VALUE_RE.test(val)) {
        addLink({
          kind: 'vscode',
          label: lineHint ? `${val}:${lineHint}` : val,
          target: val,
          ...(lineHint ? { line: lineHint } : {}),
        });
      } else if (/route/i.test(pLocal) && val.startsWith('/')) {
        addLink({
          kind: 'playground',
          label: `Playground ${val}`,
          target: val,
        });
      } else if (/storyId/i.test(pLocal)) {
        addLink({
          kind: 'storybook',
          label: `Story ${val}`,
          target: val,
        });
      } else if (/^https?:\/\//i.test(val) && /seeAlso|source|url|href|homepage/i.test(pLocal)) {
        addLink({
          kind: 'external',
          label: val,
          target: val,
        });
      }
    } else if (q.object.termType === 'NamedNode') {
      // 1-hop file link for symbols or specs that point to a file node with a path literal
      if (/definedIn|specFile|adrFile|entryFile|playwrightSpec/i.test(pLocal)) {
        const targetQuads = store.outgoing(q.object.value);
        for (const tq of targetQuads) {
          if (tq.object.termType !== 'Literal') continue;
          const tpLocal = localNameOf(tq.predicate.value);
          if (/path|file/i.test(tpLocal) && tq.object.value.includes('/')) {
            const val = tq.object.value.trim();
            addLink({
              kind: 'vscode',
              label: lineHint ? `${val}:${lineHint}` : val,
              target: val,
              ...(lineHint ? { line: lineHint } : {}),
            });
          }
        }
      }
    }
  }

  links.sort((a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target));
  return links;
}

function extractNodeProps(store: MultiGraphStore, nodeIri: string): Array<[string, string]> {
  const skipPreds = new Set<string>([RDF.type, RDFS.label, RDFS.comment]);
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const q of store.outgoing(nodeIri)) {
    if (skipPreds.has(q.predicate.value)) continue;
    if (q.object.termType !== 'Literal') continue;
    const key = store.compact(q.predicate.value);
    const val = q.object.value;
    const dedupKey = `${key}\0${val}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    pairs.push([key, val]);
  }

  pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return pairs;
}

function deriveGhostNodeId(
  store: MultiGraphStore,
  targetIri: string,
  targetSlice: BundleSlice,
  targetKind: BundleNodeKind | undefined,
): string {
  // Try to preserve readable path after `/<kindSlug>/` if present
  if (targetKind) {
    const marker = `/${targetKind.kindSlug}/`;
    const idx = targetIri.indexOf(marker);
    if (idx !== -1) {
      return `${targetKind.kindSlug}:${targetIri.slice(idx + marker.length)}`;
    }
  }
  const sliceMarker = `/${targetSlice.slug}/`;
  const sIdx = targetIri.indexOf(sliceMarker);
  if (sIdx !== -1) {
    return `ghost:${targetIri.slice(sIdx + sliceMarker.length)}`;
  }
  return `ghost:${store.compact(targetIri)}`;
}

// ── Main Bundle Compiler ───────────────────────────────────────────────────

export function compileOntologyBundle(options?: CompileBundleOptions): OntologyBundle {
  const repoRoot = options?.repoRoot ?? REPO_ROOT;
  const dataset = options?.dataset ?? loadRegisteredDatasetSmart(repoRoot, options);
  const { system, store } = dataset;

  // 1. User-navigable slices (exclude MetaOntology which describes the registry itself)
  const navigableSlices = system.slices
    .filter((s) => s.ontologyKind !== 'meta')
    .sort((a, b) => a.layerOrder - b.layerOrder || a.slug.localeCompare(b.slug));

  const sliceIdxByGraphIri = new Map<string, number>();
  const sliceIdxBySlug = new Map<string, number>();
  const sliceModules = new Map<string, string[]>();

  for (const f of dataset.files) {
    let list = sliceModules.get(f.graphIri);
    if (!list) {
      list = [];
      sliceModules.set(f.graphIri, list);
    }
    if (!list.includes(f.relativePath)) list.push(f.relativePath);
  }
  for (const list of sliceModules.values()) {
    list.sort((a, b) => a.localeCompare(b));
  }

  const slicesBase: Array<Omit<BundleSlice, 'stats'>> = navigableSlices.map((s, idx) => {
    sliceIdxByGraphIri.set(s.graphIri, idx);
    sliceIdxBySlug.set(s.slug, idx);
    return {
      slug: s.slug,
      graphIri: s.graphIri,
      ontologyKind: s.ontologyKind,
      label: s.label,
      comment: s.comment,
      layerOrder: s.layerOrder,
      accentToken: s.accentToken,
      modules: sliceModules.get(s.graphIri) ?? [...s.schemaGlobs, ...s.generatedGlobs],
    };
  });

  // 2. NodeKinds indexed deterministically
  const nodeKinds: BundleNodeKind[] = [];
  const kindIdxBySliceAndSlug = new Map<string, number>();
  const kindIdxByTargetClass = new Map<string, number>();

  for (let sIdx = 0; sIdx < navigableSlices.length; sIdx++) {
    const slice = navigableSlices[sIdx];
    for (const nk of slice.nodeKinds) {
      const kIdx = nodeKinds.length;
      nodeKinds.push({
        kindSlug: nk.kindSlug,
        sliceIdx: sIdx,
        badgeLabel: nk.badgeLabel,
        selectorMode: nk.selectorMode,
      });
      kindIdxBySliceAndSlug.set(`${sIdx}\0${nk.kindSlug}`, kIdx);
      for (const tc of nk.targetClasses) {
        if (!kindIdxByTargetClass.has(`${sIdx}\0${tc}`)) {
          kindIdxByTargetClass.set(`${sIdx}\0${tc}`, kIdx);
        }
      }
    }
  }

  // 3. Materialize nodes & edges via system-loader
  const materializedNodes = dataset.materializeNodes();
  const walkableByIri = new Map<string, MaterializedNode>(
    materializedNodes.map((n) => [n.iri, n]),
  );
  const materializedEdges = dataset.materializeEdges(materializedNodes);

  // Load SHACL shapes generically
  const shaclStore = loadShaclStore(dataset, options?.shapesDir);
  const shaclSectionsByClass = buildShaclSectionsByTargetClass(shaclStore);

  // 4. Build initial real BundleNodes
  const draftNodes: BundleNode[] = [];
  const nodeByIdDraft = new Map<string, BundleNode>();

  for (const mn of materializedNodes) {
    const sliceIdx = sliceIdxBySlug.get(mn.sliceSlug);
    if (sliceIdx === undefined) continue;
    const kindIdx = kindIdxBySliceAndSlug.get(`${sliceIdx}\0${mn.kindSlug}`) ?? 0;

    const drawerSections: DrawerSection[] = [];
    const shaclSection = shaclSectionsByClass.get(mn.iri);
    if (shaclSection) drawerSections.push(shaclSection);
    drawerSections.push(...extractNestedChildSections(store, mn.iri, walkableByIri));

    const node: BundleNode = {
      id: mn.id,
      iri: mn.iri,
      sliceIdx,
      kindIdx,
      label: mn.label,
      summary: mn.summary,
      props: extractNodeProps(store, mn.iri),
      drawerSections,
      links: extractExternalLinks(store, mn.iri),
    };
    draftNodes.push(node);
    nodeByIdDraft.set(node.id, node);
  }

  // 5. Materialize Historical Missing Target Ghost Nodes
  const ghostByIri = new Map<string, BundleNode>();
  const historicalMissingTargets: HistoricalMissingTargetRecord[] = [];

  for (const me of materializedEdges) {
    if (me.targetId) continue;

    let ghostNode = ghostByIri.get(me.targetIri);
    if (!ghostNode) {
      // Determine target slice & kind from matching LinkContract or GraphBridge
      const matchedContract = system.linkContracts.find((lc) =>
        store.isSubPropertyOf(me.predicateIri, lc.linkPredicate),
      );
      const matchedBridge = system.bridges.find((b) =>
        store.isSubPropertyOf(me.predicateIri, b.bridgePredicate),
      );
      const targetGraphIri = matchedContract?.targetGraph ?? matchedBridge?.targetGraph;
      const targetSliceIdx =
        (targetGraphIri ? sliceIdxByGraphIri.get(targetGraphIri) : undefined) ??
        Math.max(0, slicesBase.length - 1);
      const targetSlice = slicesBase[targetSliceIdx];

      const targetClasses = matchedContract?.targetClasses ?? matchedBridge?.targetClasses ?? [];
      let targetKindIdx = 0;
      for (const tc of targetClasses) {
        const found = kindIdxByTargetClass.get(`${targetSliceIdx}\0${tc}`);
        if (found !== undefined) {
          targetKindIdx = found;
          break;
        }
      }
      if (targetKindIdx === 0 && nodeKinds.length > 0) {
        const fallbackKind = nodeKinds.findIndex((nk) => nk.sliceIdx === targetSliceIdx);
        if (fallbackKind >= 0) targetKindIdx = fallbackKind;
      }

      const targetKind = nodeKinds[targetKindIdx];
      const ghostId = deriveGhostNodeId(
        store,
        me.targetIri,
        targetSlice ?? {
          slug: 'unknown',
          graphIri: '',
          ontologyKind: 'generated',
          label: 'Unknown',
          comment: '',
          layerOrder: 99,
          accentToken: 'slate',
          modules: [],
        },
        targetKind,
      );

      ghostNode = {
        id: ghostId,
        iri: me.targetIri,
        sliceIdx: targetSliceIdx,
        kindIdx: targetKindIdx,
        label: localNameOf(me.targetIri),
        summary: `Historical target referenced via ${me.predicateCurie} that no longer exists in the current build.`,
        props: [['targetIri', me.targetIri]],
        drawerSections: [],
        links: [],
        ghost: true,
        ghostReason: 'historical-missing-target',
      };
      ghostByIri.set(me.targetIri, ghostNode);
      if (!nodeByIdDraft.has(ghostNode.id)) {
        draftNodes.push(ghostNode);
        nodeByIdDraft.set(ghostNode.id, ghostNode);
      }
    }

    historicalMissingTargets.push({
      sourceId: me.sourceId,
      predicateCurie: me.predicateCurie,
      targetIri: me.targetIri,
      ghostNodeId: ghostNode.id,
    });
  }

  historicalMissingTargets.sort(
    (a, b) =>
      a.sourceId.localeCompare(b.sourceId) ||
      a.predicateCurie.localeCompare(b.predicateCurie) ||
      a.targetIri.localeCompare(b.targetIri),
  );

  // 6. Sort all nodes canonically by ID for byte-determinism
  const nodes: BundleNode[] = [...draftNodes].sort(
    (a, b) => a.id.localeCompare(b.id) || a.iri.localeCompare(b.iri),
  );
  const nodeIdxById = new Map<string, number>(nodes.map((n, idx) => [n.id, idx]));

  // 7. Resolve predicate metadata & integer-indexed edges
  const predicateMap = new Map<string, BundlePredicate>();
  const resolvePredicate = (predIri: string, predCurie: string, category: EdgeCategory): BundlePredicate => {
    const existing = predicateMap.get(predCurie);
    if (existing) return existing;

    const matchedBridge = system.bridges.find((b) => store.isSubPropertyOf(predIri, b.bridgePredicate));
    const matchedContract = system.linkContracts.find((lc) =>
      store.isSubPropertyOf(predIri, lc.linkPredicate),
    );

    const directForward = store.literalValue(predIri, SYS.forwardLabel);
    const directInverse = store.literalValue(predIri, SYS.inverseLabel);
    const directPriority = store.numberValue(predIri, SYS.navPriority);
    const rdfsLabel = store.literalValue(predIri, RDFS.label);

    const forwardLabel =
      directForward ??
      matchedBridge?.forwardLabel ??
      matchedContract?.forwardLabel ??
      rdfsLabel ??
      humanizeLocalName(localNameOf(predIri));

    const inverseLabel =
      directInverse ??
      matchedBridge?.inverseLabel ??
      matchedContract?.inverseLabel ??
      `inverse of ${forwardLabel}`;

    const navPriority =
      directPriority ??
      matchedBridge?.navPriority ??
      matchedContract?.navPriority ??
      (category === 'localBridge' ? 30 : category === 'generatedLink' ? 50 : category === 'global' ? 80 : 60);

    const pred: BundlePredicate = {
      curie: predCurie,
      iri: predIri,
      forwardLabel,
      inverseLabel,
      navPriority,
      edgeCategory: category,
    };
    predicateMap.set(predCurie, pred);
    return pred;
  };

  // Pre-register edges and predicates
  interface RawTuple {
    sIdx: number;
    pCurie: string;
    tIdx: number;
    category: EdgeCategory;
  }
  const rawTuples: RawTuple[] = [];
  const edgeCategoryCounts: Record<string, number> = {};
  let unclassifiedEdgeCount = 0;

  for (const me of materializedEdges) {
    const sIdx = nodeIdxById.get(me.sourceId);
    const targetId = me.targetId ?? ghostByIri.get(me.targetIri)?.id;
    const tIdx = targetId !== undefined ? nodeIdxById.get(targetId) : undefined;
    if (sIdx === undefined || tIdx === undefined) continue;

    // Normalize category if ghost node was resolved to a generated slice
    const sNode = nodes[sIdx];
    const tNode = nodes[tIdx];
    const tSlice = slicesBase[tNode.sliceIdx];
    let effectiveCategory: EdgeCategory = me.category;
    if (sNode.sliceIdx !== tNode.sliceIdx) {
      if (tSlice?.ontologyKind === 'generated') effectiveCategory = 'generatedLink';
      else if (tSlice?.ontologyKind === 'global') effectiveCategory = 'global';
    }

    resolvePredicate(me.predicateIri, me.predicateCurie, effectiveCategory);
    rawTuples.push({ sIdx, pCurie: me.predicateCurie, tIdx, category: effectiveCategory });
  }

  const predicates: BundlePredicate[] = [...predicateMap.values()].sort(
    (a, b) => a.navPriority - b.navPriority || a.curie.localeCompare(b.curie),
  );
  const predIdxByCurie = new Map<string, number>(predicates.map((p, idx) => [p.curie, idx]));

  const edgeDedup = new Set<string>();
  const edges: BundleEdge[] = [];

  for (const rt of rawTuples) {
    const pIdx = predIdxByCurie.get(rt.pCurie);
    if (pIdx === undefined) continue;
    const key = `${rt.sIdx}\0${pIdx}\0${rt.tIdx}`;
    if (edgeDedup.has(key)) continue;
    edgeDedup.add(key);
    edges.push([rt.sIdx, pIdx, rt.tIdx]);

    edgeCategoryCounts[rt.category] = (edgeCategoryCounts[rt.category] ?? 0) + 1;
    if (rt.category === 'unclassified') unclassifiedEdgeCount++;
  }

  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

  // 8. Compute slice statistics & metaEdges (explicit Local<->Local bridges + auto-derived Global/Generated summaries)
  const sliceNodeCounts = new Array<number>(slicesBase.length).fill(0);
  const sliceKindCounts = new Array<number>(slicesBase.length).fill(0);
  const sliceOutCounts = new Array<number>(slicesBase.length).fill(0);
  const sliceInCounts = new Array<number>(slicesBase.length).fill(0);

  for (const n of nodes) {
    if (!n.ghost && n.sliceIdx < sliceNodeCounts.length) {
      sliceNodeCounts[n.sliceIdx]++;
    }
  }
  for (const nk of nodeKinds) {
    if (nk.sliceIdx < sliceKindCounts.length) {
      sliceKindCounts[nk.sliceIdx]++;
    }
  }

  // Count cross-slice assertions per (sourceSliceIdx, targetSliceIdx, predicateCurie)
  const crossSliceCounts = new Map<string, number>();
  for (const [sIdx, pIdx, tIdx] of edges) {
    const sSlice = nodes[sIdx].sliceIdx;
    const tSlice = nodes[tIdx].sliceIdx;
    sliceOutCounts[sSlice]++;
    sliceInCounts[tSlice]++;
    if (sSlice !== tSlice) {
      const pCurie = predicates[pIdx].curie;
      const key = `${sSlice}\0${tSlice}\0${pCurie}`;
      crossSliceCounts.set(key, (crossSliceCounts.get(key) ?? 0) + 1);
    }
  }

  const slices: BundleSlice[] = slicesBase.map((s, idx) => ({
    ...s,
    stats: {
      nodeCount: sliceNodeCounts[idx],
      kindCount: sliceKindCounts[idx],
      outgoingEdges: sliceOutCounts[idx],
      incomingEdges: sliceInCounts[idx],
    },
  }));

  const metaEdges: BundleMetaEdge[] = [];
  const coveredMetaKeys = new Set<string>();

  // 8a. Explicit declared sys:GraphBridge entries
  for (const b of system.bridges) {
    const sSliceIdx = sliceIdxByGraphIri.get(b.sourceGraph);
    const tSliceIdx = sliceIdxByGraphIri.get(b.targetGraph);
    if (sSliceIdx === undefined || tSliceIdx === undefined) continue;

    // Count all assertions matching this bridge (including subproperties)
    let assertionCount = 0;
    for (const [sIdx, pIdx, tIdx] of edges) {
      if (nodes[sIdx].sliceIdx !== sSliceIdx || nodes[tIdx].sliceIdx !== tSliceIdx) continue;
      if (store.isSubPropertyOf(predicates[pIdx].iri, b.bridgePredicate)) {
        assertionCount++;
      }
    }

    const predCurie = store.compact(b.bridgePredicate);
    coveredMetaKeys.add(`${sSliceIdx}\0${tSliceIdx}\0${predCurie}`);

    metaEdges.push({
      sourceSliceIdx: sSliceIdx,
      targetSliceIdx: tSliceIdx,
      kind: 'localBridge',
      predicateCurie: predCurie,
      forwardLabel: b.forwardLabel,
      inverseLabel: b.inverseLabel,
      navPriority: b.navPriority,
      assertionCount,
      sourceClasses: b.sourceClasses.map((c) => store.compact(c)),
      targetClasses: b.targetClasses.map((c) => store.compact(c)),
    });
  }

  // 8b. Auto-derived Global & Generated link summaries (aggregated per sourceSlice -> targetSlice)
  const autoSummaryMap = new Map<
    string,
    {
      sourceSliceIdx: number;
      targetSliceIdx: number;
      kind: 'global' | 'generatedLink';
      preds: Set<string>;
      assertionCount: number;
      minPriority: number;
      sampleForward: string;
      sampleInverse: string;
    }
  >();

  for (const [key, count] of crossSliceCounts.entries()) {
    if (coveredMetaKeys.has(key)) continue;
    const [sStr, tStr, pCurie] = key.split('\0');
    const sSliceIdx = Number(sStr);
    const tSliceIdx = Number(tStr);
    const targetSlice = slices[tSliceIdx];
    if (!targetSlice) continue;
    if (targetSlice.ontologyKind !== 'global' && targetSlice.ontologyKind !== 'generated') {
      continue;
    }
    const kind = targetSlice.ontologyKind === 'global' ? 'global' : 'generatedLink';
    const predObj = predicateMap.get(pCurie);
    const aggKey = `${sSliceIdx}\0${tSliceIdx}\0${kind}`;
    let agg = autoSummaryMap.get(aggKey);
    if (!agg) {
      agg = {
        sourceSliceIdx: sSliceIdx,
        targetSliceIdx: tSliceIdx,
        kind,
        preds: new Set<string>(),
        assertionCount: 0,
        minPriority: predObj?.navPriority ?? 50,
        sampleForward: predObj?.forwardLabel ?? pCurie,
        sampleInverse: predObj?.inverseLabel ?? `referenced by`,
      };
      autoSummaryMap.set(aggKey, agg);
    }
    agg.preds.add(pCurie);
    agg.assertionCount += count;
    if (predObj && predObj.navPriority < agg.minPriority) {
      agg.minPriority = predObj.navPriority;
      agg.sampleForward = predObj.forwardLabel;
      agg.sampleInverse = predObj.inverseLabel;
    }
  }

  for (const agg of autoSummaryMap.values()) {
    const sortedPreds = [...agg.preds].sort((a, b) => a.localeCompare(b));
    const predSummary =
      sortedPreds.length === 1
        ? sortedPreds[0]
        : `${sortedPreds[0]} +${sortedPreds.length - 1}`;
    metaEdges.push({
      sourceSliceIdx: agg.sourceSliceIdx,
      targetSliceIdx: agg.targetSliceIdx,
      kind: agg.kind,
      predicateCurie: predSummary,
      forwardLabel: agg.kind === 'global' ? agg.sampleForward : `${agg.preds.size} link contract(s)`,
      inverseLabel: agg.sampleInverse,
      navPriority: agg.minPriority,
      assertionCount: agg.assertionCount,
      sourceClasses: [],
      targetClasses: [],
    });
  }

  metaEdges.sort(
    (a, b) =>
      a.sourceSliceIdx - b.sourceSliceIdx ||
      a.targetSliceIdx - b.targetSliceIdx ||
      a.navPriority - b.navPriority ||
      a.predicateCurie.localeCompare(b.predicateCurie),
  );

  const totalGhostNodes = nodes.filter((n) => n.ghost).length;
  const health: BundleHealth = {
    totalSlices: slices.length,
    totalNodeKinds: nodeKinds.length,
    totalNodes: nodes.length,
    totalRealNodes: nodes.length - totalGhostNodes,
    totalGhostNodes,
    totalEdges: edges.length,
    totalBridges: system.bridges.length,
    totalLinkContracts: system.linkContracts.length,
    edgeCategoryCounts: Object.fromEntries(
      Object.entries(edgeCategoryCounts).sort((a, b) => a[0].localeCompare(b[0])),
    ),
    missingGeneratedGlobs: [...dataset.missingGeneratedGlobs],
    historicalMissingTargets,
    unclassifiedEdgeCount,
    loadedFiles: dataset.files.length,
  };

  return {
    version: '1.0',
    system: {
      iri: system.systemIri,
      label: system.label,
      ...(system.versionInfo ? { versionInfo: system.versionInfo } : {}),
    },
    slices,
    nodeKinds,
    predicates,
    nodes,
    edges,
    metaEdges,
    health,
  };
}

// ── Pure Liftable WalkerEngine & 3-Tier Hash Codec (Exported for Testing) ──

export interface WalkedEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly predicate: string;
  readonly verb: string;
  readonly direction: 'outgoing' | 'incoming';
  readonly edgeCategory: EdgeCategory;
  readonly sliceCross: boolean;
}

export interface PruneReport {
  readonly kind: 'root-reset' | 'cascade-prune' | 'refocus' | 'ghost-replaced';
  readonly deletedNodeId?: string;
  readonly prunedNodeIds?: string[];
  readonly retainedDiamondNodeIds?: string[];
  readonly summary: string;
}

export interface WalkerSnapshot {
  readonly mode: 'meta' | 'walk';
  readonly rootNodeId: string | null;
  readonly walkedNodes: string[];
  readonly walkedEdges: WalkedEdge[];
  readonly focusedNodeId: string;
}

export interface WalkerState {
  readonly mode: 'meta' | 'walk';
  readonly rootNodeId: string | null;
  readonly walkedNodes: string[];
  readonly walkedEdges: WalkedEdge[];
  readonly focusedNodeId: string;
  readonly drawerOpen: boolean;
  readonly healthOpen: boolean;
  readonly showUnwalkedHints: boolean;
  readonly showDeletePreview: boolean;
  readonly runtimeGhosts: Record<string, BundleNode>;
  readonly lastPruneReport: PruneReport | null;
  readonly undoSnapshot: WalkerSnapshot | null;
  readonly lastAction: string;
}

export interface NeighborEntry {
  readonly neighborId: string;
  readonly direction: 'outgoing' | 'incoming';
  readonly predicateCurie: string;
  readonly verb: string;
  readonly navPriority: number;
  readonly edgeCategory: EdgeCategory;
  readonly sliceCross: boolean;
}

export interface BundleIndex {
  readonly bundle: OntologyBundle;
  readonly sliceBySlug: Map<string, { slice: BundleSlice; idx: number }>;
  readonly nodeById: Map<string, BundleNode>;
  readonly nodeIdxById: Map<string, number>;
  readonly predByCurie: Map<string, BundlePredicate>;
  readonly adj: Map<string, NeighborEntry[]>;
}

export interface CascadeDeleteResult {
  readonly resetToMeta: boolean;
  readonly deletedNodeId: string;
  readonly prunedNodeIds: string[];
  readonly retainedDiamondNodeIds: string[];
  readonly survivingNodes: string[];
  readonly survivingEdges: WalkedEdge[];
}

export type WalkerAction =
  | { type: 'RESET_TO_META'; focusMetaId?: string }
  | { type: 'FOCUS_NODE'; nodeId: string }
  | { type: 'TOGGLE_DRAWER'; open?: boolean }
  | { type: 'TOGGLE_HEALTH'; open?: boolean }
  | { type: 'TOGGLE_UNWALKED_HINTS'; show?: boolean }
  | { type: 'START_WALK_AT_NODE'; nodeId: string; openDrawer?: boolean }
  | {
      type: 'WALK_STEP';
      fromId?: string;
      toId: string;
      predicate: string;
      verb?: string;
      direction?: 'outgoing' | 'incoming';
      edgeCategory?: EdgeCategory;
    }
  | { type: 'REPLACE_GHOST_NODE'; ghostId: string; replacementId: string }
  | { type: 'CASCADE_DELETE_FOCUSED'; targetId?: string }
  | { type: 'UNDO_DELETE' }
  | {
      type: 'HYDRATE_WALK';
      mode: 'meta' | 'walk';
      rootNodeId: string | null;
      walkedNodes: string[];
      walkedEdges: WalkedEdge[];
      focusedNodeId: string;
      drawerOpen: boolean;
      runtimeGhosts?: Record<string, BundleNode>;
      lastAction?: string;
    };

export function indexBundle(bundle: OntologyBundle): BundleIndex {
  const sliceBySlug = new Map<string, { slice: BundleSlice; idx: number }>();
  bundle.slices.forEach((slice, idx) => sliceBySlug.set(slice.slug, { slice, idx }));

  const nodeById = new Map<string, BundleNode>();
  const nodeIdxById = new Map<string, number>();
  const adj = new Map<string, NeighborEntry[]>();

  bundle.nodes.forEach((n, idx) => {
    nodeById.set(n.id, n);
    nodeIdxById.set(n.id, idx);
    adj.set(n.id, []);
  });

  const predByCurie = new Map<string, BundlePredicate>(
    bundle.predicates.map((p) => [p.curie, p]),
  );

  for (const [sIdx, pIdx, tIdx] of bundle.edges) {
    const sNode = bundle.nodes[sIdx];
    const tNode = bundle.nodes[tIdx];
    const pred = bundle.predicates[pIdx];
    if (!sNode || !tNode || !pred) continue;
    const sliceCross = sNode.sliceIdx !== tNode.sliceIdx;
    adj.get(sNode.id)!.push({
      neighborId: tNode.id,
      direction: 'outgoing',
      predicateCurie: pred.curie,
      verb: pred.forwardLabel,
      navPriority: pred.navPriority,
      edgeCategory: pred.edgeCategory,
      sliceCross,
    });
    adj.get(tNode.id)!.push({
      neighborId: sNode.id,
      direction: 'incoming',
      predicateCurie: pred.curie,
      verb: pred.inverseLabel,
      navPriority: pred.navPriority,
      edgeCategory: pred.edgeCategory,
      sliceCross,
    });
  }

  for (const list of adj.values()) {
    list.sort((a, b) => {
      if (a.navPriority !== b.navPriority) return a.navPriority - b.navPriority;
      const na = nodeById.get(a.neighborId);
      const nb = nodeById.get(b.neighborId);
      const la = na ? (bundle.slices[na.sliceIdx]?.layerOrder ?? 99) : 99;
      const lb = nb ? (bundle.slices[nb.sliceIdx]?.layerOrder ?? 99) : 99;
      if (la !== lb) return la - lb;
      return a.neighborId.localeCompare(b.neighborId) || a.predicateCurie.localeCompare(b.predicateCurie);
    });
  }

  return { bundle, sliceBySlug, nodeById, nodeIdxById, predByCurie, adj };
}

export function createRuntimeGhostNode(missingId: string, bundle: OntologyBundle): BundleNode {
  const prefix = missingId.includes(':') ? missingId.slice(0, missingId.indexOf(':')) : '';
  let sliceIdx = 0;
  let kindIdx = 0;
  const matchedKindIdx = bundle.nodeKinds.findIndex((nk) => nk.kindSlug === prefix);
  if (matchedKindIdx >= 0) {
    kindIdx = matchedKindIdx;
    sliceIdx = bundle.nodeKinds[matchedKindIdx].sliceIdx;
  }
  return {
    id: missingId,
    iri: missingId,
    sliceIdx,
    kindIdx,
    label: missingId,
    summary: 'Unresolved node ID from a shared deep link. It may have been renamed or deleted.',
    props: [['unresolvedId', missingId]],
    drawerSections: [],
    links: [],
    ghost: true,
    ghostReason: 'stale-deep-link',
  };
}

export function createInitialState(
  index: BundleIndex,
  overrides?: Partial<WalkerState>,
): WalkerState {
  const defaultSlice =
    index.bundle.slices.find((s) => s.ontologyKind === 'local') ?? index.bundle.slices[0];
  const defaultFocus = defaultSlice ? `slice:${defaultSlice.slug}` : 'slice:root';
  return {
    mode: 'meta',
    rootNodeId: null,
    walkedNodes: [],
    walkedEdges: [],
    focusedNodeId: defaultFocus,
    drawerOpen: false,
    healthOpen: false,
    showUnwalkedHints: true,
    showDeletePreview: true,
    runtimeGhosts: {},
    lastPruneReport: null,
    undoSnapshot: null,
    lastAction: `Loaded ${index.bundle.slices.length} Sub-Ontology slice(s) · ${index.bundle.health.totalRealNodes} nodes.`,
    ...overrides,
  };
}

export function computeCascadeDelete(
  state: WalkerState,
  targetNodeId: string,
): CascadeDeleteResult {
  if (state.mode !== 'walk' || !state.rootNodeId || !state.walkedNodes.includes(targetNodeId)) {
    return {
      resetToMeta: false,
      deletedNodeId: targetNodeId,
      prunedNodeIds: [],
      retainedDiamondNodeIds: [],
      survivingNodes: state.walkedNodes,
      survivingEdges: state.walkedEdges,
    };
  }

  if (targetNodeId === state.rootNodeId) {
    return {
      resetToMeta: true,
      deletedNodeId: targetNodeId,
      prunedNodeIds: state.walkedNodes.filter((id) => id !== targetNodeId),
      retainedDiamondNodeIds: [],
      survivingNodes: [],
      survivingEdges: [],
    };
  }

  const buildChildren = (edges: readonly WalkedEdge[], ignoreNode: string | null): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const e of edges) {
      if (e.from === ignoreNode || e.to === ignoreNode) continue;
      let list = map.get(e.from);
      if (!list) {
        list = [];
        map.set(e.from, list);
      }
      list.push(e.to);
    }
    return map;
  };

  const fullChildren = buildChildren(state.walkedEdges, null);
  const prunedChildren = buildChildren(state.walkedEdges, targetNodeId);

  const descendantsOfTarget = new Set<string>();
  const qDesc: string[] = [targetNodeId];
  while (qDesc.length > 0) {
    const curr = qDesc.shift()!;
    for (const nxt of fullChildren.get(curr) ?? []) {
      if (nxt !== targetNodeId && !descendantsOfTarget.has(nxt)) {
        descendantsOfTarget.add(nxt);
        qDesc.push(nxt);
      }
    }
  }

  const reachableFromRoot = new Set<string>([state.rootNodeId]);
  const qRoot: string[] = [state.rootNodeId];
  while (qRoot.length > 0) {
    const curr = qRoot.shift()!;
    for (const nxt of prunedChildren.get(curr) ?? []) {
      if (!reachableFromRoot.has(nxt)) {
        reachableFromRoot.add(nxt);
        qRoot.push(nxt);
      }
    }
  }

  const survivingNodes = state.walkedNodes.filter((id) => reachableFromRoot.has(id));
  const survivingSet = new Set(survivingNodes);
  const prunedNodeIds = state.walkedNodes.filter(
    (id) => id !== targetNodeId && !survivingSet.has(id),
  );
  const retainedDiamondNodeIds = [...descendantsOfTarget].filter((id) => survivingSet.has(id));
  const survivingEdges = state.walkedEdges.filter(
    (e) => survivingSet.has(e.from) && survivingSet.has(e.to),
  );

  return {
    resetToMeta: false,
    deletedNodeId: targetNodeId,
    prunedNodeIds,
    retainedDiamondNodeIds,
    survivingNodes,
    survivingEdges,
  };
}

export function computeHopDepths(state: WalkerState): Map<string, number> {
  const depths = new Map<string, number>();
  if (state.mode !== 'walk' || !state.rootNodeId) return depths;
  depths.set(state.rootNodeId, 0);
  const queue: string[] = [state.rootNodeId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const d = depths.get(curr)!;
    for (const e of state.walkedEdges) {
      if (e.from === curr && !depths.has(e.to)) {
        depths.set(e.to, d + 1);
        queue.push(e.to);
      }
    }
  }
  for (const id of state.walkedNodes) {
    if (!depths.has(id)) depths.set(id, 1);
  }
  return depths;
}

export function getUnwalkedCanvasHints(
  index: BundleIndex,
  state: WalkerState,
): Array<{ sourceId: string; targetId: string; predicateCurie: string }> {
  if (state.mode !== 'walk' || state.walkedNodes.length < 2) return [];
  const onCanvas = new Set(state.walkedNodes);
  const walkedPairs = new Set<string>();
  for (const e of state.walkedEdges) {
    walkedPairs.add(`${e.from}\0${e.to}\0${e.predicate}`);
    walkedPairs.add(`${e.to}\0${e.from}\0${e.predicate}`);
  }
  const hints: Array<{ sourceId: string; targetId: string; predicateCurie: string }> = [];
  for (const id of state.walkedNodes) {
    for (const nb of index.adj.get(id) ?? []) {
      if (nb.direction !== 'outgoing') continue;
      if (!onCanvas.has(nb.neighborId)) continue;
      if (walkedPairs.has(`${id}\0${nb.neighborId}\0${nb.predicateCurie}`)) continue;
      hints.push({ sourceId: id, targetId: nb.neighborId, predicateCurie: nb.predicateCurie });
    }
  }
  return hints;
}

export function findFuzzyReplacements(
  index: BundleIndex,
  missingId: string,
  limit = 6,
): Array<{ node: BundleNode; score: number }> {
  const raw = missingId.replace(/^ghost:/, '').toLowerCase();
  const baseName = raw.split(/[/:.#]/).filter(Boolean).pop() ?? raw;
  const tokens = raw.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const scored: Array<{ node: BundleNode; score: number }> = [];

  for (const node of index.bundle.nodes) {
    if (node.ghost) continue;
    const idLow = node.id.toLowerCase();
    const labelLow = node.label.toLowerCase();
    let score = 0;
    if (idLow.endsWith(baseName) || labelLow === baseName) score += 60;
    if (idLow.includes(baseName) || labelLow.includes(baseName)) score += 30;
    for (const tok of tokens) {
      if (idLow.includes(tok)) score += 12;
      if (labelLow.includes(tok)) score += 8;
    }
    if (score > 0) {
      scored.push({ node, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  return scored.slice(0, limit);
}

export function reduceWalkerState(
  state: WalkerState,
  action: WalkerAction,
  index: BundleIndex,
): WalkerState {
  const resolveNode = (id: string): BundleNode | undefined =>
    index.nodeById.get(id) ?? state.runtimeGhosts[id];

  switch (action.type) {
    case 'RESET_TO_META': {
      const fallbackSlice =
        index.bundle.slices.find((s) => s.ontologyKind === 'local') ?? index.bundle.slices[0];
      const focusMeta =
        action.focusMetaId ?? (fallbackSlice ? `slice:${fallbackSlice.slug}` : 'slice:root');
      return {
        ...state,
        mode: 'meta',
        rootNodeId: null,
        walkedNodes: [],
        walkedEdges: [],
        focusedNodeId: focusMeta,
        lastPruneReport: null,
        lastAction: `Returned to Meta Constellation (focused ${focusMeta}).`,
      };
    }

    case 'FOCUS_NODE': {
      return {
        ...state,
        focusedNodeId: action.nodeId,
        lastAction: `Focused ${action.nodeId}.`,
      };
    }

    case 'TOGGLE_DRAWER': {
      const nextOpen = action.open !== undefined ? action.open : !state.drawerOpen;
      return {
        ...state,
        drawerOpen: nextOpen,
        lastAction: `${nextOpen ? 'Opened' : 'Closed'} Detail Drawer for ${state.focusedNodeId}.`,
      };
    }

    case 'TOGGLE_HEALTH': {
      const nextOpen = action.open !== undefined ? action.open : !state.healthOpen;
      return {
        ...state,
        healthOpen: nextOpen,
        lastAction: `${nextOpen ? 'Opened' : 'Closed'} Health & Diagnostics.`,
      };
    }

    case 'TOGGLE_UNWALKED_HINTS': {
      const nextShow = action.show !== undefined ? action.show : !state.showUnwalkedHints;
      return {
        ...state,
        showUnwalkedHints: nextShow,
        lastAction: `${nextShow ? 'Enabled' : 'Hidden'} dashed unwalked canvas hints.`,
      };
    }

    case 'START_WALK_AT_NODE': {
      let node = resolveNode(action.nodeId);
      let nextGhosts = state.runtimeGhosts;
      if (!node) {
        node = createRuntimeGhostNode(action.nodeId, index.bundle);
        nextGhosts = { ...state.runtimeGhosts, [action.nodeId]: node };
      }
      const slice = index.bundle.slices[node.sliceIdx];
      return {
        ...state,
        mode: 'walk',
        rootNodeId: node.id,
        walkedNodes: [node.id],
        walkedEdges: [],
        focusedNodeId: node.id,
        drawerOpen: action.openDrawer !== undefined ? action.openDrawer : state.drawerOpen,
        runtimeGhosts: nextGhosts,
        lastPruneReport: null,
        lastAction: `Started walk rooted at ${node.id}${slice ? ` in :${slice.slug}` : ''}.`,
      };
    }

    case 'WALK_STEP': {
      const fromId = action.fromId ?? state.focusedNodeId;
      const toId = action.toId;
      const fromNode = resolveNode(fromId);
      const toNode = resolveNode(toId);
      if (!fromNode || !toNode) return state;

      if (state.mode === 'meta') {
        return reduceWalkerState(state, { type: 'START_WALK_AT_NODE', nodeId: toId }, index);
      }

      const alreadyOnCanvas = state.walkedNodes.includes(toId);
      const nextNodes = alreadyOnCanvas ? state.walkedNodes : [...state.walkedNodes, toId];

      const predMeta = index.predByCurie.get(action.predicate);
      const verb = action.verb ?? predMeta?.forwardLabel ?? action.predicate;
      const direction = action.direction ?? 'outgoing';
      const edgeCategory = action.edgeCategory ?? predMeta?.edgeCategory ?? 'intra';
      const edgeId = `${fromId}--${action.predicate}-->${toId}`;
      const hasEdge = state.walkedEdges.some((e) => e.id === edgeId);
      const sliceCross = fromNode.sliceIdx !== toNode.sliceIdx;
      const nextEdges: WalkedEdge[] = hasEdge
        ? state.walkedEdges
        : [
            ...state.walkedEdges,
            {
              id: edgeId,
              from: fromId,
              to: toId,
              predicate: action.predicate,
              verb,
              direction,
              edgeCategory,
              sliceCross,
            },
          ];

      return {
        ...state,
        mode: 'walk',
        walkedNodes: nextNodes,
        walkedEdges: nextEdges,
        focusedNodeId: toId,
        lastPruneReport: alreadyOnCanvas
          ? {
              kind: 'refocus',
              summary: `${toId} was already on canvas — linked (${fromId} → ${toId} via ${action.predicate}) and refocused without duplicating.`,
            }
          : null,
        lastAction: alreadyOnCanvas
          ? `Linked ${fromId} → ${toId} (${action.predicate}) & refocused.`
          : `Walked ${fromId} → ${toId} via ${action.predicate}.`,
      };
    }

    case 'REPLACE_GHOST_NODE': {
      const replacement = index.nodeById.get(action.replacementId);
      if (!replacement) return state;
      const replaceId = (id: string): string => (id === action.ghostId ? replacement.id : id);
      const nextWalkedNodes = [...new Set(state.walkedNodes.map(replaceId))];
      const nextWalkedEdges = state.walkedEdges.map((e) => {
        const from = replaceId(e.from);
        const to = replaceId(e.to);
        const fNode = resolveNode(from);
        const tNode = resolveNode(to);
        return {
          ...e,
          id: `${from}--${e.predicate}-->${to}`,
          from,
          to,
          sliceCross: fNode && tNode ? fNode.sliceIdx !== tNode.sliceIdx : e.sliceCross,
        };
      });
      const nextGhosts = { ...state.runtimeGhosts };
      delete nextGhosts[action.ghostId];
      return {
        ...state,
        rootNodeId: state.rootNodeId ? replaceId(state.rootNodeId) : null,
        walkedNodes: nextWalkedNodes,
        walkedEdges: nextWalkedEdges,
        focusedNodeId: replaceId(state.focusedNodeId),
        runtimeGhosts: nextGhosts,
        lastPruneReport: {
          kind: 'ghost-replaced',
          summary: `Replaced unresolved ghost ${action.ghostId} with ${replacement.id}.`,
        },
        lastAction: `Replaced ghost ${action.ghostId} → ${replacement.id}.`,
      };
    }

    case 'CASCADE_DELETE_FOCUSED': {
      const targetId = action.targetId ?? state.focusedNodeId;
      if (state.mode !== 'walk') {
        return {
          ...state,
          lastAction: 'Meta Constellation slices are registry-defined.',
        };
      }

      const snapshot: WalkerSnapshot = {
        mode: state.mode,
        rootNodeId: state.rootNodeId,
        walkedNodes: [...state.walkedNodes],
        walkedEdges: [...state.walkedEdges],
        focusedNodeId: state.focusedNodeId,
      };

      const res = computeCascadeDelete(state, targetId);
      if (res.resetToMeta) {
        const deletedNode = resolveNode(targetId);
        const slice = deletedNode ? index.bundle.slices[deletedNode.sliceIdx] : index.bundle.slices[0];
        const metaId = slice ? `slice:${slice.slug}` : 'slice:root';
        return {
          ...state,
          mode: 'meta',
          rootNodeId: null,
          walkedNodes: [],
          walkedEdges: [],
          focusedNodeId: metaId,
          undoSnapshot: snapshot,
          lastPruneReport: {
            kind: 'root-reset',
            deletedNodeId: targetId,
            prunedNodeIds: res.prunedNodeIds,
            retainedDiamondNodeIds: [],
            summary: `Deleted root ${targetId} (${res.prunedNodeIds.length} downstream cleared) — returned to Meta Constellation.`,
          },
          lastAction: `Deleted root ${targetId} → Meta Constellation.`,
        };
      }

      const parentEdge = state.walkedEdges.find(
        (e) => e.to === targetId && res.survivingNodes.includes(e.from),
      );
      const nextFocus =
        parentEdge?.from ?? res.survivingNodes[res.survivingNodes.length - 1] ?? state.rootNodeId!;

      const prunedText =
        res.prunedNodeIds.length > 0
          ? `Pruned ${res.prunedNodeIds.length} exclusive downstream node(s): ${res.prunedNodeIds.join(', ')}.`
          : 'No downstream nodes pruned.';
      const retainedText =
        res.retainedDiamondNodeIds.length > 0
          ? ` Retained ${res.retainedDiamondNodeIds.length} diamond-reachable node(s): ${res.retainedDiamondNodeIds.join(', ')}.`
          : '';

      return {
        ...state,
        walkedNodes: res.survivingNodes,
        walkedEdges: res.survivingEdges,
        focusedNodeId: nextFocus,
        undoSnapshot: snapshot,
        lastPruneReport: {
          kind: 'cascade-prune',
          deletedNodeId: targetId,
          prunedNodeIds: res.prunedNodeIds,
          retainedDiamondNodeIds: res.retainedDiamondNodeIds,
          summary: `Deleted ${targetId}. ${prunedText}${retainedText}`,
        },
        lastAction: `Deleted ${targetId} (${res.prunedNodeIds.length} pruned, ${res.retainedDiamondNodeIds.length} retained).`,
      };
    }

    case 'UNDO_DELETE': {
      if (!state.undoSnapshot) return state;
      const snap = state.undoSnapshot;
      return {
        ...state,
        mode: snap.mode,
        rootNodeId: snap.rootNodeId,
        walkedNodes: [...snap.walkedNodes],
        walkedEdges: [...snap.walkedEdges],
        focusedNodeId: snap.focusedNodeId,
        undoSnapshot: null,
        lastPruneReport: null,
        lastAction: 'Undid last cascade delete.',
      };
    }

    case 'HYDRATE_WALK': {
      return {
        ...state,
        mode: action.mode,
        rootNodeId: action.rootNodeId,
        walkedNodes: [...action.walkedNodes],
        walkedEdges: [...action.walkedEdges],
        focusedNodeId: action.focusedNodeId,
        drawerOpen: action.drawerOpen,
        runtimeGhosts: action.runtimeGhosts ?? state.runtimeGhosts,
        lastPruneReport: null,
        lastAction: action.lastAction ?? 'Hydrated walk state from URL hash.',
      };
    }

    default:
      return state;
  }
}

// ── 3-Tier Deep-Link Hash Codec & Legacy `#/<kind>/<id>` Resolver ──────────

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function encodePart(v: string): string {
  return encodeURIComponent(v).replace(/%3A/g, ':').replace(/%2F/g, '/');
}

export interface EncodedWalkHash {
  readonly hash: string;
  readonly tier: 'meta' | 'readable' | 'compressed';
  readonly readable: string;
  readonly byteLength: number;
}

export function buildReadableHash(state: WalkerState): string {
  if (state.mode === 'meta' || !state.rootNodeId) {
    const parts: string[] = [];
    if (state.focusedNodeId && state.focusedNodeId.startsWith('slice:')) {
      parts.push(`focus=${encodePart(state.focusedNodeId)}`);
    }
    if (state.drawerOpen) parts.push('drawer=1');
    return parts.length > 0 ? `#meta&${parts.join('&')}` : '#meta';
  }

  const parts: string[] = [`root=${encodePart(state.rootNodeId)}`];
  if (state.walkedEdges.length > 0) {
    const edgeTokens = state.walkedEdges
      .map((e) => `${encodePart(e.from)}~${encodePart(e.predicate)}~${encodePart(e.to)}`)
      .join(',');
    parts.push(`edges=${edgeTokens}`);
  }
  if (state.focusedNodeId && state.focusedNodeId !== state.rootNodeId) {
    parts.push(`focus=${encodePart(state.focusedNodeId)}`);
  }
  if (state.drawerOpen) {
    parts.push('drawer=1');
  }
  return `#${parts.join('&')}`;
}

export function encodeWalkHash(state: WalkerState): EncodedWalkHash {
  const readable = buildReadableHash(state);
  if (state.mode === 'meta' || !state.rootNodeId) {
    return { hash: readable, tier: 'meta', readable, byteLength: readable.length };
  }
  if (readable.length <= READABLE_HASH_MAX_LEN) {
    return { hash: readable, tier: 'readable', readable, byteLength: readable.length };
  }
  const payload = JSON.stringify({
    r: state.rootNodeId,
    e: state.walkedEdges.map((e) => [e.from, e.predicate, e.to]),
    f: state.focusedNodeId,
    d: state.drawerOpen ? 1 : 0,
  });
  const deflated = zlib.deflateRawSync(Buffer.from(payload, 'utf8'));
  const hash = `#g=v1.${bytesToBase64Url(deflated)}`;
  return { hash, tier: 'compressed', readable, byteLength: hash.length };
}

export function resolveLegacyHash(hash: string, index: BundleIndex): string | null {
  const clean = hash.replace(/^#/, '');
  if (!clean.startsWith('/')) return null;
  const segs = clean.slice(1).split('/');
  if (segs.length < 2) return null;
  const kind = decodeURIComponent(segs[0]);
  const rest = decodeURIComponent(segs.slice(1).join('/'));

  // Direct matches: `<kind>:<rest>` or `<rest>`
  const directCandidates = [`${kind}:${rest}`, rest];
  for (const cand of directCandidates) {
    if (index.nodeById.has(cand)) return cand;
  }

  // Case-insensitive match by kindSlug + suffix
  const restLow = rest.toLowerCase();
  for (const node of index.bundle.nodes) {
    const nk = index.bundle.nodeKinds[node.kindIdx];
    if (nk?.kindSlug === kind && (node.id.toLowerCase().endsWith(restLow) || node.label.toLowerCase() === restLow)) {
      return node.id;
    }
  }
  // Fallback: return `<kind>:<rest>` so it hydrates as an Unresolved Ghost Node rather than dropping
  return `${kind}:${rest}`;
}

export interface DecodedWalkHash {
  readonly state: WalkerState;
  readonly legacyRedirect: boolean;
  readonly ghostIds: string[];
}

export function decodeWalkHash(hash: string, index: BundleIndex): DecodedWalkHash {
  const base = createInitialState(index);
  const raw = (hash || '').trim();
  if (!raw || raw === '#') {
    return { state: base, legacyRedirect: false, ghostIds: [] };
  }

  // Legacy `#/<kind>/<id>` redirect
  const legacyId = resolveLegacyHash(raw, index);
  if (legacyId !== null) {
    const runtimeGhosts: Record<string, BundleNode> = {};
    const ghostIds: string[] = [];
    if (!index.nodeById.has(legacyId)) {
      runtimeGhosts[legacyId] = createRuntimeGhostNode(legacyId, index.bundle);
      ghostIds.push(legacyId);
    }
    return {
      state: {
        ...base,
        mode: 'walk',
        rootNodeId: legacyId,
        walkedNodes: [legacyId],
        walkedEdges: [],
        focusedNodeId: legacyId,
        drawerOpen: true,
        runtimeGhosts,
        lastAction: `Redirected legacy hash ${raw} → ${legacyId}.`,
      },
      legacyRedirect: true,
      ghostIds,
    };
  }

  const body = raw.startsWith('#') ? raw.slice(1) : raw;
  if (body === 'meta' || body.startsWith('meta&')) {
    const params = new URLSearchParams(body.startsWith('meta&') ? body.slice(5) : '');
    const focus = params.get('focus');
    const drawer = params.get('drawer') === '1';
    return {
      state: {
        ...base,
        mode: 'meta',
        focusedNodeId: focus && focus.startsWith('slice:') ? focus : base.focusedNodeId,
        drawerOpen: drawer,
      },
      legacyRedirect: false,
      ghostIds: [],
    };
  }

  const hydrateFromTupleData = (
    rootId: string,
    edgeTriples: Array<[string, string, string]>,
    focusId: string | null,
    drawerOpen: boolean,
  ): DecodedWalkHash => {
    const runtimeGhosts: Record<string, BundleNode> = {};
    const ghostIds: string[] = [];
    const ensureNode = (id: string): BundleNode => {
      const existing = index.nodeById.get(id) ?? runtimeGhosts[id];
      if (existing) {
        if (existing.ghost && !ghostIds.includes(id)) ghostIds.push(id);
        return existing;
      }
      const g = createRuntimeGhostNode(id, index.bundle);
      runtimeGhosts[id] = g;
      ghostIds.push(id);
      return g;
    };

    ensureNode(rootId);
    const walkedNodes: string[] = [rootId];
    const walkedEdges: WalkedEdge[] = [];

    for (const [from, pred, to] of edgeTriples) {
      if (!from || !pred || !to) continue;
      const fNode = ensureNode(from);
      const tNode = ensureNode(to);
      if (!walkedNodes.includes(from)) walkedNodes.push(from);
      if (!walkedNodes.includes(to)) walkedNodes.push(to);
      const predMeta = index.predByCurie.get(pred);
      walkedEdges.push({
        id: `${from}--${pred}-->${to}`,
        from,
        to,
        predicate: pred,
        verb: predMeta?.forwardLabel ?? pred,
        direction: 'outgoing',
        edgeCategory: predMeta?.edgeCategory ?? 'intra',
        sliceCross: fNode.sliceIdx !== tNode.sliceIdx,
      });
    }

    const finalFocus = focusId && walkedNodes.includes(focusId) ? focusId : rootId;
    return {
      state: {
        ...base,
        mode: 'walk',
        rootNodeId: rootId,
        walkedNodes,
        walkedEdges,
        focusedNodeId: finalFocus,
        drawerOpen,
        runtimeGhosts,
        lastAction: `Restored walked subgraph (${walkedNodes.length} nodes, ${walkedEdges.length} edges).`,
      },
      legacyRedirect: false,
      ghostIds,
    };
  };

  // Tier 3 compressed `#g=v1.<deflate-raw-base64url>` or `#g=v1u.<base64url>`
  if (body.startsWith('g=v1.') || body.startsWith('g=v1u.')) {
    try {
      const isDeflated = body.startsWith('g=v1.');
      const encoded = body.slice(isDeflated ? 5 : 6).split('&')[0];
      const bytes = base64UrlToBytes(encoded);
      const jsonStr = isDeflated
        ? zlib.inflateRawSync(bytes).toString('utf8')
        : Buffer.from(bytes).toString('utf8');
      const parsed = JSON.parse(jsonStr) as {
        r?: string;
        e?: Array<[string, string, string]>;
        f?: string;
        d?: number;
      };
      if (parsed.r) {
        return hydrateFromTupleData(parsed.r, parsed.e ?? [], parsed.f ?? null, Boolean(parsed.d));
      }
    } catch {
      return { state: base, legacyRedirect: false, ghostIds: [] };
    }
  }

  // Tier 2 readable `#root=<id>&edges=...&focus=...&drawer=1`
  const params = new URLSearchParams(body);
  const root = params.get('root');
  if (root) {
    const rawEdges = params.get('edges') ?? '';
    const triples: Array<[string, string, string]> = rawEdges
      ? rawEdges
          .split(',')
          .filter(Boolean)
          .map((tok) => {
            const parts = tok.split('~');
            return [
              decodeURIComponent(parts[0] ?? ''),
              decodeURIComponent(parts[1] ?? ''),
              decodeURIComponent(parts[2] ?? ''),
            ];
          })
      : [];
    return hydrateFromTupleData(root, triples, params.get('focus'), params.get('drawer') === '1');
  }

  return { state: base, legacyRedirect: false, ghostIds: [] };
}

// ── Static HTML Renderer (Variant B + Meta Constellation) ──────────────────

function escapeJsonForScript(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--');
}

function escapeHtmlText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderExplorerHtml(bundle: OntologyBundle): string {
  const bundleJson = escapeJsonForScript(bundle);
  const pageTitle = escapeHtmlText(`${bundle.system.label} — Layered Graph Walker`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<script>
  try {
    document.querySelector('meta[name="color-scheme"]').content =
      localStorage.getItem('wod-walker-color-scheme') ?? 'light dark';
  } catch (e) {}
</script>
<title>${pageTitle}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: light-dark(#f8fafc, #090d16);
    --bg-canvas: light-dark(#f1f5f9, #060911);
    --surface: light-dark(#ffffff, #111827);
    --surface-2: light-dark(#f1f5f9, #1a2336);
    --surface-3: light-dark(#e2e8f0, #243049);
    --surface-glass: light-dark(rgba(255, 255, 255, 0.92), rgba(17, 24, 39, 0.92));
    --border: light-dark(#cbd5e1, #1e293b);
    --border-strong: light-dark(#94a3b8, #334155);
    --text: light-dark(#0f172a, #f1f5f9);
    --text-dim: light-dark(#475569, #94a3b8);
    --text-faint: light-dark(#64748b, #64748b);
    --accent: light-dark(#0284c7, #38bdf8);
    --accent-soft: light-dark(rgba(2, 132, 199, 0.12), rgba(56, 189, 248, 0.14));
    --focus-ring: light-dark(#0284c7, #38bdf8);
    --danger: light-dark(#dc2626, #fb7185);
    --danger-soft: light-dark(rgba(220, 38, 38, 0.1), rgba(251, 113, 133, 0.14));
    --success: light-dark(#059669, #34d399);
    --success-soft: light-dark(rgba(5, 150, 105, 0.12), rgba(52, 211, 153, 0.14));
    --warn: light-dark(#d97706, #fbbf24);
    --warn-soft: light-dark(rgba(217, 119, 6, 0.12), rgba(251, 191, 36, 0.15));
    --c-bridge: light-dark(#e11d48, #fb7185);
    --c-global: light-dark(#7c3aed, #a78bfa);
    --c-generated: light-dark(#0891b2, #22d3ee);
    --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    --shadow-lg: light-dark(0 12px 32px rgba(15, 23, 42, 0.12), 0 16px 40px rgba(0, 0, 0, 0.55));

    /* Accent token palette (zero slice-name coupling) */
    --tok-violet: light-dark(#7c3aed, #a78bfa);
    --tok-violet-bg: light-dark(rgba(124, 58, 237, 0.1), rgba(167, 139, 250, 0.14));
    --tok-amber: light-dark(#d97706, #fbbf24);
    --tok-amber-bg: light-dark(rgba(217, 119, 6, 0.1), rgba(251, 191, 36, 0.14));
    --tok-sky: light-dark(#0284c7, #38bdf8);
    --tok-sky-bg: light-dark(rgba(2, 132, 199, 0.1), rgba(56, 189, 248, 0.14));
    --tok-emerald: light-dark(#059669, #34d399);
    --tok-emerald-bg: light-dark(rgba(5, 150, 105, 0.1), rgba(52, 211, 153, 0.14));
    --tok-indigo: light-dark(#4f46e5, #818cf8);
    --tok-indigo-bg: light-dark(rgba(79, 70, 229, 0.1), rgba(129, 140, 248, 0.14));
    --tok-cyan: light-dark(#0891b2, #22d3ee);
    --tok-cyan-bg: light-dark(rgba(8, 145, 178, 0.1), rgba(34, 211, 238, 0.14));
    --tok-rose: light-dark(#e11d48, #fb7185);
    --tok-rose-bg: light-dark(rgba(225, 29, 72, 0.1), rgba(251, 113, 133, 0.14));
    --tok-orange: light-dark(#ea580c, #fb923c);
    --tok-orange-bg: light-dark(rgba(234, 88, 12, 0.1), rgba(251, 146, 60, 0.14));
    --tok-teal: light-dark(#0d9488, #2dd4bf);
    --tok-teal-bg: light-dark(rgba(13, 148, 136, 0.1), rgba(45, 212, 191, 0.14));
    --tok-fuchsia: light-dark(#c026d3, #e879f9);
    --tok-fuchsia-bg: light-dark(rgba(192, 38, 211, 0.1), rgba(232, 121, 249, 0.14));
    --tok-lime: light-dark(#65a30d, #a3e635);
    --tok-lime-bg: light-dark(rgba(101, 163, 13, 0.1), rgba(163, 230, 53, 0.14));
    --tok-slate: light-dark(#475569, #94a3b8);
    --tok-slate-bg: light-dark(rgba(71, 85, 105, 0.1), rgba(148, 163, 184, 0.14));
  }
  :root:has(> head > meta[name="color-scheme"][content="dark"]) { color-scheme: dark; }
  :root:has(> head > meta[name="color-scheme"][content="light"]) { color-scheme: light; }

  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: var(--bg); color: var(--text);
    font-family: var(--font-sans); font-size: 13px; line-height: 1.45;
  }
  body { display: flex; flex-direction: column; overflow: hidden; }
  code, .mono { font-family: var(--font-mono); font-size: 11.5px; }
  button, input, select { font: inherit; color: inherit; }

  dialog:modal { overscroll-behavior: contain; }
  dialog::backdrop {
    overflow: hidden; overscroll-behavior: contain;
    background: rgba(5, 8, 17, 0.65); backdrop-filter: blur(3px);
  }
  dialog {
    border: 1px solid var(--border-strong); border-radius: 12px;
    background: var(--surface); color: var(--text); box-shadow: var(--shadow-lg);
    padding: 0; max-width: 760px; width: calc(100vw - 32px);
  }

  .top-header {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 9px 16px; display: flex; flex-wrap: wrap;
    align-items: center; justify-content: space-between; gap: 10px;
  }
  .title-group { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .title-group h1 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
  .header-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }

  .btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 5px 10px; border-radius: 6px;
    border: 1px solid var(--border-strong); background: var(--surface-2);
    color: var(--text); font-size: 12px; font-weight: 600;
    cursor: pointer; text-decoration: none; white-space: nowrap;
    transition: border-color 0.12s, background 0.12s;
  }
  .btn:hover:not(:disabled) { border-color: var(--accent); background: var(--surface-3); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--accent); }
  .btn-danger { background: var(--danger-soft); border-color: var(--danger); color: var(--danger); }
  .btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }
  .btn-sm { padding: 3px 8px; font-size: 11px; }

  .kbd {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 1px 5px; border-radius: 4px;
    border: 1px solid var(--border-strong); background: var(--bg);
    color: var(--text-dim); font-family: var(--font-mono);
    font-size: 10.5px; font-weight: 600; line-height: 1.3;
  }

  .slice-badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 7px; border-radius: 999px;
    font-size: 10.5px; font-weight: 700; font-family: var(--font-mono);
    border: 1px solid currentColor; white-space: nowrap;
  }
  .slice-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; display: inline-block; }
  .kind-pill {
    display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 4px;
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text-dim);
  }
  .kind-pill.kind-global { color: var(--c-global); border-color: var(--c-global); }
  .kind-pill.kind-local { color: var(--accent); border-color: var(--accent); }
  .kind-pill.kind-generated { color: var(--c-generated); border-color: var(--c-generated); }

  .state-strip {
    background: var(--surface-2); border-bottom: 1px solid var(--border);
    padding: 7px 16px; display: flex; flex-wrap: wrap;
    align-items: center; justify-content: space-between; gap: 10px; font-size: 12px;
  }
  .state-metrics { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .state-kv { display: inline-flex; align-items: center; gap: 5px; }
  .state-kv .k {
    color: var(--text-faint); font-size: 10.5px; text-transform: uppercase;
    letter-spacing: 0.04em; font-weight: 700;
  }
  .url-hash-box {
    display: flex; align-items: center; gap: 6px;
    background: var(--bg); border: 1px solid var(--border-strong);
    border-radius: 6px; padding: 3px 8px; max-width: 520px; flex: 1; min-width: 220px;
  }
  .url-hash-box input {
    background: transparent; border: none; outline: none; width: 100%;
    font-family: var(--font-mono); font-size: 11px; color: var(--accent);
  }

  .prune-banner {
    margin: 8px 16px 0; padding: 8px 12px; border-radius: 8px;
    border: 1px solid var(--danger); background: var(--danger-soft);
    display: flex; flex-wrap: wrap; align-items: center;
    justify-content: space-between; gap: 10px; font-size: 12px;
  }
  .prune-banner.info { border-color: var(--accent); background: var(--accent-soft); }
  .prune-banner.success { border-color: var(--success); background: var(--success-soft); }

  .workspace-stage {
    position: relative; flex: 1; display: flex; min-height: 0; overflow: hidden;
  }
  .canvas-pane {
    flex: 1; display: flex; flex-direction: column; min-width: 0;
    background: var(--bg-canvas); position: relative; outline: none;
  }

  .dag-canvas-wrap {
    position: relative; flex: 1; overflow: hidden;
    background-image: radial-gradient(var(--border-strong) 1px, transparent 1px);
    background-size: 22px 22px; cursor: grab;
  }
  .dag-canvas-wrap:active { cursor: grabbing; }
  .dag-hud-top {
    position: absolute; top: 12px; left: 14px; right: 14px;
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 12px; pointer-events: none; z-index: 10;
  }
  .dag-hud-box {
    pointer-events: auto; background: var(--surface-glass); backdrop-filter: blur(6px);
    border: 1px solid var(--border-strong); border-radius: 8px;
    padding: 6px 10px; box-shadow: var(--shadow-lg);
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .dag-minimap {
    position: absolute; bottom: 14px; right: 14px; width: 220px; height: 136px;
    background: var(--surface-glass); border: 1px solid var(--border-strong);
    border-radius: 8px; box-shadow: var(--shadow-lg); z-index: 10;
    overflow: hidden; padding: 5px;
  }
  .dag-legend {
    position: absolute; bottom: 14px; left: 14px;
    background: var(--surface-glass); border: 1px solid var(--border-strong);
    border-radius: 8px; padding: 6px 10px;
    display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; z-index: 10;
  }

  .walker-node {
    background: var(--surface); border: 1.5px solid var(--border-strong);
    border-radius: 10px; padding: 9px 11px; cursor: pointer; user-select: none;
    transition: border-color 0.12s, box-shadow 0.12s; position: relative;
  }
  .walker-node:hover { border-color: var(--accent); }
  .walker-node.focused {
    border-color: var(--focus-ring); border-width: 2px;
    box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-lg);
  }
  .walker-node.is-root { background: linear-gradient(180deg, var(--accent-soft), var(--surface) 45%); }
  .walker-node.is-ghost {
    border-style: dashed; border-color: var(--warn);
    background: linear-gradient(180deg, var(--warn-soft), var(--surface) 55%);
  }
  .walker-node.will-prune { border-style: dashed; border-color: var(--danger); }
  .walker-node.will-retain { border-color: var(--success); }

  .node-top {
    display: flex; align-items: center; justify-content: space-between;
    gap: 6px; margin-bottom: 4px; flex-wrap: wrap;
  }
  .node-title { font-weight: 700; font-size: 12.5px; color: var(--text); line-height: 1.25; word-break: break-word; }
  .node-curie { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-dim); margin-top: 2px; word-break: break-all; }
  .node-meta-row {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 4px; margin-top: 6px; padding-top: 5px; border-top: 1px solid var(--border);
    font-size: 10.5px; color: var(--text-dim);
  }
  .root-pill {
    font-size: 9.5px; font-weight: 800; text-transform: uppercase;
    padding: 1px 5px; border-radius: 4px; background: var(--accent); color: #fff;
  }
  .ghost-pill {
    font-size: 9.5px; font-weight: 800; text-transform: uppercase;
    padding: 1px 5px; border-radius: 4px; background: var(--warn-soft);
    color: var(--warn); border: 1px solid var(--warn);
  }
  .prune-tag {
    font-size: 9.5px; font-weight: 700; padding: 1px 5px; border-radius: 4px;
    background: var(--danger-soft); color: var(--danger); border: 1px solid var(--danger);
  }
  .retain-tag {
    font-size: 9.5px; font-weight: 700; padding: 1px 5px; border-radius: 4px;
    background: var(--success-soft); color: var(--success); border: 1px solid var(--success);
  }
  .on-canvas-pill {
    font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px;
    background: var(--success-soft); color: var(--success); border: 1px solid var(--success);
  }
  .pred-pill {
    font-size: 10.5px; font-family: var(--font-mono); padding: 2px 6px; border-radius: 5px;
    background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--text);
  }

  .detail-drawer {
    width: 420px; max-width: 92vw; background: var(--surface);
    border-left: 1px solid var(--border-strong); box-shadow: -8px 0 28px rgba(0, 0, 0, 0.25);
    display: flex; flex-direction: column; z-index: 25; overflow-y: auto;
  }
  .detail-drawer[hidden] { display: none; }
  .drawer-header {
    padding: 13px 15px; border-bottom: 1px solid var(--border);
    background: var(--surface-2); display: flex; align-items: flex-start;
    justify-content: space-between; gap: 10px; position: sticky; top: 0; z-index: 2;
  }
  .drawer-body { padding: 13px 15px; display: flex; flex-direction: column; gap: 12px; }
  .drawer-section {
    border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 12px; background: var(--surface-2);
  }
  .drawer-section h3 {
    margin: 0 0 8px; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim);
  }
  .neighbor-row {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 6px 8px; border-radius: 6px; background: var(--surface);
    border: 1px solid var(--border); margin-bottom: 6px; font-size: 11.5px;
  }
  .neighbor-row:last-child { margin-bottom: 0; }
  .chain-row {
    padding: 6px 8px; border-radius: 6px; background: var(--surface);
    border: 1px solid var(--border); border-left: 3px solid var(--accent);
    margin-bottom: 6px; font-size: 11.5px;
  }
  .chain-row:last-child { margin-bottom: 0; }

  .palette-header {
    padding: 12px 16px; border-bottom: 1px solid var(--border);
    background: var(--surface-2); display: flex; flex-direction: column; gap: 8px;
  }
  .palette-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .palette-search-input {
    width: 100%; padding: 8px 11px; border-radius: 7px;
    border: 1.5px solid var(--border-strong); background: var(--bg);
    color: var(--text); font-size: 13px; outline: none;
  }
  .palette-search-input:focus { border-color: var(--accent); }
  .palette-filters { display: flex; flex-wrap: wrap; gap: 5px; }
  .palette-list { max-height: 54vh; overflow-y: auto; padding: 8px; }
  .palette-item {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 8px 10px; border-radius: 7px; cursor: pointer;
    border: 1px solid transparent; margin-bottom: 4px;
  }
  .palette-item:hover, .palette-item.selected {
    background: var(--accent-soft); border-color: var(--accent);
  }
  .palette-item-left { min-width: 0; flex: 1; }
  .palette-item-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
  .palette-footer {
    padding: 8px 14px; border-top: 1px solid var(--border); background: var(--surface-2);
    display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-dim);
  }
</style>
</head>
<body>
<header class="top-header">
  <div class="title-group">
    <h1 id="app-title">${pageTitle}</h1>
    <span class="kind-pill" id="sys-version-pill"></span>
  </div>
  <div class="header-actions">
    <button type="button" class="btn btn-sm" id="btn-open-space" title="Walk Connected Neighbors (Space)">
      <span class="kbd">Space</span> Walk
    </button>
    <button type="button" class="btn btn-sm" id="btn-open-global" title="Global Fuzzy Jump (Ctrl + /)">
      <span class="kbd">Ctrl+/</span> Jump
    </button>
    <button type="button" class="btn btn-sm" id="btn-toggle-drawer" title="Toggle Detail Drawer (Enter)">
      <span class="kbd">Enter</span> Drawer
    </button>
    <button type="button" class="btn btn-sm btn-danger" id="btn-delete-focused" title="Cascade Delete Focused Node (Delete)">
      <span class="kbd">Del</span> Prune
    </button>
    <label class="btn btn-sm" style="cursor:pointer;">
      <input type="checkbox" id="chk-unwalked-hints" checked style="margin:0;" />
      Hints
    </label>
    <button type="button" class="btn btn-sm" id="btn-open-health">Health</button>
    <button type="button" class="btn btn-sm" id="btn-reset-meta">Meta</button>
    <select id="theme-select" class="btn btn-sm" aria-label="Color theme">
      <option value="light dark">Theme: Auto</option>
      <option value="dark">Theme: Dark</option>
      <option value="light">Theme: Light</option>
    </select>
  </div>
</header>

<section class="state-strip" id="state-strip" aria-label="Walk state and deep-link hash"></section>
<div id="prune-banner-slot"></div>

<main class="workspace-stage">
  <section class="canvas-pane" id="canvas-pane" tabindex="0" aria-label="Layered Graph Walker Canvas"></section>
  <aside class="detail-drawer" id="detail-drawer" hidden aria-label="Node Detail Drawer"></aside>
</main>

<dialog id="palette-dialog" closedby="any" aria-labelledby="palette-dialog-title">
  <div class="palette-header">
    <div class="palette-title-row">
      <strong id="palette-dialog-title" style="font-size:13.5px;">Command Palette</strong>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="slice-badge" id="palette-mode-badge"></span>
        <button type="button" class="btn btn-sm" id="btn-close-palette">Esc ✕</button>
      </div>
    </div>
    <input type="text" id="palette-search-input" class="palette-search-input" placeholder="Fuzzy filter by label, ID, predicate, or slice..." autocomplete="off" />
    <div class="palette-filters" id="palette-slice-filters"></div>
  </div>
  <div class="palette-list" id="palette-list" role="listbox"></div>
  <div class="palette-footer">
    <span id="palette-count-label"></span>
    <span><span class="kbd">↑↓</span> select · <span class="kbd">Enter</span> walk/jump · <span class="kbd">Shift+Enter</span> re-root · <span class="kbd">Esc</span> close</span>
  </div>
</dialog>

<dialog id="health-dialog" closedby="any" aria-labelledby="health-dialog-title">
  <div class="drawer-header">
    <div>
      <h2 id="health-dialog-title" style="margin:0; font-size:15px;">Ontology Health &amp; Bridge Diagnostics</h2>
      <div style="font-size:11.5px; color:var(--text-dim);">Compiled directly from registered <code>sys:OntologyGraph</code>, <code>sys:GraphBridge</code>, and <code>sys:LinkContract</code> declarations.</div>
    </div>
    <button type="button" class="btn btn-sm" id="btn-close-health">Esc ✕</button>
  </div>
  <div class="drawer-body" id="health-dialog-body" style="max-height:70vh; overflow-y:auto;"></div>
</dialog>

<script id="ontology-bundle-data">
window.__ONTOLOGY_BUNDLE__ = ${bundleJson};
</script>

<script id="graph-walker-runtime">
(function () {
  const BUNDLE = window.__ONTOLOGY_BUNDLE__;
  const READABLE_MAX = ${READABLE_HASH_MAX_LEN};
  const KNOWN_TOKENS = new Set([
    'violet', 'amber', 'sky', 'emerald', 'indigo', 'cyan',
    'rose', 'orange', 'teal', 'fuchsia', 'lime', 'slate'
  ]);

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function accentVars(token) {
    const t = String(token || 'slate').toLowerCase();
    if (KNOWN_TOKENS.has(t)) {
      return { color: 'var(--tok-' + t + ')', bg: 'var(--tok-' + t + '-bg)' };
    }
    let hash = 0;
    for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) % 360;
    return {
      color: 'hsl(' + hash + ' 70% 48%)',
      bg: 'hsla(' + hash + ' 70% 48% / 0.12)'
    };
  }

  function sliceBadgeHtml(slice) {
    if (!slice) return '';
    const v = accentVars(slice.accentToken);
    return '<span class="slice-badge" style="color:' + v.color + '; background:' + v.bg + ';">' +
      '<span class="slice-dot"></span>:' + escapeHtml(slice.slug) + '</span>';
  }

  // ── Pure WalkerEngine (mirrors TypeScript exports) ──
  const WalkerEngine = (function () {
    function indexBundle(bundle) {
      const sliceBySlug = new Map();
      bundle.slices.forEach((s, idx) => sliceBySlug.set(s.slug, { slice: s, idx }));
      const nodeById = new Map();
      const adj = new Map();
      bundle.nodes.forEach((n) => {
        nodeById.set(n.id, n);
        adj.set(n.id, []);
      });
      const predByCurie = new Map(bundle.predicates.map((p) => [p.curie, p]));
      for (const edge of bundle.edges) {
        const sNode = bundle.nodes[edge[0]];
        const pred = bundle.predicates[edge[1]];
        const tNode = bundle.nodes[edge[2]];
        if (!sNode || !tNode || !pred) continue;
        const sliceCross = sNode.sliceIdx !== tNode.sliceIdx;
        adj.get(sNode.id).push({
          neighborId: tNode.id,
          direction: 'outgoing',
          predicateCurie: pred.curie,
          verb: pred.forwardLabel,
          navPriority: pred.navPriority,
          edgeCategory: pred.edgeCategory,
          sliceCross
        });
        adj.get(tNode.id).push({
          neighborId: sNode.id,
          direction: 'incoming',
          predicateCurie: pred.curie,
          verb: pred.inverseLabel,
          navPriority: pred.navPriority,
          edgeCategory: pred.edgeCategory,
          sliceCross
        });
      }
      for (const list of adj.values()) {
        list.sort((a, b) => {
          if (a.navPriority !== b.navPriority) return a.navPriority - b.navPriority;
          const na = nodeById.get(a.neighborId);
          const nb = nodeById.get(b.neighborId);
          const la = na ? (bundle.slices[na.sliceIdx]?.layerOrder ?? 99) : 99;
          const lb = nb ? (bundle.slices[nb.sliceIdx]?.layerOrder ?? 99) : 99;
          if (la !== lb) return la - lb;
          return a.neighborId.localeCompare(b.neighborId);
        });
      }
      return { bundle, sliceBySlug, nodeById, predByCurie, adj };
    }

    function createRuntimeGhostNode(missingId, bundle) {
      const prefix = missingId.includes(':') ? missingId.slice(0, missingId.indexOf(':')) : '';
      let sliceIdx = 0;
      let kindIdx = 0;
      const matched = bundle.nodeKinds.findIndex((nk) => nk.kindSlug === prefix);
      if (matched >= 0) {
        kindIdx = matched;
        sliceIdx = bundle.nodeKinds[matched].sliceIdx;
      }
      return {
        id: missingId,
        iri: missingId,
        sliceIdx,
        kindIdx,
        label: missingId,
        summary: 'Unresolved node ID from a shared deep link. It may have been renamed or deleted.',
        props: [['unresolvedId', missingId]],
        drawerSections: [],
        links: [],
        ghost: true,
        ghostReason: 'stale-deep-link'
      };
    }

    function createInitialState(index, overrides) {
      const defSlice = index.bundle.slices.find((s) => s.ontologyKind === 'local') || index.bundle.slices[0];
      return Object.assign({
        mode: 'meta',
        rootNodeId: null,
        walkedNodes: [],
        walkedEdges: [],
        focusedNodeId: defSlice ? 'slice:' + defSlice.slug : 'slice:root',
        drawerOpen: false,
        healthOpen: false,
        showUnwalkedHints: true,
        showDeletePreview: true,
        runtimeGhosts: {},
        lastPruneReport: null,
        undoSnapshot: null,
        lastAction: 'Loaded ' + index.bundle.slices.length + ' Sub-Ontology slices (' + index.bundle.health.totalRealNodes + ' nodes).'
      }, overrides || {});
    }

    function computeCascadeDelete(state, targetNodeId) {
      if (state.mode !== 'walk' || !state.rootNodeId || !state.walkedNodes.includes(targetNodeId)) {
        return {
          resetToMeta: false,
          deletedNodeId: targetNodeId,
          prunedNodeIds: [],
          retainedDiamondNodeIds: [],
          survivingNodes: state.walkedNodes,
          survivingEdges: state.walkedEdges
        };
      }
      if (targetNodeId === state.rootNodeId) {
        return {
          resetToMeta: true,
          deletedNodeId: targetNodeId,
          prunedNodeIds: state.walkedNodes.filter((id) => id !== targetNodeId),
          retainedDiamondNodeIds: [],
          survivingNodes: [],
          survivingEdges: []
        };
      }
      const buildChildren = (edges, ignore) => {
        const m = new Map();
        for (const e of edges) {
          if (e.from === ignore || e.to === ignore) continue;
          if (!m.has(e.from)) m.set(e.from, []);
          m.get(e.from).push(e.to);
        }
        return m;
      };
      const fullChildren = buildChildren(state.walkedEdges, null);
      const prunedChildren = buildChildren(state.walkedEdges, targetNodeId);

      const desc = new Set();
      const qD = [targetNodeId];
      while (qD.length > 0) {
        const curr = qD.shift();
        for (const nxt of fullChildren.get(curr) || []) {
          if (nxt !== targetNodeId && !desc.has(nxt)) {
            desc.add(nxt);
            qD.push(nxt);
          }
        }
      }

      const reachable = new Set([state.rootNodeId]);
      const qR = [state.rootNodeId];
      while (qR.length > 0) {
        const curr = qR.shift();
        for (const nxt of prunedChildren.get(curr) || []) {
          if (!reachable.has(nxt)) {
            reachable.add(nxt);
            qR.push(nxt);
          }
        }
      }

      const survivingNodes = state.walkedNodes.filter((id) => reachable.has(id));
      const survivingSet = new Set(survivingNodes);
      const prunedNodeIds = state.walkedNodes.filter((id) => id !== targetNodeId && !survivingSet.has(id));
      const retainedDiamondNodeIds = [...desc].filter((id) => survivingSet.has(id));
      const survivingEdges = state.walkedEdges.filter((e) => survivingSet.has(e.from) && survivingSet.has(e.to));

      return {
        resetToMeta: false,
        deletedNodeId: targetNodeId,
        prunedNodeIds,
        retainedDiamondNodeIds,
        survivingNodes,
        survivingEdges
      };
    }

    function computeHopDepths(state) {
      const depths = new Map();
      if (state.mode !== 'walk' || !state.rootNodeId) return depths;
      depths.set(state.rootNodeId, 0);
      const q = [state.rootNodeId];
      while (q.length > 0) {
        const curr = q.shift();
        const d = depths.get(curr);
        for (const e of state.walkedEdges) {
          if (e.from === curr && !depths.has(e.to)) {
            depths.set(e.to, d + 1);
            q.push(e.to);
          }
        }
      }
      for (const id of state.walkedNodes) {
        if (!depths.has(id)) depths.set(id, 1);
      }
      return depths;
    }

    function getUnwalkedCanvasHints(index, state) {
      if (state.mode !== 'walk' || state.walkedNodes.length < 2) return [];
      const onCanvas = new Set(state.walkedNodes);
      const walkedPairs = new Set();
      for (const e of state.walkedEdges) {
        walkedPairs.add(e.from + '\\0' + e.to + '\\0' + e.predicate);
        walkedPairs.add(e.to + '\\0' + e.from + '\\0' + e.predicate);
      }
      const hints = [];
      for (const id of state.walkedNodes) {
        for (const nb of index.adj.get(id) || []) {
          if (nb.direction !== 'outgoing' || !onCanvas.has(nb.neighborId)) continue;
          if (walkedPairs.has(id + '\\0' + nb.neighborId + '\\0' + nb.predicateCurie)) continue;
          hints.push({ sourceId: id, targetId: nb.neighborId, predicateCurie: nb.predicateCurie });
        }
      }
      return hints;
    }

    function findFuzzyReplacements(index, missingId, limit) {
      const max = limit || 6;
      const raw = missingId.replace(/^ghost:/, '').toLowerCase();
      const baseName = raw.split(/[/:.#]/).filter(Boolean).pop() || raw;
      const tokens = raw.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
      const scored = [];
      for (const node of index.bundle.nodes) {
        if (node.ghost) continue;
        const idLow = node.id.toLowerCase();
        const labelLow = node.label.toLowerCase();
        let score = 0;
        if (idLow.endsWith(baseName) || labelLow === baseName) score += 60;
        if (idLow.includes(baseName) || labelLow.includes(baseName)) score += 30;
        for (const tok of tokens) {
          if (idLow.includes(tok)) score += 12;
          if (labelLow.includes(tok)) score += 8;
        }
        if (score > 0) scored.push({ node, score });
      }
      scored.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
      return scored.slice(0, max);
    }

    function reduce(state, action, index) {
      const resolveNode = (id) => index.nodeById.get(id) || state.runtimeGhosts[id];
      switch (action.type) {
        case 'RESET_TO_META': {
          const defSlice = index.bundle.slices.find((s) => s.ontologyKind === 'local') || index.bundle.slices[0];
          const focusMeta = action.focusMetaId || (defSlice ? 'slice:' + defSlice.slug : 'slice:root');
          return Object.assign({}, state, {
            mode: 'meta',
            rootNodeId: null,
            walkedNodes: [],
            walkedEdges: [],
            focusedNodeId: focusMeta,
            lastPruneReport: null,
            lastAction: 'Returned to Meta Constellation (' + focusMeta + ').'
          });
        }
        case 'FOCUS_NODE':
          return Object.assign({}, state, { focusedNodeId: action.nodeId, lastAction: 'Focused ' + action.nodeId + '.' });
        case 'TOGGLE_DRAWER': {
          const open = action.open !== undefined ? action.open : !state.drawerOpen;
          return Object.assign({}, state, { drawerOpen: open, lastAction: (open ? 'Opened' : 'Closed') + ' Detail Drawer.' });
        }
        case 'TOGGLE_UNWALKED_HINTS': {
          const show = action.show !== undefined ? action.show : !state.showUnwalkedHints;
          return Object.assign({}, state, { showUnwalkedHints: show });
        }
        case 'START_WALK_AT_NODE': {
          let node = resolveNode(action.nodeId);
          let ghosts = state.runtimeGhosts;
          if (!node) {
            node = createRuntimeGhostNode(action.nodeId, index.bundle);
            ghosts = Object.assign({}, state.runtimeGhosts, { [action.nodeId]: node });
          }
          const slice = index.bundle.slices[node.sliceIdx];
          return Object.assign({}, state, {
            mode: 'walk',
            rootNodeId: node.id,
            walkedNodes: [node.id],
            walkedEdges: [],
            focusedNodeId: node.id,
            drawerOpen: action.openDrawer !== undefined ? action.openDrawer : state.drawerOpen,
            runtimeGhosts: ghosts,
            lastPruneReport: null,
            lastAction: 'Started walk rooted at ' + node.id + (slice ? ' in :' + slice.slug : '') + '.'
          });
        }
        case 'WALK_STEP': {
          const fromId = action.fromId || state.focusedNodeId;
          const toId = action.toId;
          const fromNode = resolveNode(fromId);
          const toNode = resolveNode(toId);
          if (!fromNode || !toNode) return state;
          if (state.mode === 'meta') {
            return reduce(state, { type: 'START_WALK_AT_NODE', nodeId: toId }, index);
          }
          const alreadyOnCanvas = state.walkedNodes.includes(toId);
          const nextNodes = alreadyOnCanvas ? state.walkedNodes : state.walkedNodes.concat([toId]);
          const predMeta = index.predByCurie.get(action.predicate);
          const edgeId = fromId + '--' + action.predicate + '-->' + toId;
          const hasEdge = state.walkedEdges.some((e) => e.id === edgeId);
          const sliceCross = fromNode.sliceIdx !== toNode.sliceIdx;
          const nextEdges = hasEdge
            ? state.walkedEdges
            : state.walkedEdges.concat([{
                id: edgeId,
                from: fromId,
                to: toId,
                predicate: action.predicate,
                verb: action.verb || (predMeta ? predMeta.forwardLabel : action.predicate),
                direction: action.direction || 'outgoing',
                edgeCategory: action.edgeCategory || (predMeta ? predMeta.edgeCategory : 'intra'),
                sliceCross
              }]);
          return Object.assign({}, state, {
            mode: 'walk',
            walkedNodes: nextNodes,
            walkedEdges: nextEdges,
            focusedNodeId: toId,
            lastPruneReport: alreadyOnCanvas
              ? { kind: 'refocus', summary: toId + ' was already on canvas — linked (' + fromId + ' → ' + toId + ') & refocused.' }
              : null,
            lastAction: alreadyOnCanvas
              ? 'Linked & refocused ' + toId + '.'
              : 'Walked ' + fromId + ' → ' + toId + ' via ' + action.predicate + '.'
          });
        }
        case 'REPLACE_GHOST_NODE': {
          const repl = index.nodeById.get(action.replacementId);
          if (!repl) return state;
          const mapId = (id) => (id === action.ghostId ? repl.id : id);
          const nextNodes = [...new Set(state.walkedNodes.map(mapId))];
          const nextEdges = state.walkedEdges.map((e) => {
            const from = mapId(e.from);
            const to = mapId(e.to);
            const fn = resolveNode(from);
            const tn = resolveNode(to);
            return Object.assign({}, e, {
              id: from + '--' + e.predicate + '-->' + to,
              from,
              to,
              sliceCross: fn && tn ? fn.sliceIdx !== tn.sliceIdx : e.sliceCross
            });
          });
          const nextGhosts = Object.assign({}, state.runtimeGhosts);
          delete nextGhosts[action.ghostId];
          return Object.assign({}, state, {
            rootNodeId: state.rootNodeId ? mapId(state.rootNodeId) : null,
            walkedNodes: nextNodes,
            walkedEdges: nextEdges,
            focusedNodeId: mapId(state.focusedNodeId),
            runtimeGhosts: nextGhosts,
            lastPruneReport: { kind: 'ghost-replaced', summary: 'Replaced ghost ' + action.ghostId + ' with ' + repl.id + '.' },
            lastAction: 'Replaced ghost ' + action.ghostId + ' → ' + repl.id + '.'
          });
        }
        case 'CASCADE_DELETE_FOCUSED': {
          const targetId = action.targetId || state.focusedNodeId;
          if (state.mode !== 'walk') return state;
          const snap = {
            mode: state.mode,
            rootNodeId: state.rootNodeId,
            walkedNodes: state.walkedNodes.slice(),
            walkedEdges: state.walkedEdges.slice(),
            focusedNodeId: state.focusedNodeId
          };
          const res = computeCascadeDelete(state, targetId);
          if (res.resetToMeta) {
            const deletedNode = resolveNode(targetId);
            const slice = deletedNode ? index.bundle.slices[deletedNode.sliceIdx] : index.bundle.slices[0];
            return Object.assign({}, state, {
              mode: 'meta',
              rootNodeId: null,
              walkedNodes: [],
              walkedEdges: [],
              focusedNodeId: slice ? 'slice:' + slice.slug : 'slice:root',
              undoSnapshot: snap,
              lastPruneReport: {
                kind: 'root-reset',
                deletedNodeId: targetId,
                prunedNodeIds: res.prunedNodeIds,
                retainedDiamondNodeIds: [],
                summary: 'Deleted root ' + targetId + ' (' + res.prunedNodeIds.length + ' downstream cleared) — returned to Meta Constellation.'
              },
              lastAction: 'Deleted root ' + targetId + ' → Meta Constellation.'
            });
          }
          const parentEdge = state.walkedEdges.find((e) => e.to === targetId && res.survivingNodes.includes(e.from));
          const nextFocus = (parentEdge && parentEdge.from) || res.survivingNodes[res.survivingNodes.length - 1] || state.rootNodeId;
          const prunedText = res.prunedNodeIds.length > 0
            ? 'Pruned ' + res.prunedNodeIds.length + ' exclusive node(s): ' + res.prunedNodeIds.join(', ') + '.'
            : 'No downstream nodes pruned.';
          const retainedText = res.retainedDiamondNodeIds.length > 0
            ? ' Retained ' + res.retainedDiamondNodeIds.length + ' diamond-reachable node(s): ' + res.retainedDiamondNodeIds.join(', ') + '.'
            : '';
          return Object.assign({}, state, {
            walkedNodes: res.survivingNodes,
            walkedEdges: res.survivingEdges,
            focusedNodeId: nextFocus,
            undoSnapshot: snap,
            lastPruneReport: {
              kind: 'cascade-prune',
              deletedNodeId: targetId,
              prunedNodeIds: res.prunedNodeIds,
              retainedDiamondNodeIds: res.retainedDiamondNodeIds,
              summary: 'Deleted ' + targetId + '. ' + prunedText + retainedText
            },
            lastAction: 'Deleted ' + targetId + ' (' + res.prunedNodeIds.length + ' pruned, ' + res.retainedDiamondNodeIds.length + ' retained).'
          });
        }
        case 'UNDO_DELETE': {
          if (!state.undoSnapshot) return state;
          const s = state.undoSnapshot;
          return Object.assign({}, state, s, {
            undoSnapshot: null,
            lastPruneReport: null,
            lastAction: 'Undid last cascade delete.'
          });
        }
        case 'HYDRATE_WALK':
          return Object.assign({}, state, {
            mode: action.mode,
            rootNodeId: action.rootNodeId,
            walkedNodes: action.walkedNodes.slice(),
            walkedEdges: action.walkedEdges.slice(),
            focusedNodeId: action.focusedNodeId,
            drawerOpen: Boolean(action.drawerOpen),
            runtimeGhosts: action.runtimeGhosts || state.runtimeGhosts,
            lastPruneReport: null,
            lastAction: action.lastAction || 'Restored from URL hash.'
          });
        default:
          return state;
      }
    }

    // ── 3-Tier Hash Codec (Browser CompressionStream + Sync Fallback) ──
    function encodePart(v) {
      return encodeURIComponent(v).replace(/%3A/g, ':').replace(/%2F/g, '/');
    }
    function bytesToB64Url(bytes) {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }
    function b64UrlToBytes(str) {
      const pad = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
      const bin = atob(pad);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    function buildReadableHash(state) {
      if (state.mode === 'meta' || !state.rootNodeId) {
        const parts = [];
        if (state.focusedNodeId && state.focusedNodeId.startsWith('slice:')) {
          parts.push('focus=' + encodePart(state.focusedNodeId));
        }
        if (state.drawerOpen) parts.push('drawer=1');
        return parts.length > 0 ? '#meta&' + parts.join('&') : '#meta';
      }
      const parts = ['root=' + encodePart(state.rootNodeId)];
      if (state.walkedEdges.length > 0) {
        parts.push('edges=' + state.walkedEdges.map((e) => encodePart(e.from) + '~' + encodePart(e.predicate) + '~' + encodePart(e.to)).join(','));
      }
      if (state.focusedNodeId && state.focusedNodeId !== state.rootNodeId) {
        parts.push('focus=' + encodePart(state.focusedNodeId));
      }
      if (state.drawerOpen) parts.push('drawer=1');
      return '#' + parts.join('&');
    }
    async function encodeHashAsync(state) {
      const readable = buildReadableHash(state);
      if (state.mode === 'meta' || !state.rootNodeId) {
        return { hash: readable, tier: 'meta', byteLength: readable.length };
      }
      if (readable.length <= READABLE_MAX) {
        return { hash: readable, tier: 'readable', byteLength: readable.length };
      }
      const json = JSON.stringify({
        r: state.rootNodeId,
        e: state.walkedEdges.map((e) => [e.from, e.predicate, e.to]),
        f: state.focusedNodeId,
        d: state.drawerOpen ? 1 : 0
      });
      const rawBytes = new TextEncoder().encode(json);
      if (typeof CompressionStream !== 'undefined') {
        try {
          const cs = new CompressionStream('deflate-raw');
          const w = cs.writable.getWriter();
          w.write(rawBytes);
          w.close();
          const buf = await new Response(cs.readable).arrayBuffer();
          const hash = '#g=v1.' + bytesToB64Url(new Uint8Array(buf));
          return { hash, tier: 'compressed', byteLength: hash.length };
        } catch (err) {}
      }
      const fallback = '#g=v1u.' + bytesToB64Url(rawBytes);
      return { hash: fallback, tier: 'compressed', byteLength: fallback.length };
    }
    function resolveLegacyHash(hash, index) {
      const clean = (hash || '').replace(/^#/, '');
      if (!clean.startsWith('/')) return null;
      const segs = clean.slice(1).split('/');
      if (segs.length < 2) return null;
      const kind = decodeURIComponent(segs[0]);
      const rest = decodeURIComponent(segs.slice(1).join('/'));
      if (index.nodeById.has(kind + ':' + rest)) return kind + ':' + rest;
      if (index.nodeById.has(rest)) return rest;
      const restLow = rest.toLowerCase();
      for (const n of index.bundle.nodes) {
        const nk = index.bundle.nodeKinds[n.kindIdx];
        if (nk && nk.kindSlug === kind && (n.id.toLowerCase().endsWith(restLow) || n.label.toLowerCase() === restLow)) {
          return n.id;
        }
      }
      return kind + ':' + rest;
    }
    async function decodeHashAsync(hash, index) {
      const base = createInitialState(index);
      const raw = (hash || '').trim();
      if (!raw || raw === '#') return { state: base, legacyRedirect: false };

      const legacyId = resolveLegacyHash(raw, index);
      if (legacyId !== null) {
        const ghosts = {};
        if (!index.nodeById.has(legacyId)) ghosts[legacyId] = createRuntimeGhostNode(legacyId, index.bundle);
        return {
          state: Object.assign({}, base, {
            mode: 'walk',
            rootNodeId: legacyId,
            walkedNodes: [legacyId],
            walkedEdges: [],
            focusedNodeId: legacyId,
            drawerOpen: true,
            runtimeGhosts: ghosts,
            lastAction: 'Redirected legacy URL ' + raw + ' → ' + legacyId + '.'
          }),
          legacyRedirect: true
        };
      }

      const body = raw.startsWith('#') ? raw.slice(1) : raw;
      if (body === 'meta' || body.startsWith('meta&')) {
        const params = new URLSearchParams(body.startsWith('meta&') ? body.slice(5) : '');
        const focus = params.get('focus');
        return {
          state: Object.assign({}, base, {
            mode: 'meta',
            focusedNodeId: focus && focus.startsWith('slice:') ? focus : base.focusedNodeId,
            drawerOpen: params.get('drawer') === '1'
          }),
          legacyRedirect: false
        };
      }

      const hydrate = (rootId, triples, focusId, drawerOpen) => {
        const ghosts = {};
        const ensure = (id) => {
          const ex = index.nodeById.get(id) || ghosts[id];
          if (ex) return ex;
          const g = createRuntimeGhostNode(id, index.bundle);
          ghosts[id] = g;
          return g;
        };
        ensure(rootId);
        const walkedNodes = [rootId];
        const walkedEdges = [];
        for (const t of triples) {
          const from = t[0], pred = t[1], to = t[2];
          if (!from || !pred || !to) continue;
          const fn = ensure(from), tn = ensure(to);
          if (!walkedNodes.includes(from)) walkedNodes.push(from);
          if (!walkedNodes.includes(to)) walkedNodes.push(to);
          const pm = index.predByCurie.get(pred);
          walkedEdges.push({
            id: from + '--' + pred + '-->' + to,
            from, to, predicate: pred,
            verb: pm ? pm.forwardLabel : pred,
            direction: 'outgoing',
            edgeCategory: pm ? pm.edgeCategory : 'intra',
            sliceCross: fn.sliceIdx !== tn.sliceIdx
          });
        }
        return {
          state: Object.assign({}, base, {
            mode: 'walk',
            rootNodeId: rootId,
            walkedNodes,
            walkedEdges,
            focusedNodeId: focusId && walkedNodes.includes(focusId) ? focusId : rootId,
            drawerOpen,
            runtimeGhosts: ghosts,
            lastAction: 'Restored walk (' + walkedNodes.length + ' nodes, ' + walkedEdges.length + ' edges).'
          }),
          legacyRedirect: false
        };
      };

      if (body.startsWith('g=v1.') || body.startsWith('g=v1u.')) {
        try {
          const isDef = body.startsWith('g=v1.');
          const encoded = body.slice(isDef ? 5 : 6).split('&')[0];
          const bytes = b64UrlToBytes(encoded);
          let jsonStr;
          if (isDef && typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('deflate-raw');
            const w = ds.writable.getWriter();
            w.write(bytes);
            w.close();
            const buf = await new Response(ds.readable).arrayBuffer();
            jsonStr = new TextDecoder().decode(buf);
          } else {
            jsonStr = new TextDecoder().decode(bytes);
          }
          const parsed = JSON.parse(jsonStr);
          if (parsed && parsed.r) return hydrate(parsed.r, parsed.e || [], parsed.f || null, Boolean(parsed.d));
        } catch (err) {
          return { state: base, legacyRedirect: false };
        }
      }

      const params = new URLSearchParams(body);
      const root = params.get('root');
      if (root) {
        const rawEdges = params.get('edges') || '';
        const triples = rawEdges
          ? rawEdges.split(',').filter(Boolean).map((tok) => {
              const p = tok.split('~');
              return [decodeURIComponent(p[0] || ''), decodeURIComponent(p[1] || ''), decodeURIComponent(p[2] || '')];
            })
          : [];
        return hydrate(root, triples, params.get('focus'), params.get('drawer') === '1');
      }
      return { state: base, legacyRedirect: false };
    }

    return {
      indexBundle,
      createInitialState,
      createRuntimeGhostNode,
      computeCascadeDelete,
      computeHopDepths,
      getUnwalkedCanvasHints,
      findFuzzyReplacements,
      reduce,
      buildReadableHash,
      encodeHashAsync,
      decodeHashAsync
    };
  })();

  window.__WALKER_ENGINE__ = WalkerEngine;

  // Light-dismiss polyfill for <dialog closedby="any">
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e, d) => {
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const d of document.querySelectorAll('dialog[closedby="any"]')) {
      let downOut = false;
      d.addEventListener('pointerdown', (e) => { downOut = outside(e, d); });
      d.addEventListener('pointerup', (e) => { if (downOut && outside(e, d)) d.close(); });
    }
  }

  const index = WalkerEngine.indexBundle(BUNDLE);
  let state = WalkerEngine.createInitialState(index);
  let currentHashInfo = { hash: '#meta', tier: 'meta', byteLength: 5 };
  let hashSyncSeq = 0;

  const ui = {
    paletteMode: 'connected',
    paletteQuery: '',
    paletteSlice: 'all',
    paletteIndex: 0,
    paletteCandidates: [],
    paletteTotalMatches: 0,
    panX: 0,
    panY: 0,
    zoom: 1
  };

  function getNode(id) {
    return index.nodeById.get(id) || state.runtimeGhosts[id] || null;
  }

  function dispatch(action) {
    state = WalkerEngine.reduce(state, action, index);
    syncHashAsync();
    render();
  }

  function syncHashAsync() {
    const seq = ++hashSyncSeq;
    const readable = WalkerEngine.buildReadableHash(state);
    currentHashInfo = {
      hash: readable,
      tier: state.mode === 'meta' ? 'meta' : readable.length <= READABLE_MAX ? 'readable' : 'compressed',
      byteLength: readable.length
    };
    WalkerEngine.encodeHashAsync(state).then((info) => {
      if (seq !== hashSyncSeq) return;
      currentHashInfo = info;
      try {
        history.replaceState(null, '', info.hash);
      } catch (e) {
        try { window.location.hash = info.hash; } catch (e2) {}
      }
      renderStateStrip();
    });
  }

  // ── Header Version Pill ──
  const verPill = document.getElementById('sys-version-pill');
  verPill.textContent = (BUNDLE.system.versionInfo ? 'v' + BUNDLE.system.versionInfo + ' · ' : '') +
    BUNDLE.slices.length + ' slices · ' + BUNDLE.health.totalRealNodes + ' nodes';

  // ── Render State & Hash Strip ──
  function renderStateStrip() {
    const strip = document.getElementById('state-strip');
    const cascadePreview = state.mode === 'walk' && state.showDeletePreview
      ? WalkerEngine.computeCascadeDelete(state, state.focusedNodeId)
      : null;

    let previewHtml = '';
    if (cascadePreview) {
      if (cascadePreview.resetToMeta) {
        previewHtml = '<span class="prune-tag">Del on Root → Meta</span>';
      } else {
        previewHtml = '<span class="prune-tag">Del Prunes: ' + cascadePreview.prunedNodeIds.length + '</span>' +
          (cascadePreview.retainedDiamondNodeIds.length > 0
            ? '<span class="retain-tag">Diamond Retained: ' + cascadePreview.retainedDiamondNodeIds.length + '</span>'
            : '');
      }
    }

    const tierLabel = currentHashInfo.tier === 'compressed'
      ? '#g=v1. (' + currentHashInfo.byteLength + 'B)'
      : currentHashInfo.tier === 'readable'
      ? '#root= (' + currentHashInfo.byteLength + 'B)'
      : '#meta';

    strip.innerHTML =
      '<div class="state-metrics">' +
        '<span class="state-kv"><span class="k">Mode:</span><strong class="mono" style="color:var(--accent)">' + (state.mode === 'meta' ? 'META CONSTELLATION' : 'SPATIAL WALKED DAG') + '</strong></span>' +
        '<span class="state-kv"><span class="k">Root:</span><code>' + escapeHtml(state.rootNodeId || 'sys:MetaRoot') + '</code></span>' +
        '<span class="state-kv"><span class="k">Focused:</span><code style="color:var(--accent); font-weight:700;">' + escapeHtml(state.focusedNodeId) + '</code></span>' +
        '<span class="state-kv"><span class="k">Walked:</span><span><strong>' + state.walkedNodes.length + '</strong> nodes · <strong>' + state.walkedEdges.length + '</strong> edges</span></span>' +
        previewHtml +
      '</div>' +
      '<div class="url-hash-box" title="Live serverless deep-link URL hash">' +
        '<span class="kind-pill">' + escapeHtml(tierLabel) + '</span>' +
        '<input type="text" id="url-hash-input" readonly value="' + escapeHtml(currentHashInfo.hash) + '" aria-label="Deep-link URL hash" />' +
      '</div>';

    const inp = document.getElementById('url-hash-input');
    if (inp) inp.onclick = () => inp.select();
  }

  function renderPruneBanner() {
    const slot = document.getElementById('prune-banner-slot');
    if (!state.lastPruneReport) { slot.innerHTML = ''; return; }
    const rep = state.lastPruneReport;
    const cls = rep.kind === 'refocus' ? 'info' : rep.kind === 'ghost-replaced' ? 'success' : '';
    slot.innerHTML =
      '<div class="prune-banner ' + cls + '" role="status">' +
        '<div><strong>' + escapeHtml(rep.kind === 'root-reset' ? 'Root Deleted:' : rep.kind === 'refocus' ? 'Refocused & Linked:' : rep.kind === 'ghost-replaced' ? 'Ghost Resolved:' : 'Cascade Delete:') + '</strong> ' + escapeHtml(rep.summary) + '</div>' +
        '<div style="display:flex; gap:6px;">' +
          (state.undoSnapshot ? '<button type="button" class="btn btn-sm" id="btn-undo-prune">↶ Undo</button>' : '') +
          '<button type="button" class="btn btn-sm" id="btn-dismiss-prune">✕</button>' +
        '</div>' +
      '</div>';
    const undoBtn = document.getElementById('btn-undo-prune');
    if (undoBtn) undoBtn.onclick = () => dispatch({ type: 'UNDO_DELETE' });
    const disBtn = document.getElementById('btn-dismiss-prune');
    if (disBtn) disBtn.onclick = () => { state.lastPruneReport = null; renderPruneBanner(); };
  }

  function buildMetaSliceCardHtml(slice, idx, extraStyle) {
    const metaId = 'slice:' + slice.slug;
    const isFocused = state.focusedNodeId === metaId;
    const samples = BUNDLE.nodes.filter((n) => n.sliceIdx === idx && !n.ghost).slice(0, 3);
    const kindCls = 'kind-' + slice.ontologyKind;
    return '<div class="walker-node ' + (isFocused ? 'focused' : '') + '" data-meta-id="' + escapeHtml(metaId) + '" style="' + extraStyle + '">' +
      '<div class="node-top">' +
        sliceBadgeHtml(slice) +
        '<div style="display:flex; gap:5px; align-items:center;">' +
          '<span class="kind-pill ' + kindCls + '">' + escapeHtml(slice.ontologyKind) + '</span>' +
          '<span class="mono" style="font-size:10.5px; color:var(--text-dim);">L' + slice.layerOrder + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="node-title" style="font-size:13.5px;">' + escapeHtml(slice.label) + '</div>' +
      '<div class="node-curie">' + slice.stats.nodeCount + ' nodes · ' + slice.stats.kindCount + ' kind(s)</div>' +
      '<div style="font-size:11px; color:var(--text-dim); margin-top:4px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">' + escapeHtml(slice.comment) + '</div>' +
      '<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:7px;">' +
        samples.map((n) => '<button type="button" class="btn btn-sm" data-start-walk="' + escapeHtml(n.id) + '" style="font-size:10px; padding:2px 6px; max-width:120px; overflow:hidden; text-overflow:ellipsis;">▶ ' + escapeHtml(n.label) + '</button>').join('') +
      '</div>' +
      '<div class="node-meta-row">' +
        '<span class="mono" style="overflow:hidden; text-overflow:ellipsis; max-width:150px;">' + escapeHtml(slice.modules[0] || slice.slug) + '</span>' +
        '<span class="kbd" data-space-meta="' + escapeHtml(metaId) + '">Space: Pick</span>' +
      '</div>' +
    '</div>';
  }

  function buildEntityCardHtml(nodeId, cascadePreview, extraStyle) {
    const node = getNode(nodeId);
    if (!node) return '';
    const slice = BUNDLE.slices[node.sliceIdx];
    const nk = BUNDLE.nodeKinds[node.kindIdx];
    const isFocused = state.focusedNodeId === nodeId;
    const isRoot = state.rootNodeId === nodeId;
    const willPrune = state.showDeletePreview && cascadePreview && (cascadePreview.deletedNodeId === nodeId || cascadePreview.prunedNodeIds.includes(nodeId));
    const willRetain = state.showDeletePreview && cascadePreview && cascadePreview.retainedDiamondNodeIds.includes(nodeId);
    const deg = (index.adj.get(nodeId) || []).length;

    return '<div class="walker-node ' + (isFocused ? 'focused' : '') + ' ' + (isRoot ? 'is-root' : '') + ' ' + (node.ghost ? 'is-ghost' : '') + ' ' + (willPrune ? 'will-prune' : '') + ' ' + (willRetain ? 'will-retain' : '') + '" data-node-id="' + escapeHtml(node.id) + '" style="' + extraStyle + '">' +
      '<div class="node-top">' +
        sliceBadgeHtml(slice) +
        '<div style="display:flex; gap:4px; align-items:center;">' +
          (isRoot ? '<span class="root-pill">ROOT</span>' : '') +
          (node.ghost ? '<span class="ghost-pill">GHOST</span>' : '') +
          (willPrune ? '<span class="prune-tag">' + (cascadePreview.deletedNodeId === nodeId ? 'DEL' : 'PRUNE') + '</span>' : '') +
          (willRetain ? '<span class="retain-tag">RETAINED</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="node-title">' + escapeHtml(node.label) + '</div>' +
      '<div class="node-curie">' + escapeHtml(node.id) + '</div>' +
      '<div class="node-meta-row">' +
        '<span>' + escapeHtml(nk ? nk.badgeLabel : 'Node') + '</span>' +
        '<span class="kbd" data-space-node="' + escapeHtml(node.id) + '">Space +' + deg + '</span>' +
      '</div>' +
    '</div>';
  }

  // ── Variant B: Spatial Walked DAG Canvas + Minimap ──
  function renderCanvas(cascadePreview) {
    const pane = document.getElementById('canvas-pane');
    const depths = WalkerEngine.computeHopDepths(state);
    const positions = new Map();
    let W = 1240;
    let H = 640;

    if (state.mode === 'meta') {
      const cols = Math.min(3, Math.max(1, BUNDLE.slices.length));
      const cardW = 300;
      const cardH = 196;
      const gapX = 72;
      const gapY = 82;
      BUNDLE.slices.forEach((s, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = 70 + col * (cardW + gapX);
        const y = 76 + row * (cardH + gapY);
        positions.set('slice:' + s.slug, { x, y, w: cardW, h: cardH });
        W = Math.max(W, x + cardW + 90);
        H = Math.max(H, y + cardH + 90);
      });
    } else {
      const colMap = new Map();
      for (const id of state.walkedNodes) {
        const d = depths.get(id) ?? 0;
        if (!colMap.has(d)) colMap.set(d, []);
        colMap.get(d).push(id);
      }
      for (const [d, ids] of colMap.entries()) {
        ids.sort((a, b) => {
          const na = getNode(a);
          const nb = getNode(b);
          const la = na ? (BUNDLE.slices[na.sliceIdx]?.layerOrder ?? 99) : 99;
          const lb = nb ? (BUNDLE.slices[nb.sliceIdx]?.layerOrder ?? 99) : 99;
          return la - lb || a.localeCompare(b);
        });
        const colX = 72 + d * 310;
        const totalH = ids.length * 144;
        const startY = Math.max(72, (H - totalH) / 2);
        ids.forEach((id, idx) => {
          const y = startY + idx * 144;
          positions.set(id, { x: colX, y, w: 244, h: 116 });
          W = Math.max(W, colX + 340);
          H = Math.max(H, y + 180);
        });
      }
    }

    let edgesSvg =
      '<defs>' +
        '<marker id="dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="var(--accent)" /></marker>' +
        '<marker id="dag-bridge" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="var(--c-bridge)" /></marker>' +
        '<marker id="dag-global" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="var(--c-global)" /></marker>' +
        '<marker id="dag-gen" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="var(--c-generated)" /></marker>' +
      '</defs>';

    if (state.mode === 'meta') {
      const pairCount = new Map();
      for (const me of BUNDLE.metaEdges) {
        const sSlice = BUNDLE.slices[me.sourceSliceIdx];
        const tSlice = BUNDLE.slices[me.targetSliceIdx];
        if (!sSlice || !tSlice) continue;
        const sPos = positions.get('slice:' + sSlice.slug);
        const tPos = positions.get('slice:' + tSlice.slug);
        if (!sPos || !tPos) continue;

        const pairKey = Math.min(me.sourceSliceIdx, me.targetSliceIdx) + ':' + Math.max(me.sourceSliceIdx, me.targetSliceIdx);
        const offsetIdx = pairCount.get(pairKey) || 0;
        pairCount.set(pairKey, offsetIdx + 1);
        const curveOffset = (offsetIdx % 2 === 0 ? 1 : -1) * (18 + Math.floor(offsetIdx / 2) * 24);

        const x1 = sPos.x + sPos.w / 2;
        const y1 = sPos.y + sPos.h / 2;
        const x2 = tPos.x + tPos.w / 2;
        const y2 = tPos.y + tPos.h / 2;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 + curveOffset;
        const stroke = me.kind === 'localBridge' ? 'var(--c-bridge)' : me.kind === 'global' ? 'var(--c-global)' : 'var(--c-generated)';
        const marker = me.kind === 'localBridge' ? 'url(#dag-bridge)' : me.kind === 'global' ? 'url(#dag-global)' : 'url(#dag-gen)';
        const dash = me.kind === 'localBridge' ? '' : ' stroke-dasharray="5 3"';
        const pillText = me.predicateCurie + (me.assertionCount > 0 ? ' (' + me.assertionCount + ')' : '');
        const pillW = Math.min(180, Math.max(88, pillText.length * 6.2));
        edgesSvg +=
          '<path d="M ' + x1 + ' ' + y1 + ' Q ' + mx + ' ' + my + ' ' + x2 + ' ' + y2 + '" fill="none" stroke="' + stroke + '" stroke-width="1.9"' + dash + ' marker-end="' + marker + '" opacity="0.82" />' +
          '<g transform="translate(' + mx + ', ' + my + ')">' +
            '<rect x="' + (-pillW / 2) + '" y="-9" width="' + pillW + '" height="18" rx="5" fill="var(--surface)" stroke="' + stroke + '" stroke-width="1" />' +
            '<text x="0" y="3" text-anchor="middle" fill="var(--text)" font-size="9.5" font-family="ui-monospace, monospace">' + escapeHtml(pillText) + '</text>' +
          '</g>';
      }
    } else {
      if (state.showUnwalkedHints) {
        for (const h of WalkerEngine.getUnwalkedCanvasHints(index, state)) {
          const sPos = positions.get(h.sourceId);
          const tPos = positions.get(h.targetId);
          if (!sPos || !tPos) continue;
          edgesSvg += '<line x1="' + (sPos.x + sPos.w / 2) + '" y1="' + (sPos.y + sPos.h / 2) + '" x2="' + (tPos.x + tPos.w / 2) + '" y2="' + (tPos.y + tPos.h / 2) + '" stroke="var(--border-strong)" stroke-width="1.3" stroke-dasharray="5 5" opacity="0.55" />';
        }
      }
      for (const e of state.walkedEdges) {
        const sPos = positions.get(e.from);
        const tPos = positions.get(e.to);
        if (!sPos || !tPos) continue;
        const leftToRight = sPos.x <= tPos.x;
        const x1 = leftToRight ? sPos.x + sPos.w : sPos.x;
        const y1 = sPos.y + sPos.h / 2;
        const x2 = leftToRight ? tPos.x : tPos.x + tPos.w;
        const y2 = tPos.y + tPos.h / 2;
        const dx = Math.max(52, Math.abs(x2 - x1) * 0.45);
        const c1x = leftToRight ? x1 + dx : x1 - dx;
        const c2x = leftToRight ? x2 - dx : x2 + dx;
        const stroke = e.edgeCategory === 'localBridge' ? 'var(--c-bridge)' : e.edgeCategory === 'global' ? 'var(--c-global)' : e.edgeCategory === 'generatedLink' ? 'var(--c-generated)' : 'var(--accent)';
        const marker = e.edgeCategory === 'localBridge' ? 'url(#dag-bridge)' : e.edgeCategory === 'global' ? 'url(#dag-global)' : e.edgeCategory === 'generatedLink' ? 'url(#dag-gen)' : 'url(#dag-arrow)';
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 - 8;
        const pillW = Math.min(180, Math.max(92, e.predicate.length * 6.5));
        edgesSvg +=
          '<path d="M ' + x1 + ' ' + y1 + ' C ' + c1x + ' ' + y1 + ', ' + c2x + ' ' + y2 + ', ' + x2 + ' ' + y2 + '" fill="none" stroke="' + stroke + '" stroke-width="2.4" marker-end="' + marker + '" />' +
          '<g transform="translate(' + mx + ', ' + my + ')">' +
            '<rect x="' + (-pillW / 2) + '" y="-9" width="' + pillW + '" height="18" rx="5" fill="var(--surface)" stroke="' + stroke + '" />' +
            '<text x="0" y="3" text-anchor="middle" fill="var(--text)" font-size="9.5" font-family="ui-monospace, monospace">' + escapeHtml(e.predicate) + '</text>' +
          '</g>';
      }
    }

    // Minimap scaled to W x H
    const mmScaleX = 200 / Math.max(1, W);
    const mmScaleY = 104 / Math.max(1, H);
    let minimapNodesSvg = '';
    for (const [id, pos] of positions.entries()) {
      const isFocused = state.focusedNodeId === id;
      minimapNodesSvg += '<rect x="' + (pos.x * mmScaleX).toFixed(1) + '" y="' + (pos.y * mmScaleY).toFixed(1) + '" width="' + Math.max(4, pos.w * mmScaleX).toFixed(1) + '" height="' + Math.max(3, pos.h * mmScaleY).toFixed(1) + '" rx="2" fill="' + (isFocused ? 'var(--accent)' : 'var(--border-strong)') + '" />';
    }

    const cardsHtml = state.mode === 'meta'
      ? BUNDLE.slices.map((s, idx) => {
          const p = positions.get('slice:' + s.slug);
          return buildMetaSliceCardHtml(s, idx, 'position:absolute; left:' + p.x + 'px; top:' + p.y + 'px; width:' + p.w + 'px;');
        }).join('')
      : state.walkedNodes.map((id) => {
          const p = positions.get(id);
          return p ? buildEntityCardHtml(id, cascadePreview, 'position:absolute; left:' + p.x + 'px; top:' + p.y + 'px; width:' + p.w + 'px;') : '';
        }).join('');

    pane.innerHTML =
      '<div class="dag-canvas-wrap" id="dag-canvas-wrap">' +
        '<div class="dag-hud-top">' +
          '<div class="dag-hud-box">' +
            '<strong>' + (state.mode === 'meta' ? 'Meta Constellation' : 'Walked DAG Canvas') + '</strong>' +
            '<span style="color:var(--text-dim);">Drag to pan · Arrows focus · <span class="kbd">Space</span> ' + (state.mode === 'meta' ? 'pick slice node' : 'walk neighbor') + ' · <span class="kbd">Enter</span> details</span>' +
          '</div>' +
          '<div class="dag-hud-box">' +
            '<button type="button" class="btn btn-sm" id="dag-zoom-in">+</button>' +
            '<button type="button" class="btn btn-sm" id="dag-zoom-out">−</button>' +
            '<button type="button" class="btn btn-sm" id="dag-zoom-reset">Fit (' + Math.round(ui.zoom * 100) + '%)</button>' +
          '</div>' +
        '</div>' +
        '<div id="dag-transform-stage" style="position:relative; width:' + W + 'px; height:' + H + 'px; transform: translate(' + ui.panX + 'px, ' + ui.panY + 'px) scale(' + ui.zoom + '); transform-origin: 0 0;">' +
          '<svg width="' + W + '" height="' + H + '" style="position:absolute; inset:0; pointer-events:none; overflow:visible;">' + edgesSvg + '</svg>' +
          cardsHtml +
        '</div>' +
        '<div class="dag-legend">' +
          '<span><strong style="color:var(--c-bridge)">━━▶</strong> Local Bridge</span>' +
          '<span><strong style="color:var(--c-global)">╌╌▶</strong> Global</span>' +
          '<span><strong style="color:var(--c-generated)">╌╌▶</strong> Generated Link</span>' +
          '<span><strong style="color:var(--accent)">━━▶</strong> Intra-Slice</span>' +
          '<span><strong style="color:var(--text-dim)">╌╌╌</strong> Unwalked Hint</span>' +
        '</div>' +
        '<div class="dag-minimap" id="dag-minimap" title="Click to recenter canvas">' +
          '<div style="font-size:9.5px; font-weight:700; color:var(--text-dim); margin-bottom:2px;">MINIMAP (' + positions.size + ')</div>' +
          '<svg viewBox="0 0 205 108" width="100%" height="106">' + minimapNodesSvg + '</svg>' +
        '</div>' +
      '</div>';

    // Wire pan & zoom
    const wrap = document.getElementById('dag-canvas-wrap');
    let dragging = false, sx = 0, sy = 0;
    wrap.onmousedown = (e) => {
      if (e.target.closest('.walker-node') || e.target.closest('.dag-hud-box') || e.target.closest('.dag-minimap')) return;
      dragging = true;
      sx = e.clientX - ui.panX;
      sy = e.clientY - ui.panY;
    };
    window.onmousemove = (e) => {
      if (!dragging) return;
      ui.panX = e.clientX - sx;
      ui.panY = e.clientY - sy;
      const st = document.getElementById('dag-transform-stage');
      if (st) st.style.transform = 'translate(' + ui.panX + 'px, ' + ui.panY + 'px) scale(' + ui.zoom + ')';
    };
    window.onmouseup = () => { dragging = false; };
    wrap.onwheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      ui.zoom = Math.max(0.45, Math.min(1.8, ui.zoom + (e.deltaY < 0 ? 0.1 : -0.1)));
      render();
    };

    document.getElementById('dag-zoom-in').onclick = () => { ui.zoom = Math.min(1.8, ui.zoom + 0.15); render(); };
    document.getElementById('dag-zoom-out').onclick = () => { ui.zoom = Math.max(0.45, ui.zoom - 0.15); render(); };
    const resetView = () => { ui.panX = 0; ui.panY = 0; ui.zoom = 1; render(); };
    document.getElementById('dag-zoom-reset').onclick = resetView;
    document.getElementById('dag-minimap').onclick = resetView;
  }

  // ── Slide-out Detail Drawer (Enter) ──
  function renderDetailDrawer() {
    const drawer = document.getElementById('detail-drawer');
    if (!state.drawerOpen) { drawer.hidden = true; return; }
    drawer.hidden = false;

    if (state.focusedNodeId.startsWith('slice:')) {
      const slug = state.focusedNodeId.slice(6);
      const entry = index.sliceBySlug.get(slug);
      if (!entry) { drawer.hidden = true; return; }
      const { slice, idx } = entry;
      const kinds = BUNDLE.nodeKinds.filter((nk) => nk.sliceIdx === idx);
      const relatedMetaEdges = BUNDLE.metaEdges.filter((me) => me.sourceSliceIdx === idx || me.targetSliceIdx === idx);
      const sampleNodes = BUNDLE.nodes.filter((n) => n.sliceIdx === idx && !n.ghost).slice(0, 25);

      drawer.innerHTML =
        '<div class="drawer-header">' +
          '<div>' +
            '<div style="display:flex; gap:6px; align-items:center;">' + sliceBadgeHtml(slice) + '<span class="kind-pill kind-' + slice.ontologyKind + '">' + escapeHtml(slice.ontologyKind) + '</span></div>' +
            '<h2 style="margin:6px 0 2px; font-size:15px;">' + escapeHtml(slice.label) + '</h2>' +
            '<div class="mono" style="color:var(--text-dim);">' + escapeHtml(slice.graphIri) + '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-sm" id="btn-close-drawer">Esc ✕</button>' +
        '</div>' +
        '<div class="drawer-body">' +
          '<div class="drawer-section"><h3>Summary</h3><p style="margin:0; font-size:12px;">' + escapeHtml(slice.comment || 'Registered Sub-Ontology slice.') + '</p></div>' +
          '<div class="drawer-section"><h3>Walkable Node Kinds (' + kinds.length + ')</h3>' +
            kinds.map((nk) => '<div class="neighbor-row"><strong>' + escapeHtml(nk.badgeLabel) + '</strong><code style="color:var(--text-dim);">' + escapeHtml(nk.kindSlug) + ' · ' + escapeHtml(nk.selectorMode) + '</code></div>').join('') +
          '</div>' +
          '<div class="drawer-section"><h3>Modules (' + slice.modules.length + ')</h3>' +
            slice.modules.map((m) => '<div class="mono" style="padding:2px 0;">' + escapeHtml(m) + '</div>').join('') +
          '</div>' +
          '<div class="drawer-section"><h3>Cross-Slice Bridges &amp; Link Summaries (' + relatedMetaEdges.length + ')</h3>' +
            (relatedMetaEdges.length > 0
              ? relatedMetaEdges.map((me) => {
                  const s = BUNDLE.slices[me.sourceSliceIdx];
                  const t = BUNDLE.slices[me.targetSliceIdx];
                  return '<div class="neighbor-row" style="flex-direction:column; align-items:flex-start;">' +
                    '<div><code>' + escapeHtml(me.predicateCurie) + '</code> <span class="mono">(' + escapeHtml(s.slug) + ' → ' + escapeHtml(t.slug) + ')</span></div>' +
                    '<div style="font-size:11px; color:var(--text-dim);">' + escapeHtml(me.forwardLabel) + ' · ' + me.assertionCount + ' assertion(s)</div>' +
                  '</div>';
                }).join('')
              : '<div style="font-size:11.5px; color:var(--text-dim);">No cross-slice edges recorded.</div>') +
          '</div>' +
          '<div class="drawer-section"><h3>Sample Nodes (' + sampleNodes.length + ' of ' + slice.stats.nodeCount + ')</h3>' +
            sampleNodes.map((n) => '<div class="neighbor-row"><div style="min-width:0;"><div style="font-weight:600;">' + escapeHtml(n.label) + '</div><div class="mono" style="font-size:10.5px; color:var(--text-dim); word-break:break-all;">' + escapeHtml(n.id) + '</div></div><button type="button" class="btn btn-sm" data-start-walk="' + escapeHtml(n.id) + '">Walk ▶</button></div>').join('') +
          '</div>' +
        '</div>';
    } else {
      const node = getNode(state.focusedNodeId);
      if (!node) { drawer.hidden = true; return; }
      const slice = BUNDLE.slices[node.sliceIdx];
      const nk = BUNDLE.nodeKinds[node.kindIdx];
      const neighbors = index.adj.get(node.id) || [];

      let ghostHtml = '';
      if (node.ghost) {
        const suggestions = WalkerEngine.findFuzzyReplacements(index, node.id, 6);
        ghostHtml =
          '<div class="drawer-section" style="border-color:var(--warn); background:var(--warn-soft);">' +
            '<h3 style="color:var(--warn);">Unresolved Ghost Node (' + escapeHtml(node.ghostReason || 'missing') + ')</h3>' +
            '<p style="margin:0 0 8px; font-size:12px;">' + escapeHtml(node.summary) + '</p>' +
            '<div style="font-size:11px; font-weight:700; margin-bottom:6px;">Did you mean?</div>' +
            (suggestions.length > 0
              ? suggestions.map((s) =>
                  '<div class="neighbor-row">' +
                    '<div style="min-width:0;"><div style="font-weight:600;">' + escapeHtml(s.node.label) + '</div><div class="mono" style="font-size:10px; color:var(--text-dim); word-break:break-all;">' + escapeHtml(s.node.id) + '</div></div>' +
                    '<button type="button" class="btn btn-sm btn-primary" data-replace-ghost="' + escapeHtml(node.id) + '" data-replace-with="' + escapeHtml(s.node.id) + '">Replace</button>' +
                  '</div>'
                ).join('')
              : '<div style="font-size:11.5px; color:var(--text-dim);">No close fuzzy matches found.</div>') +
            '<div style="margin-top:8px;"><button type="button" class="btn btn-sm btn-danger" id="btn-ghost-delete">Delete Ghost Node</button></div>' +
          '</div>';
      }

      const linksHtml = node.links && node.links.length > 0
        ? '<div class="drawer-section"><h3>Jump Links (' + node.links.length + ')</h3><div style="display:flex; flex-wrap:wrap; gap:6px;">' +
            node.links.map((lk) => {
              const href = lk.kind === 'vscode'
                ? 'vscode://file/' + encodeURI(lk.target) + (lk.line ? ':' + lk.line : '')
                : lk.kind === 'playground'
                ? 'http://localhost:5173' + lk.target
                : lk.kind === 'storybook'
                ? 'http://localhost:6006/?path=/story/' + encodeURIComponent(lk.target)
                : lk.target;
              return '<a class="btn btn-sm" href="' + escapeHtml(href) + '" target="_blank" rel="noreferrer">' + escapeHtml(lk.kind.toUpperCase() + ': ' + lk.label) + ' ↗</a>';
            }).join('') +
          '</div></div>'
        : '';

      const propsHtml = node.props && node.props.length > 0
        ? '<div class="drawer-section"><h3>Attributes (' + node.props.length + ')</h3>' +
            node.props.map((pair) => '<div style="display:flex; justify-content:space-between; gap:8px; padding:4px 0; border-bottom:1px solid var(--border); font-size:11.5px;"><span style="color:var(--text-dim); font-weight:600;">' + escapeHtml(pair[0]) + '</span><code style="text-align:right; word-break:break-all;">' + escapeHtml(pair[1]) + '</code></div>').join('') +
          '</div>'
        : '';

      const sectionsHtml = (node.drawerSections || []).map((sec) =>
        '<div class="drawer-section"><h3>' + escapeHtml(sec.title) + '</h3>' +
          sec.items.map((item) =>
            '<div class="' + (sec.kind === 'chain' ? 'chain-row' : 'neighbor-row') + '" style="flex-direction:column; align-items:flex-start;">' +
              '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; width:100%; justify-content:space-between;">' +
                '<strong>' + escapeHtml(item.label) + '</strong>' +
                (item.badge ? '<span class="kind-pill">' + escapeHtml(item.badge) + '</span>' : '') +
              '</div>' +
              (item.detail ? '<div style="font-size:11px; color:var(--text-dim); margin-top:2px;">' + escapeHtml(item.detail) + '</div>' : '') +
              (item.meta ? '<div class="mono" style="font-size:10px; color:var(--text-faint); margin-top:2px;">' + escapeHtml(item.meta) + '</div>' : '') +
              (item.jumpNodeIds && item.jumpNodeIds.length > 0
                ? '<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:5px;">' +
                    item.jumpNodeIds.map((jid) => '<button type="button" class="btn btn-sm" data-start-walk="' + escapeHtml(jid) + '" style="font-size:10px; padding:1px 6px;">↗ ' + escapeHtml(jid) + '</button>').join('') +
                  '</div>'
                : '') +
            '</div>'
          ).join('') +
        '</div>'
      ).join('');

      const shownNeighbors = neighbors.slice(0, 40);
      const neighborsHtml =
        '<div class="drawer-section"><h3>Connected Neighbors (' + neighbors.length + ')</h3>' +
          (shownNeighbors.length > 0
            ? shownNeighbors.map((nb) => {
                const t = index.nodeById.get(nb.neighborId);
                if (!t) return '';
                const tSlice = BUNDLE.slices[t.sliceIdx];
                const onCanvas = state.walkedNodes.includes(t.id);
                return '<div class="neighbor-row">' +
                  '<div style="min-width:0;">' +
                    '<div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">' +
                      sliceBadgeHtml(tSlice) +
                      '<code style="font-size:10.5px;">' + (nb.direction === 'outgoing' ? '→ ' : '← ') + escapeHtml(nb.verb) + '</code>' +
                      (onCanvas ? '<span class="on-canvas-pill">On canvas</span>' : '') +
                    '</div>' +
                    '<div style="font-weight:600; margin-top:2px; word-break:break-word;">' + escapeHtml(t.label) + '</div>' +
                  '</div>' +
                  '<button type="button" class="btn btn-sm" data-walk-to="' + escapeHtml(t.id) + '" data-walk-pred="' + escapeHtml(nb.predicateCurie) + '" data-walk-verb="' + escapeHtml(nb.verb) + '" data-walk-dir="' + escapeHtml(nb.direction) + '" data-walk-cat="' + escapeHtml(nb.edgeCategory) + '">' + (onCanvas ? 'Refocus' : '+ Walk') + '</button>' +
                '</div>';
              }).join('') +
              (neighbors.length > shownNeighbors.length ? '<div style="font-size:11px; color:var(--text-dim); padding-top:4px;">Showing ' + shownNeighbors.length + ' of ' + neighbors.length + ' — press Space to fuzzy search all.</div>' : '')
            : '<div style="font-size:11.5px; color:var(--text-dim);">No connected edges.</div>') +
        '</div>';

      drawer.innerHTML =
        '<div class="drawer-header">' +
          '<div>' +
            '<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">' + sliceBadgeHtml(slice) + '<span class="kind-pill">' + escapeHtml(nk ? nk.badgeLabel : 'Node') + '</span>' + (node.ghost ? '<span class="ghost-pill">GHOST</span>' : '') + '</div>' +
            '<h2 style="margin:6px 0 2px; font-size:15px; word-break:break-word;">' + escapeHtml(node.label) + '</h2>' +
            '<div class="mono" style="color:var(--text-dim); word-break:break-all;">' + escapeHtml(node.id) + '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-sm" id="btn-close-drawer">Esc ✕</button>' +
        '</div>' +
        '<div class="drawer-body">' +
          ghostHtml +
          (node.summary ? '<div class="drawer-section"><h3>Summary</h3><p style="margin:0; font-size:12px;">' + escapeHtml(node.summary) + '</p></div>' : '') +
          linksHtml +
          propsHtml +
          sectionsHtml +
          neighborsHtml +
        '</div>';
    }

    const closeBtn = document.getElementById('btn-close-drawer');
    if (closeBtn) closeBtn.onclick = () => dispatch({ type: 'TOGGLE_DRAWER', open: false });
    const ghostDelBtn = document.getElementById('btn-ghost-delete');
    if (ghostDelBtn) ghostDelBtn.onclick = () => dispatch({ type: 'CASCADE_DELETE_FOCUSED' });
  }

  // ── Command Palette (Space & Ctrl + /) ──
  const paletteDialog = document.getElementById('palette-dialog');
  const paletteInput = document.getElementById('palette-search-input');
  document.getElementById('btn-close-palette').onclick = () => closePalette();

  function openPalette(mode, initialQuery, initialSlice) {
    ui.paletteMode = mode;
    ui.paletteQuery = initialQuery || '';
    if (initialSlice) {
      ui.paletteSlice = initialSlice;
    } else if (mode === 'connected' && state.mode === 'meta' && state.focusedNodeId.startsWith('slice:')) {
      ui.paletteSlice = state.focusedNodeId.slice(6);
    } else {
      ui.paletteSlice = 'all';
    }
    ui.paletteIndex = 0;
    paletteInput.value = ui.paletteQuery;
    renderPaletteContents();
    if (!paletteDialog.open) paletteDialog.showModal();
    paletteInput.focus();
    paletteInput.select();
  }

  function closePalette() {
    if (paletteDialog.open) paletteDialog.close();
    document.getElementById('canvas-pane')?.focus({ preventScroll: true });
  }

  function fuzzyScore(haystack, query) {
    if (!query) return 1;
    const h = haystack.toLowerCase();
    const q = query.toLowerCase();
    const idx = h.indexOf(q);
    if (idx === 0) return 100;
    if (idx > 0) return 60 - Math.min(30, idx);
    // Token match
    const toks = q.split(/\\s+/).filter(Boolean);
    if (toks.length > 1 && toks.every((t) => h.includes(t))) return 40;
    // Subsequence fuzzy match
    let qi = 0;
    for (let i = 0; i < h.length && qi < q.length; i++) {
      if (h[i] === q[qi]) qi++;
    }
    return qi === q.length ? 15 : 0;
  }

  function computePaletteCandidates() {
    const q = ui.paletteQuery.trim();
    const onCanvas = new Set(state.walkedNodes);
    const items = [];

    if (ui.paletteMode === 'connected') {
      if (state.mode === 'meta') {
        const targetSliceIdx = ui.paletteSlice === 'all' ? -1 : (index.sliceBySlug.get(ui.paletteSlice)?.idx ?? -1);
        for (const n of BUNDLE.nodes) {
          if (targetSliceIdx >= 0 && n.sliceIdx !== targetSliceIdx) continue;
          const sl = BUNDLE.slices[n.sliceIdx];
          const nk = BUNDLE.nodeKinds[n.kindIdx];
          const hay = n.label + ' ' + n.id + ' ' + sl.slug + ' ' + (nk ? nk.badgeLabel : '');
          const sc = fuzzyScore(hay, q);
          if (sc <= 0) continue;
          items.push({
            score: sc + (n.ghost ? -5 : 0),
            kind: 'slice-entry',
            nodeId: n.id,
            label: n.label,
            slice: sl,
            predicate: nk ? nk.badgeLabel : 'Node',
            verb: 'Start walk at ' + n.label,
            direction: 'outgoing',
            edgeCategory: 'intra',
            alreadyOnCanvas: false,
            summary: n.summary
          });
        }
      } else {
        const neighbors = index.adj.get(state.focusedNodeId) || [];
        for (const nb of neighbors) {
          const t = index.nodeById.get(nb.neighborId);
          if (!t) continue;
          const sl = BUNDLE.slices[t.sliceIdx];
          if (ui.paletteSlice !== 'all' && sl.slug !== ui.paletteSlice) continue;
          const hay = t.label + ' ' + t.id + ' ' + sl.slug + ' ' + nb.predicateCurie + ' ' + nb.verb;
          const sc = fuzzyScore(hay, q);
          if (sc <= 0) continue;
          items.push({
            score: sc + (100 - Math.min(99, nb.navPriority)) * 0.1,
            kind: 'neighbor',
            nodeId: t.id,
            label: t.label,
            slice: sl,
            predicate: nb.predicateCurie,
            verb: nb.verb,
            direction: nb.direction,
            edgeCategory: nb.edgeCategory,
            alreadyOnCanvas: onCanvas.has(t.id),
            summary: t.summary
          });
        }
      }
    } else {
      for (const sl of BUNDLE.slices) {
        if (ui.paletteSlice !== 'all' && sl.slug !== ui.paletteSlice) continue;
        const sc = fuzzyScore(sl.label + ' ' + sl.slug + ' slice:' + sl.slug + ' ' + sl.ontologyKind, q);
        if (sc > 0) {
          items.push({
            score: sc + 2,
            kind: 'meta-slice',
            nodeId: 'slice:' + sl.slug,
            label: ':' + sl.slug + ' — ' + sl.label,
            slice: sl,
            predicate: sl.ontologyKind,
            verb: 'Focus slice on Meta Constellation',
            direction: 'outgoing',
            edgeCategory: 'intra',
            alreadyOnCanvas: state.mode === 'meta',
            summary: sl.comment
          });
        }
      }
      for (const n of BUNDLE.nodes) {
        const sl = BUNDLE.slices[n.sliceIdx];
        if (ui.paletteSlice !== 'all' && sl.slug !== ui.paletteSlice) continue;
        const nk = BUNDLE.nodeKinds[n.kindIdx];
        const hay = n.label + ' ' + n.id + ' ' + sl.slug + ' ' + (nk ? nk.badgeLabel : '');
        const sc = fuzzyScore(hay, q);
        if (sc <= 0) continue;
        items.push({
          score: sc + (onCanvas.has(n.id) ? 5 : 0),
          kind: 'global-entity',
          nodeId: n.id,
          label: n.label,
          slice: sl,
          predicate: nk ? nk.badgeLabel : 'Node',
          verb: onCanvas.has(n.id) ? 'Refocus on canvas' : 'Start walk',
          direction: 'outgoing',
          edgeCategory: 'intra',
          alreadyOnCanvas: onCanvas.has(n.id),
          summary: n.summary
        });
      }
    }

    items.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
    return { total: items.length, top: items.slice(0, 80) };
  }

  function renderPaletteContents() {
    const titleEl = document.getElementById('palette-dialog-title');
    const badgeEl = document.getElementById('palette-mode-badge');
    const filtersEl = document.getElementById('palette-slice-filters');
    const listEl = document.getElementById('palette-list');
    const countEl = document.getElementById('palette-count-label');

    if (ui.paletteMode === 'connected') {
      if (state.mode === 'meta') {
        const slug = state.focusedNodeId.startsWith('slice:') ? state.focusedNodeId.slice(6) : BUNDLE.slices[0]?.slug;
        const sl = index.sliceBySlug.get(slug)?.slice;
        titleEl.textContent = 'Enter Slice — :' + (sl ? sl.slug + ' (' + sl.label + ')' : '');
        badgeEl.textContent = 'Space · Slice Entry';
      } else {
        const focal = getNode(state.focusedNodeId);
        titleEl.textContent = 'Walk Connected Neighbors from ' + (focal ? focal.label : state.focusedNodeId);
        badgeEl.textContent = 'Space · ' + state.focusedNodeId;
      }
    } else {
      titleEl.textContent = 'Global Fuzzy Jump across All ' + BUNDLE.slices.length + ' Slices';
      badgeEl.textContent = 'Ctrl + / · Global';
    }

    const filterSlugs = ['all'].concat(BUNDLE.slices.map((s) => s.slug));
    filtersEl.innerHTML = filterSlugs.map((sl) =>
      '<button type="button" class="btn btn-sm ' + (ui.paletteSlice === sl ? 'btn-primary' : '') + '" data-pal-slice="' + escapeHtml(sl) + '" style="padding:2px 7px; font-size:11px;">' + (sl === 'all' ? 'All (' + BUNDLE.slices.length + ')' : ':' + escapeHtml(sl)) + '</button>'
    ).join('');

    filtersEl.querySelectorAll('[data-pal-slice]').forEach((btn) => {
      btn.onclick = () => {
        ui.paletteSlice = btn.getAttribute('data-pal-slice');
        ui.paletteIndex = 0;
        renderPaletteContents();
        paletteInput.focus();
      };
    });

    const res = computePaletteCandidates();
    ui.paletteCandidates = res.top;
    ui.paletteTotalMatches = res.total;
    if (ui.paletteIndex >= ui.paletteCandidates.length) {
      ui.paletteIndex = Math.max(0, ui.paletteCandidates.length - 1);
    }

    countEl.textContent = res.total > res.top.length
      ? 'Showing ' + res.top.length + ' of ' + res.total + ' matches — type to narrow'
      : res.total + ' matching candidate(s)';

    if (ui.paletteCandidates.length === 0) {
      listEl.innerHTML = '<div style="padding:24px; text-align:center; color:var(--text-dim);">No matching nodes for "' + escapeHtml(ui.paletteQuery) + '".</div>';
      return;
    }

    listEl.innerHTML = ui.paletteCandidates.map((cand, idx) =>
      '<div class="palette-item ' + (idx === ui.paletteIndex ? 'selected' : '') + '" role="option" aria-selected="' + (idx === ui.paletteIndex) + '" data-cand-idx="' + idx + '">' +
        '<div class="palette-item-left">' +
          '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">' +
            '<strong>' + escapeHtml(cand.label) + '</strong>' +
            '<code style="color:var(--text-dim);">' + escapeHtml(cand.nodeId) + '</code>' +
            (cand.alreadyOnCanvas ? '<span class="on-canvas-pill">On canvas — refocus &amp; link</span>' : '') +
          '</div>' +
          (cand.summary ? '<div style="font-size:11px; color:var(--text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escapeHtml(cand.summary) + '</div>' : '') +
        '</div>' +
        '<div class="palette-item-right">' +
          '<span class="pred-pill" title="' + escapeHtml(cand.predicate) + '">' + (cand.direction === 'outgoing' ? '→ ' : '← ') + escapeHtml(cand.verb) + '</span>' +
          sliceBadgeHtml(cand.slice) +
        '</div>' +
      '</div>'
    ).join('');

    listEl.querySelectorAll('[data-cand-idx]').forEach((row) => {
      row.onclick = (e) => {
        const idx = Number(row.getAttribute('data-cand-idx'));
        selectPaletteCandidate(ui.paletteCandidates[idx], e.shiftKey);
      };
    });
  }

  function selectPaletteCandidate(cand, forceReRoot) {
    if (!cand) return;
    closePalette();
    if (cand.kind === 'meta-slice') {
      dispatch({ type: 'RESET_TO_META', focusMetaId: cand.nodeId });
      return;
    }
    if (forceReRoot || cand.kind === 'slice-entry' || state.mode === 'meta') {
      dispatch({ type: 'START_WALK_AT_NODE', nodeId: cand.nodeId });
      return;
    }
    if (ui.paletteMode === 'global') {
      if (state.walkedNodes.includes(cand.nodeId)) {
        dispatch({ type: 'FOCUS_NODE', nodeId: cand.nodeId });
      } else {
        dispatch({ type: 'START_WALK_AT_NODE', nodeId: cand.nodeId });
      }
      return;
    }
    dispatch({
      type: 'WALK_STEP',
      fromId: state.focusedNodeId,
      toId: cand.nodeId,
      predicate: cand.predicate,
      verb: cand.verb,
      direction: cand.direction,
      edgeCategory: cand.edgeCategory
    });
  }

  paletteInput.addEventListener('input', (e) => {
    ui.paletteQuery = e.target.value;
    ui.paletteIndex = 0;
    renderPaletteContents();
  });
  paletteDialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (ui.paletteCandidates.length > 0) {
        ui.paletteIndex = (ui.paletteIndex + 1) % ui.paletteCandidates.length;
        renderPaletteContents();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (ui.paletteCandidates.length > 0) {
        ui.paletteIndex = (ui.paletteIndex - 1 + ui.paletteCandidates.length) % ui.paletteCandidates.length;
        renderPaletteContents();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      selectPaletteCandidate(ui.paletteCandidates[ui.paletteIndex], e.shiftKey);
    }
  });

  // ── Secondary Health & Diagnostics Modal ──
  const healthDialog = document.getElementById('health-dialog');
  document.getElementById('btn-close-health').onclick = () => healthDialog.close();

  function openHealthModal() {
    const h = BUNDLE.health;
    const body = document.getElementById('health-dialog-body');
    const missingHist = h.historicalMissingTargets || [];
    body.innerHTML =
      '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:8px;">' +
        '<div class="drawer-section"><h3>Slices</h3><div style="font-size:20px; font-weight:800; color:var(--accent);">' + h.totalSlices + '</div><div style="font-size:11px; color:var(--text-dim);">' + h.totalNodeKinds + ' walkable kinds</div></div>' +
        '<div class="drawer-section"><h3>Nodes</h3><div style="font-size:20px; font-weight:800; color:var(--success);">' + h.totalRealNodes + '</div><div style="font-size:11px; color:var(--text-dim);">' + h.totalEdges + ' edges · ' + h.loadedFiles + ' files</div></div>' +
        '<div class="drawer-section"><h3>Contracts</h3><div style="font-size:20px; font-weight:800; color:var(--c-bridge);">' + h.totalBridges + ' / ' + h.totalLinkContracts + '</div><div style="font-size:11px; color:var(--text-dim);">Bridges / LinkContracts</div></div>' +
        '<div class="drawer-section"><h3>Historical Ghosts</h3><div style="font-size:20px; font-weight:800; color:var(--warn);">' + missingHist.length + '</div><div style="font-size:11px; color:var(--text-dim);">' + h.totalGhostNodes + ' unique ghost target(s)</div></div>' +
      '</div>' +
      (h.missingGeneratedGlobs.length > 0
        ? '<div class="drawer-section" style="border-color:var(--warn);"><h3>Missing Generated Globs (' + h.missingGeneratedGlobs.length + ')</h3>' +
            h.missingGeneratedGlobs.map((m) => '<div class="mono" style="padding:2px 0;">:' + escapeHtml(m.slug) + ' — ' + escapeHtml(m.glob) + '</div>').join('') +
          '</div>'
        : '') +
      '<div class="drawer-section"><h3>Cross-Slice Bridges &amp; Link Summaries (' + BUNDLE.metaEdges.length + ')</h3>' +
        '<table style="width:100%; border-collapse:collapse; font-size:11.5px;"><thead><tr style="border-bottom:1px solid var(--border); text-align:left; color:var(--text-dim);"><th style="padding:4px;">Predicate</th><th style="padding:4px;">Kind</th><th style="padding:4px;">Route</th><th style="padding:4px;">Count</th></tr></thead><tbody>' +
          BUNDLE.metaEdges.map((me) => {
            const s = BUNDLE.slices[me.sourceSliceIdx];
            const t = BUNDLE.slices[me.targetSliceIdx];
            return '<tr style="border-bottom:1px solid var(--border);"><td style="padding:4px;"><code>' + escapeHtml(me.predicateCurie) + '</code></td><td style="padding:4px;"><span class="kind-pill">' + escapeHtml(me.kind) + '</span></td><td style="padding:4px;">:' + escapeHtml(s.slug) + ' → :' + escapeHtml(t.slug) + '</td><td style="padding:4px;" class="mono">' + me.assertionCount + '</td></tr>';
          }).join('') +
        '</tbody></table>' +
      '</div>' +
      (missingHist.length > 0
        ? '<div class="drawer-section"><h3>Historical Missing Targets (' + missingHist.length + ')</h3>' +
            missingHist.slice(0, 30).map((rec) =>
              '<div class="neighbor-row">' +
                '<div style="min-width:0;"><div><code>' + escapeHtml(rec.sourceId) + '</code> → <code>' + escapeHtml(rec.predicateCurie) + '</code></div><div class="mono" style="font-size:10px; color:var(--text-dim); word-break:break-all;">' + escapeHtml(rec.targetIri) + '</div></div>' +
                '<button type="button" class="btn btn-sm" data-inspect-ghost-src="' + escapeHtml(rec.sourceId) + '" data-inspect-ghost-pred="' + escapeHtml(rec.predicateCurie) + '" data-inspect-ghost-id="' + escapeHtml(rec.ghostNodeId) + '">Inspect</button>' +
              '</div>'
            ).join('') +
          '</div>'
        : '');

    body.querySelectorAll('[data-inspect-ghost-src]').forEach((btn) => {
      btn.onclick = () => {
        healthDialog.close();
        const src = btn.getAttribute('data-inspect-ghost-src');
        const pred = btn.getAttribute('data-inspect-ghost-pred');
        const gid = btn.getAttribute('data-inspect-ghost-id');
        dispatch({ type: 'START_WALK_AT_NODE', nodeId: src });
        dispatch({ type: 'WALK_STEP', fromId: src, toId: gid, predicate: pred });
        dispatch({ type: 'TOGGLE_DRAWER', open: true });
      };
    });
    healthDialog.showModal();
  }

  // ── Bind Workspace Events ──
  function bindWorkspaceEvents() {
    document.querySelectorAll('[data-node-id]').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest('[data-space-node]')) return;
        dispatch({ type: 'FOCUS_NODE', nodeId: card.getAttribute('data-node-id') });
      };
      card.ondblclick = () => {
        dispatch({ type: 'FOCUS_NODE', nodeId: card.getAttribute('data-node-id') });
        dispatch({ type: 'TOGGLE_DRAWER', open: true });
      };
    });
    document.querySelectorAll('[data-meta-id]').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest('[data-start-walk]') || e.target.closest('[data-space-meta]')) return;
        dispatch({ type: 'FOCUS_NODE', nodeId: card.getAttribute('data-meta-id') });
      };
      card.ondblclick = () => {
        dispatch({ type: 'FOCUS_NODE', nodeId: card.getAttribute('data-meta-id') });
        dispatch({ type: 'TOGGLE_DRAWER', open: true });
      };
    });
    document.querySelectorAll('[data-space-node]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        dispatch({ type: 'FOCUS_NODE', nodeId: btn.getAttribute('data-space-node') });
        openPalette('connected');
      };
    });
    document.querySelectorAll('[data-space-meta]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        dispatch({ type: 'FOCUS_NODE', nodeId: btn.getAttribute('data-space-meta') });
        openPalette('connected');
      };
    });
    document.querySelectorAll('[data-start-walk]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        dispatch({ type: 'START_WALK_AT_NODE', nodeId: btn.getAttribute('data-start-walk') });
      };
    });
    document.querySelectorAll('[data-walk-to]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        dispatch({
          type: 'WALK_STEP',
          fromId: state.focusedNodeId,
          toId: btn.getAttribute('data-walk-to'),
          predicate: btn.getAttribute('data-walk-pred'),
          verb: btn.getAttribute('data-walk-verb'),
          direction: btn.getAttribute('data-walk-dir'),
          edgeCategory: btn.getAttribute('data-walk-cat')
        });
      };
    });
    document.querySelectorAll('[data-replace-ghost]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        dispatch({
          type: 'REPLACE_GHOST_NODE',
          ghostId: btn.getAttribute('data-replace-ghost'),
          replacementId: btn.getAttribute('data-replace-with')
        });
      };
    });
  }

  function render() {
    renderStateStrip();
    renderPruneBanner();
    const cascadePreview = state.mode === 'walk' && state.showDeletePreview
      ? WalkerEngine.computeCascadeDelete(state, state.focusedNodeId)
      : null;
    renderCanvas(cascadePreview);
    renderDetailDrawer();
    bindWorkspaceEvents();
  }

  // ── Top Controls & Theme ──
  document.getElementById('btn-open-space').onclick = () => openPalette('connected');
  document.getElementById('btn-open-global').onclick = () => openPalette('global');
  document.getElementById('btn-toggle-drawer').onclick = () => dispatch({ type: 'TOGGLE_DRAWER' });
  document.getElementById('btn-delete-focused').onclick = () => dispatch({ type: 'CASCADE_DELETE_FOCUSED' });
  document.getElementById('btn-open-health').onclick = () => openHealthModal();
  document.getElementById('btn-reset-meta').onclick = () => dispatch({ type: 'RESET_TO_META' });
  document.getElementById('chk-unwalked-hints').onchange = (e) => {
    dispatch({ type: 'TOGGLE_UNWALKED_HINTS', show: e.target.checked });
  };

  const themeSelect = document.getElementById('theme-select');
  const metaScheme = document.querySelector('meta[name="color-scheme"]');
  themeSelect.value = metaScheme.content || 'light dark';
  themeSelect.onchange = (e) => {
    const val = e.target.value;
    metaScheme.content = val;
    try {
      if (val === 'light dark') localStorage.removeItem('wod-walker-color-scheme');
      else localStorage.setItem('wod-walker-color-scheme', val);
    } catch (err) {}
  };

  // ── Global Keyboard Loop ──
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      openPalette('global');
      return;
    }
    if (paletteDialog.open || healthDialog.open) return;

    if (e.key === 'Escape' && state.drawerOpen) {
      e.preventDefault();
      dispatch({ type: 'TOGGLE_DRAWER', open: false });
      return;
    }
    if (inInput) return;

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      openPalette('connected');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      dispatch({ type: 'TOGGLE_DRAWER' });
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      dispatch({ type: 'CASCADE_DELETE_FOCUSED' });
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const visible = state.mode === 'meta'
        ? BUNDLE.slices.map((s) => 'slice:' + s.slug)
        : state.walkedNodes;
      if (visible.length === 0) return;
      const idx = Math.max(0, visible.indexOf(state.focusedNodeId));
      const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      dispatch({ type: 'FOCUS_NODE', nodeId: visible[(idx + delta + visible.length) % visible.length] });
    }
  });

  // ── Hydrate Initial Hash & Listen to Hash Changes ──
  async function applyLocationHash() {
    const decoded = await WalkerEngine.decodeHashAsync(window.location.hash, index);
    state = decoded.state;
    if (decoded.legacyRedirect) {
      syncHashAsync();
    } else {
      const readable = WalkerEngine.buildReadableHash(state);
      currentHashInfo = {
        hash: window.location.hash || readable,
        tier: (window.location.hash || '').startsWith('#g=') ? 'compressed' : state.mode === 'meta' ? 'meta' : 'readable',
        byteLength: (window.location.hash || readable).length
      };
    }
    render();
  }

  window.addEventListener('hashchange', () => { applyLocationHash(); });
  applyLocationHash();
})();
</script>
</body>
</html>
`;
}

// ── CLI & Programmatic Builder ─────────────────────────────────────────────

export function buildViewer(options?: BuildViewerOptions): BuildViewerResult {
  const repoRoot = options?.repoRoot ?? REPO_ROOT;
  const outPath = options?.outPath ?? DEFAULT_OUT_HTML;
  const bundle = compileOntologyBundle({ ...options, repoRoot });
  const html = renderExplorerHtml(bundle);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  const byteLength = Buffer.byteLength(html, 'utf8');

  if (!options?.silent) {
    console.log(
      `Generated ${path.relative(repoRoot, outPath)} (${(byteLength / 1024).toFixed(1)} KB; ${bundle.slices.length} slices, ${bundle.health.totalRealNodes} nodes, ${bundle.health.totalGhostNodes} ghosts, ${bundle.edges.length} edges).`,
    );
  }

  return { outPath, html, bundle, byteLength };
}

if (import.meta.main) {
  buildViewer();
}
