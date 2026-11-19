#!/usr/bin/env bun
/**
 * Bidirectional Ontology Graph Query & Chain Projection CLI
 *
 * Usage:
 *   bun run ontology:query -- --pyramid
 *   bun run ontology:query -- --slice domain
 *   bun run ontology:query -- --node wod:SessionRun
 *   bun run ontology:query -- --journey JRN-01
 *   bun run ontology:query -- --file apps/playground/app/tour/HomeTour.tsx
 *   bun run ontology:query -- --symbol SessionRun
 *   bun run ontology:query -- --issue WW-010
 *   bun run ontology:query -- --chains
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  MultiGraphStore,
  loadRegisteredDataset,
  type RegisteredDataset,
} from './system-loader';

const REPO_ROOT = path.resolve(import.meta.dir, '../..');
const GENERATED_DIR = path.join(REPO_ROOT, 'ontology/generated');

interface Triple {
  s: string;
  p: string;
  o: string;
  isLiteral: boolean;
}

class GraphStore {
  readonly bySubj = new Map<string, Triple[]>();
  readonly byObj = new Map<string, Triple[]>();
  readonly byPred = new Map<string, Triple[]>();

  addAll(triples: Triple[]) {
    for (const t of triples) {
      const sl = this.bySubj.get(t.s) ?? [];
      sl.push(t);
      this.bySubj.set(t.s, sl);

      const pl = this.byPred.get(t.p) ?? [];
      pl.push(t);
      this.byPred.set(t.p, pl);

      if (!t.isLiteral) {
        const ol = this.byObj.get(t.o) ?? [];
        ol.push(t);
        this.byObj.set(t.o, ol);
      }
    }
  }

  vals(s: string, p: string): string[] {
    return (this.bySubj.get(s) ?? []).filter((t) => t.p === p).map((t) => t.o);
  }

  val(s: string, p: string): string | undefined {
    return this.vals(s, p)[0];
  }

  subjectsWith(p: string, o?: string): string[] {
    return (this.byPred.get(p) ?? [])
      .filter((t) => (o === undefined ? true : t.o === o))
      .map((t) => t.s);
  }

  incoming(o: string, p?: string): Triple[] {
    return (this.byObj.get(o) ?? []).filter((t) => (p === undefined ? true : t.p === p));
  }
}

function formatQueryTerm(mg: MultiGraphStore, iri: string): string {
  const compacted = mg.compact(iri);
  return compacted !== iri && !compacted.includes('/') ? compacted : iri;
}

function loadStore(): GraphStore {
  const mg = new MultiGraphStore();
  const files = [
    path.join(GENERATED_DIR, 'code-graph.ttl'),
    path.join(GENERATED_DIR, 'qa-instances.ttl'),
    path.join(GENERATED_DIR, 'bridge-instances.ttl'),
  ];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (fs.existsSync(file)) {
      mg.loadTurtle(fs.readFileSync(file, 'utf8'), { bnodePrefix: `q${i}_` });
    }
  }

  const store = new GraphStore();
  const seen = new Set<string>();
  const triples: Triple[] = [];
  for (const q of mg.quads()) {
    const s = formatQueryTerm(mg, q.subject.value);
    const p = formatQueryTerm(mg, q.predicate.value);
    const isLiteral = q.object.termType === 'Literal';
    const o = isLiteral ? q.object.value : formatQueryTerm(mg, q.object.value);
    const k = `${s}\0${p}\0${o}\0${isLiteral ? '1' : '0'}`;
    if (seen.has(k)) continue;
    seen.add(k);
    triples.push({ s, p, o, isLiteral });
  }
  store.addAll(triples);
  return store;
}

function queryBySlice(dataset: RegisteredDataset, sliceArg: string, jsonMode: boolean) {
  const nodes = dataset.materializeNodes();
  const edges = dataset.materializeEdges(nodes);
  const qLower = sliceArg.toLowerCase();

  if (qLower === 'all' || qLower === 'list') {
    const summary = dataset.system.slices.map((s) => ({
      slug: s.slug,
      graphIri: s.graphIri,
      ontologyKind: s.ontologyKind,
      layerOrder: s.layerOrder,
      label: s.label,
      nodeCount: nodes.filter((n) => n.sliceSlug === s.slug).length,
      nodeKinds: s.nodeKinds.map((nk) => nk.kindSlug),
    }));
    if (jsonMode) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    console.log('\n=== Registered Ontology Slices ===\n');
    for (const s of summary) {
      console.log(
        `  [L${s.layerOrder}] :${s.slug} (${s.ontologyKind}) — ${s.label} (${s.nodeCount} nodes; kinds: ${s.nodeKinds.join(', ')})`,
      );
    }
    return;
  }

  const slice = dataset.sliceBySlug.get(qLower);
  if (!slice) {
    const available = dataset.system.slices.map((s) => s.slug).join(', ');
    console.error(`Unknown slice "${sliceArg}". Available slices: ${available}`);
    process.exit(1);
  }

  const sliceNodes = nodes.filter((n) => n.sliceSlug === slice.slug);
  const byKind = new Map<string, number>();
  for (const n of sliceNodes) {
    byKind.set(n.kindSlug, (byKind.get(n.kindSlug) ?? 0) + 1);
  }
  const outboundBridges = dataset.system.bridges
    .filter((b) => b.sourceGraph === slice.graphIri)
    .map((b) => ({
      predicate: dataset.store.compact(b.bridgePredicate),
      targetSlice: dataset.sliceByGraphIri.get(b.targetGraph)?.slug ?? b.targetGraph,
      forwardLabel: b.forwardLabel,
    }));
  const inboundBridges = dataset.system.bridges
    .filter((b) => b.targetGraph === slice.graphIri)
    .map((b) => ({
      predicate: dataset.store.compact(b.bridgePredicate),
      sourceSlice: dataset.sliceByGraphIri.get(b.sourceGraph)?.slug ?? b.sourceGraph,
      inverseLabel: b.inverseLabel,
    }));
  const sliceEdges = edges.filter(
    (e) =>
      sliceNodes.some((n) => n.iri === e.sourceIri) ||
      sliceNodes.some((n) => n.iri === e.targetIri),
  );

  const result = {
    slug: slice.slug,
    graphIri: slice.graphIri,
    ontologyKind: slice.ontologyKind,
    layerOrder: slice.layerOrder,
    accentToken: slice.accentToken,
    label: slice.label,
    comment: slice.comment,
    nodeCount: sliceNodes.length,
    edgeCount: sliceEdges.length,
    countsByKind: Object.fromEntries([...byKind.entries()].sort(([a], [b]) => a.localeCompare(b))),
    outboundBridges,
    inboundBridges,
    nodes: sliceNodes.slice(0, 50).map((n) => ({ id: n.id, kind: n.kindSlug, label: n.label })),
  };

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n=== Slice :${result.slug} [${result.ontologyKind} | L${result.layerOrder}] ===`);
  console.log(`Label:   ${result.label}`);
  console.log(`Graph:   ${result.graphIri}`);
  if (result.comment) console.log(`Summary: ${result.comment}`);
  console.log(`Nodes:   ${result.nodeCount} | Incident Edges: ${result.edgeCount}`);
  console.log('Node Kinds:');
  for (const [k, count] of Object.entries(result.countsByKind)) {
    console.log(`  - ${k}: ${count}`);
  }
  if (outboundBridges.length > 0) {
    console.log('Outbound Bridges:');
    for (const b of outboundBridges) {
      console.log(`  - ${b.predicate} (${b.forwardLabel}) -> :${b.targetSlice}`);
    }
  }
  if (inboundBridges.length > 0) {
    console.log('Inbound Bridges:');
    for (const b of inboundBridges) {
      console.log(`  - :${b.sourceSlice} -> ${b.predicate} (${b.inverseLabel})`);
    }
  }
  if (result.nodes.length > 0) {
    console.log(`Sample Nodes (showing ${result.nodes.length}/${result.nodeCount}):`);
    for (const n of result.nodes.slice(0, 20)) {
      console.log(`  - [${n.kind}] ${n.id} (${n.label})`);
    }
  }
}

function queryByNode(dataset: RegisteredDataset, nodeQuery: string, jsonMode: boolean) {
  const nodes = dataset.materializeNodes();
  const qLower = nodeQuery.toLowerCase();
  const exact = nodes.filter(
    (n) => n.id.toLowerCase() === qLower || n.iri.toLowerCase() === qLower,
  );
  const matches =
    exact.length > 0
      ? exact
      : nodes.filter(
          (n) =>
            n.id.toLowerCase().includes(qLower) ||
            n.label.toLowerCase().includes(qLower) ||
            n.iri.toLowerCase().includes(qLower),
        );

  if (matches.length === 0) {
    console.error(`No ontology node found matching "${nodeQuery}".`);
    process.exit(1);
  }

  const edges = dataset.materializeEdges(nodes);
  const results = matches.slice(0, 10).map((n) => {
    const outgoing = edges
      .filter((e) => e.sourceIri === n.iri)
      .map((e) => ({
        predicate: e.predicateCurie,
        targetId: e.targetId ?? e.targetIri,
        category: e.category,
        derived: e.derived,
      }));
    const incoming = edges
      .filter((e) => e.targetIri === n.iri)
      .map((e) => ({
        predicate: e.predicateCurie,
        sourceId: e.sourceId,
        category: e.category,
        derived: e.derived,
      }));
    return {
      id: n.id,
      iri: n.iri,
      slice: n.sliceSlug,
      kind: n.kindSlug,
      badge: n.badgeLabel,
      label: n.label,
      summary: n.summary,
      outgoing,
      incoming,
    };
  });

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const r of results) {
    console.log(`\n=== Node: ${r.id} [:${r.slice} / ${r.badge}] ===`);
    console.log(`Label:   ${r.label}`);
    console.log(`IRI:     ${r.iri}`);
    if (r.summary) console.log(`Summary: ${r.summary}`);
    console.log(`Outgoing Edges (${r.outgoing.length}):`);
    for (const e of r.outgoing.slice(0, 20)) {
      console.log(`  -> ${e.predicate} ${e.targetId} [${e.category}${e.derived ? ', derived' : ''}]`);
    }
    console.log(`Incoming Edges (${r.incoming.length}):`);
    for (const e of r.incoming.slice(0, 20)) {
      console.log(`  <- ${e.sourceId} ${e.predicate} [${e.category}${e.derived ? ', derived' : ''}]`);
    }
  }
}

interface JourneyView {
  id: string;
  slug: string;
  title: string;
  domain: string;
  priority: string;
  summary: string;
  specFile?: string;
  playwrightSpec?: string;
  routes: string[];
  testIds: string[];
  seedNouns: string[];
  beats: Array<{ beat: string; label: string; order: number }>;
  touchedFiles: string[];
  touchedSymbols: Array<{ name: string; file: string; lineHint?: number }>;
  issues: Array<{ id: string; title: string; severity?: string; rootCauses: string[] }>;
}

function getJourneyView(store: GraphStore, jIri: string): JourneyView {
  const id = store.val(jIri, 'qa:journeyId') ?? jIri;
  const slug = store.val(jIri, 'qa:slug') ?? '';
  const title = store.val(jIri, 'qa:journeyTitle') ?? store.val(jIri, 'rdfs:label') ?? id;
  const domIri = store.val(jIri, 'qa:inDomain');
  const domain = domIri ? store.val(domIri, 'qa:domainSlug') ?? domIri : '';
  const priority = store.val(jIri, 'qa:priority') ?? '';
  const summary = store.val(jIri, 'rdfs:comment') ?? '';

  const specIri = store.val(jIri, 'bridge:specFile');
  const specFile = specIri ? store.val(specIri, 'code:filePath') ?? specIri : undefined;
  const pwIri = store.val(jIri, 'bridge:playwrightSpec');
  const playwrightSpec = pwIri ? store.val(pwIri, 'code:filePath') ?? pwIri : undefined;

  const routes = [...new Set(store.vals(jIri, 'bridge:route').map((r) => store.val(r, 'code:routePath') ?? r))];
  const testIds = [...new Set(store.vals(jIri, 'bridge:testId').map((t) => store.val(t, 'code:testIdValue') ?? t))];
  const seedNouns = [...new Set(store.vals(jIri, 'bridge:seedNoun'))];

  const stepIris = store.vals(jIri, 'qa:hasStep');
  const beats = stepIris
    .map((sIri) => ({
      beat: (store.val(sIri, 'qa:hasBeat') ?? '').replace(/^qa:/, ''),
      label: store.val(sIri, 'rdfs:label') ?? '',
      order: Number(store.val(sIri, 'qa:beatOrder') ?? 0),
    }))
    .sort((a, b) => a.order - b.order);

  // Touched files: direct bridge:touches + files that use the journey's testIds
  const touchedFileIris = new Set<string>(store.vals(jIri, 'bridge:touches'));
  for (const tidIri of store.vals(jIri, 'bridge:testId')) {
    for (const inc of store.incoming(tidIri, 'code:usesTestId')) {
      touchedFileIris.add(inc.s);
    }
  }
  const touchedFiles = [...touchedFileIris]
    .map((f) => store.val(f, 'code:filePath'))
    .filter((p): p is string => Boolean(p))
    .sort();

  const touchedSymbols: Array<{ name: string; file: string; lineHint?: number }> = [];
  for (const fIri of touchedFileIris) {
    const fPath = store.val(fIri, 'code:filePath');
    if (!fPath) continue;
    for (const inc of store.incoming(fIri, 'code:definedIn')) {
      if (store.vals(inc.s, 'rdf:type').includes('code:Symbol')) {
        const sName = store.val(inc.s, 'code:symbolName');
        const lineHint = store.val(inc.s, 'code:lineHint');
        if (sName) {
          touchedSymbols.push({
            name: sName,
            file: fPath,
            lineHint: lineHint ? Number(lineHint) : undefined,
          });
        }
      }
    }
  }

  const issueIriSet = new Set<string>([
    ...store.incoming(jIri, 'qa:affects').map((t) => t.s),
    ...store.incoming(jIri, 'qa:coveredBy').map((t) => t.s),
  ]);
  const issues = [...issueIriSet].map((iIri) => ({
    id: store.val(iIri, 'qa:issueId') ?? iIri.split('/').pop() ?? iIri,
    title: store.val(iIri, 'rdfs:label') ?? iIri,
    severity: store.val(iIri, 'qa:issueSeverity') ?? store.val(iIri, 'qa:severity'),
    rootCauses: store.vals(iIri, 'bridge:rootCause').map((rc) => store.val(rc, 'code:filePath') ?? store.val(rc, 'code:scipId') ?? rc),
  }));

  return {
    id,
    slug,
    title,
    domain,
    priority,
    summary,
    specFile,
    playwrightSpec,
    routes,
    testIds,
    seedNouns,
    beats,
    touchedFiles,
    touchedSymbols,
    issues,
  };
}

function queryByJourney(store: GraphStore, query: string, jsonMode: boolean) {
  const qLower = query.toLowerCase();
  const journeyIris = store.subjectsWith('rdf:type', 'qa:Journey');
  const matches = journeyIris.filter((j) => {
    const id = (store.val(j, 'qa:journeyId') ?? '').toLowerCase();
    const slug = (store.val(j, 'qa:slug') ?? '').toLowerCase();
    return id === qLower || slug === qLower || id.includes(qLower) || slug.includes(qLower);
  });

  if (matches.length === 0) {
    console.error(`No journey found matching "${query}".`);
    process.exit(1);
  }

  const views = matches.map((m) => getJourneyView(store, m));
  if (jsonMode) {
    console.log(JSON.stringify(views, null, 2));
    return;
  }

  for (const v of views) {
    console.log(`\n=== ${v.id}: ${v.title} [${v.domain} | ${v.priority}] ===`);
    console.log(`Spec:       ${v.specFile ?? 'n/a'}`);
    console.log(`Playwright: ${v.playwrightSpec ?? 'n/a'}`);
    console.log(`Routes:     ${v.routes.join(', ') || 'none'}`);
    console.log(`Seed Nouns: ${v.seedNouns.join(', ') || 'none'}`);
    console.log(`Test IDs:   ${v.testIds.join(', ') || 'none'}`);
    console.log('5-Beat Chain:');
    for (const b of v.beats) {
      console.log(`  ${b.order}. [${b.beat}] ${b.label}`);
    }
    console.log(`Touched Files (${v.touchedFiles.length}):`);
    for (const f of v.touchedFiles.slice(0, 20)) {
      console.log(`  - ${f}`);
    }
    if (v.touchedSymbols.length > 0) {
      console.log(`Touched Symbols (${v.touchedSymbols.length}, showing up to 15):`);
      for (const s of v.touchedSymbols.slice(0, 15)) {
        console.log(`  - ${s.name} (${s.file}:${s.lineHint ?? '?'})`);
      }
    }
    if (v.issues.length > 0) {
      console.log(`Covering Issues (${v.issues.length}):`);
      for (const iss of v.issues) {
        console.log(`  - ${iss.id} [${iss.severity ?? 'unknown'}]: ${iss.title} -> rootCause: ${iss.rootCauses.join(', ') || 'n/a'}`);
      }
    }
  }
}

function queryByFile(store: GraphStore, fileQuery: string, jsonMode: boolean) {
  const qLower = fileQuery.toLowerCase();
  const fileIris = store.subjectsWith('rdf:type', 'code:File');
  const matches = fileIris.filter((f) => {
    const p = (store.val(f, 'code:filePath') ?? '').toLowerCase();
    return p === qLower || p.endsWith(qLower) || p.includes(qLower);
  });

  if (matches.length === 0) {
    console.error(`No indexed file found matching "${fileQuery}".`);
    process.exit(1);
  }

  const results = matches.slice(0, 10).map((fIri) => {
    const filePath = store.val(fIri, 'code:filePath') ?? fIri;
    const pkg = store.val(fIri, 'code:packageName') ?? '';
    const symbols = store
      .incoming(fIri, 'code:definedIn')
      .filter((t) => store.vals(t.s, 'rdf:type').includes('code:Symbol'))
      .map((t) => ({
        name: store.val(t.s, 'code:symbolName') ?? t.s,
        kind: store.val(t.s, 'code:symbolKind') ?? '',
        lineHint: Number(store.val(t.s, 'code:lineHint') ?? 0),
        domainClasses: store.vals(t.s, 'bridge:implementsDomainClass'),
      }));

    const usedTestIds = store.vals(fIri, 'code:usesTestId').map((tid) => store.val(tid, 'code:testIdValue') ?? tid);

    // Connected journeys: via specFile, playwrightSpec, touches, testId overlap, or rootCause -> Issue -> coveredBy
    const journeySet = new Set<string>();
    for (const pred of ['bridge:specFile', 'bridge:playwrightSpec', 'bridge:touches']) {
      for (const inc of store.incoming(fIri, pred)) {
        if (store.vals(inc.s, 'rdf:type').includes('qa:Journey')) journeySet.add(inc.s);
      }
    }
    for (const tidIri of store.vals(fIri, 'code:usesTestId')) {
      for (const inc of store.incoming(tidIri, 'bridge:testId')) {
        if (store.vals(inc.s, 'rdf:type').includes('qa:Journey')) journeySet.add(inc.s);
      }
    }
    for (const inc of store.incoming(fIri, 'bridge:rootCause')) {
      for (const jIri of store.vals(inc.s, 'qa:coveredBy')) {
        if (store.vals(jIri, 'rdf:type').includes('qa:Journey')) journeySet.add(jIri);
      }
    }

    const journeys = [...journeySet].map((j) => ({
      id: store.val(j, 'qa:journeyId') ?? j,
      title: store.val(j, 'qa:journeyTitle') ?? '',
      domain: (store.val(j, 'qa:inDomain') ?? '').split('/').pop() ?? '',
      seedNouns: store.vals(j, 'bridge:seedNoun'),
    }));

    const seenIssues = new Set<string>();
    const issues = store
      .incoming(fIri, 'bridge:rootCause')
      .map((inc) => ({
        id: store.val(inc.s, 'qa:issueId') ?? inc.s.split('/').pop() ?? inc.s,
        title: store.val(inc.s, 'rdfs:label') ?? inc.s,
        severity: store.val(inc.s, 'qa:severity'),
      }))
      .filter((iss) => {
        if (seenIssues.has(iss.id)) return false;
        seenIssues.add(iss.id);
        return true;
      });

    const domainClasses = new Set<string>();
    for (const s of symbols) for (const c of s.domainClasses) domainClasses.add(c);
    for (const j of journeys) for (const c of j.seedNouns) domainClasses.add(c);

    return {
      filePath,
      packageName: pkg,
      symbols,
      usedTestIds,
      journeys,
      issues,
      domainClasses: [...domainClasses].sort(),
    };
  });

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const r of results) {
    console.log(`\n=== File: ${r.filePath} [${r.packageName}] ===`);
    console.log(`Domain Classes: ${r.domainClasses.join(', ') || 'none'}`);
    console.log(`Symbols (${r.symbols.length}):`);
    for (const s of r.symbols.slice(0, 20)) {
      const dom = s.domainClasses.length ? ` -> ${s.domainClasses.join(', ')}` : '';
      console.log(`  - ${s.kind} ${s.name} (lineHint:${s.lineHint})${dom}`);
    }
    if (r.usedTestIds.length > 0) {
      console.log(`Test IDs used: ${r.usedTestIds.join(', ')}`);
    }
    console.log(`Connected Journeys (${r.journeys.length}):`);
    for (const j of r.journeys) {
      console.log(`  - ${j.id} [${j.domain}]: ${j.title}`);
    }
    if (r.issues.length > 0) {
      console.log(`Root-Cause Issues (${r.issues.length}):`);
      for (const iss of r.issues) {
        console.log(`  - ${iss.id} [${iss.severity ?? 'unknown'}]: ${iss.title}`);
      }
    }
  }
}

function queryBySymbol(store: GraphStore, symQuery: string, jsonMode: boolean) {
  const qLower = symQuery.toLowerCase();
  const symIris = store.subjectsWith('rdf:type', 'code:Symbol');
  const matches = symIris.filter((s) => {
    const name = (store.val(s, 'code:symbolName') ?? '').toLowerCase();
    return name === qLower || name.includes(qLower);
  });

  if (matches.length === 0) {
    console.error(`No indexed symbol found matching "${symQuery}".`);
    process.exit(1);
  }

  const results = matches.slice(0, 20).map((sIri) => {
    const name = store.val(sIri, 'code:symbolName') ?? sIri;
    const kind = store.val(sIri, 'code:symbolKind') ?? '';
    const lineHint = Number(store.val(sIri, 'code:lineHint') ?? 0);
    const fIri = store.val(sIri, 'code:definedIn');
    const filePath = fIri ? store.val(fIri, 'code:filePath') ?? fIri : '';
    const domainClasses = store.vals(sIri, 'bridge:implementsDomainClass');

    const journeySet = new Set<string>();
    if (fIri) {
      for (const pred of ['bridge:specFile', 'bridge:playwrightSpec', 'bridge:touches']) {
        for (const inc of store.incoming(fIri, pred)) {
          if (store.vals(inc.s, 'rdf:type').includes('qa:Journey')) journeySet.add(inc.s);
        }
      }
      for (const tidIri of store.vals(fIri, 'code:usesTestId')) {
        for (const inc of store.incoming(tidIri, 'bridge:testId')) {
          if (store.vals(inc.s, 'rdf:type').includes('qa:Journey')) journeySet.add(inc.s);
        }
      }
    }

    return {
      name,
      kind,
      filePath,
      lineHint,
      domainClasses,
      journeys: [...journeySet].map((j) => ({
        id: store.val(j, 'qa:journeyId') ?? j,
        title: store.val(j, 'qa:journeyTitle') ?? '',
      })),
    };
  });

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const r of results) {
    console.log(
      `\n=== Symbol: ${r.kind} ${r.name} (${r.filePath}:${r.lineHint}) ===`,
    );
    console.log(`Domain Classes: ${r.domainClasses.join(', ') || 'none'}`);
    console.log(
      `Connected Journeys: ${r.journeys.map((j) => `${j.id} (${j.title})`).join(', ') || 'none'}`,
    );
  }
}

function analyzePyramid(store: GraphStore) {
  const allSuites = new Set<string>();
  for (const type of [
    'qa:VerificationSuite',
    'qa:FixtureTableSuite',
    'qa:StorageConformanceSuite',
    'qa:DomainScenarioSuite',
    'qa:HostSuite',
    'qa:StoryTest',
    'qa:Journey',
  ]) {
    for (const s of store.subjectsWith('rdf:type', type)) {
      allSuites.add(s);
    }
  }

  const suitesBySeam: Record<string, number> = {
    'T1a-compute': 0,
    'T1b-storage': 0,
    'T1c-domain': 0,
    'T2a-host': 0,
    'T2b-story': 0,
    'T3-journey': 0,
  };
  const suitesByTier: Record<string, number> = {
    T0: 0,
    T1: 0,
    T2: 0,
    T3: 0,
  };

  const suiteSeamMap = new Map<string, string>();
  for (const s of allSuites) {
    let seam = store.val(s, 'qa:seam');
    let tier = store.val(s, 'qa:tier');
    if (!seam) {
      const types = store.vals(s, 'rdf:type');
      if (types.includes('qa:FixtureTableSuite')) seam = 'T1a-compute';
      else if (types.includes('qa:StorageConformanceSuite')) seam = 'T1b-storage';
      else if (types.includes('qa:DomainScenarioSuite')) seam = 'T1c-domain';
      else if (types.includes('qa:HostSuite')) seam = 'T2a-host';
      else if (types.includes('qa:StoryTest')) seam = 'T2b-story';
      else if (types.includes('qa:Journey')) seam = 'T3-journey';
      else seam = 'T1a-compute';
    }
    if (!tier) {
      tier = seam.startsWith('T1') ? 'T1' : seam.startsWith('T2') ? 'T2' : 'T3';
    }
    suiteSeamMap.set(s, seam);
    if (suitesBySeam[seam] !== undefined) suitesBySeam[seam]++;
    if (suitesByTier[tier] !== undefined) suitesByTier[tier]++;
  }

  const domainClasses = new Set<string>([
    'wod:Note',
    'wod:Session',
    'wod:Notebook',
    'wod:Page',
    'wod:Effort',
    'wod:Equipment',
    'wod:Tag',
    'wod:Dashboard',
    'wod:Feed',
    'wod:FieldValue',
    'wod:Query',
    'wod:EventRecord',
    'wod:Metric',
    'wod:Attachment',
  ]);
  for (const t of store.subjectsWith('bridge:seedNoun')) {
    for (const noun of store.vals(t, 'bridge:seedNoun')) {
      if (noun.startsWith('wod:')) domainClasses.add(noun);
    }
  }

  const domainRows: Array<{
    domainClass: string;
    t1a: number;
    t1b: number;
    t1c: number;
    t2a: number;
    t2b: number;
    t3: number;
    status: 'balanced' | 'TOP-HEAVY' | 'uncovered';
  }> = [];
  const topHeavyNodes: Array<{
    kind: 'domain' | 'route';
    target: string;
    t3Journeys: number;
    lowerTierSuites: number;
  }> = [];

  for (const dc of [...domainClasses].sort()) {
    const seeders = store.subjectsWith('bridge:seedNoun', dc);
    let t1a = 0, t1b = 0, t1c = 0, t2a = 0, t2b = 0, t3 = 0;
    for (const s of seeders) {
      const seam = suiteSeamMap.get(s);
      if (seam === 'T1a-compute') t1a++;
      else if (seam === 'T1b-storage') t1b++;
      else if (seam === 'T1c-domain') t1c++;
      else if (seam === 'T2a-host') t2a++;
      else if (seam === 'T2b-story') t2b++;
      else if (seam === 'T3-journey') t3++;
    }
    const lowerTierCount = t1c + t2a + t2b;
    const isTopHeavy = t3 >= 2 && lowerTierCount === 0;
    const status = isTopHeavy ? 'TOP-HEAVY' : (t3 > 0 || lowerTierCount > 0 ? 'balanced' : 'uncovered');
    domainRows.push({ domainClass: dc, t1a, t1b, t1c, t2a, t2b, t3, status });
    if (isTopHeavy) {
      topHeavyNodes.push({
        kind: 'domain',
        target: dc,
        t3Journeys: t3,
        lowerTierSuites: lowerTierCount,
      });
    }
  }

  const routeNodes = store.subjectsWith('rdf:type', 'code:Route');
  const routeRows: Array<{
    route: string;
    t2a: number;
    t2b: number;
    t3: number;
    status: 'balanced' | 'TOP-HEAVY' | 'e2e-only' | 'component-only' | 'uncovered';
  }> = [];

  for (const rNode of routeNodes) {
    const routePath = store.val(rNode, 'code:routePath') ?? store.val(rNode, 'rdfs:label') ?? rNode;
    const callers = store.subjectsWith('bridge:route', rNode);
    let t2a = 0, t2b = 0, t3 = 0;
    for (const s of callers) {
      const seam = suiteSeamMap.get(s);
      if (seam === 'T2a-host') t2a++;
      else if (seam === 'T2b-story') t2b++;
      else if (seam === 'T3-journey') t3++;
    }
    const lowerTierCount = t2a + t2b;
    const isTopHeavy = t3 >= 2 && lowerTierCount === 0;
    let status: 'balanced' | 'TOP-HEAVY' | 'e2e-only' | 'component-only' | 'uncovered' = 'uncovered';
    if (isTopHeavy) {
      status = 'TOP-HEAVY';
      topHeavyNodes.push({
        kind: 'route',
        target: routePath,
        t3Journeys: t3,
        lowerTierSuites: lowerTierCount,
      });
    } else if (t3 > 0 && lowerTierCount > 0) {
      status = 'balanced';
    } else if (t3 > 0) {
      status = 'e2e-only';
    } else if (lowerTierCount > 0) {
      status = 'component-only';
    }
    routeRows.push({ route: routePath, t2a, t2b, t3, status });
  }
  routeRows.sort((a, b) => a.route.localeCompare(b.route));

  const issueNodes = store.subjectsWith('rdf:type', 'qa:Issue');
  const mismatchedIssues: Array<{
    issueId: string;
    title: string;
    rootCauses: string[];
    coveredBy: string[];
  }> = [];

  for (const iIri of issueNodes) {
    const issueId = store.val(iIri, 'qa:issueId') ?? iIri.split('/').pop() ?? iIri;
    const title = store.val(iIri, 'rdfs:label') ?? issueId;
    const rootCauses = store.vals(iIri, 'bridge:rootCause');
    const rcPaths: string[] = [];
    let hasPackageRc = false;
    for (const rc of rootCauses) {
      const p = store.val(rc, 'code:filePath') ?? store.val(rc, 'code:scipId') ?? rc;
      rcPaths.push(p);
      if (p.includes('packages/') || p.startsWith('packages/')) {
        hasPackageRc = true;
      }
    }
    if (!hasPackageRc) continue;

    const coveredBy = store.vals(iIri, 'qa:coveredBy');
    if (coveredBy.length === 0) continue;

    let hasLowerTier = false;
    const coveredByLabels: string[] = [];
    for (const cb of coveredBy) {
      const seam = suiteSeamMap.get(cb);
      const tier = store.val(cb, 'qa:tier');
      const label = store.val(cb, 'qa:journeyId') ?? store.val(cb, 'rdfs:label') ?? cb.split('/').pop() ?? cb;
      coveredByLabels.push(label);
      if (tier === 'T1' || tier === 'T2' || seam?.startsWith('T1') || seam?.startsWith('T2')) {
        hasLowerTier = true;
      }
    }

    if (!hasLowerTier) {
      mismatchedIssues.push({
        issueId,
        title,
        rootCauses: rcPaths,
        coveredBy: coveredByLabels,
      });
    }
  }
  mismatchedIssues.sort((a, b) => a.issueId.localeCompare(b.issueId));

  return {
    totalSuites: allSuites.size,
    suitesBySeam,
    suitesByTier,
    domainRows,
    routeRows,
    topHeavyNodes,
    mismatchedIssues,
  };
}

function reportPyramid(store: GraphStore, jsonMode: boolean) {
  const data = analyzePyramid(store);

  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('\n=== Testing Pyramid & Seam Coverage Diagnostic ===\n');
  console.log('Verification Suites by Seam:');
  console.log(`  - T1a-compute: ${data.suitesBySeam['T1a-compute']} (Fixture table suites)`);
  console.log(`  - T1b-storage: ${data.suitesBySeam['T1b-storage']} (Storage conformance suites)`);
  console.log(`  - T1c-domain:  ${data.suitesBySeam['T1c-domain']} (Domain scenario suites)`);
  console.log(`  - T2a-host:    ${data.suitesBySeam['T2a-host']} (App host route/state suites)`);
  console.log(`  - T2b-story:   ${data.suitesBySeam['T2b-story']} (Storybook component test suites)`);
  console.log(`  - T3-journey:  ${data.suitesBySeam['T3-journey']} (Playwright E2E journey suites)`);
  console.log(`Total Active Verification Suites: ${data.totalSuites}\n`);

  console.log('--- Domain Class Seam Coverage ---');
  console.log('| Domain Class   | T1a | T1b | T1c | T2a | T2b | T3  | Status |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of data.domainRows) {
    console.log(`| ${r.domainClass.padEnd(14)} | ${String(r.t1a).padStart(3)} | ${String(r.t1b).padStart(3)} | ${String(r.t1c).padStart(3)} | ${String(r.t2a).padStart(3)} | ${String(r.t2b).padStart(3)} | ${String(r.t3).padStart(3)} | ${r.status} |`);
  }

  console.log('\n--- Route Seam Coverage ---');
  console.log('| Route                          | T2a (Host) | T2b (Story) | T3 (Journey) | Status |');
  console.log('|---|---|---|---|---|');
  for (const r of data.routeRows) {
    console.log(`| ${r.route.padEnd(30)} | ${String(r.t2a).padStart(10)} | ${String(r.t2b).padStart(11)} | ${String(r.t3).padStart(12)} | ${r.status} |`);
  }

  console.log(`\n--- Top-Heavy Nodes (${data.topHeavyNodes.length}) ---`);
  if (data.topHeavyNodes.length === 0) {
    console.log('  No top-heavy nodes detected.');
  } else {
    for (const node of data.topHeavyNodes) {
      console.log(`  - [${node.kind.toUpperCase()}] ${node.target}: ${node.t3Journeys} journeys, ${node.lowerTierSuites} lower-tier suites`);
    }
  }

  console.log(`\n--- Mismatched Issue Coverage (${data.mismatchedIssues.length}) ---`);
  if (data.mismatchedIssues.length === 0) {
    console.log('  No mismatched issues detected.');
  } else {
    for (const issue of data.mismatchedIssues) {
      console.log(`  - ${issue.issueId}: "${issue.title}"`);
      console.log(`    Root Causes: ${issue.rootCauses.slice(0, 2).join(', ')}`);
      console.log(`    Covered By:  ${issue.coveredBy.join(', ')} (T3-journey only; missing T1/T2 regression suite)`);
    }
  }
}

function generateChainsMarkdown(store: GraphStore) {
  const journeyIris = [...new Set(store.subjectsWith('rdf:type', 'qa:Journey'))];
  const views = journeyIris.map((j) => getJourneyView(store, j)).sort((a, b) => a.id.localeCompare(b.id));
  const pyramid = analyzePyramid(store);

  const lines: string[] = [
    '# Unified Ontology 5-Beat Chain Projections & Pyramid Health',
    '',
    '> AUTO-GENERATED by `bun run ontology:query -- --chains` from `ontology/generated/`. Do not edit by hand.',
    '',
    '## Testing Pyramid Seam Health Summary',
    '',
    '| Seam | Execution Tier | Suite Class | Active Suites |',
    '|---|---|---|---|',
    `| \`T1a-compute\` | Tier 1 | \`qa:FixtureTableSuite\` | ${pyramid.suitesBySeam['T1a-compute']} |`,
    `| \`T1b-storage\` | Tier 1 | \`qa:StorageConformanceSuite\` | ${pyramid.suitesBySeam['T1b-storage']} |`,
    `| \`T1c-domain\` | Tier 1 | \`qa:DomainScenarioSuite\` | ${pyramid.suitesBySeam['T1c-domain']} |`,
    `| \`T2a-host\` | Tier 2 | \`qa:HostSuite\` | ${pyramid.suitesBySeam['T2a-host']} |`,
    `| \`T2b-story\` | Tier 2 | \`qa:StoryTest\` | ${pyramid.suitesBySeam['T2b-story']} |`,
    `| \`T3-journey\` | Tier 3 | \`qa:Journey\` | ${pyramid.suitesBySeam['T3-journey']} |`,
    '',
    `- **Total Active Suites**: ${pyramid.totalSuites}`,
    `- **Top-Heavy Nodes**: ${pyramid.topHeavyNodes.length}`,
    `- **Mismatched Issue Coverage**: ${pyramid.mismatchedIssues.length}`,
    '',
    `Total Journeys: **${views.length}**`,
    '',
    '| Journey | Domain | Priority | Seed (`wod:`) | Enter (Routes) | Sense (`TEST_IDS`) | Prove (Playwright) | Touched Files |',
    '|---|---|---|---|---|---|---|---|',
  ];

  for (const v of views) {
    lines.push(
      `| **${v.id}** | ${v.domain} | ${v.priority} | ${v.seedNouns.join(', ') || '—'} | ${v.routes.join(', ') || '—'} | ${v.testIds.slice(0, 4).join(', ') || '—'} | \`${v.playwrightSpec ?? '—'}\` | ${v.touchedFiles.length} |`,
    );
  }

  lines.push('', '## Detailed 5-Beat Chains', '');

  for (const v of views) {
    lines.push(`### ${v.id} — ${v.title}`);
    lines.push('');
    lines.push(`- **Domain**: \`${v.domain}\` | **Priority**: \`${v.priority}\``);
    if (v.specFile) lines.push(`- **Spec**: \`${v.specFile}\``);
    if (v.playwrightSpec) lines.push(`- **Playwright**: \`${v.playwrightSpec}\``);
    if (v.beats.length > 0) {
      lines.push(`- **5-Beat Causal Chain**:`);
      for (const b of v.beats) {
        lines.push(`  ${b.order}. **${b.beat}**: ${b.label}`);
      }
    } else {
      lines.push(`- **Status**: \`proposed\` (open journey slot)`);
    }
    if (v.touchedFiles.length > 0) {
      lines.push(`- **Touched Files**: ${v.touchedFiles.slice(0, 10).map((f) => `\`${f}\``).join(', ')}`);
    }
    if (v.issues.length > 0) {
      lines.push(`- **Issues**: ${v.issues.map((i) => `${i.id} (${i.title})`).join('; ')}`);
    }
    lines.push('');
  }

  const outPath = path.join(GENERATED_DIR, 'chains.md');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`Generated ${path.relative(REPO_ROOT, outPath)} (${views.length} journey chains).`);
}

function queryByIssue(store: GraphStore, issueQuery: string, jsonMode: boolean) {
  const qLower = issueQuery.toLowerCase();
  const issueIris = store.subjectsWith('rdf:type', 'qa:Issue');
  const matches = issueIris.filter((i) => {
    const id = (store.val(i, 'qa:issueId') ?? i.split('/').pop() ?? '').toLowerCase();
    return id === qLower || id.includes(qLower);
  });

  if (matches.length === 0) {
    console.error(`No issue found matching "${issueQuery}".`);
    process.exit(1);
  }

  const results = matches.map((iIri) => {
    const id = store.val(iIri, 'qa:issueId') ?? iIri.split('/').pop() ?? iIri;
    const title = store.val(iIri, 'rdfs:label') ?? id;
    const severity = store.val(iIri, 'qa:issueSeverity') ?? store.val(iIri, 'qa:severity') ?? '';
    const status = store.val(iIri, 'qa:issueStatus') ?? store.val(iIri, 'qa:status') ?? '';
    const firstSeenRun = store.val(iIri, 'qa:firstSeenRun')?.split('/').pop();
    const lastSeenRun = store.val(iIri, 'qa:lastSeenRun')?.split('/').pop();
    const affects = store.vals(iIri, 'qa:affects').map((d) => d.split('/').pop() ?? d);
    const coveredBy = store.vals(iIri, 'qa:coveredBy').map((j) => store.val(j, 'qa:journeyId') ?? j.split('/').pop() ?? j);
    const rootCauses = store.vals(iIri, 'bridge:rootCause').map((rc) => ({
      type: store.vals(rc, 'rdf:type').includes('code:Symbol') ? 'symbol' : 'file',
      ref: store.val(rc, 'code:scipId') ?? store.val(rc, 'code:filePath') ?? rc,
      lineHint: store.val(rc, 'code:lineHint'),
    }));
    return { id, title, severity, status, firstSeenRun, lastSeenRun, affects, coveredBy, rootCauses };
  });

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const r of results) {
    console.log(`\n=== Issue: ${r.id} [${r.severity} | ${r.status}] ===`);
    console.log(`Title:      ${r.title}`);
    console.log(`Runs:       firstSeen=${r.firstSeenRun ?? 'n/a'} | lastSeen=${r.lastSeenRun ?? 'n/a'}`);
    console.log(`Affects:    ${r.affects.join(', ') || 'none'}`);
    console.log(`Covered By: ${r.coveredBy.join(', ') || 'none'}`);
    console.log(`Root Causes (${r.rootCauses.length}):`);
    for (const rc of r.rootCauses) {
      console.log(`  - [${rc.type}] ${rc.ref}${rc.lineHint ? ` (lineHint:${rc.lineHint})` : ''}`);
    }
  }
}

// ── CLI Entrypoint ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const journeyArg = getFlag('--journey');
const fileArg = getFlag('--file');
const symbolArg = getFlag('--symbol');
const issueArg = getFlag('--issue');
const sliceArg = getFlag('--slice');
const nodeArg = getFlag('--node');
const chainsFlag = args.includes('--chains');
const pyramidFlag = args.includes('--pyramid');

if (sliceArg) {
  const dataset = loadRegisteredDataset(REPO_ROOT);
  queryBySlice(dataset, sliceArg, jsonMode);
} else if (nodeArg) {
  const dataset = loadRegisteredDataset(REPO_ROOT);
  queryByNode(dataset, nodeArg, jsonMode);
} else if (pyramidFlag) {
  const store = loadStore();
  reportPyramid(store, jsonMode);
} else if (journeyArg) {
  const store = loadStore();
  queryByJourney(store, journeyArg, jsonMode);
} else if (fileArg) {
  const store = loadStore();
  queryByFile(store, fileArg, jsonMode);
} else if (symbolArg) {
  const store = loadStore();
  queryBySymbol(store, symbolArg, jsonMode);
} else if (issueArg) {
  const store = loadStore();
  queryByIssue(store, issueArg, jsonMode);
} else if (chainsFlag) {
  const store = loadStore();
  generateChainsMarkdown(store);
} else {
  console.log(
    'Usage: bun run ontology:query -- [--pyramid | --slice <slug|list> | --node <id> | --journey <id> | --file <path> | --symbol <name> | --issue <id> | --chains] [--json]',
  );
  process.exit(1);
}
