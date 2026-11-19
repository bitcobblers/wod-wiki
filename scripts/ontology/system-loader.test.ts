import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_GRAPH,
  MultiGraphStore,
  RDF,
  SYS,
  XSD,
  compactIri,
  expandCurie,
  loadOntologySystem,
  loadRegisteredDataset,
  parseTriG,
  parseTurtle,
} from './system-loader';

const REPO_ROOT = path.resolve(import.meta.dir, '../..');

describe('expandCurie & compactIri', () => {
  const prefixes = {
    wod: 'https://wod.wiki/ontology#',
    sys: 'https://wod.wiki/ontology/system#',
    wodg: 'https://wod.wiki/graph/',
    root: 'https://wod.wiki/',
  };

  it('expands `a`, angle-bracket IRIs, CURIEs, and leaves full IRIs & blank nodes intact', () => {
    expect(expandCurie('a', prefixes)).toBe(RDF.type);
    expect(expandCurie('<https://example.org/x>', prefixes)).toBe('https://example.org/x');
    expect(expandCurie('sys:OntologyGraph', prefixes)).toBe(SYS.OntologyGraph);
    expect(expandCurie('https://wod.wiki/ontology#Note', prefixes)).toBe(
      'https://wod.wiki/ontology#Note',
    );
    expect(expandCurie('_:b1', prefixes)).toBe('_:b1');
  });

  it('compacts IRIs using the longest matching namespace prefix', () => {
    // `sys:` (https://wod.wiki/ontology/system#) must beat `root:` (https://wod.wiki/)
    expect(compactIri('https://wod.wiki/ontology/system#GraphBridge', prefixes)).toBe(
      'sys:GraphBridge',
    );
    expect(compactIri('https://wod.wiki/graph/domain', prefixes)).toBe('wodg:domain');
    expect(compactIri('https://unmatched.example/item', prefixes)).toBe(
      'https://unmatched.example/item',
    );
  });
});

describe('parseTurtle & parseTriG', () => {
  it('parses @prefix, PREFIX, @base, relative IRIs, literals, numbers, booleans, and ;/, lists', () => {
    const ttl = `
      @base <https://example.org/base/> .
      @prefix ex: <https://example.org/ns#> .
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
      @prefix : <https://example.org/default#> .

      <item/1> a ex:Thing, :Widget ;
        ex:title "Hello\\nWorld"@en-US ;
        ex:note """Line 1
Line 2 with "quotes" and trailing quote"""" ;
        ex:single '''Multi
single'''@fr ;
        ex:count 42 ;
        ex:ratio -3.14 ;
        ex:sci 1.5e-2 ;
        ex:active true ;
        ex:archived false ;
        ex:custom "2026-11-18"^^xsd:date ;
        ex:version ex:v1.2 ;
        ex:inlineEnd 7.
    `;

    const res = parseTurtle(ttl);
    const store = new MultiGraphStore();
    store.addPrefixes(res.prefixes);
    store.addQuads(res.quads);

    const subj = 'https://example.org/base/item/1';
    expect(store.typesOf(subj)).toEqual([
      'https://example.org/ns#Thing',
      'https://example.org/default#Widget',
    ]);

    const titleObj = store.objects(subj, 'ex:title')[0];
    expect(titleObj).toEqual({
      termType: 'Literal',
      value: 'Hello\nWorld',
      datatype: RDF.langString,
      language: 'en-us',
    });

    expect(store.literalValue(subj, 'ex:note')).toBe(
      'Line 1\nLine 2 with "quotes" and trailing quote"',
    );
    expect(store.literalValue(subj, 'ex:single')).toBe('Multi\nsingle');

    expect(store.objects(subj, 'ex:count')[0]).toEqual({
      termType: 'Literal',
      value: '42',
      datatype: XSD.integer,
    });
    expect(store.objects(subj, 'ex:ratio')[0]).toEqual({
      termType: 'Literal',
      value: '-3.14',
      datatype: XSD.decimal,
    });
    expect(store.objects(subj, 'ex:sci')[0]).toEqual({
      termType: 'Literal',
      value: '1.5e-2',
      datatype: XSD.double,
    });
    expect(store.booleanValue(subj, 'ex:active')).toBe(true);
    expect(store.booleanValue(subj, 'ex:archived')).toBe(false);
    expect(store.objects(subj, 'ex:custom')[0]).toEqual({
      termType: 'Literal',
      value: '2026-11-18',
      datatype: 'http://www.w3.org/2001/XMLSchema#date',
    });
    expect(store.iriValue(subj, 'ex:version')).toBe('https://example.org/ns#v1.2');
    expect(store.numberValue(subj, 'ex:inlineEnd')).toBe(7);
  });

  it('parses nested blank nodes [ ... ], standalone blank node subjects, and RDF collections ( ... )', () => {
    const ttl = `
      @prefix ex: <https://example.org/ns#> .
      @prefix sh: <http://www.w3.org/ns/shacl#> .

      ex:Shape a sh:NodeShape ;
        sh:property [
          sh:path ex:kind ;
          sh:in ( "alpha" "beta" "gamma" ) ;
        ] ;
        sh:or (
          [ sh:path ex:date ; sh:minCount 1 ]
          [ sh:path ex:slug ; sh:minCount 1 ]
        ) ;
        ex:emptyList () ;
        ex:emptyBnode [] .

      [ a ex:StandaloneBnode ; ex:tag "orphan" ] .
      [ a ex:SubjectBnode ] ex:pointsTo ex:Shape .
    `;

    const store = new MultiGraphStore();
    store.loadTurtle(ttl);

    const propBnodes = store.objects('ex:Shape', 'sh:property');
    expect(propBnodes).toHaveLength(1);
    expect(propBnodes[0].termType).toBe('BlankNode');

    const inHead = store.objects(propBnodes[0].value, 'sh:in')[0];
    const inItems = store.readList(inHead).map((t) => t.value);
    expect(inItems).toEqual(['alpha', 'beta', 'gamma']);

    const orHead = store.objects('ex:Shape', 'sh:or')[0];
    const orItems = store.readList(orHead);
    expect(orItems).toHaveLength(2);
    expect(store.iriValue(orItems[0].value, 'sh:path')).toBe('https://example.org/ns#date');
    expect(store.iriValue(orItems[1].value, 'sh:path')).toBe('https://example.org/ns#slug');

    expect(store.iriValue('ex:Shape', 'ex:emptyList')).toBe(RDF.nil);
    expect(store.objects('ex:Shape', 'ex:emptyBnode')[0].termType).toBe('BlankNode');

    const standalone = store.subjects(RDF.type, 'ex:StandaloneBnode');
    expect(standalone).toHaveLength(1);
    expect(store.literalValue(standalone[0], 'ex:tag')).toBe('orphan');

    const subjBnodes = store.subjects('ex:pointsTo', 'ex:Shape');
    expect(subjBnodes).toHaveLength(1);
    expect(store.typesOf(subjBnodes[0])).toEqual(['https://example.org/ns#SubjectBnode']);
  });

  it('parses TriG named-graph blocks (<iri> { }, curie { }, GRAPH <iri> { }, and default { })', () => {
    const trig = `
      @prefix ex: <https://example.org/ns#> .
      @prefix g:  <https://example.org/graph/> .

      ex:root a ex:Catalog .

      {
        ex:root ex:inDefaultBlock true
      }

      g:alpha {
        ex:A a ex:Node ; ex:label "Alpha"
      }

      <https://example.org/graph/beta> {
        ex:B a ex:Node ; ex:linksTo ex:A .
      } .

      GRAPH g:gamma {
        ex:C a ex:Node ; ex:linksTo ex:B .
      }
    `;

    const store = new MultiGraphStore();
    store.loadTriG(trig);

    expect(store.graphs()).toEqual([
      DEFAULT_GRAPH,
      'https://example.org/graph/alpha',
      'https://example.org/graph/beta',
      'https://example.org/graph/gamma',
    ]);
    expect(store.booleanValue('ex:root', 'ex:inDefaultBlock', DEFAULT_GRAPH)).toBe(true);
    expect(store.literalValue('ex:A', 'ex:label', 'https://example.org/graph/alpha')).toBe('Alpha');
    expect(store.iriValue('ex:B', 'ex:linksTo', 'https://example.org/graph/beta')).toBe(
      'https://example.org/ns#A',
    );
    expect(store.iriValue('ex:C', 'ex:linksTo', 'https://example.org/graph/gamma')).toBe(
      'https://example.org/ns#B',
    );
  });

  it('parses all committed repository Turtle & TriG ontology files cleanly', () => {
    const datasetTrig = fs.readFileSync(path.join(REPO_ROOT, 'ontology/dataset.trig'), 'utf8');
    const trigRes = parseTriG(datasetTrig);
    expect(trigRes.quads.length).toBeGreaterThan(10);

    const glob = new Bun.Glob('ontology/**/*.ttl');
    let parsedFiles = 0;
    let totalQuads = 0;
    for (const rel of glob.scanSync({ cwd: REPO_ROOT, onlyFiles: true })) {
      const normalized = rel.split(path.sep).join('/');
      if (normalized.startsWith('ontology/examples/') || normalized.startsWith('ontology/generated/')) {
        continue;
      }
      const raw = fs.readFileSync(path.join(REPO_ROOT, normalized), 'utf8');
      const res = parseTurtle(raw);
      parsedFiles++;
      totalQuads += res.quads.length;
    }
    expect(parsedFiles).toBeGreaterThan(15);
    expect(totalQuads).toBeGreaterThan(500);
  });
});

describe('MultiGraphStore transitive closures', () => {
  it('computes rdfs:subClassOf* and rdfs:subPropertyOf* closures safely including diamonds and cycles', () => {
    const store = new MultiGraphStore();
    store.loadTurtle(`
      @prefix ex: <https://example.org/ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

      ex:Entity a rdfs:Class .
      ex:Artifact rdfs:subClassOf ex:Entity .
      ex:Doc rdfs:subClassOf ex:Artifact .
      ex:Spec rdfs:subClassOf ex:Artifact .
      ex:Adr rdfs:subClassOf ex:Doc, ex:Spec .

      # Intentional cycle to verify cycle safety
      ex:CycleA rdfs:subClassOf ex:CycleB .
      ex:CycleB rdfs:subClassOf ex:CycleA .

      ex:adr1 a ex:Adr .

      ex:linksToFile a rdfs:Property .
      ex:specFile rdfs:subPropertyOf ex:linksToFile .
      ex:adrFile rdfs:subPropertyOf ex:specFile .
    `);

    expect(store.isSubClassOf('ex:Adr', 'ex:Entity')).toBe(true);
    expect(store.isSubClassOf('ex:Adr', 'ex:Adr')).toBe(true);
    expect(store.isSubClassOf('ex:Entity', 'ex:Adr')).toBe(false);
    expect(store.isInstanceOf('ex:adr1', 'ex:Entity')).toBe(true);
    expect(store.isInstanceOf('ex:adr1', 'ex:Doc')).toBe(true);
    expect(store.subClassesOf('ex:Artifact').has('https://example.org/ns#Adr')).toBe(true);

    // Cycle safety
    expect(store.superClassesOf('ex:CycleA').has('https://example.org/ns#CycleB')).toBe(true);
    expect(store.superClassesOf('ex:CycleB').has('https://example.org/ns#CycleA')).toBe(true);

    // Property closure
    expect(store.isSubPropertyOf('ex:adrFile', 'ex:linksToFile')).toBe(true);
    expect(store.isSubPropertyOf('ex:linksToFile', 'ex:adrFile')).toBe(false);
    expect(store.subPropertiesOf('ex:linksToFile').has('https://example.org/ns#adrFile')).toBe(
      true,
    );

    // Cache invalidation when adding new subclass triple
    expect(store.isSubClassOf('ex:Adr', 'ex:RootThing')).toBe(false);
    store.loadTurtle(`
      @prefix ex: <https://example.org/ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      ex:Entity rdfs:subClassOf ex:RootThing .
    `);
    expect(store.isSubClassOf('ex:Adr', 'ex:RootThing')).toBe(true);
  });
});

describe('loadOntologySystem & loadRegisteredDataset (4-kind resolution + custom Local slice)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wod-system-loader-test-'));
    fs.mkdirSync(path.join(tmpRoot, 'ontology/system'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'ontology/patterns'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'ontology/domain'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'ontology/telemetry'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'ontology/code'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'ontology/bridge'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'ontology/generated'), { recursive: true });

    // Minimal meta.ttl
    fs.writeFileSync(
      path.join(tmpRoot, 'ontology/system/meta.ttl'),
      `
      @prefix sys: <https://wod.wiki/ontology/system#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

      sys:OntologySystem a owl:Class .
      sys:OntologyGraph a owl:Class .
      sys:BridgeGraph a owl:Class .
      sys:NodeKind a owl:Class .
      sys:GraphBridge a owl:Class .
      sys:LinkContract a owl:Class .
      sys:OntologyKind a owl:Class .
      sys:MetaOntology a sys:OntologyKind .
      sys:GlobalOntology a sys:OntologyKind .
      sys:LocalOntology a sys:OntologyKind .
      sys:GeneratedOntology a sys:OntologyKind .
      sys:SelectorMode a owl:Class .
      sys:InstanceSelector a sys:SelectorMode .
      sys:DefinedClassSelector a sys:SelectorMode .
      `,
    );

    // Registry with all 4 ontology kinds + synthetic custom Local slice `:telemetry` + BridgeGraph
    fs.writeFileSync(
      path.join(tmpRoot, 'ontology/system/registry.ttl'),
      `
      @prefix sys:    <https://wod.wiki/ontology/system#> .
      @prefix wodg:   <https://wod.wiki/graph/> .
      @prefix wod:    <https://wod.wiki/ontology#> .
      @prefix ufo:    <https://wod.wiki/ontology/patterns#> .
      @prefix tel:    <https://wod.wiki/ontology/telemetry#> .
      @prefix code:   <https://wod.wiki/ontology/code#> .
      @prefix bridge: <https://wod.wiki/ontology/bridge#> .
      @prefix owl:    <http://www.w3.org/2002/07/owl#> .
      @prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .

      <https://wod.wiki/dataset> a sys:OntologySystem ;
        rdfs:label "Synthetic Multi-Graph Dataset" ;
        owl:versionInfo "1.0.0" ;
        sys:managedNamespace <https://wod.wiki/> ;
        sys:externalNamespace <http://www.w3.org/2002/07/owl#> , <http://www.w3.org/2000/01/rdf-schema#> .

      wodg:system a sys:OntologyGraph ;
        sys:graphIri wodg:system ;
        sys:slug "system" ;
        sys:ontologyKind sys:MetaOntology ;
        rdfs:label "System Meta-Ontology" ;
        sys:layerOrder 0 ;
        sys:accentToken "slate" ;
        sys:schemaGlob "ontology/system/*.ttl" .

      wodg:patterns a sys:OntologyGraph ;
        sys:graphIri wodg:patterns ;
        sys:slug "patterns" ;
        sys:ontologyKind sys:GlobalOntology ;
        rdfs:label "UFO Patterns" ;
        sys:layerOrder 1 ;
        sys:accentToken "violet" ;
        sys:schemaGlob "ontology/patterns/*.ttl" ;
        sys:hasNodeKind [
          a sys:NodeKind ;
          sys:kindSlug "stereotype" ;
          sys:badgeLabel "Stereotype" ;
          sys:selectorMode sys:InstanceSelector ;
          sys:targetClass ufo:Stereotype
        ] .

      wodg:domain a sys:OntologyGraph ;
        sys:graphIri wodg:domain ;
        sys:slug "domain" ;
        sys:ontologyKind sys:LocalOntology ;
        rdfs:label "Domain Model" ;
        sys:layerOrder 2 ;
        sys:accentToken "emerald" ;
        sys:schemaGlob "ontology/domain/*.ttl" ;
        sys:hasNodeKind [
          a sys:NodeKind ;
          sys:kindSlug "class" ;
          sys:badgeLabel "Class" ;
          sys:selectorMode sys:DefinedClassSelector ;
          sys:targetClass owl:Class
        ] .

      wodg:telemetry a sys:OntologyGraph ;
        sys:graphIri wodg:telemetry ;
        sys:slug "telemetry" ;
        sys:ontologyKind sys:LocalOntology ;
        rdfs:label "Custom Telemetry Slice" ;
        rdfs:comment "Synthetic Local Sub-Ontology for testing zero-hardcoding." ;
        sys:layerOrder 3 ;
        sys:accentToken "amber" ;
        sys:schemaGlob "ontology/telemetry/*.ttl" ;
        sys:hasNodeKind [
          a sys:NodeKind ;
          sys:kindSlug "probe" ;
          sys:badgeLabel "Probe" ;
          sys:selectorMode sys:InstanceSelector ;
          sys:targetClass tel:Probe ;
          sys:idProperty tel:probeId ;
          sys:labelProperty tel:probeTitle
        ] .

      wodg:code a sys:OntologyGraph ;
        sys:graphIri wodg:code ;
        sys:slug "code" ;
        sys:ontologyKind sys:GeneratedOntology ;
        rdfs:label "Code Graph" ;
        sys:layerOrder 4 ;
        sys:accentToken "sky" ;
        sys:schemaGlob "ontology/code/*.ttl" ;
        sys:generatedGlob "ontology/generated/code-graph.ttl" ;
        sys:hasNodeKind [
          a sys:NodeKind ;
          sys:kindSlug "file" ;
          sys:badgeLabel "File" ;
          sys:selectorMode sys:InstanceSelector ;
          sys:targetClass code:File ;
          sys:idProperty code:filePath
        ] .

      wodg:bridge a sys:BridgeGraph ;
        sys:graphIri wodg:bridge ;
        sys:slug "bridge" ;
        rdfs:label "Cross-Graph Bridge" ;
        sys:schemaGlob "ontology/bridge/*.ttl" .

      sys:bridgeTelemetryToDomain a sys:GraphBridge ;
        sys:bridgePredicate tel:observesClass ;
        sys:sourceGraph wodg:telemetry ;
        sys:targetGraph wodg:domain ;
        sys:sourceClass tel:Probe ;
        sys:targetClass owl:Class ;
        sys:forwardLabel "observes" ;
        sys:inverseLabel "observed by" ;
        sys:navPriority 10 .

      sys:contractFile a sys:LinkContract ;
        sys:linkPredicate code:linksToFile ;
        sys:targetGraph wodg:code ;
        sys:targetClass code:File ;
        sys:forwardLabel "links to file" ;
        sys:inverseLabel "referenced by" ;
        sys:navPriority 20 .

      bridge:historicalRef sys:allowHistoricalMissingTarget true .
      `,
    );

    // :patterns (Global)
    fs.writeFileSync(
      path.join(tmpRoot, 'ontology/patterns/ufo.ttl'),
      `
      @prefix ufo: <https://wod.wiki/ontology/patterns#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

      ufo:Stereotype a owl:Class .
      ufo:Kind a ufo:Stereotype ; rdfs:label "«kind»" .
      ufo:Event a ufo:Stereotype ; rdfs:label "«event»" .
      ufo:stereotype a owl:AnnotationProperty .
      `,
    );

    // :domain (Local, DefinedClassSelector)
    fs.writeFileSync(
      path.join(tmpRoot, 'ontology/domain/core.ttl'),
      `
      @prefix wod: <https://wod.wiki/ontology#> .
      @prefix ufo: <https://wod.wiki/ontology/patterns#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

      wod:Note a owl:Class ;
        ufo:stereotype ufo:Kind ;
        rdfs:label "Note" ;
        rdfs:comment "Authored workout note." .

      wod:SessionRun a owl:Class ;
        ufo:stereotype ufo:Event ;
        rdfs:label "SessionRun" .

      wod:runsFromNote a owl:ObjectProperty ;
        rdfs:domain wod:SessionRun ;
        rdfs:range wod:Note ;
        rdfs:label "runs from note" .
      `,
    );

    // :telemetry (Custom Local, InstanceSelector with subclass + idProperty + labelProperty)
    fs.writeFileSync(
      path.join(tmpRoot, 'ontology/telemetry/probes.ttl'),
      `
      @prefix tel: <https://wod.wiki/ontology/telemetry#> .
      @prefix wod: <https://wod.wiki/ontology#> .
      @prefix code: <https://wod.wiki/ontology/code#> .
      @prefix bridge: <https://wod.wiki/ontology/bridge#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

      tel:Probe a owl:Class .
      tel:LatencyProbe rdfs:subClassOf tel:Probe .
      tel:probeFile rdfs:subPropertyOf code:linksToFile .
      bridge:historicalRef rdfs:subPropertyOf code:linksToFile .

      tel:p1 a tel:LatencyProbe ;
        tel:probeId "LAT-01" ;
        tel:probeTitle "Runtime Tick Latency" ;
        tel:observesClass wod:SessionRun ;
        tel:probeFile <https://wod.wiki/code/file/packages/engine/src/clock.ts> ;
        bridge:historicalRef <https://wod.wiki/code/file/deleted/legacy.ts> .
      `,
    );

    // :code (Generated)
    fs.writeFileSync(
      path.join(tmpRoot, 'ontology/code/schema.ttl'),
      `
      @prefix code: <https://wod.wiki/ontology/code#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      code:File a owl:Class .
      code:linksToFile a owl:ObjectProperty .
      `,
    );
    fs.writeFileSync(
      path.join(tmpRoot, 'ontology/generated/code-graph.ttl'),
      `
      @prefix code: <https://wod.wiki/ontology/code#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

      <https://wod.wiki/code/file/packages/engine/src/clock.ts> a code:File ;
        code:filePath "packages/engine/src/clock.ts" ;
        rdfs:label "clock.ts" .
      `,
    );

    // :bridge (BridgeGraph edge-carrier — must NOT claim node ownership)
    fs.writeFileSync(
      path.join(tmpRoot, 'ontology/bridge/links.ttl'),
      `
      @prefix tel: <https://wod.wiki/ontology/telemetry#> .
      @prefix wod: <https://wod.wiki/ontology#> .

      tel:p1 tel:observesClass wod:Note .
      `,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('loads all 4 ontology kinds, bridge graphs, bridges, and link contracts from registry.ttl', () => {
    const sys = loadOntologySystem(tmpRoot);

    expect(sys.systemIri).toBe('https://wod.wiki/dataset');
    expect(sys.versionInfo).toBe('1.0.0');
    expect(sys.managedNamespaces).toEqual(['https://wod.wiki/']);
    expect(sys.externalNamespaces).toEqual([
      'http://www.w3.org/2000/01/rdf-schema#',
      'http://www.w3.org/2002/07/owl#',
    ]);

    expect(sys.slices.map((s) => [s.slug, s.ontologyKind, s.layerOrder])).toEqual([
      ['system', 'meta', 0],
      ['patterns', 'global', 1],
      ['domain', 'local', 2],
      ['telemetry', 'local', 3],
      ['code', 'generated', 4],
    ]);

    expect(sys.bridgeGraphs).toHaveLength(1);
    expect(sys.bridgeGraphs[0].slug).toBe('bridge');

    expect(sys.bridges).toHaveLength(1);
    expect(sys.bridges[0]).toMatchObject({
      bridgePredicate: 'https://wod.wiki/ontology/telemetry#observesClass',
      sourceGraph: 'https://wod.wiki/graph/telemetry',
      targetGraph: 'https://wod.wiki/graph/domain',
      forwardLabel: 'observes',
      inverseLabel: 'observed by',
      navPriority: 10,
      allowHistoricalMissingTarget: false,
    });

    expect(sys.linkContracts).toHaveLength(1);
    expect(sys.linkContracts[0]).toMatchObject({
      linkPredicate: 'https://wod.wiki/ontology/code#linksToFile',
      targetGraph: 'https://wod.wiki/graph/code',
      targetClasses: ['https://wod.wiki/ontology/code#File'],
      navPriority: 20,
    });
  });

  it('assembles multi-graph dataset, resolves InstanceSelector vs DefinedClassSelector, and classifies edges', () => {
    const ds = loadRegisteredDataset(tmpRoot);

    expect(ds.missingGeneratedGlobs).toEqual([]);
    // Node ownership belongs to slices, never to wodg:bridge
    expect(ds.ownerGraphOf('https://wod.wiki/ontology/telemetry#p1')).toBe(
      'https://wod.wiki/graph/telemetry',
    );
    expect(ds.ownerGraphOf('https://wod.wiki/ontology#SessionRun')).toBe(
      'https://wod.wiki/graph/domain',
    );
    expect(
      ds.ownerGraphOf('https://wod.wiki/code/file/packages/engine/src/clock.ts'),
    ).toBe('https://wod.wiki/graph/code');

    const nodes = ds.materializeNodes();
    const ids = nodes.map((n) => n.id);
    expect(ids).toEqual([
      'file:packages/engine/src/clock.ts',
      'probe:LAT-01',
      'ufo:Event',
      'ufo:Kind',
      'wod:Note',
      'wod:SessionRun',
    ]);

    // InstanceSelector matched subclass `tel:LatencyProbe` of `tel:Probe` and used custom labelProperty
    const probe = nodes.find((n) => n.id === 'probe:LAT-01')!;
    expect(probe.sliceSlug).toBe('telemetry');
    expect(probe.kindSlug).toBe('probe');
    expect(probe.selectorMode).toBe('instance');
    expect(probe.label).toBe('Runtime Tick Latency');

    // DefinedClassSelector materialized owl:Class nodes in :domain
    const sessionRun = nodes.find((n) => n.id === 'wod:SessionRun')!;
    expect(sessionRun.sliceSlug).toBe('domain');
    expect(sessionRun.selectorMode).toBe('definedClass');

    const edges = ds.materializeEdges(nodes);

    // 1. Global edge (:domain -> :patterns via ufo:stereotype)
    expect(edges).toContainEqual(
      expect.objectContaining({
        sourceId: 'wod:SessionRun',
        predicateCurie: 'ufo:stereotype',
        targetId: 'ufo:Event',
        category: 'global',
        derived: false,
      }),
    );

    // 2. Derived intra-slice DefinedClassSelector edge (owl:ObjectProperty domain -> range)
    expect(edges).toContainEqual(
      expect.objectContaining({
        sourceId: 'wod:SessionRun',
        predicateCurie: 'wod:runsFromNote',
        targetId: 'wod:Note',
        category: 'intra',
        derived: true,
      }),
    );

    // 3. Explicit Local <-> Local bridge edges (both inline in :telemetry and carried in :bridge)
    expect(edges).toContainEqual(
      expect.objectContaining({
        sourceId: 'probe:LAT-01',
        predicateCurie: 'tel:observesClass',
        targetId: 'wod:SessionRun',
        category: 'localBridge',
      }),
    );
    expect(edges).toContainEqual(
      expect.objectContaining({
        sourceId: 'probe:LAT-01',
        predicateCurie: 'tel:observesClass',
        targetId: 'wod:Note',
        graphIri: 'https://wod.wiki/graph/bridge',
        category: 'localBridge',
      }),
    );

    // 4. Generated LinkContract via rdfs:subPropertyOf*
    expect(edges).toContainEqual(
      expect.objectContaining({
        sourceId: 'probe:LAT-01',
        predicateCurie: 'tel:probeFile',
        targetId: 'file:packages/engine/src/clock.ts',
        category: 'generatedLink',
      }),
    );

    // 5. Historical missing target preserved as unresolved edge (targetId undefined)
    expect(ds.allowsHistoricalMissingTarget('bridge:historicalRef')).toBe(true);
    const ghostEdge = edges.find((e) => e.predicateCurie === 'bridge:historicalRef');
    expect(ghostEdge).toBeDefined();
    expect(ghostEdge?.targetId).toBeUndefined();
    expect(ghostEdge?.targetIri).toBe('https://wod.wiki/code/file/deleted/legacy.ts');
    expect(ghostEdge?.category).toBe('generatedLink');
  });

  it('resolves ontology-directory-relative globs (matching registry.ttl convention)', () => {
    // Rewrite registry.ttl with ontology-relative globs (no leading `ontology/`)
    const regPath = path.join(tmpRoot, 'ontology/system/registry.ttl');
    const updated = fs
      .readFileSync(regPath, 'utf8')
      .replaceAll('"ontology/', '"');
    fs.writeFileSync(regPath, updated, 'utf8');

    const ds = loadRegisteredDataset(tmpRoot);
    expect(ds.missingGeneratedGlobs).toEqual([]);
    expect(ds.files.some((f) => f.relativePath === 'ontology/patterns/ufo.ttl')).toBe(true);
    expect(ds.files.some((f) => f.relativePath === 'ontology/telemetry/probes.ttl')).toBe(true);
    expect(ds.files.some((f) => f.relativePath === 'ontology/generated/code-graph.ttl')).toBe(true);
    expect(ds.materializeNodes().map((n) => n.id)).toContain('probe:LAT-01');
  });

  it('tracks missing generated globs and throws when requireGenerated is true', () => {
    fs.rmSync(path.join(tmpRoot, 'ontology/generated/code-graph.ttl'));

    const ds = loadRegisteredDataset(tmpRoot, { includeGenerated: true, requireGenerated: false });
    expect(ds.missingGeneratedGlobs).toEqual([
      {
        graphIri: 'https://wod.wiki/graph/code',
        slug: 'code',
        glob: 'ontology/generated/code-graph.ttl',
      },
    ]);

    expect(() =>
      loadRegisteredDataset(tmpRoot, { includeGenerated: true, requireGenerated: true }),
    ).toThrow(/Required generated glob/);
  });
});
