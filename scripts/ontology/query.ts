#!/usr/bin/env bun
/**
 * Bidirectional Ontology Graph Query & Chain Projection CLI
 *
 * Usage:
 *   bun run ontology:query -- --journey JRN-01
 *   bun run ontology:query -- --file apps/playground/app/tour/HomeTour.tsx
 *   bun run ontology:query -- --symbol SessionRun
 *   bun run ontology:query -- --chains
 */
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(import.meta.dir, '../..');
const GENERATED_DIR = path.join(REPO_ROOT, 'ontology/generated');

interface Triple {
  s: string;
  p: string;
  o: string;
  isLiteral: boolean;
}

const PREFIX_MAP: Record<string, string> = {
  'wod:': 'https://wod.wiki/ontology#',
  'ufo:': 'https://wod.wiki/ontology/patterns#',
  'qa:': 'https://wod.wiki/ontology/qa#',
  'code:': 'https://wod.wiki/ontology/code#',
  'bridge:': 'https://wod.wiki/ontology/bridge#',
  'owl:': 'http://www.w3.org/2002/07/owl#',
  'rdf:': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'rdfs:': 'http://www.w3.org/2000/01/rdf-schema#',
  'xsd:': 'http://www.w3.org/2001/XMLSchema#',
  'prov:': 'http://www.w3.org/ns/prov#',
};

function expandTerm(tok: string): string {
  if (tok === 'a') return 'rdf:type';
  if (tok.startsWith('<') && tok.endsWith('>')) return tok.slice(1, -1);
  return tok;
}

function unescapeLiteral(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Fast Turtle triple loader for generated instance files (flat subject-predicate-object
 * statements with `;` and `,` separators).
 */
function parseGeneratedTtl(filePath: string): Triple[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const triples: Triple[] = [];

  // Tokenize cleanly respecting strings and <IRIs>
  const tokens: Array<{ type: 'iri' | 'str' | 'sym' | 'punct'; val: string }> = [];
  let i = 0;
  const len = raw.length;
  while (i < len) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '#') {
      while (i < len && raw[i] !== '\n') i++;
      continue;
    }
    if (ch === '<') {
      const end = raw.indexOf('>', i + 1);
      if (end !== -1) {
        tokens.push({ type: 'iri', val: raw.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '"') {
      i++;
      let val = '';
      while (i < len && raw[i] !== '"') {
        if (raw[i] === '\\' && i + 1 < len) {
          val += '\\' + raw[i + 1];
          i += 2;
        } else {
          val += raw[i++];
        }
      }
      i++;
      // skip optional ^^datatype or @lang
      if (raw[i] === '^' && raw[i + 1] === '^') {
        i += 2;
        while (i < len && !/[\s;,.]/.test(raw[i])) i++;
      } else if (raw[i] === '@') {
        while (i < len && !/[\s;,.]/.test(raw[i])) i++;
      }
      tokens.push({ type: 'str', val: unescapeLiteral(val) });
      continue;
    }
    if (ch === ';' || ch === ',' || (ch === '.' && (i + 1 >= len || /\s/.test(raw[i + 1])))) {
      tokens.push({ type: 'punct', val: ch });
      i++;
      continue;
    }
    const m = raw.slice(i).match(/^[^\s;,"<>]+/);
    if (m) {
      tokens.push({ type: 'sym', val: m[0] });
      i += m[0].length;
      continue;
    }
    i++;
  }

  let pos = 0;
  while (pos < tokens.length) {
    const t = tokens[pos];
    if (t.type === 'sym' && (t.val === '@prefix' || t.val === '@base')) {
      pos += 3;
      if (tokens[pos]?.val === '.') pos++;
      continue;
    }
    if (t.type === 'punct' && t.val === '.') {
      pos++;
      continue;
    }
    const subj = expandTerm(tokens[pos++]?.val ?? '');
    while (pos < tokens.length && tokens[pos].val !== '.') {
      const pred = expandTerm(tokens[pos++]?.val ?? '');
      while (pos < tokens.length) {
        const objTok = tokens[pos++];
        if (!objTok) break;
        const isLit = objTok.type === 'str' || /^(true|false|-?\d+(\.\d+)?)$/.test(objTok.val);
        triples.push({
          s: subj,
          p: pred,
          o: objTok.type === 'str' ? objTok.val : expandTerm(objTok.val),
          isLiteral: isLit,
        });
        if (tokens[pos]?.val === ',') {
          pos++;
        } else {
          break;
        }
      }
      if (tokens[pos]?.val === ';') {
        pos++;
        if (tokens[pos]?.val === '.') break;
      } else {
        break;
      }
    }
    if (tokens[pos]?.val === '.') pos++;
  }

  return triples;
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

function loadStore(): GraphStore {
  const store = new GraphStore();
  for (const name of ['code-graph.ttl', 'qa-instances.ttl', 'bridge-instances.ttl']) {
    store.addAll(parseGeneratedTtl(path.join(GENERATED_DIR, name)));
  }
  return store;
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
    severity: store.val(iIri, 'qa:severity'),
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

function generateChainsMarkdown(store: GraphStore) {
  const journeyIris = store.subjectsWith('rdf:type', 'qa:Journey');
  const views = journeyIris.map((j) => getJourneyView(store, j)).sort((a, b) => a.id.localeCompare(b.id));

  const lines: string[] = [
    '# Unified Ontology 5-Beat Chain Projections',
    '',
    '> AUTO-GENERATED by `bun run ontology:query -- --chains` from `ontology/generated/`. Do not edit by hand.',
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
    const severity = store.val(iIri, 'qa:severity') ?? '';
    const status = store.val(iIri, 'qa:status') ?? '';
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

const store = loadStore();
const journeyArg = getFlag('--journey');
const fileArg = getFlag('--file');
const symbolArg = getFlag('--symbol');
const issueArg = getFlag('--issue');
const chainsFlag = args.includes('--chains');

if (journeyArg) {
  queryByJourney(store, journeyArg, jsonMode);
} else if (fileArg) {
  queryByFile(store, fileArg, jsonMode);
} else if (symbolArg) {
  queryBySymbol(store, symbolArg, jsonMode);
} else if (issueArg) {
  queryByIssue(store, issueArg, jsonMode);
} else if (chainsFlag) {
  generateChainsMarkdown(store);
} else {
  console.log('Usage: bun run ontology:query -- [--journey <id> | --file <path> | --symbol <name> | --issue <id> | --chains] [--json]');
  process.exit(1);
}
