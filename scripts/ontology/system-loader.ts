/**
 * Shared RDF Turtle / TriG Parser & System Meta-Ontology (`sys:`) Loader
 *
 * Pure TypeScript, zero DOM/React imports, Bun-compatible.
 * Consumed by `index-code-graph.ts`, `codegen.ts`, `query.ts`, and `build-viewer.ts`
 * so all ontology tooling loads any registered multi-graph dataset without duplicating
 * Turtle tokenizers or hardcoding slice/kind lists.
 */
import fs from 'node:fs';
import path from 'node:path';

// ── Canonical Namespace & Term Constants ───────────────────────────────────

export const DEFAULT_GRAPH = '';

export const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS_NS = 'http://www.w3.org/2000/01/rdf-schema#';
export const OWL_NS = 'http://www.w3.org/2002/07/owl#';
export const XSD_NS = 'http://www.w3.org/2001/XMLSchema#';
export const SH_NS = 'http://www.w3.org/ns/shacl#';
export const DCTERMS_NS = 'http://purl.org/dc/terms/';
export const VOID_NS = 'http://rdfs.org/ns/void#';

export const SYS_NS = 'https://wod.wiki/ontology/system#';
export const WOD_NS = 'https://wod.wiki/ontology#';
export const WODG_NS = 'https://wod.wiki/graph/';
export const UFO_NS = 'https://wod.wiki/ontology/patterns#';
export const QA_NS = 'https://wod.wiki/ontology/qa#';
export const CODE_NS = 'https://wod.wiki/ontology/code#';
export const BRIDGE_NS = 'https://wod.wiki/ontology/bridge#';
export const ARCH_NS = 'https://wod.wiki/ontology/architecture#';
export const WF_NS = 'https://wod.wiki/ontology/workflow#';

export const RDF = {
  type: `${RDF_NS}type`,
  first: `${RDF_NS}first`,
  rest: `${RDF_NS}rest`,
  nil: `${RDF_NS}nil`,
  langString: `${RDF_NS}langString`,
} as const;

export const RDFS = {
  Class: `${RDFS_NS}Class`,
  subClassOf: `${RDFS_NS}subClassOf`,
  subPropertyOf: `${RDFS_NS}subPropertyOf`,
  domain: `${RDFS_NS}domain`,
  range: `${RDFS_NS}range`,
  label: `${RDFS_NS}label`,
  comment: `${RDFS_NS}comment`,
} as const;

export const OWL = {
  Ontology: `${OWL_NS}Ontology`,
  Class: `${OWL_NS}Class`,
  ObjectProperty: `${OWL_NS}ObjectProperty`,
  DatatypeProperty: `${OWL_NS}DatatypeProperty`,
  AnnotationProperty: `${OWL_NS}AnnotationProperty`,
  versionInfo: `${OWL_NS}versionInfo`,
} as const;

export const XSD = {
  string: `${XSD_NS}string`,
  boolean: `${XSD_NS}boolean`,
  integer: `${XSD_NS}integer`,
  decimal: `${XSD_NS}decimal`,
  double: `${XSD_NS}double`,
} as const;

export const SYS = {
  OntologySystem: `${SYS_NS}OntologySystem`,
  OntologyGraph: `${SYS_NS}OntologyGraph`,
  OntologyKind: `${SYS_NS}OntologyKind`,
  MetaOntology: `${SYS_NS}MetaOntology`,
  GlobalOntology: `${SYS_NS}GlobalOntology`,
  LocalOntology: `${SYS_NS}LocalOntology`,
  GeneratedOntology: `${SYS_NS}GeneratedOntology`,
  BridgeGraph: `${SYS_NS}BridgeGraph`,
  NodeKind: `${SYS_NS}NodeKind`,
  SelectorMode: `${SYS_NS}SelectorMode`,
  InstanceSelector: `${SYS_NS}InstanceSelector`,
  DefinedClassSelector: `${SYS_NS}DefinedClassSelector`,
  GraphBridge: `${SYS_NS}GraphBridge`,
  LinkContract: `${SYS_NS}LinkContract`,

  // Properties
  managedNamespace: `${SYS_NS}managedNamespace`,
  externalNamespace: `${SYS_NS}externalNamespace`,
  hasOntologyGraph: `${SYS_NS}hasOntologyGraph`,
  hasBridgeGraph: `${SYS_NS}hasBridgeGraph`,
  hasGraphBridge: `${SYS_NS}hasGraphBridge`,
  hasLinkContract: `${SYS_NS}hasLinkContract`,
  graphIri: `${SYS_NS}graphIri`,
  slug: `${SYS_NS}slug`,
  ontologyKind: `${SYS_NS}ontologyKind`,
  layerOrder: `${SYS_NS}layerOrder`,
  accentToken: `${SYS_NS}accentToken`,
  schemaGlob: `${SYS_NS}schemaGlob`,
  generatedGlob: `${SYS_NS}generatedGlob`,
  hasNodeKind: `${SYS_NS}hasNodeKind`,
  kindSlug: `${SYS_NS}kindSlug`,
  badgeLabel: `${SYS_NS}badgeLabel`,
  selectorMode: `${SYS_NS}selectorMode`,
  targetClass: `${SYS_NS}targetClass`,
  sourceClass: `${SYS_NS}sourceClass`,
  idProperty: `${SYS_NS}idProperty`,
  labelProperty: `${SYS_NS}labelProperty`,
  bridgePredicate: `${SYS_NS}bridgePredicate`,
  linkPredicate: `${SYS_NS}linkPredicate`,
  sourceGraph: `${SYS_NS}sourceGraph`,
  targetGraph: `${SYS_NS}targetGraph`,
  forwardLabel: `${SYS_NS}forwardLabel`,
  inverseLabel: `${SYS_NS}inverseLabel`,
  navPriority: `${SYS_NS}navPriority`,
  allowHistoricalMissingTarget: `${SYS_NS}allowHistoricalMissingTarget`,
} as const;

export const STANDARD_PREFIXES: Readonly<Record<string, string>> = {
  rdf: RDF_NS,
  rdfs: RDFS_NS,
  owl: OWL_NS,
  xsd: XSD_NS,
  sh: SH_NS,
  dcterms: DCTERMS_NS,
  void: VOID_NS,
  sys: SYS_NS,
  wod: WOD_NS,
  wodg: WODG_NS,
  ufo: UFO_NS,
  qa: QA_NS,
  code: CODE_NS,
  bridge: BRIDGE_NS,
  arch: ARCH_NS,
  wf: WF_NS,
};

// ── RDF Data Model ─────────────────────────────────────────────────────────

export interface RdfNamedNode {
  readonly termType: 'NamedNode';
  readonly value: string;
}

export interface RdfBlankNode {
  readonly termType: 'BlankNode';
  readonly value: string;
}

export interface RdfLiteral {
  readonly termType: 'Literal';
  readonly value: string;
  readonly datatype: string;
  readonly language?: string;
}

export type RdfSubject = RdfNamedNode | RdfBlankNode;
export type RdfTerm = RdfNamedNode | RdfBlankNode | RdfLiteral;

export interface RdfQuad {
  readonly subject: RdfSubject;
  readonly predicate: RdfNamedNode;
  readonly object: RdfTerm;
  readonly graph: string;
}

export interface ParseOptions {
  /** Named graph IRI to assign to default-graph statements (defaults to DEFAULT_GRAPH). */
  readonly graph?: string;
  /** Initial base IRI for resolving relative `<...>` references. */
  readonly baseIri?: string;
  /** Initial prefix bindings available before document `@prefix` directives. */
  readonly prefixes?: Readonly<Record<string, string>>;
  /** Optional prefix for generated and labeled blank nodes to prevent cross-file collisions. */
  readonly bnodePrefix?: string;
}

export interface ParseResult {
  readonly quads: RdfQuad[];
  readonly prefixes: Record<string, string>;
  readonly base?: string;
}

// ── Prefix Expansion & Compaction Helpers ──────────────────────────────────

function lookupPrefix(
  prefix: string,
  prefixes: Readonly<Record<string, string>> | ReadonlyMap<string, string>,
): string | undefined {
  if (prefixes instanceof Map) {
    return prefixes.get(prefix);
  }
  return (prefixes as Readonly<Record<string, string>>)[prefix];
}

function prefixEntries(
  prefixes: Readonly<Record<string, string>> | ReadonlyMap<string, string>,
): Array<[string, string]> {
  if (prefixes instanceof Map) {
    return [...prefixes.entries()];
  }
  return Object.entries(prefixes as Readonly<Record<string, string>>);
}

/**
 * Expands a Turtle/CURIE term (`a`, `<iri>`, `prefix:local`, or already-expanded IRI)
 * into its full IRI string using the supplied prefix map.
 */
export function expandCurie(
  term: string,
  prefixes: Readonly<Record<string, string>> | ReadonlyMap<string, string> = STANDARD_PREFIXES,
): string {
  if (term === 'a') return RDF.type;
  if (term.startsWith('<') && term.endsWith('>')) {
    return term.slice(1, -1);
  }
  if (term.startsWith('_:')) return term;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(term) || term.startsWith('urn:')) {
    return term;
  }
  const colon = term.indexOf(':');
  if (colon !== -1) {
    const pfx = term.slice(0, colon);
    const local = unescapeLocalName(term.slice(colon + 1));
    const ns = lookupPrefix(pfx, prefixes);
    if (ns !== undefined) {
      return `${ns}${local}`;
    }
  }
  return term;
}

/**
 * Compacts a full IRI into a CURIE (`prefix:local`) using the longest matching
 * namespace in `prefixes`. Returns the original IRI if no prefix matches.
 */
export function compactIri(
  iri: string,
  prefixes: Readonly<Record<string, string>> | ReadonlyMap<string, string> = STANDARD_PREFIXES,
): string {
  if (!iri || iri.startsWith('_:')) return iri;
  let bestPrefix: string | undefined;
  let bestNsLen = -1;

  for (const [pfx, ns] of prefixEntries(prefixes)) {
    if (!ns) continue;
    if (iri.startsWith(ns) && ns.length > bestNsLen) {
      bestNsLen = ns.length;
      bestPrefix = pfx;
    }
  }

  if (bestPrefix !== undefined) {
    return `${bestPrefix}:${iri.slice(bestNsLen)}`;
  }
  return iri;
}

function unescapeLocalName(local: string): string {
  if (!local.includes('\\')) return local;
  return local.replace(/\\(.)/g, '$1');
}

function unescapeTurtleString(raw: string): string {
  if (!raw.includes('\\')) return raw;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\' || i + 1 >= raw.length) {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    switch (next) {
      case 'n':
        out += '\n';
        i++;
        break;
      case 'r':
        out += '\r';
        i++;
        break;
      case 't':
        out += '\t';
        i++;
        break;
      case 'b':
        out += '\b';
        i++;
        break;
      case 'f':
        out += '\f';
        i++;
        break;
      case '"':
        out += '"';
        i++;
        break;
      case "'":
        out += "'";
        i++;
        break;
      case '\\':
        out += '\\';
        i++;
        break;
      case 'u': {
        const hex = raw.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
        } else {
          out += '\\u';
          i++;
        }
        break;
      }
      case 'U': {
        const hex = raw.slice(i + 2, i + 10);
        if (/^[0-9a-fA-F]{8}$/.test(hex)) {
          out += String.fromCodePoint(parseInt(hex, 16));
          i += 9;
        } else {
          out += '\\U';
          i++;
        }
        break;
      }
      default:
        out += next;
        i++;
        break;
    }
  }
  return out;
}

function resolveIriAgainstBase(iri: string, base?: string): string {
  const unescaped = unescapeTurtleString(iri);
  if (!base) return unescaped;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(unescaped)) {
    return unescaped;
  }
  try {
    return new URL(unescaped, base).href;
  } catch {
    return unescaped;
  }
}

// ── Turtle & TriG Tokenizer ────────────────────────────────────────────────

type TokenType =
  | 'PREFIX_KW'
  | 'BASE_KW'
  | 'GRAPH_KW'
  | 'IRI'
  | 'PNAME'
  | 'BNODE'
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
  | 'LBRACE'
  | 'RBRACE'
  | 'LANG_TAG'
  | 'DATATYPE_HAT';

interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly line: number;
}

function tokenizeRdf(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      if (ch === '\n') line++;
      i++;
      continue;
    }

    // Comment
    if (ch === '#') {
      while (i < len && input[i] !== '\n') i++;
      continue;
    }

    // Single-char structural punctuation
    if (ch === ';') {
      tokens.push({ type: 'SEMI', value: ';', line });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',', line });
      i++;
      continue;
    }
    if (ch === '[') {
      tokens.push({ type: 'LBRACKET', value: '[', line });
      i++;
      continue;
    }
    if (ch === ']') {
      tokens.push({ type: 'RBRACKET', value: ']', line });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', line });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', line });
      i++;
      continue;
    }
    if (ch === '{') {
      tokens.push({ type: 'LBRACE', value: '{', line });
      i++;
      continue;
    }
    if (ch === '}') {
      tokens.push({ type: 'RBRACE', value: '}', line });
      i++;
      continue;
    }
    if (ch === '^' && input[i + 1] === '^') {
      tokens.push({ type: 'DATATYPE_HAT', value: '^^', line });
      i += 2;
      continue;
    }

    // @prefix / @base / @lang
    if (ch === '@') {
      if (input.startsWith('@prefix', i) && (i + 7 >= len || /\s/.test(input[i + 7]))) {
        tokens.push({ type: 'PREFIX_KW', value: '@prefix', line });
        i += 7;
        continue;
      }
      if (input.startsWith('@base', i) && (i + 5 >= len || /\s/.test(input[i + 5]))) {
        tokens.push({ type: 'BASE_KW', value: '@base', line });
        i += 5;
        continue;
      }
      const langMatch = input.slice(i).match(/^@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*/);
      if (langMatch) {
        tokens.push({ type: 'LANG_TAG', value: langMatch[0].slice(1).toLowerCase(), line });
        i += langMatch[0].length;
        continue;
      }
    }

    // Full IRI <...>
    if (ch === '<') {
      const startLine = line;
      i++;
      let val = '';
      while (i < len && input[i] !== '>') {
        if (input[i] === '\n') line++;
        val += input[i++];
      }
      if (i >= len || input[i] !== '>') {
        throw new Error(`Unterminated IRI starting at line ${startLine}`);
      }
      i++; // consume '>'
      tokens.push({ type: 'IRI', value: val, line: startLine });
      continue;
    }

    // Long string """...""" or '''...'''
    if (input.startsWith('"""', i) || input.startsWith("'''", i)) {
      const startLine = line;
      const quote = input.slice(i, i + 3);
      i += 3;
      let raw = '';
      let closed = false;
      while (i < len) {
        if (input.startsWith(quote, i)) {
          // Handle 4 or 5 consecutive quotes at the end of a long string
          // e.g., """foo"""" -> content is `foo"`
          let qCount = 0;
          while (i + qCount < len && input[i + qCount] === quote[0]) {
            qCount++;
          }
          if (qCount === 3) {
            i += 3;
            closed = true;
            break;
          }
          // Extra quotes belong to content before closing triple-quote
          raw += quote[0].repeat(qCount - 3);
          i += qCount;
          closed = true;
          break;
        }
        if (input[i] === '\\' && i + 1 < len) {
          raw += '\\' + input[i + 1];
          if (input[i + 1] === '\n') line++;
          i += 2;
        } else {
          if (input[i] === '\n') line++;
          raw += input[i++];
        }
      }
      if (!closed) {
        throw new Error(`Unterminated multiline string starting at line ${startLine}`);
      }
      tokens.push({ type: 'STRING', value: unescapeTurtleString(raw), line: startLine });
      continue;
    }

    // Short string "..." or '...'
    if (ch === '"' || ch === "'") {
      const startLine = line;
      const quote = ch;
      i++;
      let raw = '';
      let closed = false;
      while (i < len) {
        if (input[i] === quote) {
          i++;
          closed = true;
          break;
        }
        if (input[i] === '\\' && i + 1 < len) {
          raw += '\\' + input[i + 1];
          i += 2;
        } else {
          if (input[i] === '\n') {
            throw new Error(`Unterminated string literal at line ${startLine}`);
          }
          raw += input[i++];
        }
      }
      if (!closed) {
        throw new Error(`Unterminated string literal starting at line ${startLine}`);
      }
      tokens.push({ type: 'STRING', value: unescapeTurtleString(raw), line: startLine });
      continue;
    }

    // Dot (statement terminator unless starting a decimal like `.5`)
    if (ch === '.' && (i + 1 >= len || !/\d/.test(input[i + 1]))) {
      tokens.push({ type: 'DOT', value: '.', line });
      i++;
      continue;
    }

    // Numeric literal (integer, decimal, double)
    // Per Turtle 1.1: decimal requires digits after '.', so `1.` is integer `1` + DOT.
    const numMatch = input
      .slice(i)
      .match(/^[+-]?(?:\d+\.\d+[eE][+-]?\d+|\.\d+[eE][+-]?\d+|\d+[eE][+-]?\d+|\d+\.\d+|\.\d+|\d+)/);
    if (
      numMatch &&
      (i + numMatch[0].length >= len || /[\s;,.()[\]{}^#]/.test(input[i + numMatch[0].length]))
    ) {
      tokens.push({ type: 'NUMBER', value: numMatch[0], line });
      i += numMatch[0].length;
      continue;
    }

    // Blank node label _:label, prefixed name, or keyword (`a`, `true`, `false`, `PREFIX`, `BASE`, `GRAPH`)
    let word = '';
    while (i < len) {
      const c = input[i];
      if (c === '\\' && i + 1 < len) {
        word += c + input[i + 1];
        i += 2;
        continue;
      }
      if (/[\s;,()[\]{}<>"'^#]/.test(c)) {
        break;
      }
      word += c;
      i++;
    }

    // Strip trailing unescaped dots (statement terminators attached to a CURIE, e.g., `ex:Foo.`)
    let trailingDots = 0;
    while (word.endsWith('.') && !word.endsWith('\\.')) {
      word = word.slice(0, -1);
      trailingDots++;
    }

    if (word.length > 0) {
      if (word === 'a') {
        tokens.push({ type: 'A', value: 'a', line });
      } else if (word === 'true' || word === 'false') {
        tokens.push({ type: 'BOOL', value: word, line });
      } else if (word.toUpperCase() === 'PREFIX') {
        tokens.push({ type: 'PREFIX_KW', value: 'PREFIX', line });
      } else if (word.toUpperCase() === 'BASE') {
        tokens.push({ type: 'BASE_KW', value: 'BASE', line });
      } else if (word.toUpperCase() === 'GRAPH') {
        tokens.push({ type: 'GRAPH_KW', value: 'GRAPH', line });
      } else if (word.startsWith('_:')) {
        tokens.push({ type: 'BNODE', value: word, line });
      } else {
        tokens.push({ type: 'PNAME', value: word, line });
      }
    }

    for (let d = 0; d < trailingDots; d++) {
      tokens.push({ type: 'DOT', value: '.', line });
    }
  }

  return tokens;
}

// ── Recursive-Descent Turtle / TriG Parser ─────────────────────────────────

function parseRdfInternal(
  input: string,
  allowNamedGraphs: boolean,
  options?: ParseOptions,
): ParseResult {
  const tokens = tokenizeRdf(input);
  const prefixes: Record<string, string> = { ...(options?.prefixes ?? {}) };
  let base = options?.baseIri;
  const defaultGraph = options?.graph ?? DEFAULT_GRAPH;
  const bnodePrefix = options?.bnodePrefix ?? '';
  const quads: RdfQuad[] = [];

  let pos = 0;
  let bnodeSeq = 0;

  function peek(offset = 0): Token | undefined {
    return tokens[pos + offset];
  }

  function next(): Token | undefined {
    return tokens[pos++];
  }

  function allocBnode(): RdfBlankNode {
    bnodeSeq++;
    const label = bnodePrefix ? `${bnodePrefix}b${bnodeSeq}` : `b${bnodeSeq}`;
    return { termType: 'BlankNode', value: `_:${label}` };
  }

  function resolveBnodeLabel(raw: string): RdfBlankNode {
    const label = raw.slice(2);
    return {
      termType: 'BlankNode',
      value: bnodePrefix ? `_:${bnodePrefix}${label}` : `_:${label}`,
    };
  }

  function resolveNamedNode(tok: Token): RdfNamedNode {
    if (tok.type === 'IRI') {
      return { termType: 'NamedNode', value: resolveIriAgainstBase(tok.value, base) };
    }
    if (tok.type === 'A') {
      return { termType: 'NamedNode', value: RDF.type };
    }
    if (tok.type === 'PNAME') {
      const colon = tok.value.indexOf(':');
      if (colon !== -1) {
        const pfx = tok.value.slice(0, colon);
        const local = unescapeLocalName(tok.value.slice(colon + 1));
        const ns = prefixes[pfx];
        if (ns !== undefined) {
          return { termType: 'NamedNode', value: `${ns}${local}` };
        }
      }
      throw new Error(`Unknown prefix in '${tok.value}' at line ${tok.line}`);
    }
    throw new Error(`Expected IRI or prefixed name at line ${tok.line}, got ${tok.type} ('${tok.value}')`);
  }

  function parseObject(currentGraph: string): RdfTerm {
    const tok = peek();
    if (!tok) {
      throw new Error('Unexpected end of input while parsing RDF object');
    }

    // Blank node property list [ ... ]
    if (tok.type === 'LBRACKET') {
      next();
      const bnode = allocBnode();
      parsePredicateObjectList(bnode, currentGraph, 'RBRACKET');
      if (peek()?.type === 'RBRACKET') {
        next();
      } else {
        throw new Error(`Expected ']' to close blank node starting at line ${tok.line}`);
      }
      return bnode;
    }

    // RDF collection ( ... )
    if (tok.type === 'LPAREN') {
      next();
      const items: RdfTerm[] = [];
      while (peek() && peek()!.type !== 'RPAREN') {
        items.push(parseObject(currentGraph));
      }
      if (peek()?.type === 'RPAREN') {
        next();
      } else {
        throw new Error(`Expected ')' to close RDF collection starting at line ${tok.line}`);
      }
      if (items.length === 0) {
        return { termType: 'NamedNode', value: RDF.nil };
      }
      const head = allocBnode();
      let curr = head;
      for (let idx = 0; idx < items.length; idx++) {
        quads.push({
          subject: curr,
          predicate: { termType: 'NamedNode', value: RDF.first },
          object: items[idx],
          graph: currentGraph,
        });
        const rest: RdfTerm =
          idx + 1 < items.length ? allocBnode() : { termType: 'NamedNode', value: RDF.nil };
        quads.push({
          subject: curr,
          predicate: { termType: 'NamedNode', value: RDF.rest },
          object: rest,
          graph: currentGraph,
        });
        if (rest.termType === 'BlankNode') {
          curr = rest;
        }
      }
      return head;
    }

    // String literal (with optional ^^datatype or @lang)
    if (tok.type === 'STRING') {
      next();
      const nextTok = peek();
      if (nextTok?.type === 'DATATYPE_HAT') {
        next();
        const dtTok = next();
        if (!dtTok) {
          throw new Error(`Expected datatype IRI after '^^' at line ${tok.line}`);
        }
        const dtNode = resolveNamedNode(dtTok);
        return { termType: 'Literal', value: tok.value, datatype: dtNode.value };
      }
      if (nextTok?.type === 'LANG_TAG') {
        next();
        return {
          termType: 'Literal',
          value: tok.value,
          datatype: RDF.langString,
          language: nextTok.value,
        };
      }
      return { termType: 'Literal', value: tok.value, datatype: XSD.string };
    }

    // Numeric literal
    if (tok.type === 'NUMBER') {
      next();
      let datatype: string = XSD.integer;
      if (/[eE]/.test(tok.value)) {
        datatype = XSD.double;
      } else if (tok.value.includes('.')) {
        datatype = XSD.decimal;
      }
      return { termType: 'Literal', value: tok.value, datatype };
    }

    // Boolean literal
    if (tok.type === 'BOOL') {
      next();
      return { termType: 'Literal', value: tok.value, datatype: XSD.boolean };
    }

    // Labeled blank node
    if (tok.type === 'BNODE') {
      next();
      return resolveBnodeLabel(tok.value);
    }

    // IRI or Prefixed Name
    next();
    return resolveNamedNode(tok);
  }

  function parsePredicateObjectList(
    subject: RdfSubject,
    currentGraph: string,
    terminator: 'DOT' | 'RBRACKET' | 'RBRACE',
  ): void {
    while (peek()) {
      const t = peek()!;
      if (t.type === terminator || t.type === 'DOT' || t.type === 'RBRACE' || t.type === 'RBRACKET') {
        break;
      }
      if (t.type === 'SEMI') {
        next();
        continue;
      }

      const predTok = next()!;
      const predicate = resolveNamedNode(predTok);

      // Object list separated by ','
      while (peek()) {
        const obj = parseObject(currentGraph);
        quads.push({
          subject,
          predicate,
          object: obj,
          graph: currentGraph,
        });
        if (peek()?.type === 'COMMA') {
          next();
        } else {
          break;
        }
      }

      if (peek()?.type === 'SEMI') {
        next();
      } else {
        break;
      }
    }
  }

  function parseSubject(currentGraph: string): RdfSubject {
    const tok = peek();
    if (!tok) {
      throw new Error('Unexpected end of input while parsing RDF subject');
    }
    if (tok.type === 'LBRACKET' || tok.type === 'LPAREN') {
      const term = parseObject(currentGraph);
      if (term.termType === 'Literal') {
        throw new Error(`Literal cannot appear in subject position at line ${tok.line}`);
      }
      return term;
    }
    if (tok.type === 'BNODE') {
      next();
      return resolveBnodeLabel(tok.value);
    }
    next();
    return resolveNamedNode(tok);
  }

  function parseGraphBlock(graphIri: string): void {
    const openTok = next(); // consume '{'
    while (peek() && peek()!.type !== 'RBRACE') {
      if (peek()!.type === 'DOT') {
        next();
        continue;
      }
      const subject = parseSubject(graphIri);
      // Allow standalone blankNodePropertyList without predicateObjectList
      if (peek()?.type !== 'DOT' && peek()?.type !== 'RBRACE') {
        parsePredicateObjectList(subject, graphIri, 'RBRACE');
      }
      if (peek()?.type === 'DOT') {
        next();
      }
    }
    if (peek()?.type === 'RBRACE') {
      next();
      // Some TriG serializers emit an optional trailing '.' after '}'
      if (peek()?.type === 'DOT') next();
    } else {
      throw new Error(`Expected '}' to close graph block starting at line ${openTok?.line ?? 0}`);
    }
  }

  while (pos < tokens.length) {
    const tok = peek()!;

    // @prefix / PREFIX
    if (tok.type === 'PREFIX_KW') {
      const isAtStyle = tok.value === '@prefix';
      next();
      const pfxTok = next();
      const iriTok = next();
      if (!pfxTok || !iriTok || iriTok.type !== 'IRI') {
        throw new Error(`Malformed prefix directive at line ${tok.line}`);
      }
      const pfx = pfxTok.value.replace(/:$/, '');
      prefixes[pfx] = resolveIriAgainstBase(iriTok.value, base);
      if (isAtStyle && peek()?.type === 'DOT') {
        next();
      } else if (!isAtStyle && peek()?.type === 'DOT') {
        next();
      }
      continue;
    }

    // @base / BASE
    if (tok.type === 'BASE_KW') {
      next();
      const iriTok = next();
      if (!iriTok || iriTok.type !== 'IRI') {
        throw new Error(`Malformed base directive at line ${tok.line}`);
      }
      base = resolveIriAgainstBase(iriTok.value, base);
      if (peek()?.type === 'DOT') next();
      continue;
    }

    if (tok.type === 'DOT') {
      next();
      continue;
    }

    // TriG: `GRAPH <iri> { ... }`
    if (tok.type === 'GRAPH_KW') {
      if (!allowNamedGraphs) {
        throw new Error(`TriG GRAPH block not allowed in Turtle mode at line ${tok.line}`);
      }
      next();
      const labelTok = next();
      if (!labelTok) {
        throw new Error(`Expected graph name after GRAPH at line ${tok.line}`);
      }
      const graphNode = resolveNamedNode(labelTok);
      if (peek()?.type !== 'LBRACE') {
        throw new Error(`Expected '{' after GRAPH ${labelTok.value} at line ${labelTok.line}`);
      }
      parseGraphBlock(graphNode.value);
      continue;
    }

    // TriG: anonymous default graph `{ ... }`
    if (tok.type === 'LBRACE') {
      if (!allowNamedGraphs) {
        throw new Error(`TriG graph block '{' not allowed in Turtle mode at line ${tok.line}`);
      }
      parseGraphBlock(defaultGraph);
      continue;
    }

    // TriG: `<iri> { ... }` or `prefix:name { ... }`
    if (
      (tok.type === 'IRI' || tok.type === 'PNAME') &&
      peek(1)?.type === 'LBRACE'
    ) {
      if (!allowNamedGraphs) {
        throw new Error(`TriG named graph block not allowed in Turtle mode at line ${tok.line}`);
      }
      next();
      const graphNode = resolveNamedNode(tok);
      parseGraphBlock(graphNode.value);
      continue;
    }

    // Standard triple statement in defaultGraph
    const subject = parseSubject(defaultGraph);
    if (peek()?.type !== 'DOT') {
      parsePredicateObjectList(subject, defaultGraph, 'DOT');
    }
    if (peek()?.type === 'DOT') {
      next();
    }
  }

  return { quads, prefixes, base };
}

/**
 * Parses a Turtle (`.ttl`) document into RDF quads assigned to `options?.graph` (default `DEFAULT_GRAPH`).
 */
export function parseTurtle(input: string, options?: ParseOptions): ParseResult {
  return parseRdfInternal(input, false, options);
}

/**
 * Parses a TriG (`.trig`) document (or Turtle subset) supporting named graph `<iri> { ... }` blocks.
 */
export function parseTriG(input: string, options?: ParseOptions): ParseResult {
  return parseRdfInternal(input, true, options);
}

// ── In-Memory Multi-Graph Store & Transitive Closures ──────────────────────

export interface QuadFilter {
  readonly subject?: string;
  readonly predicate?: string;
  readonly object?: string;
  readonly graph?: string;
}

export class MultiGraphStore {
  private readonly quadList: RdfQuad[] = [];
  private readonly seen = new Set<string>();
  private readonly byGraph = new Map<string, RdfQuad[]>();
  private readonly bySubject = new Map<string, RdfQuad[]>();
  private readonly byPredicate = new Map<string, RdfQuad[]>();
  private readonly byObject = new Map<string, RdfQuad[]>();
  private readonly prefixMap = new Map<string, string>(Object.entries(STANDARD_PREFIXES));

  // Lazy caches invalidated on mutation
  private subClassCache = new Map<string, Set<string>>();
  private superClassCache = new Map<string, Set<string>>();
  private subPropCache = new Map<string, Set<string>>();
  private superPropCache = new Map<string, Set<string>>();

  get size(): number {
    return this.quadList.length;
  }

  addPrefixes(prefixes: Readonly<Record<string, string>>): void {
    for (const [pfx, ns] of Object.entries(prefixes)) {
      if (ns) this.prefixMap.set(pfx, ns);
    }
  }

  getPrefixes(): Record<string, string> {
    return Object.fromEntries(this.prefixMap.entries());
  }

  expand(term: string): string {
    return expandCurie(term, this.prefixMap);
  }

  compact(iri: string): string {
    return compactIri(iri, this.prefixMap);
  }

  private invalidateCaches(): void {
    if (this.subClassCache.size > 0) this.subClassCache.clear();
    if (this.superClassCache.size > 0) this.superClassCache.clear();
    if (this.subPropCache.size > 0) this.subPropCache.clear();
    if (this.superPropCache.size > 0) this.superPropCache.clear();
  }

  addQuad(quad: RdfQuad): boolean {
    const objKey =
      quad.object.termType === 'Literal'
        ? `L\0${quad.object.value}\0${quad.object.datatype}\0${quad.object.language ?? ''}`
        : `${quad.object.termType[0]}\0${quad.object.value}`;
    const key = `${quad.graph}\0${quad.subject.value}\0${quad.predicate.value}\0${objKey}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.quadList.push(quad);

    let gList = this.byGraph.get(quad.graph);
    if (!gList) {
      gList = [];
      this.byGraph.set(quad.graph, gList);
    }
    gList.push(quad);

    let sList = this.bySubject.get(quad.subject.value);
    if (!sList) {
      sList = [];
      this.bySubject.set(quad.subject.value, sList);
    }
    sList.push(quad);

    let pList = this.byPredicate.get(quad.predicate.value);
    if (!pList) {
      pList = [];
      this.byPredicate.set(quad.predicate.value, pList);
    }
    pList.push(quad);

    if (quad.object.termType !== 'Literal') {
      let oList = this.byObject.get(quad.object.value);
      if (!oList) {
        oList = [];
        this.byObject.set(quad.object.value, oList);
      }
      oList.push(quad);
    }

    if (
      quad.predicate.value === RDFS.subClassOf ||
      quad.predicate.value === RDFS.subPropertyOf
    ) {
      this.invalidateCaches();
    }
    return true;
  }

  addQuads(quads: readonly RdfQuad[]): number {
    let added = 0;
    for (const q of quads) {
      if (this.addQuad(q)) added++;
    }
    return added;
  }

  /**
   * Parses a Turtle or TriG string directly into this store, merging its prefixes.
   */
  loadTurtle(input: string, options?: ParseOptions): number {
    const res = parseTurtle(input, options);
    this.addPrefixes(res.prefixes);
    return this.addQuads(res.quads);
  }

  loadTriG(input: string, options?: ParseOptions): number {
    const res = parseTriG(input, options);
    this.addPrefixes(res.prefixes);
    return this.addQuads(res.quads);
  }

  graphs(): string[] {
    return [...this.byGraph.keys()].sort((a, b) => a.localeCompare(b));
  }

  quads(filter?: QuadFilter): RdfQuad[] {
    if (!filter) return [...this.quadList];
    const s = filter.subject !== undefined ? this.expand(filter.subject) : undefined;
    const p = filter.predicate !== undefined ? this.expand(filter.predicate) : undefined;
    const o = filter.object !== undefined ? this.expand(filter.object) : undefined;
    const g = filter.graph !== undefined ? (filter.graph === '' ? '' : this.expand(filter.graph)) : undefined;

    // Pick the narrowest index available
    let candidates: RdfQuad[];
    if (s !== undefined) {
      candidates = this.bySubject.get(s) ?? [];
    } else if (o !== undefined) {
      candidates = this.byObject.get(o) ?? [];
    } else if (p !== undefined) {
      candidates = this.byPredicate.get(p) ?? [];
    } else if (g !== undefined) {
      candidates = this.byGraph.get(g) ?? [];
    } else {
      candidates = this.quadList;
    }

    return candidates.filter(
      (q) =>
        (s === undefined || q.subject.value === s) &&
        (p === undefined || q.predicate.value === p) &&
        (o === undefined || q.object.value === o) &&
        (g === undefined || q.graph === g),
    );
  }

  outgoing(subject: string, predicate?: string, graph?: string): RdfQuad[] {
    return this.quads({ subject, predicate, graph });
  }

  incoming(object: string, predicate?: string, graph?: string): RdfQuad[] {
    return this.quads({ object, predicate, graph });
  }

  objects(subject: string, predicate: string, graph?: string): RdfTerm[] {
    return this.quads({ subject, predicate, graph }).map((q) => q.object);
  }

  objectValues(subject: string, predicate: string, graph?: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const obj of this.objects(subject, predicate, graph)) {
      if (!seen.has(obj.value)) {
        seen.add(obj.value);
        out.push(obj.value);
      }
    }
    return out;
  }

  objectValue(subject: string, predicate: string, graph?: string): string | undefined {
    return this.objectValues(subject, predicate, graph)[0];
  }

  literalValues(subject: string, predicate: string, graph?: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const obj of this.objects(subject, predicate, graph)) {
      if (obj.termType === 'Literal' && !seen.has(obj.value)) {
        seen.add(obj.value);
        out.push(obj.value);
      }
    }
    return out;
  }

  literalValue(subject: string, predicate: string, graph?: string): string | undefined {
    return this.literalValues(subject, predicate, graph)[0];
  }

  iriValues(subject: string, predicate: string, graph?: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const obj of this.objects(subject, predicate, graph)) {
      if (obj.termType === 'NamedNode' && !seen.has(obj.value)) {
        seen.add(obj.value);
        out.push(obj.value);
      }
    }
    return out;
  }

  iriValue(subject: string, predicate: string, graph?: string): string | undefined {
    return this.iriValues(subject, predicate, graph)[0];
  }

  booleanValue(subject: string, predicate: string, graph?: string): boolean | undefined {
    const val = this.literalValue(subject, predicate, graph);
    if (val === undefined) return undefined;
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    return undefined;
  }

  numberValue(subject: string, predicate: string, graph?: string): number | undefined {
    const val = this.literalValue(subject, predicate, graph);
    if (val === undefined) return undefined;
    const n = Number(val);
    return Number.isNaN(n) ? undefined : n;
  }

  subjects(predicate: string, object?: string, graph?: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const q of this.quads({ predicate, object, graph })) {
      if (!seen.has(q.subject.value)) {
        seen.add(q.subject.value);
        out.push(q.subject.value);
      }
    }
    return out;
  }

  typesOf(subject: string, graph?: string): string[] {
    return this.iriValues(subject, RDF.type, graph);
  }

  /**
   * Walks an RDF collection (`rdf:first` / `rdf:rest` ... `rdf:nil`) starting at `head`.
   */
  readList(head: RdfTerm | string, graph?: string): RdfTerm[] {
    const items: RdfTerm[] = [];
    const visited = new Set<string>();
    let curr = typeof head === 'string' ? this.expand(head) : head.value;

    while (curr && curr !== RDF.nil && !visited.has(curr)) {
      visited.add(curr);
      const first = this.objects(curr, RDF.first, graph)[0];
      if (first) items.push(first);
      const rest = this.objects(curr, RDF.rest, graph)[0];
      if (!rest || rest.termType === 'Literal') break;
      curr = rest.value;
    }
    return items;
  }

  // ── Transitive Closures (`rdfs:subClassOf*` & `rdfs:subPropertyOf*`) ─────

  /**
   * Returns all superclasses reachable from `classIri` via `rdfs:subClassOf*` (reflexive).
   */
  superClassesOf(classIri: string, graph?: string): Set<string> {
    const target = this.expand(classIri);
    const cacheKey = `${graph ?? '*'}\0${target}`;
    const cached = this.superClassCache.get(cacheKey);
    if (cached) return new Set(cached);

    const visited = new Set<string>([target]);
    const queue: string[] = [target];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const sup of this.iriValues(curr, RDFS.subClassOf, graph)) {
        if (!visited.has(sup)) {
          visited.add(sup);
          queue.push(sup);
        }
      }
    }
    this.superClassCache.set(cacheKey, visited);
    return new Set(visited);
  }

  /**
   * Alias for `superClassesOf(classIri)` — the upward `rdfs:subClassOf*` closure.
   */
  subClassClosure(classIri: string, graph?: string): Set<string> {
    return this.superClassesOf(classIri, graph);
  }

  /**
   * Returns all subclasses whose `rdfs:subClassOf*` reaches `superClassIri` (reflexive).
   */
  subClassesOf(superClassIri: string, graph?: string): Set<string> {
    const target = this.expand(superClassIri);
    const cacheKey = `${graph ?? '*'}\0${target}`;
    const cached = this.subClassCache.get(cacheKey);
    if (cached) return new Set(cached);

    const visited = new Set<string>([target]);
    const queue: string[] = [target];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const sub of this.subjects(RDFS.subClassOf, curr, graph)) {
        if (!visited.has(sub)) {
          visited.add(sub);
          queue.push(sub);
        }
      }
    }
    this.subClassCache.set(cacheKey, visited);
    return new Set(visited);
  }

  isSubClassOf(subClassIri: string, superClassIri: string, graph?: string): boolean {
    return this.superClassesOf(subClassIri, graph).has(this.expand(superClassIri));
  }

  /**
   * Checks whether `resourceIri` has an `rdf:type` whose `rdfs:subClassOf*` closure
   * includes `targetClassIri`.
   */
  isInstanceOf(resourceIri: string, targetClassIri: string, graph?: string): boolean {
    const target = this.expand(targetClassIri);
    for (const directType of this.typesOf(resourceIri, graph)) {
      if (this.superClassesOf(directType).has(target)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns all superproperties reachable from `propIri` via `rdfs:subPropertyOf*` (reflexive).
   */
  superPropertiesOf(propIri: string, graph?: string): Set<string> {
    const target = this.expand(propIri);
    const cacheKey = `${graph ?? '*'}\0${target}`;
    const cached = this.superPropCache.get(cacheKey);
    if (cached) return new Set(cached);

    const visited = new Set<string>([target]);
    const queue: string[] = [target];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const sup of this.iriValues(curr, RDFS.subPropertyOf, graph)) {
        if (!visited.has(sup)) {
          visited.add(sup);
          queue.push(sup);
        }
      }
    }
    this.superPropCache.set(cacheKey, visited);
    return new Set(visited);
  }

  /**
   * Alias for `superPropertiesOf(propIri)` — the upward `rdfs:subPropertyOf*` closure.
   */
  subPropertyClosure(propIri: string, graph?: string): Set<string> {
    return this.superPropertiesOf(propIri, graph);
  }

  /**
   * Returns all subproperties whose `rdfs:subPropertyOf*` reaches `superPropIri` (reflexive).
   */
  subPropertiesOf(superPropIri: string, graph?: string): Set<string> {
    const target = this.expand(superPropIri);
    const cacheKey = `${graph ?? '*'}\0${target}`;
    const cached = this.subPropCache.get(cacheKey);
    if (cached) return new Set(cached);

    const visited = new Set<string>([target]);
    const queue: string[] = [target];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const sub of this.subjects(RDFS.subPropertyOf, curr, graph)) {
        if (!visited.has(sub)) {
          visited.add(sub);
          queue.push(sub);
        }
      }
    }
    this.subPropCache.set(cacheKey, visited);
    return new Set(visited);
  }

  isSubPropertyOf(subPropIri: string, superPropIri: string, graph?: string): boolean {
    return this.superPropertiesOf(subPropIri, graph).has(this.expand(superPropIri));
  }
}

// ── System Meta-Ontology Models ────────────────────────────────────────────

export type OntologyKind = 'meta' | 'global' | 'local' | 'generated';
export type SelectorMode = 'instance' | 'definedClass';

export interface NodeKindSpec {
  readonly iri: string;
  readonly kindSlug: string;
  readonly badgeLabel: string;
  readonly selectorMode: SelectorMode;
  readonly targetClasses: string[];
  readonly idProperty?: string;
  readonly labelProperty?: string;
}

export interface OntologyGraphSpec {
  readonly iri: string;
  readonly graphIri: string;
  readonly slug: string;
  readonly ontologyKind: OntologyKind;
  readonly label: string;
  readonly comment: string;
  readonly layerOrder: number;
  readonly accentToken: string;
  readonly schemaGlobs: string[];
  readonly generatedGlobs: string[];
  readonly nodeKinds: NodeKindSpec[];
}

export interface BridgeGraphSpec {
  readonly iri: string;
  readonly graphIri: string;
  readonly slug: string;
  readonly label: string;
  readonly comment: string;
  readonly schemaGlobs: string[];
  readonly generatedGlobs: string[];
}

export interface GraphBridgeSpec {
  readonly iri: string;
  readonly bridgePredicate: string;
  readonly sourceGraph: string;
  readonly targetGraph: string;
  readonly sourceClasses: string[];
  readonly targetClasses: string[];
  readonly forwardLabel: string;
  readonly inverseLabel: string;
  readonly navPriority: number;
  readonly allowHistoricalMissingTarget: boolean;
}

export interface LinkContractSpec {
  readonly iri: string;
  readonly linkPredicate: string;
  readonly targetGraph: string;
  readonly targetClasses: string[];
  readonly forwardLabel: string;
  readonly inverseLabel: string;
  readonly navPriority: number;
  readonly allowHistoricalMissingTarget: boolean;
}

export interface OntologySystemConfig {
  readonly systemIri: string;
  readonly label: string;
  readonly versionInfo?: string;
  readonly managedNamespaces: string[];
  readonly externalNamespaces: string[];
  readonly slices: OntologyGraphSpec[];
  readonly bridgeGraphs: BridgeGraphSpec[];
  readonly bridges: GraphBridgeSpec[];
  readonly linkContracts: LinkContractSpec[];
  readonly prefixes: Record<string, string>;
  readonly store: MultiGraphStore;
}

export interface LoadSystemOptions {
  /** Repo-relative or absolute path to `meta.ttl` (default: `ontology/system/meta.ttl`). */
  readonly metaPath?: string;
  /** Repo-relative or absolute path to `registry.ttl` (default: `ontology/system/registry.ttl`). */
  readonly registryPath?: string;
  /** Named graph IRI for system triples (default: `https://wod.wiki/graph/system`). */
  readonly systemGraphIri?: string;
}

const DEFAULT_META_REL_PATH = 'ontology/system/meta.ttl';
const DEFAULT_REGISTRY_REL_PATH = 'ontology/system/registry.ttl';
const DEFAULT_SYSTEM_GRAPH_IRI = `${WODG_NS}system`;

function resolveFilePath(repoRoot: string, maybeRelative: string): string {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.join(repoRoot, maybeRelative);
}

function parseOntologyKind(iri: string | undefined, subjectIri: string): OntologyKind {
  switch (iri) {
    case SYS.MetaOntology:
      return 'meta';
    case SYS.GlobalOntology:
      return 'global';
    case SYS.LocalOntology:
      return 'local';
    case SYS.GeneratedOntology:
      return 'generated';
    default:
      throw new Error(
        `Invalid or missing sys:ontologyKind ('${iri ?? ''}') on OntologyGraph '${subjectIri}'`,
      );
  }
}

function parseSelectorMode(iri: string | undefined, subjectIri: string): SelectorMode {
  switch (iri) {
    case SYS.InstanceSelector:
      return 'instance';
    case SYS.DefinedClassSelector:
      return 'definedClass';
    default:
      throw new Error(
        `Invalid or missing sys:selectorMode ('${iri ?? ''}') on NodeKind '${subjectIri}'`,
      );
  }
}

function localNameOf(iri: string): string {
  const hash = iri.lastIndexOf('#');
  const slash = iri.lastIndexOf('/');
  const idx = Math.max(hash, slash);
  return idx >= 0 ? iri.slice(idx + 1) : iri;
}

/**
 * Loads `ontology/system/meta.ttl` and `ontology/system/registry.ttl` and returns
 * typed System Meta-Ontology configuration models.
 */
export function loadOntologySystem(
  repoRoot: string,
  options?: LoadSystemOptions,
): OntologySystemConfig {
  const systemGraphIri = options?.systemGraphIri ?? DEFAULT_SYSTEM_GRAPH_IRI;
  const metaFile = resolveFilePath(repoRoot, options?.metaPath ?? DEFAULT_META_REL_PATH);
  const registryFile = resolveFilePath(
    repoRoot,
    options?.registryPath ?? DEFAULT_REGISTRY_REL_PATH,
  );

  if (options?.metaPath && !fs.existsSync(metaFile)) {
    throw new Error(`System meta-ontology file not found: ${metaFile}`);
  }
  if (!fs.existsSync(registryFile)) {
    throw new Error(`System registry file not found: ${registryFile}`);
  }

  const store = new MultiGraphStore();
  if (fs.existsSync(metaFile)) {
    const metaRaw = fs.readFileSync(metaFile, 'utf8');
    store.loadTurtle(metaRaw, { graph: systemGraphIri, bnodePrefix: 'sys_meta_' });
  }
  const registryRaw = fs.readFileSync(registryFile, 'utf8');
  store.loadTurtle(registryRaw, { graph: systemGraphIri, bnodePrefix: 'sys_reg_' });

  // Locate OntologySystem root resource
  const systemIris = store
    .subjects(RDF.type)
    .filter((s) => store.isInstanceOf(s, SYS.OntologySystem))
    .sort((a, b) => a.localeCompare(b));
  const systemIri = systemIris[0] ?? 'https://wod.wiki/dataset';

  const label = store.literalValue(systemIri, RDFS.label) ?? localNameOf(systemIri);
  const versionInfo = store.literalValue(systemIri, OWL.versionInfo);

  const managedNamespaces = store
    .objectValues(systemIri, SYS.managedNamespace)
    .sort((a, b) => a.localeCompare(b));
  const externalNamespaces = store
    .objectValues(systemIri, SYS.externalNamespace)
    .sort((a, b) => a.localeCompare(b));

  // Parse all sys:OntologyGraph declarations
  const sliceSubjectSet = new Set<string>(
    store.subjects(RDF.type).filter((s) => store.isInstanceOf(s, SYS.OntologyGraph)),
  );
  for (const linked of store.iriValues(systemIri, SYS.hasOntologyGraph)) {
    sliceSubjectSet.add(linked);
  }

  const sliceAliasToGraphIri = new Map<string, string>();
  const slices: OntologyGraphSpec[] = [];

  for (const sliceIri of [...sliceSubjectSet].sort((a, b) => a.localeCompare(b))) {
    const graphIri = store.iriValue(sliceIri, SYS.graphIri) ?? sliceIri;
    const slug = store.literalValue(sliceIri, SYS.slug) ?? localNameOf(graphIri);
    const ontologyKind = parseOntologyKind(store.iriValue(sliceIri, SYS.ontologyKind), sliceIri);
    const sliceLabel = store.literalValue(sliceIri, RDFS.label) ?? slug;
    const sliceComment = store.literalValue(sliceIri, RDFS.comment) ?? '';
    const layerOrder = store.numberValue(sliceIri, SYS.layerOrder) ?? 0;
    const accentToken = store.literalValue(sliceIri, SYS.accentToken) ?? 'slate';
    const schemaGlobs = store
      .literalValues(sliceIri, SYS.schemaGlob)
      .sort((a, b) => a.localeCompare(b));
    const generatedGlobs = store
      .literalValues(sliceIri, SYS.generatedGlob)
      .sort((a, b) => a.localeCompare(b));

    const nodeKindRefs = store.objectValues(sliceIri, SYS.hasNodeKind);
    const nodeKinds: NodeKindSpec[] = nodeKindRefs
      .map((nkIri): NodeKindSpec => {
        const kindSlug = store.literalValue(nkIri, SYS.kindSlug) ?? localNameOf(nkIri);
        const badgeLabel = store.literalValue(nkIri, SYS.badgeLabel) ?? kindSlug;
        const selectorMode = parseSelectorMode(
          store.iriValue(nkIri, SYS.selectorMode),
          nkIri,
        );
        const targetClasses = store
          .iriValues(nkIri, SYS.targetClass)
          .sort((a, b) => a.localeCompare(b));
        const idProperty = store.iriValue(nkIri, SYS.idProperty);
        const labelProperty = store.iriValue(nkIri, SYS.labelProperty);
        return {
          iri: nkIri,
          kindSlug,
          badgeLabel,
          selectorMode,
          targetClasses,
          ...(idProperty ? { idProperty } : {}),
          ...(labelProperty ? { labelProperty } : {}),
        };
      })
      .sort((a, b) => a.kindSlug.localeCompare(b.kindSlug));

    sliceAliasToGraphIri.set(sliceIri, graphIri);
    sliceAliasToGraphIri.set(graphIri, graphIri);

    slices.push({
      iri: sliceIri,
      graphIri,
      slug,
      ontologyKind,
      label: sliceLabel,
      comment: sliceComment,
      layerOrder,
      accentToken,
      schemaGlobs,
      generatedGlobs,
      nodeKinds,
    });
  }

  slices.sort((a, b) => a.layerOrder - b.layerOrder || a.slug.localeCompare(b.slug));

  // Parse all sys:BridgeGraph declarations
  const bridgeGraphSubjectSet = new Set<string>(
    store.subjects(RDF.type).filter((s) => store.isInstanceOf(s, SYS.BridgeGraph)),
  );
  for (const linked of store.iriValues(systemIri, SYS.hasBridgeGraph)) {
    bridgeGraphSubjectSet.add(linked);
  }

  const bridgeGraphs: BridgeGraphSpec[] = [...bridgeGraphSubjectSet]
    .sort((a, b) => a.localeCompare(b))
    .map((bgIri): BridgeGraphSpec => {
      const graphIri = store.iriValue(bgIri, SYS.graphIri) ?? bgIri;
      const slug = store.literalValue(bgIri, SYS.slug) ?? localNameOf(graphIri);
      return {
        iri: bgIri,
        graphIri,
        slug,
        label: store.literalValue(bgIri, RDFS.label) ?? slug,
        comment: store.literalValue(bgIri, RDFS.comment) ?? '',
        schemaGlobs: store.literalValues(bgIri, SYS.schemaGlob).sort((a, b) => a.localeCompare(b)),
        generatedGlobs: store
          .literalValues(bgIri, SYS.generatedGlob)
          .sort((a, b) => a.localeCompare(b)),
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug) || a.graphIri.localeCompare(b.graphIri));

  const resolveGraphRef = (raw: string | undefined, ownerIri: string, field: string): string => {
    if (!raw) {
      throw new Error(`Missing ${field} on '${ownerIri}'`);
    }
    return sliceAliasToGraphIri.get(raw) ?? raw;
  };

  // Parse all sys:GraphBridge declarations
  const bridgeSubjectSet = new Set<string>(
    store.subjects(RDF.type).filter((s) => store.isInstanceOf(s, SYS.GraphBridge)),
  );
  for (const linked of store.iriValues(systemIri, SYS.hasGraphBridge)) {
    bridgeSubjectSet.add(linked);
  }

  const bridges: GraphBridgeSpec[] = [...bridgeSubjectSet]
    .sort((a, b) => a.localeCompare(b))
    .map((bIri): GraphBridgeSpec => {
      const bridgePredicate = store.iriValue(bIri, SYS.bridgePredicate);
      if (!bridgePredicate) {
        throw new Error(`Missing sys:bridgePredicate on GraphBridge '${bIri}'`);
      }
      const sourceGraph = resolveGraphRef(
        store.iriValue(bIri, SYS.sourceGraph),
        bIri,
        'sys:sourceGraph',
      );
      const targetGraph = resolveGraphRef(
        store.iriValue(bIri, SYS.targetGraph),
        bIri,
        'sys:targetGraph',
      );
      const sourceClasses = store
        .iriValues(bIri, SYS.sourceClass)
        .sort((a, b) => a.localeCompare(b));
      const targetClasses = store
        .iriValues(bIri, SYS.targetClass)
        .sort((a, b) => a.localeCompare(b));
      const forwardLabel =
        store.literalValue(bIri, SYS.forwardLabel) ?? localNameOf(bridgePredicate);
      const inverseLabel =
        store.literalValue(bIri, SYS.inverseLabel) ?? `inverse of ${forwardLabel}`;
      const navPriority = store.numberValue(bIri, SYS.navPriority) ?? 100;
      const allowHistoricalMissingTarget =
        store.booleanValue(bIri, SYS.allowHistoricalMissingTarget) ??
        store.booleanValue(bridgePredicate, SYS.allowHistoricalMissingTarget) ??
        false;

      return {
        iri: bIri,
        bridgePredicate,
        sourceGraph,
        targetGraph,
        sourceClasses,
        targetClasses,
        forwardLabel,
        inverseLabel,
        navPriority,
        allowHistoricalMissingTarget,
      };
    })
    .sort(
      (a, b) =>
        a.navPriority - b.navPriority ||
        a.bridgePredicate.localeCompare(b.bridgePredicate) ||
        a.sourceGraph.localeCompare(b.sourceGraph) ||
        a.targetGraph.localeCompare(b.targetGraph),
    );

  // Parse all sys:LinkContract declarations
  const linkContractSubjectSet = new Set<string>(
    store.subjects(RDF.type).filter((s) => store.isInstanceOf(s, SYS.LinkContract)),
  );
  for (const linked of store.iriValues(systemIri, SYS.hasLinkContract)) {
    linkContractSubjectSet.add(linked);
  }

  const linkContracts: LinkContractSpec[] = [...linkContractSubjectSet]
    .sort((a, b) => a.localeCompare(b))
    .map((lcIri): LinkContractSpec => {
      const linkPredicate = store.iriValue(lcIri, SYS.linkPredicate);
      if (!linkPredicate) {
        throw new Error(`Missing sys:linkPredicate on LinkContract '${lcIri}'`);
      }
      const targetGraph = resolveGraphRef(
        store.iriValue(lcIri, SYS.targetGraph),
        lcIri,
        'sys:targetGraph',
      );
      const targetClasses = store
        .iriValues(lcIri, SYS.targetClass)
        .sort((a, b) => a.localeCompare(b));
      const forwardLabel =
        store.literalValue(lcIri, SYS.forwardLabel) ?? localNameOf(linkPredicate);
      const inverseLabel =
        store.literalValue(lcIri, SYS.inverseLabel) ?? `inverse of ${forwardLabel}`;
      const navPriority = store.numberValue(lcIri, SYS.navPriority) ?? 100;
      const allowHistoricalMissingTarget =
        store.booleanValue(lcIri, SYS.allowHistoricalMissingTarget) ??
        store.booleanValue(linkPredicate, SYS.allowHistoricalMissingTarget) ??
        false;

      return {
        iri: lcIri,
        linkPredicate,
        targetGraph,
        targetClasses,
        forwardLabel,
        inverseLabel,
        navPriority,
        allowHistoricalMissingTarget,
      };
    })
    .sort(
      (a, b) =>
        a.navPriority - b.navPriority ||
        a.linkPredicate.localeCompare(b.linkPredicate) ||
        a.targetGraph.localeCompare(b.targetGraph),
    );

  return {
    systemIri,
    label,
    ...(versionInfo ? { versionInfo } : {}),
    managedNamespaces,
    externalNamespaces,
    slices,
    bridgeGraphs,
    bridges,
    linkContracts,
    prefixes: store.getPrefixes(),
    store,
  };
}

// ── Multi-Graph Dataset Assembly ───────────────────────────────────────────

export interface LoadDatasetOptions extends LoadSystemOptions {
  /** Load `sys:generatedGlob` files in addition to `sys:schemaGlob` (default: `true`). */
  readonly includeGenerated?: boolean;
  /** Throw if any declared `sys:generatedGlob` matches zero files (default: `false`). */
  readonly requireGenerated?: boolean;
  /** Load `sys:BridgeGraph` files (default: `true`). */
  readonly includeBridgeGraphs?: boolean;
  /** Keep the system meta/registry quads inside the dataset store (default: `true`). */
  readonly includeMetaGraph?: boolean;
  /** Reuse a pre-loaded `OntologySystemConfig`. */
  readonly system?: OntologySystemConfig;
}

export interface LoadedFileRecord {
  readonly graphIri: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly sourceKind: 'schema' | 'generated' | 'system';
  readonly quadCount: number;
}

export interface MissingGeneratedGlob {
  readonly graphIri: string;
  readonly slug: string;
  readonly glob: string;
}

export interface MaterializedNode {
  readonly id: string;
  readonly iri: string;
  readonly sliceSlug: string;
  readonly graphIri: string;
  readonly kindSlug: string;
  readonly badgeLabel: string;
  readonly selectorMode: SelectorMode;
  readonly label: string;
  readonly summary: string;
}

export type EdgeCategory =
  | 'intra'
  | 'localBridge'
  | 'global'
  | 'generatedLink'
  | 'external'
  | 'unclassified';

export interface MaterializedEdge {
  readonly sourceIri: string;
  readonly sourceId: string;
  readonly predicateIri: string;
  readonly predicateCurie: string;
  readonly targetIri: string;
  readonly targetId?: string;
  readonly graphIri: string;
  readonly category: EdgeCategory;
  readonly derived: boolean;
}

export interface RegisteredDataset {
  readonly repoRoot: string;
  readonly system: OntologySystemConfig;
  readonly store: MultiGraphStore;
  readonly files: LoadedFileRecord[];
  readonly missingGeneratedGlobs: MissingGeneratedGlob[];
  readonly nodeOwnerGraph: ReadonlyMap<string, string>;
  readonly sliceByGraphIri: ReadonlyMap<string, OntologyGraphSpec>;
  readonly sliceBySlug: ReadonlyMap<string, OntologyGraphSpec>;
  ownerGraphOf(iri: string): string | undefined;
  isManagedIri(iri: string): boolean;
  isExternalIri(iri: string): boolean;
  allowsHistoricalMissingTarget(predicateIri: string): boolean;
  materializeNodes(): MaterializedNode[];
  materializeEdges(nodes?: readonly MaterializedNode[]): MaterializedEdge[];
}

function expandRepoGlob(repoRoot: string, pattern: string): string[] {
  const glob = new Bun.Glob(pattern);
  const matches: string[] = [];
  for (const rel of glob.scanSync({ cwd: repoRoot, onlyFiles: true })) {
    matches.push(rel.split(path.sep).join('/'));
  }
  if (matches.length === 0 && !pattern.startsWith('ontology/')) {
    const ontologyDir = path.join(repoRoot, 'ontology');
    if (fs.existsSync(ontologyDir)) {
      for (const rel of glob.scanSync({ cwd: ontologyDir, onlyFiles: true })) {
        matches.push(`ontology/${rel.split(path.sep).join('/')}`);
      }
    }
  }
  matches.sort((a, b) => a.localeCompare(b));
  return matches;
}

function matchesNodeKind(
  store: MultiGraphStore,
  resourceIri: string,
  graphIri: string,
  kind: NodeKindSpec,
): boolean {
  const directTypes = store.typesOf(resourceIri, graphIri);
  if (directTypes.length === 0) return false;

  if (kind.selectorMode === 'definedClass') {
    const isDeclaredClass = directTypes.some(
      (t) => t === OWL.Class || t === RDFS.Class || store.isSubClassOf(t, RDFS.Class),
    );
    if (!isDeclaredClass) return false;
    if (kind.targetClasses.length === 0) return true;
    return kind.targetClasses.some(
      (tc) =>
        tc === OWL.Class ||
        tc === RDFS.Class ||
        store.isInstanceOf(resourceIri, tc, graphIri) ||
        store.isSubClassOf(resourceIri, tc),
    );
  }

  // InstanceSelector
  if (kind.targetClasses.length === 0) return false;
  return kind.targetClasses.some((tc) => store.isInstanceOf(resourceIri, tc, graphIri));
}

function computeCanonicalNodeId(
  store: MultiGraphStore,
  resourceIri: string,
  kind: NodeKindSpec,
): string {
  if (kind.idProperty) {
    const idVal = store.objectValue(resourceIri, kind.idProperty);
    if (idVal !== undefined && idVal.length > 0) {
      return `${kind.kindSlug}:${idVal}`;
    }
  }
  return store.compact(resourceIri);
}

/**
 * Expands all registered `schemaGlob` and (optionally) `generatedGlob` files from
 * `ontology/system/registry.ttl` into an indexed `MultiGraphStore` with deterministic
 * file ordering, node-owner graph indexing, and `sys:NodeKind` materialization helpers.
 */
export function loadRegisteredDataset(
  repoRoot: string,
  options?: LoadDatasetOptions,
): RegisteredDataset {
  const system = options?.system ?? loadOntologySystem(repoRoot, options);
  const includeGenerated = options?.includeGenerated ?? true;
  const requireGenerated = options?.requireGenerated ?? false;
  const includeBridgeGraphs = options?.includeBridgeGraphs ?? true;
  const includeMetaGraph = options?.includeMetaGraph ?? true;

  const store = new MultiGraphStore();
  store.addPrefixes(system.prefixes);

  const files: LoadedFileRecord[] = [];
  const missingGeneratedGlobs: MissingGeneratedGlob[] = [];
  const sliceByGraphIri = new Map<string, OntologyGraphSpec>();
  const sliceBySlug = new Map<string, OntologyGraphSpec>();

  for (const slice of system.slices) {
    sliceByGraphIri.set(slice.graphIri, slice);
    sliceBySlug.set(slice.slug, slice);
  }

  let fileSeq = 0;

  if (includeMetaGraph) {
    store.addQuads(system.store.quads());
  }

  function loadGlobsForGraph(
    graphIri: string,
    slug: string,
    globs: readonly string[],
    sourceKind: 'schema' | 'generated',
  ): void {
    const loadedForGraph = new Set<string>();
    for (const pattern of globs) {
      const matched = expandRepoGlob(repoRoot, pattern);
      if (matched.length === 0 && sourceKind === 'generated') {
        missingGeneratedGlobs.push({ graphIri, slug, glob: pattern });
        if (requireGenerated) {
          throw new Error(
            `Required generated glob '${pattern}' for graph '${slug}' (${graphIri}) matched 0 files`,
          );
        }
        continue;
      }
      for (const relPath of matched) {
        if (loadedForGraph.has(relPath)) continue;
        loadedForGraph.add(relPath);
        const absPath = path.join(repoRoot, relPath);
        const raw = fs.readFileSync(absPath, 'utf8');
        fileSeq++;
        const bnodePrefix = `f${fileSeq}_`;
        const quadCount = relPath.endsWith('.trig')
          ? store.loadTriG(raw, { graph: graphIri, bnodePrefix })
          : store.loadTurtle(raw, { graph: graphIri, bnodePrefix });
        files.push({
          graphIri,
          relativePath: relPath,
          absolutePath: absPath,
          sourceKind,
          quadCount,
        });
      }
    }
  }

  // Load OntologyGraph slices in deterministic layerOrder
  for (const slice of system.slices) {
    if (slice.ontologyKind === 'meta' && !includeMetaGraph) continue;
    loadGlobsForGraph(slice.graphIri, slice.slug, slice.schemaGlobs, 'schema');
    if (includeGenerated) {
      loadGlobsForGraph(slice.graphIri, slice.slug, slice.generatedGlobs, 'generated');
    }
  }

  // Load BridgeGraph edge-carrier graphs
  if (includeBridgeGraphs) {
    for (const bg of system.bridgeGraphs) {
      loadGlobsForGraph(bg.graphIri, bg.slug, bg.schemaGlobs, 'schema');
      if (includeGenerated) {
        loadGlobsForGraph(bg.graphIri, bg.slug, bg.generatedGlobs, 'generated');
      }
    }
  }

  files.sort(
    (a, b) =>
      a.graphIri.localeCompare(b.graphIri) || a.relativePath.localeCompare(b.relativePath),
  );

  // Compute node ownership: only sys:OntologyGraph slices own nodes (never sys:BridgeGraph)
  const nodeOwnerGraph = new Map<string, string>();
  const nonMetaSlices = system.slices.filter((s) => s.ontologyKind !== 'meta');
  const metaSlices = system.slices.filter((s) => s.ontologyKind === 'meta');

  // Pass 1: Resources explicitly matching a slice's sys:NodeKind claim ownership first
  for (const slice of nonMetaSlices) {
    const typedSubjects = store.subjects(RDF.type, undefined, slice.graphIri);
    for (const iri of typedSubjects) {
      if (iri.startsWith('_:')) continue;
      if (nodeOwnerGraph.has(iri)) continue;
      if (slice.nodeKinds.some((nk) => matchesNodeKind(store, iri, slice.graphIri, nk))) {
        nodeOwnerGraph.set(iri, slice.graphIri);
      }
    }
  }

  // Pass 2: Remaining typed resources declared in non-meta slices (e.g. properties, shapes, steps)
  for (const slice of nonMetaSlices) {
    const typedSubjects = store.subjects(RDF.type, undefined, slice.graphIri);
    for (const iri of typedSubjects) {
      if (iri.startsWith('_:')) continue;
      if (!nodeOwnerGraph.has(iri)) {
        nodeOwnerGraph.set(iri, slice.graphIri);
      }
    }
  }

  // Pass 3: Meta slice resources
  for (const slice of metaSlices) {
    const typedSubjects = store.subjects(RDF.type, undefined, slice.graphIri);
    for (const iri of typedSubjects) {
      if (iri.startsWith('_:')) continue;
      if (!nodeOwnerGraph.has(iri)) {
        nodeOwnerGraph.set(iri, slice.graphIri);
      }
    }
  }

  const isManagedIri = (iri: string): boolean =>
    system.managedNamespaces.some((ns) => iri.startsWith(ns));

  const isExternalIri = (iri: string): boolean =>
    system.externalNamespaces.some((ns) => iri.startsWith(ns));

  const allowsHistoricalMissingTarget = (predicateIri: string): boolean => {
    const expanded = store.expand(predicateIri);
    if (store.booleanValue(expanded, SYS.allowHistoricalMissingTarget) === true) {
      return true;
    }
    for (const bridge of system.bridges) {
      if (
        bridge.allowHistoricalMissingTarget &&
        store.isSubPropertyOf(expanded, bridge.bridgePredicate)
      ) {
        return true;
      }
    }
    for (const contract of system.linkContracts) {
      if (
        contract.allowHistoricalMissingTarget &&
        store.isSubPropertyOf(expanded, contract.linkPredicate)
      ) {
        return true;
      }
    }
    return false;
  };

  const materializeNodes = (): MaterializedNode[] => {
    const byIri = new Map<string, MaterializedNode>();

    for (const slice of system.slices) {
      if (slice.ontologyKind === 'meta') continue;
      const typedSubjects = store
        .subjects(RDF.type, undefined, slice.graphIri)
        .filter((s) => !s.startsWith('_:'))
        .sort((a, b) => a.localeCompare(b));

      for (const iri of typedSubjects) {
        if (byIri.has(iri)) continue;
        // Respect ownership if another slice owns this node
        const owner = nodeOwnerGraph.get(iri);
        if (owner && owner !== slice.graphIri) continue;

        const matchedKind = slice.nodeKinds.find((nk) =>
          matchesNodeKind(store, iri, slice.graphIri, nk),
        );
        if (!matchedKind) continue;

        const id = computeCanonicalNodeId(store, iri, matchedKind);
        const label =
          (matchedKind.labelProperty
            ? store.literalValue(iri, matchedKind.labelProperty)
            : undefined) ??
          store.literalValue(iri, RDFS.label) ??
          localNameOf(iri);
        const summary = store.literalValue(iri, RDFS.comment) ?? '';

        byIri.set(iri, {
          id,
          iri,
          sliceSlug: slice.slug,
          graphIri: slice.graphIri,
          kindSlug: matchedKind.kindSlug,
          badgeLabel: matchedKind.badgeLabel,
          selectorMode: matchedKind.selectorMode,
          label,
          summary,
        });
      }
    }

    return [...byIri.values()].sort(
      (a, b) => a.id.localeCompare(b.id) || a.iri.localeCompare(b.iri),
    );
  };

  const materializeEdges = (precomputedNodes?: readonly MaterializedNode[]): MaterializedEdge[] => {
    const nodes = precomputedNodes ?? materializeNodes();
    const nodeByIri = new Map<string, MaterializedNode>(nodes.map((n) => [n.iri, n]));
    const edgeSet = new Set<string>();
    const edges: MaterializedEdge[] = [];

    const classifyEdge = (
      sourceGraph: string,
      predIri: string,
      targetIri: string,
      targetGraph: string | undefined,
    ): EdgeCategory => {
      if (targetGraph && targetGraph === sourceGraph) return 'intra';
      const targetSlice = targetGraph ? sliceByGraphIri.get(targetGraph) : undefined;
      if (targetSlice?.ontologyKind === 'global') return 'global';
      if (
        targetSlice?.ontologyKind === 'generated' ||
        system.linkContracts.some((lc) => store.isSubPropertyOf(predIri, lc.linkPredicate))
      ) {
        return 'generatedLink';
      }
      if (
        targetGraph &&
        system.bridges.some(
          (b) =>
            b.sourceGraph === sourceGraph &&
            b.targetGraph === targetGraph &&
            store.isSubPropertyOf(predIri, b.bridgePredicate),
        )
      ) {
        return 'localBridge';
      }
      if (isExternalIri(targetIri) || !isManagedIri(targetIri)) return 'external';
      return 'unclassified';
    };

    const pushEdge = (edge: MaterializedEdge): void => {
      const key = `${edge.sourceIri}\0${edge.predicateIri}\0${edge.targetIri}\0${edge.derived ? '1' : '0'}`;
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      edges.push(edge);
    };

    // 1. Direct named-node-to-named-node assertions from materialized nodes
    for (const node of nodes) {
      for (const q of store.outgoing(node.iri)) {
        if (q.object.termType !== 'NamedNode') continue;
        if (q.predicate.value === RDF.type) continue;
        const targetIri = q.object.value;
        const targetNode = nodeByIri.get(targetIri);
        const targetGraph = targetNode?.graphIri ?? nodeOwnerGraph.get(targetIri);

        // Emit edges to materialized nodes OR historical-missing-target links
        if (!targetNode && !allowsHistoricalMissingTarget(q.predicate.value)) {
          continue;
        }

        pushEdge({
          sourceIri: node.iri,
          sourceId: node.id,
          predicateIri: q.predicate.value,
          predicateCurie: store.compact(q.predicate.value),
          targetIri,
          ...(targetNode ? { targetId: targetNode.id } : {}),
          graphIri: q.graph,
          category: classifyEdge(node.graphIri, q.predicate.value, targetIri, targetGraph),
          derived: false,
        });
      }
    }

    // 2. DefinedClassSelector projections: intra-slice owl:ObjectProperty (domain -> range)
    for (const slice of system.slices) {
      const hasDefinedClassKind = slice.nodeKinds.some(
        (nk) => nk.selectorMode === 'definedClass',
      );
      if (!hasDefinedClassKind) continue;

      const objProps = store.subjects(RDF.type, OWL.ObjectProperty, slice.graphIri);
      for (const propIri of objProps) {
        const domains = store.iriValues(propIri, RDFS.domain, slice.graphIri);
        const ranges = store.iriValues(propIri, RDFS.range, slice.graphIri);
        for (const domIri of domains) {
          const domNode = nodeByIri.get(domIri);
          if (!domNode || domNode.graphIri !== slice.graphIri) continue;
          for (const rngIri of ranges) {
            const rngNode = nodeByIri.get(rngIri);
            if (!rngNode || rngNode.graphIri !== slice.graphIri) continue;
            pushEdge({
              sourceIri: domNode.iri,
              sourceId: domNode.id,
              predicateIri: propIri,
              predicateCurie: store.compact(propIri),
              targetIri: rngNode.iri,
              targetId: rngNode.id,
              graphIri: slice.graphIri,
              category: 'intra',
              derived: true,
            });
          }
        }
      }
    }

    edges.sort(
      (a, b) =>
        a.sourceId.localeCompare(b.sourceId) ||
        a.predicateCurie.localeCompare(b.predicateCurie) ||
        (a.targetId ?? a.targetIri).localeCompare(b.targetId ?? b.targetIri),
    );

    return edges;
  };

  return {
    repoRoot,
    system,
    store,
    files,
    missingGeneratedGlobs,
    nodeOwnerGraph,
    sliceByGraphIri,
    sliceBySlug,
    ownerGraphOf: (iri: string) => nodeOwnerGraph.get(store.expand(iri)),
    isManagedIri,
    isExternalIri,
    allowsHistoricalMissingTarget,
    materializeNodes,
    materializeEdges,
  };
}
