#!/usr/bin/env bun
/**
 * Ontology Explorer Static HTML Builder
 *
 * Emits a self-contained, zero-backend, file://-compatible single-file HTML
 * explorer at ontology/generated/explorer.html embedding the unified 5-named-graph
 * dataset (:patterns, :domain, :qa, :code, :bridge).
 *
 * Byte-deterministic on re-run (no timestamps).
 */
import fs from 'fs';
import path from 'path';
import {
  ONTOLOGY_CLASSES,
  ONTOLOGY_METRICS,
  ONTOLOGY_PROPERTIES,
  ONTOLOGY_SHAPES,
} from '../../ontology/generated/ontology-types';

const REPO_ROOT = path.resolve(import.meta.dir, '../..');
const GENERATED_DIR = path.join(REPO_ROOT, 'ontology/generated');
const OUT_HTML = path.join(GENERATED_DIR, 'explorer.html');

interface Triple {
  s: string;
  p: string;
  o: string;
  isLiteral: boolean;
}

function expandTerm(tok: string): string {
  if (tok === 'a') return 'rdf:type';
  if (tok.startsWith('<') && tok.endsWith('>')) return tok.slice(1, -1);
  return tok;
}

function unescapeLiteral(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseGeneratedTtl(filePath: string): Triple[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const triples: Triple[] = [];
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

class Store {
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
    return (this.byPred.get(p) ?? []).filter((t) => (o === undefined ? true : t.o === o)).map((t) => t.s);
  }
  incoming(o: string, p?: string): Triple[] {
    return (this.byObj.get(o) ?? []).filter((t) => (p === undefined ? true : t.p === p));
  }
}

export function buildViewer() {
  const store = new Store();
  for (const f of ['code-graph.ttl', 'qa-instances.ttl', 'bridge-instances.ttl']) {
    store.addAll(parseGeneratedTtl(path.join(GENERATED_DIR, f)));
  }

  // 1. Patterns
  const stereotypes = [
    'ufo:Kind',
    'ufo:Relator',
    'ufo:Phase',
    'ufo:Role',
    'ufo:Event',
    'ufo:Perdurant',
    'ufo:Mode',
    'ufo:Quantity',
    'ufo:InformationObject',
  ];

  // 2. Domain Classes, Properties, Shapes, Metrics
  const classes = Object.values(ONTOLOGY_CLASSES)
    .map((c) => {
      const domainProps = Object.values(ONTOLOGY_PROPERTIES)
        .filter((p) => p.domains.includes(c.curie))
        .map((p) => ({ curie: p.curie, kind: p.kind, range: p.ranges[0] ?? '' }))
        .sort((a, b) => a.curie.localeCompare(b.curie));
      const shapes = (ONTOLOGY_SHAPES[c.curie] ?? []).map((s) => ({
        path: s.path,
        min: s.minCount,
        max: s.maxCount,
        dt: s.datatype,
        cls: s.targetClass,
        inVals: s.allowedValues,
      }));
      const implSymbols = store
        .incoming(c.curie, 'bridge:implementsDomainClass')
        .map((t) => ({
          name: store.val(t.s, 'code:symbolName') ?? t.s,
          file: store.val(store.val(t.s, 'code:definedIn') ?? '', 'code:filePath') ?? '',
        }))
        .sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
      const seededJourneys = store
        .incoming(c.curie, 'bridge:seedNoun')
        .map((t) => store.val(t.s, 'qa:journeyId') ?? t.s)
        .sort();
      return {
        curie: c.curie,
        label: c.label,
        comment: c.comment,
        module: c.module,
        stereotype: c.stereotype ?? '',
        superClasses: [...c.superClasses],
        props: domainProps,
        shapes,
        implSymbols,
        seededJourneys: [...new Set(seededJourneys)],
      };
    })
    .sort((a, b) => a.curie.localeCompare(b.curie));

  // 3. QA Domains, Runs, Journeys, Issues
  const qaDomains = store
    .subjectsWith('rdf:type', 'qa:Domain')
    .map((d) => ({
      slug: store.val(d, 'qa:domainSlug') ?? d.split('/').pop() ?? d,
      mapping: store.val(d, 'bridge:domainMapping') ?? '',
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const qaRuns = store
    .subjectsWith('rdf:type', 'qa:Run')
    .map((r) => ({
      id: store.val(r, 'rdfs:label') ?? r.split('/').pop() ?? r,
      date: store.val(r, 'qa:runDate') ?? '',
      commit: store.val(r, 'qa:commit') ?? '',
      findings: Number(store.val(r, 'qa:findings') ?? 0),
      domains: store.vals(r, 'qa:runDomain').map((d) => d.split('/').pop() ?? d).sort(),
    }))
    .sort((a, b) => b.id.localeCompare(a.id));

  const qaJourneys = store
    .subjectsWith('rdf:type', 'qa:Journey')
    .map((j) => {
      const id = store.val(j, 'qa:journeyId') ?? j;
      const slug = store.val(j, 'qa:slug') ?? '';
      const title = store.val(j, 'qa:journeyTitle') ?? store.val(j, 'rdfs:label') ?? id;
      const domain = (store.val(j, 'qa:inDomain') ?? '').split('/').pop() ?? '';
      const priority = store.val(j, 'qa:priority') ?? 'P1';
      const status = store.val(j, 'qa:status') ?? 'authored';
      const specFile = store.val(store.val(j, 'bridge:specFile') ?? '', 'code:filePath') ?? '';
      const pwSpec = store.val(store.val(j, 'bridge:playwrightSpec') ?? '', 'code:filePath') ?? '';
      const routes = [...new Set(store.vals(j, 'bridge:route').map((r) => store.val(r, 'code:routePath') ?? r))].sort();
      const testIds = [...new Set(store.vals(j, 'bridge:testId').map((t) => store.val(t, 'code:testIdValue') ?? t))].sort();
      const seedNouns = [...new Set(store.vals(j, 'bridge:seedNoun'))].sort();

      const steps = store
        .vals(j, 'qa:hasStep')
        .map((s) => ({
          beat: (store.val(s, 'qa:hasBeat') ?? '').replace(/^qa:/, ''),
          label: store.val(s, 'rdfs:label') ?? '',
          order: Number(store.val(s, 'qa:beatOrder') ?? 0),
        }))
        .sort((a, b) => a.order - b.order);

      const touchedSet = new Set<string>(store.vals(j, 'bridge:touches'));
      for (const tidIri of store.vals(j, 'bridge:testId')) {
        for (const inc of store.incoming(tidIri, 'code:usesTestId')) {
          touchedSet.add(inc.s);
        }
      }
      const touchedFiles = [...touchedSet]
        .map((f) => store.val(f, 'code:filePath'))
        .filter((p): p is string => Boolean(p))
        .sort();

      const issueIds = [
        ...new Set([
          ...store.incoming(j, 'qa:affects').map((t) => store.val(t.s, 'qa:issueId') ?? t.s.split('/').pop() ?? t.s),
          ...store.incoming(j, 'qa:coveredBy').map((t) => store.val(t.s, 'qa:issueId') ?? t.s.split('/').pop() ?? t.s),
        ]),
      ].sort();

      return {
        id,
        slug,
        title,
        domain,
        priority,
        status,
        specFile,
        pwSpec,
        routes,
        testIds,
        seedNouns,
        steps,
        touchedFiles,
        issueIds,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const qaIssues = store
    .subjectsWith('rdf:type', 'qa:Issue')
    .map((i) => {
      const id = store.val(i, 'qa:issueId') ?? i.split('/').pop() ?? i;
      const title = store.val(i, 'rdfs:label') ?? id;
      const severity = store.val(i, 'qa:severity') ?? 'Medium';
      const kind = store.val(i, 'qa:kind') ?? 'defect';
      const status = store.val(i, 'qa:status') ?? 'open';
      const coverageStatus = store.val(i, 'qa:coverageStatus') ?? '';
      const firstSeenRun = store.val(i, 'qa:firstSeenRun')?.split('/').pop() ?? '';
      const lastSeenRun = store.val(i, 'qa:lastSeenRun')?.split('/').pop() ?? '';
      const affects = store.vals(i, 'qa:affects').map((d) => d.split('/').pop() ?? d).sort();
      const coveredBy = [
        ...new Set(store.vals(i, 'qa:coveredBy').map((j) => store.val(j, 'qa:journeyId') ?? j.split('/').pop() ?? j)),
      ].sort();
      const rootCauses = store.vals(i, 'bridge:rootCause').map((rc) => {
        const isSym = store.vals(rc, 'rdf:type').includes('code:Symbol');
        if (isSym) {
          const fIri = store.val(rc, 'code:definedIn') ?? '';
          return {
            type: 'symbol' as const,
            file: store.val(fIri, 'code:filePath') ?? '',
            symbol: store.val(rc, 'code:symbolName') ?? '',
            lineHint: Number(store.val(rc, 'code:lineHint') ?? 0),
          };
        }
        return {
          type: 'file' as const,
          file: store.val(rc, 'code:filePath') ?? rc,
          symbol: '',
          lineHint: Number(store.val(rc, 'code:lineHint') ?? 0),
        };
      });
      return {
        id,
        title,
        severity,
        kind,
        status,
        coverageStatus,
        firstSeenRun,
        lastSeenRun,
        affects,
        coveredBy,
        rootCauses,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  // 4. Code Files, Symbols, Routes, TestIds, WebMCP Tools
  const codeFiles = store
    .subjectsWith('rdf:type', 'code:File')
    .map((f) => {
      const filePath = store.val(f, 'code:filePath') ?? '';
      const pkg = store.val(f, 'code:packageName') ?? '';
      const isTest = store.val(f, 'code:isTestFile') === 'true';
      const symbols = store
        .incoming(f, 'code:definedIn')
        .filter((t) => store.vals(t.s, 'rdf:type').includes('code:Symbol'))
        .map((t) => ({
          n: store.val(t.s, 'code:symbolName') ?? '',
          k: store.val(t.s, 'code:symbolKind') ?? '',
          l: Number(store.val(t.s, 'code:lineHint') ?? 0),
          d: store.vals(t.s, 'bridge:implementsDomainClass'),
        }))
        .sort((a, b) => a.l - b.l || a.n.localeCompare(b.n));
      const testIds = store
        .vals(f, 'code:usesTestId')
        .map((tid) => store.val(tid, 'code:testIdValue') ?? tid)
        .sort();
      return { p: filePath, pkg, isTest, syms: symbols, tids: testIds };
    })
    .filter((f) => f.p)
    .sort((a, b) => a.p.localeCompare(b.p));

  const codeRoutes = store
    .subjectsWith('rdf:type', 'code:Route')
    .map((r) => ({
      name: store.val(r, 'code:routeName') ?? '',
      path: store.val(r, 'code:routePath') ?? '',
      journeys: [
        ...new Set(store.incoming(r, 'bridge:route').map((t) => store.val(t.s, 'qa:journeyId') ?? t.s)),
      ].sort(),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const codeTestIds = store
    .subjectsWith('rdf:type', 'code:TestId')
    .map((t) => ({
      key: store.val(t, 'code:testIdKey') ?? '',
      val: store.val(t, 'code:testIdValue') ?? '',
      files: store.incoming(t, 'code:usesTestId').map((x) => store.val(x.s, 'code:filePath') ?? '').filter(Boolean).sort(),
      journeys: [
        ...new Set(store.incoming(t, 'bridge:testId').map((x) => store.val(x.s, 'qa:journeyId') ?? x.s)),
      ].sort(),
    }))
    .sort((a, b) => a.val.localeCompare(b.val));

  const codeTools = store
    .subjectsWith('rdf:type', 'code:WebMcpTool')
    .map((w) => ({
      name: store.val(w, 'code:toolName') ?? '',
      title: store.val(w, 'code:toolTitle') ?? '',
      domain: store.val(w, 'code:toolDomain') ?? '',
      tier: Number(store.val(w, 'code:toolTier') ?? 0),
      cli: store.val(w, 'code:cliEquivalent') ?? '',
      file: store.val(store.val(w, 'code:definedIn') ?? '', 'code:filePath') ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const payload = {
    stereotypes,
    classes,
    metrics: Object.values(ONTOLOGY_METRICS).sort((a, b) => a.curie.localeCompare(b.curie)),
    qaDomains,
    qaRuns,
    qaJourneys,
    qaIssues,
    codeFiles,
    codeRoutes,
    codeTestIds,
    codeTools,
  };

  const jsonStr = JSON.stringify(payload).replace(/<\//g, '<\\/');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>WOD Wiki — Unified 5-Named-Graph Ontology Explorer</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #121722; --panel2: #181f2e; --border: #263044;
    --text: #e5ecf4; --muted: #8b9bb4; --accent: #38bdf8;
    --c-patterns: #a78bfa; --c-domain: #34d399; --c-qa: #fbbf24;
    --c-code: #38bdf8; --c-bridge: #fb7185;
    --sev-high: #ef4444; --sev-med: #f59e0b; --sev-low: #64748b;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); font-size: 13px; line-height: 1.45; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
  header { padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--panel); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
  header h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; }
  .pill { padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--panel2); font-size: 11px; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .layer-bar { padding: 8px 20px; border-bottom: 1px solid var(--border); background: #0e131d; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .layer-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel); cursor: pointer; font-size: 12px; user-select: none; }
  .layer-toggle input { accent-color: var(--accent); margin: 0; }
  .toolbar { padding: 10px 20px; border-bottom: 1px solid var(--border); background: var(--panel); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  input[type="search"], select { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 12px; }
  input[type="search"] { min-width: 260px; flex: 1; max-width: 420px; }
  .tabs { display: flex; gap: 4px; padding: 8px 20px 0; border-bottom: 1px solid var(--border); background: var(--panel); overflow-x: auto; }
  .tab { padding: 8px 14px; border: 1px solid transparent; border-bottom: none; border-radius: 6px 6px 0 0; cursor: pointer; color: var(--muted); background: transparent; font-size: 12px; font-weight: 500; }
  .tab.active { background: var(--bg); color: var(--text); border-color: var(--border); }
  main { display: grid; grid-template-columns: 380px 1fr; height: calc(100vh - 178px); min-height: 480px; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; height: auto; } }
  .list-pane { border-right: 1px solid var(--border); overflow-y: auto; padding: 8px; background: #0d111a; }
  .detail-pane { overflow-y: auto; padding: 18px 22px; }
  .card { padding: 9px 11px; border: 1px solid var(--border); border-radius: 7px; margin-bottom: 6px; background: var(--panel); cursor: pointer; transition: border-color .12s; }
  .card:hover, .card.selected { border-color: var(--accent); background: var(--panel2); }
  .card-title { font-weight: 600; font-size: 12.5px; display: flex; justify-content: space-between; gap: 6px; }
  .card-sub { color: var(--muted); font-size: 11px; margin-top: 3px; word-break: break-all; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10.5px; border: 1px solid var(--border); background: var(--panel2); color: var(--text); margin: 2px 3px 2px 0; }
  .badge.clickable { cursor: pointer; }
  .badge.clickable:hover { border-color: var(--accent); color: var(--accent); }
  .b-patterns { border-color: rgba(167,139,250,.4); color: var(--c-patterns); }
  .b-domain { border-color: rgba(52,211,153,.4); color: var(--c-domain); }
  .b-qa { border-color: rgba(251,191,36,.4); color: var(--c-qa); }
  .b-code { border-color: rgba(56,189,248,.4); color: var(--c-code); }
  .b-bridge { border-color: rgba(251,113,133,.4); color: var(--c-bridge); }
  .b-high { border-color: rgba(239,68,68,.5); color: #fca5a5; }
  .b-med { border-color: rgba(245,158,11,.5); color: #fcd34d; }
  .section { margin-bottom: 18px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
  .section h3 { margin: 0 0 10px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .beat-row { display: grid; grid-template-columns: 80px 1fr; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(38,48,68,.5); }
  .beat-row:last-child { border-bottom: none; }
  .subtabs { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
  .subtab { padding: 4px 9px; border-radius: 5px; border: 1px solid var(--border); background: var(--panel); color: var(--muted); cursor: pointer; font-size: 11px; }
  .subtab.active { border-color: var(--accent); color: var(--text); background: var(--panel2); }
  .breadcrumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 12px; }
  .btn { padding: 4px 10px; border-radius: 5px; border: 1px solid var(--border); background: var(--panel2); color: var(--text); cursor: pointer; font-size: 11.5px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .ext-links { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }
  a.badge { text-decoration: none; }
  svg.graph { width: 100%; height: 480px; border: 1px solid var(--border); border-radius: 8px; background: #090c12; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; }
</style>
</head>
<body>
<header>
  <h1>WOD Wiki — Unified 5-Named-Graph Ontology Explorer</h1>
  <div class="stats" id="stats-bar"></div>
</header>

<div class="layer-bar">
  <span style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em;">Named Graphs:</span>
  <label class="layer-toggle"><input type="checkbox" data-layer="patterns" checked /><span class="dot" style="background:var(--c-patterns)"></span>:patterns</label>
  <label class="layer-toggle"><input type="checkbox" data-layer="domain" checked /><span class="dot" style="background:var(--c-domain)"></span>:domain (wod:)</label>
  <label class="layer-toggle"><input type="checkbox" data-layer="qa" checked /><span class="dot" style="background:var(--c-qa)"></span>:qa</label>
  <label class="layer-toggle"><input type="checkbox" data-layer="code" checked /><span class="dot" style="background:var(--c-code)"></span>:code</label>
  <label class="layer-toggle"><input type="checkbox" data-layer="bridge" checked /><span class="dot" style="background:var(--c-bridge)"></span>:bridge</label>
  <div class="ext-links" id="surface-links">
    <select id="env-select" title="Target *.wod.wiki environment for cross-links">
      <option value="auto">Env: Auto</option>
      <option value="prod">Env: prod (wod.wiki)</option>
      <option value="main">Env: main (*.wod.wiki)</option>
      <option value="local">Env: local (:5173/:6006)</option>
    </select>
    <a class="btn" id="link-playground" target="_blank" rel="noopener noreferrer">Playground ↗</a>
    <a class="btn" id="link-storybook" target="_blank" rel="noopener noreferrer">Storybook ↗</a>
    <a class="btn" id="link-e2e" target="_blank" rel="noopener noreferrer">E2E Report ↗</a>
    <a class="btn" id="link-qa" target="_blank" rel="noopener noreferrer">Dogfood QA ↗</a>
  </div>
</div>

<div class="toolbar">
  <input type="search" id="search-input" placeholder="Search IRI, label, file path, symbol, issue ID, test ID..." />
  <select id="filter-domain"><option value="">All QA Domains (7)</option></select>
  <select id="filter-priority">
    <option value="">All Priorities</option>
    <option value="P0-gate">P0-gate</option>
    <option value="P1-core">P1-core</option>
    <option value="P1">P1</option>
    <option value="P2">P2</option>
  </select>
  <select id="filter-stereotype"><option value="">All UFO Stereotypes</option></select>
  <select id="filter-severity">
    <option value="">All Severities</option>
    <option value="High">High</option>
    <option value="Medium">Medium</option>
    <option value="Low">Low</option>
  </select>
  <select id="filter-status">
    <option value="">All Statuses</option>
    <option value="open">open</option>
    <option value="resolved">resolved</option>
    <option value="authored">authored</option>
    <option value="proposed">proposed</option>
  </select>
</div>

<div class="tabs" id="main-tabs">
  <button class="tab active" data-tab="journeys">Journeys &amp; 5-Beat Flows</button>
  <button class="tab" data-tab="domain">Domain &amp; Patterns</button>
  <button class="tab" data-tab="code">Code &amp; Reverse Lookup</button>
  <button class="tab" data-tab="issues">Issues &amp; Provenance</button>
  <button class="tab" data-tab="graph">Interactive Neighborhood Graph</button>
</div>

<main>
  <div class="list-pane" id="list-pane"></div>
  <div class="detail-pane" id="detail-pane"></div>
</main>

<script id="ontology-data" type="application/json">${jsonStr}</script>
<script>
(function() {
  const DATA = JSON.parse(document.getElementById('ontology-data').textContent);

  // Build reverse indexes for O(1) bidirectional lookup
  const journeyById = new Map(DATA.qaJourneys.map(j => [j.id, j]));
  const issueById = new Map(DATA.qaIssues.map(i => [i.id, i]));
  const classByCurie = new Map(DATA.classes.map(c => [c.curie, c]));
  const fileByPath = new Map(DATA.codeFiles.map(f => [f.p, f]));

  const fileToJourneys = new Map();
  const fileToIssues = new Map();
  for (const j of DATA.qaJourneys) {
    for (const f of j.touchedFiles) {
      if (!fileToJourneys.has(f)) fileToJourneys.set(f, new Set());
      fileToJourneys.get(f).add(j.id);
    }
    if (j.specFile) {
      if (!fileToJourneys.has(j.specFile)) fileToJourneys.set(j.specFile, new Set());
      fileToJourneys.get(j.specFile).add(j.id);
    }
    if (j.pwSpec) {
      if (!fileToJourneys.has(j.pwSpec)) fileToJourneys.set(j.pwSpec, new Set());
      fileToJourneys.get(j.pwSpec).add(j.id);
    }
  }
  for (const iss of DATA.qaIssues) {
    for (const rc of iss.rootCauses) {
      if (!rc.file) continue;
      if (!fileToIssues.has(rc.file)) fileToIssues.set(rc.file, new Set());
      fileToIssues.get(rc.file).add(iss.id);
      for (const jId of iss.coveredBy) {
        if (!fileToJourneys.has(rc.file)) fileToJourneys.set(rc.file, new Set());
        fileToJourneys.get(rc.file).add(jId);
      }
    }
  }

  const state = {
    tab: 'journeys',
    codeSubtab: 'files',
    search: '',
    domain: '',
    priority: '',
    stereotype: '',
    severity: '',
    status: '',
    env: 'auto',
    layers: { patterns: true, domain: true, qa: true, code: true, bridge: true },
    selected: { kind: 'journey', id: DATA.qaJourneys[0]?.id || '' }
  };

  function resolveOrigins() {
    const qa = 'https://qa.forest-adhara.ts.net';
    const host = window.location.hostname || '';
    let mode = state.env;
    if (mode === 'auto') {
      const m = host.match(/^([a-z0-9-]+)\.(preview|story|e2e|ontology)\.wod\.wiki$/i);
      if (m) {
        const slug = m[1];
        return {
          playground: \`https://\${slug}.preview.wod.wiki\`,
          storybook: \`https://\${slug}.story.wod.wiki\`,
          e2e: \`https://\${slug}.e2e.wod.wiki\`,
          qa
        };
      }
      if (/^(?:www\.|story\.|e2e\.|ontology\.)?wod\.wiki$/i.test(host)) {
        mode = 'prod';
      } else {
        mode = 'main';
      }
    }
    if (mode === 'prod') {
      return { playground: 'https://wod.wiki', storybook: 'https://story.wod.wiki', e2e: 'https://e2e.wod.wiki', qa };
    }
    if (mode === 'local') {
      return { playground: 'http://localhost:5173', storybook: 'http://localhost:6006', e2e: 'http://localhost:9323', qa };
    }
    return { playground: 'https://main.preview.wod.wiki', storybook: 'https://main.story.wod.wiki', e2e: 'https://main.e2e.wod.wiki', qa };
  }

  function syncSurfaceLinks() {
    const o = resolveOrigins();
    document.getElementById('link-playground').href = o.playground;
    document.getElementById('link-storybook').href = o.storybook;
    document.getElementById('link-e2e').href = o.e2e;
    document.getElementById('link-qa').href = o.qa;
  }

  function defaultTabForKind(kind) {
    if (kind === 'journey') return 'journeys';
    if (kind === 'class') return 'domain';
    if (kind === 'file') return 'code';
    if (kind === 'issue') return 'issues';
    return 'journeys';
  }

  function buildHash(kind, id, tab, codeSubtab) {
    const encodedId = kind === 'file'
      ? id.split('/').map(encodeURIComponent).join('/')
      : encodeURIComponent(id);
    const params = new URLSearchParams();
    if (tab && tab !== defaultTabForKind(kind)) params.set('tab', tab);
    if (tab === 'code' && codeSubtab && codeSubtab !== 'files') params.set('sub', codeSubtab);
    const qs = params.toString();
    return \`#/\${kind}/\${encodedId}\${qs ? '?' + qs : ''}\`;
  }

  function parseHash(hashStr) {
    const raw = (hashStr || '').replace(/^#/, '').replace(/^[/]+/, '');
    if (!raw) return null;
    const [pathPart, qs] = raw.split('?');
    const parts = pathPart.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const kind = parts[0];
    if (!['journey', 'class', 'file', 'issue'].includes(kind)) return null;
    let id = '';
    try {
      id = kind === 'file'
        ? parts.slice(1).map(decodeURIComponent).join('/')
        : decodeURIComponent(parts.slice(1).join('/'));
    } catch {
      id = parts.slice(1).join('/');
    }
    const params = new URLSearchParams(qs || '');
    return { kind, id, tab: params.get('tab'), sub: params.get('sub') };
  }

  function syncHash(replace) {
    const next = buildHash(state.selected.kind, state.selected.id, state.tab, state.codeSubtab);
    if (window.location.hash !== next) {
      if (replace && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', next);
      } else {
        window.location.hash = next;
      }
    }
  }

  function applyHashFromLocation() {
    const parsed = parseHash(window.location.hash);
    if (!parsed) return false;
    state.selected = { kind: parsed.kind, id: parsed.id };
    state.tab = parsed.tab || defaultTabForKind(parsed.kind);
    if (parsed.sub) state.codeSubtab = parsed.sub;
    else if (parsed.kind === 'file') state.codeSubtab = 'files';
    syncTabUI();
    return true;
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function badge(text, cls, navKind, navId) {
    const click = navKind ? \` data-nav-kind="\${esc(navKind)}" data-nav-id="\${esc(navId)}"\` : '';
    return \`<span class="badge \${cls} \${navKind ? 'clickable' : ''}"\${click}>\${esc(text)}</span>\`;
  }

  // Stats bar
  document.getElementById('stats-bar').innerHTML = [
    \`<span class="pill"><span class="dot" style="background:var(--c-patterns)"></span>\${DATA.stereotypes.length} UFO stereotypes</span>\`,
    \`<span class="pill"><span class="dot" style="background:var(--c-domain)"></span>\${DATA.classes.length} classes</span>\`,
    \`<span class="pill"><span class="dot" style="background:var(--c-qa)"></span>\${DATA.qaJourneys.length} journeys · \${DATA.qaIssues.length} issues · \${DATA.qaRuns.length} runs</span>\`,
    \`<span class="pill"><span class="dot" style="background:var(--c-code)"></span>\${DATA.codeFiles.length} files · \${DATA.codeTestIds.length} testIds · \${DATA.codeTools.length} tools</span>\`
  ].join('');

  // Populate filter selects
  const domSel = document.getElementById('filter-domain');
  for (const d of DATA.qaDomains) {
    const opt = document.createElement('option');
    opt.value = d.slug;
    opt.textContent = d.slug;
    domSel.appendChild(opt);
  }
  const stSel = document.getElementById('filter-stereotype');
  for (const s of DATA.stereotypes) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    stSel.appendChild(opt);
  }

  function navigateTo(kind, id, switchTab) {
    state.selected = { kind, id };
    if (switchTab) {
      state.tab = switchTab;
    } else if (state.tab !== 'graph') {
      state.tab = defaultTabForKind(kind);
      if (kind === 'file') state.codeSubtab = 'files';
    }
    syncTabUI();
    syncHash(false);
    render();
  }

  function syncTabUI() {
    document.querySelectorAll('#main-tabs .tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === state.tab);
    });
  }

  function matchSearch(haystack) {
    if (!state.search) return true;
    return haystack.toLowerCase().includes(state.search);
  }

  function renderList() {
    const el = document.getElementById('list-pane');
    if (state.tab === 'journeys') {
      if (!state.layers.qa) { el.innerHTML = '<div class="card-sub">Layer :qa is hidden.</div>'; return; }
      const items = DATA.qaJourneys.filter(j => {
        if (state.domain && j.domain !== state.domain) return false;
        if (state.priority && j.priority !== state.priority) return false;
        if (state.status && j.status !== state.status) return false;
        return matchSearch(\`\${j.id} \${j.title} \${j.domain} \${j.routes.join(' ')} \${j.testIds.join(' ')}\`);
      });
      el.innerHTML = items.map(j => \`
        <div class="card \${state.selected.kind === 'journey' && state.selected.id === j.id ? 'selected' : ''}" data-nav-kind="journey" data-nav-id="\${esc(j.id)}">
          <div class="card-title"><span>\${esc(j.id)} — \${esc(j.title)}</span><span class="badge b-qa">\${esc(j.priority)}</span></div>
          <div class="card-sub">\${esc(j.domain)} · \${esc(j.status)} · \${j.touchedFiles.length} files · \${j.issueIds.length} issues</div>
        </div>\`).join('') || '<div class="card-sub">No matching journeys.</div>';
    } else if (state.tab === 'domain') {
      if (!state.layers.domain) { el.innerHTML = '<div class="card-sub">Layer :domain is hidden.</div>'; return; }
      const items = DATA.classes.filter(c => {
        if (state.stereotype && c.stereotype !== state.stereotype) return false;
        return matchSearch(\`\${c.curie} \${c.label} \${c.module} \${c.stereotype}\`);
      });
      el.innerHTML = items.map(c => \`
        <div class="card \${state.selected.kind === 'class' && state.selected.id === c.curie ? 'selected' : ''}" data-nav-kind="class" data-nav-id="\${esc(c.curie)}">
          <div class="card-title"><span class="mono">\${esc(c.curie)}</span><span class="badge b-patterns">\${esc(c.stereotype || 'class')}</span></div>
          <div class="card-sub">\${esc(c.label)} · \${esc(c.module)} · \${c.props.length} props</div>
        </div>\`).join('') || '<div class="card-sub">No matching classes.</div>';
    } else if (state.tab === 'code') {
      if (!state.layers.code) { el.innerHTML = '<div class="card-sub">Layer :code is hidden.</div>'; return; }
      const subTabs = \`<div class="subtabs">
        <button class="subtab \${state.codeSubtab === 'files' ? 'active' : ''}" data-subtab="files">Files (\${DATA.codeFiles.length})</button>
        <button class="subtab \${state.codeSubtab === 'routes' ? 'active' : ''}" data-subtab="routes">Routes (\${DATA.codeRoutes.length})</button>
        <button class="subtab \${state.codeSubtab === 'testids' ? 'active' : ''}" data-subtab="testids">TEST_IDS (\${DATA.codeTestIds.length})</button>
        <button class="subtab \${state.codeSubtab === 'tools' ? 'active' : ''}" data-subtab="tools">WebMCP (\${DATA.codeTools.length})</button>
      </div>\`;
      if (state.codeSubtab === 'files') {
        const items = DATA.codeFiles.filter(f => matchSearch(\`\${f.p} \${f.syms.map(s => s.n).join(' ')}\`)).slice(0, 120);
        el.innerHTML = subTabs + items.map(f => {
          const jc = (fileToJourneys.get(f.p)?.size) || 0;
          const ic = (fileToIssues.get(f.p)?.size) || 0;
          return \`<div class="card \${state.selected.kind === 'file' && state.selected.id === f.p ? 'selected' : ''}" data-nav-kind="file" data-nav-id="\${esc(f.p)}">
            <div class="card-title"><span class="mono">\${esc(f.p.split('/').pop())}</span><span class="badge b-code">\${f.syms.length} syms</span></div>
            <div class="card-sub">\${esc(f.p)} · \${jc} journeys · \${ic} issues</div>
          </div>\`;
        }).join('');
      } else if (state.codeSubtab === 'routes') {
        const origins = resolveOrigins();
        const items = DATA.codeRoutes.filter(r => matchSearch(\`\${r.path} \${r.name}\`));
        el.innerHTML = subTabs + items.map(r => {
          const isStatic = !r.path.includes(':');
          const routeHref = origins.playground + (r.path.startsWith('/') ? r.path : '/' + r.path);
          return \`
          <div class="card">
            <div class="card-title"><span class="mono">\${esc(r.path)}</span>\${isStatic ? \`<a class="badge b-code clickable" href="\${esc(routeHref)}" target="_blank" rel="noopener noreferrer">Open ↗</a>\` : \`<span class="badge b-code">\${esc(r.name || 'route')}</span>\`}</div>
            <div class="card-sub">\${r.journeys.map(j => badge(j, 'b-qa', 'journey', j)).join('')}</div>
          </div>\`;
        }).join('');
      } else if (state.codeSubtab === 'testids') {
        const items = DATA.codeTestIds.filter(t => matchSearch(\`\${t.val} \${t.key}\`)).slice(0, 150);
        el.innerHTML = subTabs + items.map(t => \`
          <div class="card">
            <div class="card-title"><span class="mono">\${esc(t.val)}</span><span class="badge b-code">\${t.files.length} files</span></div>
            <div class="card-sub">\${esc(t.key)} · \${t.journeys.map(j => badge(j, 'b-qa', 'journey', j)).join('')}</div>
          </div>\`).join('');
      } else {
        const items = DATA.codeTools.filter(w => matchSearch(\`\${w.name} \${w.title} \${w.domain}\`));
        el.innerHTML = subTabs + items.map(w => \`
          <div class="card" data-nav-kind="file" data-nav-id="\${esc(w.file)}">
            <div class="card-title"><span class="mono">\${esc(w.name)}</span><span class="badge b-code">tier \${w.tier}</span></div>
            <div class="card-sub">\${esc(w.title)} · <code>\${esc(w.cli)}</code></div>
          </div>\`).join('');
      }
    } else if (state.tab === 'issues') {
      if (!state.layers.qa) { el.innerHTML = '<div class="card-sub">Layer :qa is hidden.</div>'; return; }
      const items = DATA.qaIssues.filter(i => {
        if (state.severity && i.severity !== state.severity) return false;
        if (state.status && i.status !== state.status) return false;
        if (state.domain && !i.affects.includes(state.domain)) return false;
        return matchSearch(\`\${i.id} \${i.title} \${i.rootCauses.map(r => r.file + ' ' + r.symbol).join(' ')}\`);
      });
      el.innerHTML = items.map(i => \`
        <div class="card \${state.selected.kind === 'issue' && state.selected.id === i.id ? 'selected' : ''}" data-nav-kind="issue" data-nav-id="\${esc(i.id)}">
          <div class="card-title"><span>\${esc(i.id)}</span><span class="badge \${i.severity === 'High' ? 'b-high' : 'b-med'}">\${esc(i.severity)} · \${esc(i.status)}</span></div>
          <div class="card-sub">\${esc(i.title)}</div>
        </div>\`).join('') || '<div class="card-sub">No matching issues.</div>';
    } else {
      // Graph tab: quick jump list of top entities matching search
      const cards = [];
      for (const j of DATA.qaJourneys.filter(x => matchSearch(x.id + ' ' + x.title)).slice(0, 12)) {
        cards.push(\`<div class="card" data-nav-kind="journey" data-nav-id="\${esc(j.id)}"><div class="card-title"><span>\${esc(j.id)}</span><span class="badge b-qa">Journey</span></div><div class="card-sub">\${esc(j.title)}</div></div>\`);
      }
      for (const c of DATA.classes.filter(x => matchSearch(x.curie + ' ' + x.label)).slice(0, 10)) {
        cards.push(\`<div class="card" data-nav-kind="class" data-nav-id="\${esc(c.curie)}"><div class="card-title"><span class="mono">\${esc(c.curie)}</span><span class="badge b-domain">Class</span></div></div>\`);
      }
      for (const i of DATA.qaIssues.filter(x => matchSearch(x.id + ' ' + x.title)).slice(0, 10)) {
        cards.push(\`<div class="card" data-nav-kind="issue" data-nav-id="\${esc(i.id)}"><div class="card-title"><span>\${esc(i.id)}</span><span class="badge b-qa">Issue</span></div><div class="card-sub">\${esc(i.title)}</div></div>\`);
      }
      for (const f of DATA.codeFiles.filter(x => matchSearch(x.p)).slice(0, 12)) {
        cards.push(\`<div class="card" data-nav-kind="file" data-nav-id="\${esc(f.p)}"><div class="card-title"><span class="mono">\${esc(f.p.split('/').pop())}</span><span class="badge b-code">File</span></div><div class="card-sub">\${esc(f.p)}</div></div>\`);
      }
      el.innerHTML = cards.join('') || '<div class="card-sub">Search to jump to any node.</div>';
    }
  }

  function renderNeighborhoodSvg(kind, id) {
    const nodes = [];
    const edges = [];
    const seen = new Set();
    function addNode(k, nid, label, layer) {
      if (!state.layers[layer]) return;
      const key = k + ':' + nid;
      if (seen.has(key)) return;
      seen.add(key);
      nodes.push({ k, id: nid, label, layer });
    }
    const centerLayer = kind === 'class' ? 'domain' : kind === 'file' ? 'code' : 'qa';
    addNode(kind, id, id.split('/').pop(), centerLayer);

    if (kind === 'journey') {
      const j = journeyById.get(id);
      if (j) {
        for (const s of j.seedNouns) { addNode('class', s, s, 'domain'); edges.push([0, nodes.length - 1, 'seedNoun']); }
        for (const f of j.touchedFiles.slice(0, 8)) { addNode('file', f, f.split('/').pop(), 'code'); edges.push([0, nodes.length - 1, 'touches']); }
        for (const iid of j.issueIds.slice(0, 6)) { addNode('issue', iid, iid, 'qa'); edges.push([0, nodes.length - 1, 'coveredBy']); }
      }
    } else if (kind === 'file') {
      for (const jid of (fileToJourneys.get(id) || [])) { addNode('journey', jid, jid, 'qa'); edges.push([0, nodes.length - 1, 'journey']); }
      for (const iid of (fileToIssues.get(id) || [])) { addNode('issue', iid, iid, 'qa'); edges.push([0, nodes.length - 1, 'rootCause']); }
      const f = fileByPath.get(id);
      if (f) {
        for (const s of f.syms) for (const d of s.d) { addNode('class', d, d, 'domain'); edges.push([0, nodes.length - 1, 'implements']); }
      }
    } else if (kind === 'class') {
      const c = classByCurie.get(id);
      if (c) {
        for (const jid of c.seededJourneys) { addNode('journey', jid, jid, 'qa'); edges.push([0, nodes.length - 1, 'seedNoun']); }
        for (const sym of c.implSymbols) { addNode('file', sym.file, sym.name, 'code'); edges.push([0, nodes.length - 1, 'impl']); }
      }
    } else if (kind === 'issue') {
      const iss = issueById.get(id);
      if (iss) {
        for (const jid of iss.coveredBy) { addNode('journey', jid, jid, 'qa'); edges.push([0, nodes.length - 1, 'coveredBy']); }
        for (const rc of iss.rootCauses.slice(0, 10)) {
          if (rc.file) { addNode('file', rc.file, rc.symbol || rc.file.split('/').pop(), 'code'); edges.push([0, nodes.length - 1, 'rootCause']); }
        }
      }
    }

    const W = 760, H = 460, cx = W / 2, cy = H / 2;
    const colors = { patterns: '#a78bfa', domain: '#34d399', qa: '#fbbf24', code: '#38bdf8', bridge: '#fb7185' };
    const coords = nodes.map((n, idx) => {
      if (idx === 0) return { x: cx, y: cy };
      const angle = ((idx - 1) / Math.max(1, nodes.length - 1)) * Math.PI * 2 - Math.PI / 2;
      const r = 165 + (idx % 2) * 32;
      return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });

    const edgeSvg = edges.map(([a, b, lbl]) => {
      const p1 = coords[a], p2 = coords[b];
      if (!p1 || !p2) return '';
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      return \`<line x1="\${p1.x}" y1="\${p1.y}" x2="\${p2.x}" y2="\${p2.y}" stroke="#334155" stroke-width="1.4" /><text x="\${mx}" y="\${my - 3}" fill="#64748b" font-size="9" text-anchor="middle">\${esc(lbl)}</text>\`;
    }).join('');

    const nodeSvg = nodes.map((n, idx) => {
      const p = coords[idx];
      const col = colors[n.layer] || '#38bdf8';
      return \`<g style="cursor:pointer" data-nav-kind="\${esc(n.k)}" data-nav-id="\${esc(n.id)}">
        <circle cx="\${p.x}" cy="\${p.y}" r="\${idx === 0 ? 22 : 15}" fill="#121722" stroke="\${col}" stroke-width="\${idx === 0 ? 3 : 2}" />
        <text x="\${p.x}" y="\${p.y + (idx === 0 ? 35 : 26)}" fill="#e5ecf4" font-size="10.5" text-anchor="middle">\${esc(n.label.slice(0, 28))}</text>
      </g>\`;
    }).join('');

    return \`<svg class="graph" viewBox="0 0 \${W} \${H}">\${edgeSvg}\${nodeSvg}</svg>\`;
  }

  function renderDetail() {
    const el = document.getElementById('detail-pane');
    const origins = resolveOrigins();
    const crumbs = \`<div class="breadcrumbs">
      <button class="btn" id="btn-back" title="Browser Back">← Back</button>
      <button class="btn" id="btn-fwd" title="Browser Forward">Forward →</button>
      <span class="badge b-bridge">\${esc(state.selected.kind)}: \${esc(state.selected.id)}</span>
      \${state.tab !== 'graph' ? '<button class="btn" id="btn-open-graph">View Neighborhood Graph</button>' : ''}
      <button class="btn" id="btn-copy-link" title="Copy deep link">Copy # Link</button>
    </div>\`;

    if (state.tab === 'graph') {
      el.innerHTML = crumbs + \`<div class="section"><h3>1-Hop Neighborhood Graph (Click any node to traverse)</h3>\${renderNeighborhoodSvg(state.selected.kind, state.selected.id)}</div>\`;
      return;
    }

    const { kind, id } = state.selected;
    if (kind === 'journey') {
      const j = journeyById.get(id);
      if (!j) { el.innerHTML = crumbs + '<p>Select a journey.</p>'; return; }
      const e2eHref = \`\${origins.e2e}/#?q=\${encodeURIComponent(j.id)}\`;
      el.innerHTML = crumbs + \`
        <div class="section">
          <h2 style="margin:0 0 6px;">\${esc(j.id)} — \${esc(j.title)}</h2>
          <div>\${badge(j.domain, 'b-qa')} \${badge(j.priority, 'b-qa')} \${badge(j.status, 'b-qa')} \${j.pwSpec ? \`<a class="badge b-code clickable" href="\${esc(e2eHref)}" target="_blank" rel="noopener noreferrer">E2E Report ↗</a>\` : ''}</div>
          <p class="card-sub">Spec: \${j.specFile ? badge(j.specFile, 'b-code', 'file', j.specFile) : '<code>proposed</code>'} · Playwright: \${j.pwSpec ? badge(j.pwSpec, 'b-code', 'file', j.pwSpec) : '<code>—</code>'}</p>
        </div>
        <div class="section">
          <h3>5-Beat Causal Chain (Seed → Enter → Sense → Drive → Prove)</h3>
          \${j.steps.length ? j.steps.map(s => \`<div class="beat-row"><div>\${badge(s.beat, 'b-qa')}</div><div>\${esc(s.label)}</div></div>\`).join('') : '<p class="card-sub">Proposed open journey slot (no 5-beat spec authored yet).</p>'}
        </div>
        \${state.layers.bridge ? \`<div class="section">
          <h3>Bridge Connections</h3>
          <p><strong>Seed Nouns (:domain):</strong> \${j.seedNouns.map(s => badge(s, 'b-domain', 'class', s)).join('') || '—'}</p>
          <p><strong>Routes (:code):</strong> \${j.routes.map(r => !r.includes(':') ? \`<a class="badge b-code clickable" href="\${esc(origins.playground + (r.startsWith('/') ? r : '/' + r))}" target="_blank" rel="noopener noreferrer">\${esc(r)} ↗</a>\` : badge(r, 'b-code')).join('') || '—'}</p>
          <p><strong>TEST_IDS (:code):</strong> \${j.testIds.map(t => badge(t, 'b-code')).join('') || '—'}</p>
          <p><strong>Touched Files (\${j.touchedFiles.length}):</strong><br/>\${j.touchedFiles.map(f => badge(f, 'b-code', 'file', f)).join('') || '—'}</p>
          <p><strong>Covering / Affected Issues (\${j.issueIds.length}):</strong><br/>\${j.issueIds.map(i => badge(i, 'b-qa', 'issue', i)).join('') || '—'}</p>
        </div>\` : ''}\`;
    } else if (kind === 'class') {
      const c = classByCurie.get(id);
      if (!c) { el.innerHTML = crumbs + '<p>Select a class.</p>'; return; }
      el.innerHTML = crumbs + \`
        <div class="section">
          <h2 style="margin:0 0 6px;" class="mono">\${esc(c.curie)}</h2>
          <div>\${badge(c.stereotype || 'owl:Class', 'b-patterns')} \${badge(c.module, 'b-domain')} \${c.superClasses.map(sc => badge('subClassOf ' + sc, 'b-domain', 'class', sc)).join('')}</div>
          <p>\${esc(c.comment)}</p>
        </div>
        <div class="section">
          <h3>Properties (\${c.props.length})</h3>
          <table><tr><th>Property</th><th>Kind</th><th>Range</th></tr>
          \${c.props.map(p => \`<tr><td class="mono">\${esc(p.curie)}</td><td>\${esc(p.kind)}</td><td class="mono">\${esc(p.range)}</td></tr>\`).join('') || '<tr><td colspan="3">None declared directly.</td></tr>'}
          </table>
        </div>
        <div class="section">
          <h3>SHACL Constraints (\${c.shapes.length})</h3>
          <table><tr><th>Path</th><th>Card</th><th>Type / Values</th></tr>
          \${c.shapes.map(s => \`<tr><td class="mono">\${esc(s.path)}</td><td>[\${s.min ?? 0}..\${s.max ?? '*'}]</td><td class="mono">\${esc(s.dt || s.cls || (s.inVals ? s.inVals.join(' | ') : ''))}</td></tr>\`).join('') || '<tr><td colspan="3">None.</td></tr>'}
          </table>
        </div>
        <div class="section">
          <h3>Reverse Bridge Links</h3>
          <p><strong>Seeded Journeys:</strong> \${c.seededJourneys.map(j => badge(j, 'b-qa', 'journey', j)).join('') || '—'}</p>
          <p><strong>Implementing Symbols:</strong> \${c.implSymbols.map(s => badge(s.name + ' (' + s.file + ')', 'b-code', 'file', s.file)).join('') || '—'}</p>
        </div>\`;
    } else if (kind === 'file') {
      const f = fileByPath.get(id);
      const jIds = [...(fileToJourneys.get(id) || [])].sort();
      const iIds = [...(fileToIssues.get(id) || [])].sort();
      el.innerHTML = crumbs + \`
        <div class="section">
          <h2 style="margin:0 0 6px;" class="mono">\${esc(id)}</h2>
          <div>\${f ? badge(f.pkg, 'b-code') : ''} \${badge(jIds.length + ' journeys', 'b-qa')} \${badge(iIds.length + ' issues', 'b-qa')}</div>
        </div>
        <div class="section">
          <h3>Exported Symbols (\${f ? f.syms.length : 0})</h3>
          <table><tr><th>Symbol</th><th>Kind</th><th>lineHint</th><th>Implements</th></tr>
          \${(f?.syms || []).map(s => \`<tr><td class="mono">\${esc(s.n)}</td><td>\${esc(s.k)}</td><td>\${s.l}</td><td>\${s.d.map(d => badge(d, 'b-domain', 'class', d)).join('')}</td></tr>\`).join('') || '<tr><td colspan="4">No exported symbols.</td></tr>'}
          </table>
        </div>
        <div class="section">
          <h3>Connected Journeys (\${jIds.length}) &amp; Root-Cause Issues (\${iIds.length})</h3>
          <p><strong>Journeys:</strong> \${jIds.map(j => badge(j + ' — ' + (journeyById.get(j)?.title || ''), 'b-qa', 'journey', j)).join('') || '—'}</p>
          <p><strong>Issues:</strong> \${iIds.map(i => badge(i + ' — ' + (issueById.get(i)?.title || ''), 'b-high', 'issue', i)).join('') || '—'}</p>
          \${f?.tids.length ? \`<p><strong>TEST_IDS used:</strong> \${f.tids.map(t => badge(t, 'b-code')).join('')}</p>\` : ''}
        </div>\`;
    } else if (kind === 'issue') {
      const iss = issueById.get(id);
      if (!iss) { el.innerHTML = crumbs + '<p>Select an issue.</p>'; return; }
      const qaIssueHref = \`\${origins.qa}/issues/\${encodeURIComponent(iss.id)}\`;
      const fmtRun = (runId) => runId
        ? \`<a class="badge b-qa clickable" href="\${esc(origins.qa + '/sessions/' + encodeURIComponent(runId))}" target="_blank" rel="noopener noreferrer">\${esc(runId)} ↗</a>\`
        : '<code>n/a</code>';
      el.innerHTML = crumbs + \`
        <div class="section">
          <h2 style="margin:0 0 6px;">\${esc(iss.id)} — \${esc(iss.title)}</h2>
          <div>\${badge(iss.severity, iss.severity === 'High' ? 'b-high' : 'b-med')} \${badge(iss.status, 'b-qa')} \${badge(iss.kind, 'b-qa')} \${iss.coverageStatus ? badge(iss.coverageStatus, 'b-qa') : ''} <a class="badge b-code clickable" href="\${esc(qaIssueHref)}" target="_blank" rel="noopener noreferrer">Dogfood QA ↗</a></div>
          <p class="card-sub">PROV Runs: firstSeen=\${fmtRun(iss.firstSeenRun)} · lastSeen=\${fmtRun(iss.lastSeenRun)}</p>
        </div>
        <div class="section">
          <h3>Affected Domains &amp; Covering Journeys</h3>
          <p><strong>Domains:</strong> \${iss.affects.map(d => badge(d, 'b-qa')).join('') || '—'}</p>
          <p><strong>Covered By:</strong> \${iss.coveredBy.map(j => badge(j, 'b-qa', 'journey', j)).join('') || '—'}</p>
        </div>
        <div class="section">
          <h3>Root-Cause Files &amp; Symbols (bridge:rootCause)</h3>
          <table><tr><th>Type</th><th>File</th><th>Symbol</th><th>lineHint</th></tr>
          \${iss.rootCauses.map(rc => \`<tr><td>\${esc(rc.type)}</td><td>\${badge(rc.file, 'b-code', 'file', rc.file)}</td><td class="mono">\${esc(rc.symbol || '—')}</td><td>\${rc.lineHint || '—'}</td></tr>\`).join('') || '<tr><td colspan="4">None recorded.</td></tr>'}
          </table>
        </div>\`;
    }
  }

  function render() {
    renderList();
    renderDetail();
  }

  // Event delegation
  document.addEventListener('click', (e) => {
    const navEl = e.target.closest('[data-nav-kind]');
    if (navEl) {
      navigateTo(navEl.dataset.navKind, navEl.dataset.navId);
      return;
    }
    const tabEl = e.target.closest('#main-tabs .tab');
    if (tabEl) {
      state.tab = tabEl.dataset.tab;
      if (state.tab === 'domain' && state.selected.kind !== 'class' && DATA.classes[0]) state.selected = { kind: 'class', id: DATA.classes[0].curie };
      if (state.tab === 'issues' && state.selected.kind !== 'issue' && DATA.qaIssues[0]) state.selected = { kind: 'issue', id: DATA.qaIssues[0].id };
      if (state.tab === 'code' && state.selected.kind !== 'file' && DATA.codeFiles[0]) state.selected = { kind: 'file', id: DATA.codeFiles[0].p };
      syncTabUI();
      syncHash(false);
      render();
      return;
    }
    const subEl = e.target.closest('[data-subtab]');
    if (subEl) {
      state.codeSubtab = subEl.dataset.subtab;
      syncHash(false);
      render();
      return;
    }
    if (e.target.id === 'btn-back') {
      window.history.back();
      return;
    }
    if (e.target.id === 'btn-fwd') {
      window.history.forward();
      return;
    }
    if (e.target.id === 'btn-copy-link') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(window.location.href).then(() => {
          e.target.textContent = 'Copied!';
          setTimeout(() => { e.target.textContent = 'Copy # Link'; }, 1200);
        }).catch(() => {});
      }
      return;
    }
    if (e.target.id === 'btn-open-graph') {
      state.tab = 'graph';
      syncTabUI();
      syncHash(false);
      render();
    }
  });

  window.addEventListener('hashchange', () => {
    if (applyHashFromLocation()) render();
  });

  document.getElementById('env-select').addEventListener('change', (e) => {
    state.env = e.target.value;
    syncSurfaceLinks();
    render();
  });
  document.getElementById('search-input').addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); render(); });
  document.getElementById('filter-domain').addEventListener('change', (e) => { state.domain = e.target.value; render(); });
  document.getElementById('filter-priority').addEventListener('change', (e) => { state.priority = e.target.value; render(); });
  document.getElementById('filter-stereotype').addEventListener('change', (e) => { state.stereotype = e.target.value; render(); });
  document.getElementById('filter-severity').addEventListener('change', (e) => { state.severity = e.target.value; render(); });
  document.getElementById('filter-status').addEventListener('change', (e) => { state.status = e.target.value; render(); });
  document.querySelectorAll('.layer-toggle input').forEach(cb => {
    cb.addEventListener('change', (e) => { state.layers[e.target.dataset.layer] = e.target.checked; render(); });
  });

  syncSurfaceLinks();
  if (!applyHashFromLocation()) {
    syncHash(true);
  }
  render();
})();
</script>
</body>
</html>
`;

  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf8');
  console.log(
    `Generated ${path.relative(REPO_ROOT, OUT_HTML)} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB; ${classes.length} classes, ${qaJourneys.length} journeys, ${qaIssues.length} issues, ${codeFiles.length} files).`,
  );
}

if (import.meta.main) {
  buildViewer();
}
