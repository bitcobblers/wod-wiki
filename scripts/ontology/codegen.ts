#!/usr/bin/env bun
/**
 * Ontology Codegen — parses all Turtle (.ttl) schemas in ontology/
 * (domain, patterns, qa, code, bridge, shapes) and generates TypeScript
 * interfaces, class/stereotype metadata, metric vocabulary, and SHACL-derived
 * runtime validation helpers in ontology/generated/ontology-types.ts.
 */
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(import.meta.dir, '../..');
const ONTOLOGY_DIR = path.join(REPO_ROOT, 'ontology');
const OUTPUT_FILE = path.join(ONTOLOGY_DIR, 'generated/ontology-types.ts');

// ── Lightweight Turtle Tokenizer & Parser ──────────────────────────────────

type TokenType =
  | 'PREFIX_KW'
  | 'BASE_KW'
  | 'IRI'
  | 'PNAME'
  | 'STRING'
  | 'NUMBER'
  | 'BOOL'
  | 'A'
  | 'SEMI'
  | 'COMMA'
  | 'DOT'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'LPAREN'
  | 'RPAREN'
  | 'LANG_TAG'
  | 'DATATYPE_HAT';

interface Token {
  type: TokenType;
  value: string;
}

function tokenizeTurtle(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Comment
    if (ch === '#') {
      while (i < len && input[i] !== '\n') i++;
      continue;
    }

    // Punctuation
    if (ch === ';') {
      tokens.push({ type: 'SEMI', value: ';' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',' });
      i++;
      continue;
    }
    if (ch === '[') {
      tokens.push({ type: 'LBRACKET', value: '[' });
      i++;
      continue;
    }
    if (ch === ']') {
      tokens.push({ type: 'RBRACKET', value: ']' });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }
    if (ch === '^' && input[i + 1] === '^') {
      tokens.push({ type: 'DATATYPE_HAT', value: '^^' });
      i += 2;
      continue;
    }

    // @prefix / @base / @lang
    if (ch === '@') {
      if (input.startsWith('@prefix', i)) {
        tokens.push({ type: 'PREFIX_KW', value: '@prefix' });
        i += 7;
        continue;
      }
      if (input.startsWith('@base', i)) {
        tokens.push({ type: 'BASE_KW', value: '@base' });
        i += 5;
        continue;
      }
      const langMatch = input.slice(i).match(/^@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*/);
      if (langMatch) {
        tokens.push({ type: 'LANG_TAG', value: langMatch[0] });
        i += langMatch[0].length;
        continue;
      }
    }

    // IRI <...>
    if (ch === '<') {
      const end = input.indexOf('>', i + 1);
      if (end !== -1) {
        tokens.push({ type: 'IRI', value: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Long string """...""" or '''...'''
    if (input.startsWith('"""', i) || input.startsWith("'''", i)) {
      const quote = input.slice(i, i + 3);
      i += 3;
      let val = '';
      while (i < len && !input.startsWith(quote, i)) {
        if (input[i] === '\\' && i + 1 < len) {
          val += input[i + 1];
          i += 2;
        } else {
          val += input[i++];
        }
      }
      i += 3;
      tokens.push({ type: 'STRING', value: val });
      continue;
    }

    // Short string "..." or '...'
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let val = '';
      while (i < len && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < len) {
          const esc = input[i + 1];
          val += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          i += 2;
        } else {
          val += input[i++];
        }
      }
      i++;
      tokens.push({ type: 'STRING', value: val });
      continue;
    }

    // Dot (statement terminator, not decimal)
    if (ch === '.' && (i + 1 >= len || !/\d/.test(input[i + 1]))) {
      tokens.push({ type: 'DOT', value: '.' });
      i++;
      continue;
    }

    // Number
    const numMatch = input.slice(i).match(/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/);
    if (numMatch && (i + numMatch[0].length >= len || /[\s;,.()\]^]/.test(input[i + numMatch[0].length]))) {
      tokens.push({ type: 'NUMBER', value: numMatch[0] });
      i += numMatch[0].length;
      continue;
    }

    // Prefixed name, keyword `a`, boolean, or PREFIX/BASE
    const wordMatch = input.slice(i).match(/^[^\s;,.()[\]<>"{}^]+/);
    if (wordMatch) {
      const word = wordMatch[0];
      i += word.length;
      if (word === 'a') {
        tokens.push({ type: 'A', value: 'a' });
      } else if (word === 'true' || word === 'false') {
        tokens.push({ type: 'BOOL', value: word });
      } else if (word.toUpperCase() === 'PREFIX') {
        tokens.push({ type: 'PREFIX_KW', value: 'PREFIX' });
      } else if (word.toUpperCase() === 'BASE') {
        tokens.push({ type: 'BASE_KW', value: 'BASE' });
      } else {
        tokens.push({ type: 'PNAME', value: word });
      }
      continue;
    }

    i++;
  }

  return tokens;
}

type RdfValue =
  | { kind: 'iri'; value: string; curie: string }
  | { kind: 'literal'; value: string; datatype?: string }
  | { kind: 'bnode'; id: string; props: Map<string, RdfValue[]> }
  | { kind: 'list'; items: RdfValue[] };

interface Triple {
  subject: string;
  predicate: string;
  object: RdfValue;
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

function parseTurtleFile(filePath: string, sharedPrefixes: Map<string, string>): Triple[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const tokens = tokenizeTurtle(raw);
  const prefixes = new Map<string, string>(sharedPrefixes);
  const triples: Triple[] = [];
  let pos = 0;
  let bnodeSeq = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }
  function next(): Token | undefined {
    return tokens[pos++];
  }

  function resolveName(tok: Token): { iri: string; curie: string } {
    if (tok.type === 'IRI') {
      for (const [pfx, ns] of prefixes.entries()) {
        if (tok.value.startsWith(ns)) {
          return { iri: tok.value, curie: `${pfx}:${tok.value.slice(ns.length)}` };
        }
      }
      return { iri: tok.value, curie: tok.value };
    }
    if (tok.type === 'A') {
      return { iri: RDF_TYPE, curie: 'rdf:type' };
    }
    const colon = tok.value.indexOf(':');
    if (colon !== -1) {
      const pfx = tok.value.slice(0, colon);
      const local = tok.value.slice(colon + 1);
      const ns = prefixes.get(pfx);
      if (ns) {
        return { iri: `${ns}${local}`, curie: tok.value };
      }
    }
    return { iri: tok.value, curie: tok.value };
  }

  function parseObject(): RdfValue {
    const tok = peek();
    if (!tok) return { kind: 'literal', value: '' };

    if (tok.type === 'LBRACKET') {
      next();
      const id = `_:b${++bnodeSeq}`;
      const props = new Map<string, RdfValue[]>();
      while (peek() && peek()!.type !== 'RBRACKET') {
        const predTok = next()!;
        const pred = resolveName(predTok).iri;
        const objs: RdfValue[] = [];
        while (peek()) {
          objs.push(parseObject());
          if (peek()?.type === 'COMMA') {
            next();
          } else {
            break;
          }
        }
        const existing = props.get(pred) ?? [];
        props.set(pred, [...existing, ...objs]);
        if (peek()?.type === 'SEMI') {
          next();
        } else {
          break;
        }
      }
      if (peek()?.type === 'RBRACKET') next();
      return { kind: 'bnode', id, props };
    }

    if (tok.type === 'LPAREN') {
      next();
      const items: RdfValue[] = [];
      while (peek() && peek()!.type !== 'RPAREN') {
        items.push(parseObject());
      }
      if (peek()?.type === 'RPAREN') next();
      return { kind: 'list', items };
    }

    if (tok.type === 'STRING') {
      next();
      let datatype: string | undefined;
      if (peek()?.type === 'DATATYPE_HAT') {
        next();
        const dtTok = next();
        if (dtTok) datatype = resolveName(dtTok).curie;
      } else if (peek()?.type === 'LANG_TAG') {
        next();
      }
      return { kind: 'literal', value: tok.value, datatype };
    }

    if (tok.type === 'NUMBER' || tok.type === 'BOOL') {
      next();
      return {
        kind: 'literal',
        value: tok.value,
        datatype: tok.type === 'BOOL' ? 'xsd:boolean' : tok.value.includes('.') ? 'xsd:decimal' : 'xsd:integer',
      };
    }

    next();
    const { iri, curie } = resolveName(tok);
    return { kind: 'iri', value: iri, curie };
  }

  while (pos < tokens.length) {
    const tok = peek()!;
    if (tok.type === 'PREFIX_KW') {
      next();
      const pfxTok = next();
      const iriTok = next();
      if (pfxTok && iriTok) {
        const pfx = pfxTok.value.replace(/:$/, '');
        prefixes.set(pfx, iriTok.value);
        sharedPrefixes.set(pfx, iriTok.value);
      }
      if (peek()?.type === 'DOT') next();
      continue;
    }
    if (tok.type === 'BASE_KW') {
      next();
      next();
      if (peek()?.type === 'DOT') next();
      continue;
    }
    if (tok.type === 'DOT') {
      next();
      continue;
    }

    // Subject
    const subjObj = parseObject();
    const subject = subjObj.kind === 'iri' ? subjObj.curie : subjObj.kind === 'bnode' ? subjObj.id : '';

    // Predicate-Object list
    while (peek() && peek()!.type !== 'DOT') {
      const predTok = next()!;
      const predicate = resolveName(predTok).curie;
      while (peek()) {
        const obj = parseObject();
        if (subject) {
          triples.push({ subject, predicate, object: obj });
        }
        if (peek()?.type === 'COMMA') {
          next();
        } else {
          break;
        }
      }
      if (peek()?.type === 'SEMI') {
        next();
        if (peek()?.type === 'DOT') break;
      } else {
        break;
      }
    }
    if (peek()?.type === 'DOT') next();
  }

  return triples;
}

// ── Schema Extraction ──────────────────────────────────────────────────────

function walkTtlFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['examples', 'generated', 'changesets', 'graphs'].includes(entry.name)) continue;
      walkTtlFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ttl')) {
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

const DEFAULT_PREFIXES = new Map<string, string>([
  ['wod', 'https://wod.wiki/ontology#'],
  ['ufo', 'https://wod.wiki/ontology/patterns#'],
  ['qa', 'https://wod.wiki/ontology/qa#'],
  ['code', 'https://wod.wiki/ontology/code#'],
  ['bridge', 'https://wod.wiki/ontology/bridge#'],
  ['owl', 'http://www.w3.org/2002/07/owl#'],
  ['rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
  ['rdfs', 'http://www.w3.org/2000/01/rdf-schema#'],
  ['xsd', 'http://www.w3.org/2001/XMLSchema#'],
  ['sh', 'http://www.w3.org/ns/shacl#'],
  ['sosa', 'http://www.w3.org/ns/sosa/'],
  ['skos', 'http://www.w3.org/2004/02/skos/core#'],
  ['prov', 'http://www.w3.org/ns/prov#'],
  ['qudt', 'http://qudt.org/schema/qudt/'],
  ['unit', 'http://qudt.org/vocab/unit/'],
]);

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

function expandCurie(curie: string, prefixes: Map<string, string>): string {
  if (curie.startsWith('http://') || curie.startsWith('https://')) return curie;
  const idx = curie.indexOf(':');
  if (idx !== -1) {
    const pfx = curie.slice(0, idx);
    const local = curie.slice(idx + 1);
    const ns = prefixes.get(pfx);
    if (ns) return `${ns}${local}`;
  }
  return curie;
}

function normalizeCurie(iriOrCurie: string, prefixes: Map<string, string>): string {
  for (const [pfx, ns] of prefixes.entries()) {
    if (iriOrCurie.startsWith(ns)) {
      return `${pfx}:${iriOrCurie.slice(ns.length)}`;
    }
  }
  return iriOrCurie;
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
  const prefixes = new Map<string, string>(DEFAULT_PREFIXES);
  const allTriples: Array<Triple & { sourceFile: string }> = [];

  for (const file of ttlFiles) {
    const rel = path.relative(ONTOLOGY_DIR, file).replace(/\\/g, '/');
    const triples = parseTurtleFile(file, prefixes);
    for (const t of triples) {
      allTriples.push({ ...t, sourceFile: rel });
    }
  }

  const classes = new Map<string, ClassDef>();
  const props = new Map<string, PropDef>();
  const shapesByTarget = new Map<string, ShapeConstraint[]>();
  const metrics = new Map<string, MetricDef>();

  // Group triples by subject
  const bySubject = new Map<string, Array<Triple & { sourceFile: string }>>();
  for (const t of allTriples) {
    const list = bySubject.get(t.subject) ?? [];
    list.push(t);
    bySubject.set(t.subject, list);
  }

  for (const [subj, subjTriples] of bySubject.entries()) {
    const types = subjTriples
      .filter((t) => t.predicate === 'rdf:type' && t.object.kind === 'iri')
      .map((t) => (t.object as { kind: 'iri'; curie: string }).curie);

    const getStr = (pred: string) => {
      const hit = subjTriples.find((t) => t.predicate === pred && t.object.kind === 'literal');
      return hit && hit.object.kind === 'literal' ? hit.object.value : '';
    };
    const getIris = (pred: string) =>
      subjTriples
        .filter((t) => t.predicate === pred && t.object.kind === 'iri')
        .map((t) => (t.object as { kind: 'iri'; curie: string }).curie);

    const moduleName = subjTriples[0]?.sourceFile.replace(/\.ttl$/, '') ?? 'unknown';

    if (types.includes('owl:Class') || types.includes('rdfs:Class')) {
      const stereotype = getIris('ufo:stereotype')[0];
      classes.set(subj, {
        curie: subj,
        iri: expandCurie(subj, prefixes),
        tsName: toTsInterfaceName(subj),
        label: getStr('rdfs:label') || subj,
        comment: getStr('rdfs:comment'),
        module: moduleName,
        stereotype,
        superClasses: getIris('rdfs:subClassOf'),
      });
    }

    if (
      types.includes('owl:ObjectProperty') ||
      types.includes('owl:DatatypeProperty') ||
      types.includes('owl:AnnotationProperty')
    ) {
      const kind = types.includes('owl:ObjectProperty')
        ? 'object'
        : types.includes('owl:DatatypeProperty')
          ? 'datatype'
          : 'annotation';
      props.set(subj, {
        curie: subj,
        iri: expandCurie(subj, prefixes),
        fieldName: toFieldName(subj),
        kind,
        label: getStr('rdfs:label') || subj,
        comment: getStr('rdfs:comment'),
        domains: getIris('rdfs:domain'),
        ranges: getIris('rdfs:range'),
      });
    }

    if (types.includes('wod:Metric')) {
      metrics.set(subj, {
        curie: subj,
        label: getStr('rdfs:label') || subj,
        allowedUnits: getIris('wod:allowedUnit'),
      });
    }

    if (types.includes('sh:NodeShape')) {
      const targetClasses = getIris('sh:targetClass');
      const propBlocks = subjTriples.filter(
        (t) => t.predicate === 'sh:property' && t.object.kind === 'bnode',
      );
      for (const tc of targetClasses) {
        const list = shapesByTarget.get(tc) ?? [];
        for (const pb of propBlocks) {
          if (pb.object.kind !== 'bnode') continue;
          const bprops = pb.object.props;
          const getBVal = (fullPred: string) => bprops.get(fullPred)?.[0];
          const pathVal = getBVal('http://www.w3.org/ns/shacl#path');
          if (!pathVal || pathVal.kind !== 'iri') continue;
          const pathCurie = normalizeCurie(pathVal.value, prefixes);
          const minC = getBVal('http://www.w3.org/ns/shacl#minCount');
          const maxC = getBVal('http://www.w3.org/ns/shacl#maxCount');
          const dtV = getBVal('http://www.w3.org/ns/shacl#datatype');
          const clsV = getBVal('http://www.w3.org/ns/shacl#class');
          const inV = getBVal('http://www.w3.org/ns/shacl#in');
          const minInc = getBVal('http://www.w3.org/ns/shacl#minInclusive');
          const msgV = getBVal('http://www.w3.org/ns/shacl#message');

          list.push({
            path: pathCurie,
            fieldName: toFieldName(pathCurie),
            minCount: minC?.kind === 'literal' ? Number(minC.value) : undefined,
            maxCount: maxC?.kind === 'literal' ? Number(maxC.value) : undefined,
            datatype: dtV?.kind === 'iri' ? normalizeCurie(dtV.value, prefixes) : undefined,
            targetClass: clsV?.kind === 'iri' ? normalizeCurie(clsV.value, prefixes) : undefined,
            allowedValues:
              inV?.kind === 'list'
                ? inV.items.map((it) => (it.kind === 'literal' ? it.value : it.kind === 'iri' ? it.curie : '')).filter(Boolean)
                : undefined,
            minInclusive: minInc?.kind === 'literal' ? Number(minInc.value) : undefined,
            message: msgV?.kind === 'literal' ? msgV.value : undefined,
          });
        }
        shapesByTarget.set(tc, list);
      }
    }
  }

  // Build TypeScript output
  const lines: string[] = [
    '/* eslint-disable */',
    '/**',
    ' * AUTO-GENERATED by scripts/ontology/codegen.ts — DO NOT EDIT BY HAND.',
    ` * Parsed ${ttlFiles.length} Turtle schema files from ontology/.`,
    ` * Classes: ${classes.size} | Properties: ${props.size} | Shapes: ${shapesByTarget.size} | Metrics: ${metrics.size}`,
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
    const knownParents = cls.superClasses.filter((sc) => classes.has(sc)).map((sc) => classes.get(sc)!.tsName);
    const extendsClause = knownParents.length > 0 ? ` extends ${knownParents.join(', ')}` : '';
    const domainProps = [...props.values()].filter((p) => p.domains.includes(cls.curie));
    const constraints = shapesByTarget.get(cls.curie) ?? [];
    const constraintByField = new Map<string, ShapeConstraint>();
    for (const c of constraints) {
      constraintByField.set(c.fieldName, c);
    }

    // Collect all field names from domain properties + shape constraints
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
  lines.push('export function getClassesByStereotype(stereotype: UfoStereotypeCurie): OntologyClassMeta[] {');
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
  lines.push('      const values = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];');
  lines.push('      if (c.minCount !== undefined && values.length < c.minCount) {');
  lines.push('        errors.push({');
  lines.push('          field: c.fieldName,');
  lines.push('          path: c.path,');
  lines.push('          message: c.message ?? `${c.path} requires at least ${c.minCount} value(s).`,');
  lines.push('        });');
  lines.push('      }');
  lines.push('      if (c.maxCount !== undefined && values.length > c.maxCount) {');
  lines.push('        errors.push({');
  lines.push('          field: c.fieldName,');
  lines.push('          path: c.path,');
  lines.push('          message: c.message ?? `${c.path} allows at most ${c.maxCount} value(s).`,');
  lines.push('        });');
  lines.push('      }');
  lines.push('      for (const v of values) {');
  lines.push('        if (c.allowedValues && c.allowedValues.length > 0 && !c.allowedValues.includes(String(v))) {');
  lines.push('          errors.push({');
  lines.push('            field: c.fieldName,');
  lines.push('            path: c.path,');
  lines.push('            message: c.message ?? `${c.path} value "${String(v)}" must be one of [${c.allowedValues.join(", ")}].`,');
  lines.push('          });');
  lines.push('        }');
  lines.push('        if (c.minInclusive !== undefined && (typeof v !== "number" || v < c.minInclusive)) {');
  lines.push('          errors.push({');
  lines.push('            field: c.fieldName,');
  lines.push('            path: c.path,');
  lines.push('            message: c.message ?? `${c.path} must be >= ${c.minInclusive}.`,');
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
    `Generated ${path.relative(REPO_ROOT, OUTPUT_FILE)}: ${classes.size} classes, ${props.size} properties, ${shapesByTarget.size} shaped targets, ${metrics.size} metrics.`,
  );
}

if (import.meta.main) {
  runCodegen();
}
