#!/usr/bin/env bun
/**
 * Ontology Codegen — parses all Turtle (.ttl) schemas in ontology/
 * (system, patterns, workflow, domain, qa, architecture, code, bridge, shapes)
 * via shared `scripts/ontology/system-loader.ts` and generates TypeScript
 * interfaces, class/stereotype/slice/bridge metadata, metric vocabulary, and
 * SHACL-derived runtime validation helpers in ontology/generated/ontology-types.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  MultiGraphStore,
  OWL,
  RDF,
  RDFS,
  SH_NS,
  loadOntologySystem,
  type OntologySystemConfig,
} from './system-loader';

const REPO_ROOT = path.resolve(import.meta.dir, '../..');
const ONTOLOGY_DIR = path.join(REPO_ROOT, 'ontology');
const OUTPUT_FILE = path.join(ONTOLOGY_DIR, 'generated/ontology-types.ts');

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
  minInclusive: `${SH_NS}minInclusive`,
  message: `${SH_NS}message`,
} as const;

function walkTtlFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['examples', 'generated', 'changesets', 'graphs'].includes(entry.name)) continue;
      walkTtlFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ttl') && entry.name !== 'qa-snapshot.ttl') {
      out.push(full);
    }
  }
  return out;
}

interface ClassDef {
  curie: string;
  iri: string;
  tsName: string;
  label: string;
  comment: string;
  module: string;
  stereotype?: string;
  superClasses: string[];
}

interface PropDef {
  curie: string;
  iri: string;
  fieldName: string;
  kind: 'object' | 'datatype' | 'annotation';
  label: string;
  comment: string;
  domains: string[];
  ranges: string[];
}

interface ShapeConstraint {
  path: string;
  fieldName: string;
  minCount?: number;
  maxCount?: number;
  datatype?: string;
  targetClass?: string;
  allowedValues?: string[];
  minInclusive?: number;
  message?: string;
}

interface MetricDef {
  curie: string;
  label: string;
  allowedUnits: string[];
}

function toTsInterfaceName(curie: string): string {
  const [ns, local] = curie.includes(':') ? curie.split(':', 2) : ['wod', curie];
  const cleanLocal = local.replace(/[^A-Za-z0-9]/g, '');
  const pascalLocal = cleanLocal.charAt(0).toUpperCase() + cleanLocal.slice(1);
  if (ns === 'wod' || ns === '') return pascalLocal;
  const pascalNs = ns.charAt(0).toUpperCase() + ns.slice(1);
  return `${pascalNs}${pascalLocal}`;
}

function toFieldName(curie: string): string {
  const local = curie.includes(':') ? curie.split(':', 2)[1] : curie;
  return local.replace(/[^A-Za-z0-9_]/g, '_');
}

function xsdToTs(dt?: string): string {
  if (!dt) return 'string';
  switch (dt) {
    case 'xsd:integer':
    case 'xsd:int':
    case 'xsd:decimal':
    case 'xsd:float':
    case 'xsd:double':
    case 'xsd:number':
      return 'number';
    case 'xsd:boolean':
      return 'boolean';
    case 'xsd:dateTime':
    case 'xsd:date':
    case 'xsd:string':
    case 'xsd:anyURI':
    default:
      return 'string';
  }
}

export function runCodegen() {
  const ttlFiles = walkTtlFiles(ONTOLOGY_DIR);
  const store = new MultiGraphStore();
  store.addPrefixes({
    sosa: 'http://www.w3.org/ns/sosa/',
    skos: 'http://www.w3.org/2004/02/skos/core#',
    prov: 'http://www.w3.org/ns/prov#',
    qudt: 'http://qudt.org/schema/qudt/',
    unit: 'http://qudt.org/vocab/unit/',
  });

  const subjectFirstModule = new Map<string, string>();

  for (let idx = 0; idx < ttlFiles.length; idx++) {
    const file = ttlFiles[idx];
    const rel = path.relative(ONTOLOGY_DIR, file).replace(/\\/g, '/');
    const modName = rel.replace(/\.ttl$/, '');
    const raw = fs.readFileSync(file, 'utf8');
    store.loadTurtle(raw, { graph: modName, bnodePrefix: `cg${idx + 1}_` });
    for (const q of store.quads({ graph: modName })) {
      if (q.subject.termType === 'NamedNode' && !subjectFirstModule.has(q.subject.value)) {
        subjectFirstModule.set(q.subject.value, modName);
      }
    }
  }

  let systemConfig: OntologySystemConfig | undefined;
  const registryPath = path.join(ONTOLOGY_DIR, 'system/registry.ttl');
  if (fs.existsSync(registryPath)) {
    systemConfig = loadOntologySystem(REPO_ROOT);
    store.addPrefixes(systemConfig.prefixes);
  }

  const classes = new Map<string, ClassDef>();
  const props = new Map<string, PropDef>();
  const shapesByTarget = new Map<string, ShapeConstraint[]>();
  const metrics = new Map<string, MetricDef>();

  const allTypedSubjects = [...new Set(store.subjects(RDF.type))]
    .filter((s) => !s.startsWith('_:'))
    .sort((a, b) => a.localeCompare(b));

  for (const iri of allTypedSubjects) {
    const curie = store.compact(iri);
    const types = store.typesOf(iri);
    const moduleName = subjectFirstModule.get(iri) ?? 'unknown';

    if (types.includes(OWL.Class) || types.includes(RDFS.Class)) {
      const stereoIri = store.iriValue(iri, 'ufo:stereotype');
      classes.set(curie, {
        curie,
        iri,
        tsName: toTsInterfaceName(curie),
        label: store.literalValue(iri, RDFS.label) ?? curie,
        comment: store.literalValue(iri, RDFS.comment) ?? '',
        module: moduleName,
        ...(stereoIri ? { stereotype: store.compact(stereoIri) } : {}),
        superClasses: store
          .iriValues(iri, RDFS.subClassOf)
          .map((sc) => store.compact(sc))
          .sort((a, b) => a.localeCompare(b)),
      });
    }

    if (
      types.includes(OWL.ObjectProperty) ||
      types.includes(OWL.DatatypeProperty) ||
      types.includes(OWL.AnnotationProperty)
    ) {
      const kind = types.includes(OWL.ObjectProperty)
        ? 'object'
        : types.includes(OWL.DatatypeProperty)
          ? 'datatype'
          : 'annotation';
      props.set(curie, {
        curie,
        iri,
        fieldName: toFieldName(curie),
        kind,
        label: store.literalValue(iri, RDFS.label) ?? curie,
        comment: store.literalValue(iri, RDFS.comment) ?? '',
        domains: store
          .iriValues(iri, RDFS.domain)
          .map((d) => store.compact(d))
          .sort((a, b) => a.localeCompare(b)),
        ranges: store
          .iriValues(iri, RDFS.range)
          .map((r) => store.compact(r))
          .sort((a, b) => a.localeCompare(b)),
      });
    }

    if (types.includes(store.expand('wod:Metric'))) {
      metrics.set(curie, {
        curie,
        label: store.literalValue(iri, RDFS.label) ?? curie,
        allowedUnits: store
          .iriValues(iri, 'wod:allowedUnit')
          .map((u) => store.compact(u))
          .sort((a, b) => a.localeCompare(b)),
      });
    }

    if (types.includes(SH.NodeShape)) {
      const targetClasses = store.iriValues(iri, SH.targetClass).map((t) => store.compact(t));
      const propNodes = store
        .objects(iri, SH.property)
        .filter((o) => o.termType === 'BlankNode' || o.termType === 'NamedNode');

      for (const tc of targetClasses) {
        const list = shapesByTarget.get(tc) ?? [];
        for (const pn of propNodes) {
          const pathIri = store.iriValue(pn.value, SH.path);
          if (!pathIri) continue;
          const pathCurie = store.compact(pathIri);
          const minCount = store.numberValue(pn.value, SH.minCount);
          const maxCount = store.numberValue(pn.value, SH.maxCount);
          const dtIri = store.iriValue(pn.value, SH.datatype);
          const clsIri = store.iriValue(pn.value, SH.class);
          const inHead = store.objects(pn.value, SH.in)[0];
          const allowedValues = inHead
            ? store
                .readList(inHead)
                .map((it) => (it.termType === 'Literal' ? it.value : store.compact(it.value)))
                .filter(Boolean)
            : undefined;
          const minInclusive = store.numberValue(pn.value, SH.minInclusive);
          const message = store.literalValue(pn.value, SH.message);

          list.push({
            path: pathCurie,
            fieldName: toFieldName(pathCurie),
            minCount,
            maxCount,
            datatype: dtIri ? store.compact(dtIri) : undefined,
            targetClass: clsIri ? store.compact(clsIri) : undefined,
            allowedValues: allowedValues && allowedValues.length > 0 ? allowedValues : undefined,
            minInclusive,
            message,
          });
        }
        shapesByTarget.set(tc, list);
      }
    }
  }

  const slicesExport = (systemConfig?.slices ?? []).map((s) => ({
    slug: s.slug,
    graphIri: s.graphIri,
    ontologyKind: s.ontologyKind,
    label: s.label,
    comment: s.comment,
    layerOrder: s.layerOrder,
    accentToken: s.accentToken,
    nodeKinds: s.nodeKinds.map((nk) => ({
      kindSlug: nk.kindSlug,
      badgeLabel: nk.badgeLabel,
      selectorMode: nk.selectorMode,
      targetClasses: nk.targetClasses.map((tc) => store.compact(tc)),
    })),
  }));

  const bridgesExport = (systemConfig?.bridges ?? []).map((b) => ({
    predicate: store.compact(b.bridgePredicate),
    predicateIri: b.bridgePredicate,
    sourceGraph: b.sourceGraph,
    targetGraph: b.targetGraph,
    sourceClasses: b.sourceClasses.map((c) => store.compact(c)),
    targetClasses: b.targetClasses.map((c) => store.compact(c)),
    forwardLabel: b.forwardLabel,
    inverseLabel: b.inverseLabel,
    navPriority: b.navPriority,
    allowHistoricalMissingTarget: b.allowHistoricalMissingTarget,
  }));

  // Build TypeScript output
  const lines: string[] = [
    '/* eslint-disable */',
    '/**',
    ' * AUTO-GENERATED by scripts/ontology/codegen.ts — DO NOT EDIT BY HAND.',
    ` * Parsed ${ttlFiles.length} Turtle schema files from ontology/.`,
    ` * Slices: ${slicesExport.length} | Bridges: ${bridgesExport.length} | Classes: ${classes.size} | Properties: ${props.size} | Shapes: ${shapesByTarget.size} | Metrics: ${metrics.size}`,
    ' */',
    '',
    'export type UfoStereotypeCurie =',
    "  | 'ufo:Kind'",
    "  | 'ufo:Relator'",
    "  | 'ufo:Phase'",
    "  | 'ufo:Role'",
    "  | 'ufo:Event'",
    "  | 'ufo:Perdurant'",
    "  | 'ufo:Mode'",
    "  | 'ufo:Quantity'",
    "  | 'ufo:InformationObject'",
    '  | (string & {});',
    '',
    "export type OntologySliceKind = 'meta' | 'global' | 'local' | 'generated';",
    '',
    'export interface OntologySliceMeta {',
    '  slug: string;',
    '  graphIri: string;',
    '  ontologyKind: OntologySliceKind;',
    '  label: string;',
    '  comment: string;',
    '  layerOrder: number;',
    '  accentToken: string;',
    '  nodeKinds: readonly {',
    '    kindSlug: string;',
    '    badgeLabel: string;',
    "    selectorMode: 'instance' | 'definedClass';",
    '    targetClasses: readonly string[];',
    '  }[];',
    '}',
    '',
    'export interface OntologyBridgeMeta {',
    '  predicate: string;',
    '  predicateIri: string;',
    '  sourceGraph: string;',
    '  targetGraph: string;',
    '  sourceClasses: readonly string[];',
    '  targetClasses: readonly string[];',
    '  forwardLabel: string;',
    '  inverseLabel: string;',
    '  navPriority: number;',
    '  allowHistoricalMissingTarget: boolean;',
    '}',
    '',
    'export interface OntologyClassMeta {',
    '  curie: string;',
    '  iri: string;',
    '  tsName: string;',
    '  label: string;',
    '  comment: string;',
    '  module: string;',
    '  stereotype?: UfoStereotypeCurie;',
    '  superClasses: readonly string[];',
    '}',
    '',
    'export interface OntologyPropertyMeta {',
    '  curie: string;',
    '  iri: string;',
    '  fieldName: string;',
    "  kind: 'object' | 'datatype' | 'annotation';",
    '  label: string;',
    '  comment: string;',
    '  domains: readonly string[];',
    '  ranges: readonly string[];',
    '}',
    '',
    'export interface ShaclPropertyConstraint {',
    '  path: string;',
    '  fieldName: string;',
    '  minCount?: number;',
    '  maxCount?: number;',
    '  datatype?: string;',
    '  targetClass?: string;',
    '  allowedValues?: readonly string[];',
    '  minInclusive?: number;',
    '  message?: string;',
    '}',
    '',
    'export interface OntologyMetricMeta {',
    '  curie: string;',
    '  label: string;',
    '  allowedUnits: readonly string[];',
    '}',
    '',
    `export const ONTOLOGY_SLICES: readonly OntologySliceMeta[] = ${JSON.stringify(
      slicesExport,
      null,
      2,
    )};`,
    '',
    `export const ONTOLOGY_BRIDGES: readonly OntologyBridgeMeta[] = ${JSON.stringify(
      bridgesExport,
      null,
      2,
    )};`,
    '',
    `export const ONTOLOGY_CLASSES: Record<string, OntologyClassMeta> = ${JSON.stringify(
      Object.fromEntries([...classes.entries()].sort(([a], [b]) => a.localeCompare(b))),
      null,
      2,
    )};`,
    '',
    `export const ONTOLOGY_PROPERTIES: Record<string, OntologyPropertyMeta> = ${JSON.stringify(
      Object.fromEntries([...props.entries()].sort(([a], [b]) => a.localeCompare(b))),
      null,
      2,
    )};`,
    '',
    `export const ONTOLOGY_SHAPES: Record<string, readonly ShaclPropertyConstraint[]> = ${JSON.stringify(
      Object.fromEntries([...shapesByTarget.entries()].sort(([a], [b]) => a.localeCompare(b))),
      null,
      2,
    )};`,
    '',
    `export const ONTOLOGY_METRICS: Record<string, OntologyMetricMeta> = ${JSON.stringify(
      Object.fromEntries([...metrics.entries()].sort(([a], [b]) => a.localeCompare(b))),
      null,
      2,
    )};`,
    '',
    'export type OntologyClassCurie = keyof typeof ONTOLOGY_CLASSES;',
    '',
    '// ── Generated Domain & Unified Interfaces ────────────────────────────────',
    '',
  ];

  // Emit interface for each class
  for (const [, cls] of [...classes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const knownParents = cls.superClasses
      .filter((sc) => classes.has(sc))
      .map((sc) => classes.get(sc)!.tsName);
    const extendsClause = knownParents.length > 0 ? ` extends ${knownParents.join(', ')}` : '';
    const domainProps = [...props.values()].filter((p) => p.domains.includes(cls.curie));
    const constraints = shapesByTarget.get(cls.curie) ?? [];
    const constraintByField = new Map<string, ShapeConstraint>();
    for (const c of constraints) {
      constraintByField.set(c.fieldName, c);
    }

    const fieldNames = new Set<string>([
      ...domainProps.map((p) => p.fieldName),
      ...constraints.map((c) => c.fieldName),
    ]);

    lines.push(`/** ${cls.label}${cls.stereotype ? ` (${cls.stereotype})` : ''} — ${cls.curie} */`);
    lines.push(`export interface ${cls.tsName}${extendsClause} {`);
    lines.push(`  '@id'?: string;`);
    lines.push(`  '@type'?: '${cls.curie}' | (string & {});`);

    for (const field of [...fieldNames].sort()) {
      const prop = domainProps.find((p) => p.fieldName === field);
      const constraint = constraintByField.get(field);
      const required = (constraint?.minCount ?? 0) >= 1;
      const isSingle = constraint?.maxCount === 1 || prop?.kind === 'datatype';

      let baseType = 'string';
      if (constraint?.allowedValues && constraint.allowedValues.length > 0) {
        baseType = constraint.allowedValues.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(' | ');
      } else if (constraint?.datatype) {
        baseType = xsdToTs(constraint.datatype);
      } else if (prop?.ranges[0]?.startsWith('xsd:')) {
        baseType = xsdToTs(prop.ranges[0]);
      } else if (prop?.kind === 'object' || constraint?.targetClass) {
        baseType = 'string | Record<string, unknown>';
      }

      const tsType = isSingle ? baseType : `${baseType} | readonly (${baseType})[]`;
      lines.push(`  ${field}${required ? '' : '?'}: ${tsType};`);
    }
    lines.push('}');
    lines.push('');
  }

  // Runtime helpers
  lines.push('// ── Validation & Lookup Helpers ──────────────────────────────────────────');
  lines.push('');
  lines.push('export interface OntologyValidationError {');
  lines.push('  field: string;');
  lines.push('  path: string;');
  lines.push('  message: string;');
  lines.push('}');
  lines.push('');
  lines.push('export interface OntologyValidationResult {');
  lines.push('  valid: boolean;');
  lines.push('  classCurie: string;');
  lines.push('  errors: OntologyValidationError[];');
  lines.push('}');
  lines.push('');
  lines.push('export function getOntologyClassMeta(curie: string): OntologyClassMeta | undefined {');
  lines.push('  return ONTOLOGY_CLASSES[curie];');
  lines.push('}');
  lines.push('');
  lines.push(
    'export function getClassesByStereotype(stereotype: UfoStereotypeCurie): OntologyClassMeta[] {',
  );
  lines.push('  return Object.values(ONTOLOGY_CLASSES).filter((c) => c.stereotype === stereotype);');
  lines.push('}');
  lines.push('');
  lines.push('function collectSuperClasses(curie: string, visited = new Set<string>()): string[] {');
  lines.push('  if (visited.has(curie)) return [];');
  lines.push('  visited.add(curie);');
  lines.push('  const meta = ONTOLOGY_CLASSES[curie];');
  lines.push('  if (!meta) return [curie];');
  lines.push('  const out = [curie];');
  lines.push('  for (const sc of meta.superClasses) {');
  lines.push('    out.push(...collectSuperClasses(sc, visited));');
  lines.push('  }');
  lines.push('  return out;');
  lines.push('}');
  lines.push('');
  lines.push('export function validateOntologyInstance(');
  lines.push('  classCurie: string,');
  lines.push('  instance: Record<string, unknown>,');
  lines.push('): OntologyValidationResult {');
  lines.push('  const errors: OntologyValidationError[] = [];');
  lines.push('  const chain = collectSuperClasses(classCurie);');
  lines.push('  for (const cls of chain) {');
  lines.push('    const constraints = ONTOLOGY_SHAPES[cls] ?? [];');
  lines.push('    for (const c of constraints) {');
  lines.push('      const raw = instance[c.fieldName];');
  lines.push(
    '      const values = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];',
  );
  lines.push('      if (c.minCount !== undefined && values.length < c.minCount) {');
  lines.push('        errors.push({');
  lines.push('          field: c.fieldName,');
  lines.push('          path: c.path,');
  lines.push(
    '          message: c.message ?? `${c.path} requires at least ${c.minCount} value(s).`,',
  );
  lines.push('        });');
  lines.push('      }');
  lines.push('      if (c.maxCount !== undefined && values.length > c.maxCount) {');
  lines.push('        errors.push({');
  lines.push('          field: c.fieldName,');
  lines.push('          path: c.path,');
  lines.push(
    '          message: c.message ?? `${c.path} allows at most ${c.maxCount} value(s).`,',
  );
  lines.push('        });');
  lines.push('      }');
  lines.push('      for (const v of values) {');
  lines.push(
    '        if (c.allowedValues && c.allowedValues.length > 0 && !c.allowedValues.includes(String(v))) {',
  );
  lines.push('          errors.push({');
  lines.push('            field: c.fieldName,');
  lines.push('            path: c.path,');
  lines.push(
    '            message: c.message ?? `${c.path} value "${String(v)}" must be one of [${c.allowedValues.join(", ")}].`,',
  );
  lines.push('          });');
  lines.push('        }');
  lines.push(
    '        if (c.minInclusive !== undefined && (typeof v !== "number" || v < c.minInclusive)) {',
  );
  lines.push('          errors.push({');
  lines.push('            field: c.fieldName,');
  lines.push('            path: c.path,');
  lines.push(
    '            message: c.message ?? `${c.path} must be >= ${c.minInclusive}.`,',
  );
  lines.push('          });');
  lines.push('        }');
  lines.push('      }');
  lines.push('    }');
  lines.push('  }');
  lines.push('  return { valid: errors.length === 0, classCurie, errors };');
  lines.push('}');
  lines.push('');

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf8');
  console.log(
    `Generated ${path.relative(REPO_ROOT, OUTPUT_FILE)}: ${slicesExport.length} slices, ${bridgesExport.length} bridges, ${classes.size} classes, ${props.size} properties, ${shapesByTarget.size} shaped targets, ${metrics.size} metrics.`,
  );
}

if (import.meta.main) {
  runCodegen();
}
