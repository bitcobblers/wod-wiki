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
  const bridgeRawByPred = new Map<string, number>();
  const bridgeDistinctByPred = new Map<string, Set<string>>();
  const emittedPredCounts = new Map<string, number>();

  for (const f of ['code-graph.ttl', 'qa-instances.ttl', 'bridge-instances.ttl']) {
    const triples = parseGeneratedTtl(path.join(GENERATED_DIR, f));
    store.addAll(triples);
    for (const t of triples) {
      emittedPredCounts.set(t.p, (emittedPredCounts.get(t.p) ?? 0) + 1);
      if (f === 'bridge-instances.ttl') {
        bridgeRawByPred.set(t.p, (bridgeRawByPred.get(t.p) ?? 0) + 1);
        const set = bridgeDistinctByPred.get(t.p) ?? new Set<string>();
        set.add(`${t.s}\0${t.p}\0${t.o}`);
        bridgeDistinctByPred.set(t.p, set);
      }
    }
  }

  const declaredPropMap = new Map(Object.values(ONTOLOGY_PROPERTIES).map((p) => [p.curie, p]));
  const builtinPreds = new Set(['rdf:type', 'rdfs:label', 'rdfs:comment', 'owl:equivalentClass']);
  const undeclaredEmitted = [...emittedPredCounts.entries()]
    .filter(([p]) => !declaredPropMap.has(p) && !builtinPreds.has(p))
    .map(([pred, count]) => ({ pred, count }))
    .sort((a, b) => b.count - a.count || a.pred.localeCompare(b.pred));

  const zeroEdgeProps = Object.values(ONTOLOGY_PROPERTIES)
    .filter((p) => (emittedPredCounts.get(p.curie) ?? 0) === 0)
    .map((p) => ({ curie: p.curie, kind: p.kind, domains: [...p.domains], ranges: [...p.ranges] }))
    .sort((a, b) => a.curie.localeCompare(b.curie));

  const duplicateBridgePreds = [...bridgeRawByPred.entries()]
    .map(([pred, raw]) => ({ pred, raw, distinct: bridgeDistinctByPred.get(pred)?.size ?? raw }))
    .filter((x) => x.raw > x.distinct)
    .sort((a, b) => (b.raw - b.distinct) - (a.raw - a.distinct) || a.pred.localeCompare(b.pred));

  const bridgeRawTotal = [...bridgeRawByPred.values()].reduce((a, b) => a + b, 0);
  const bridgeDistinctTotal = [...bridgeDistinctByPred.values()].reduce((a, s) => a + s.size, 0);

  const properties = Object.values(ONTOLOGY_PROPERTIES)
    .map((p) => ({
      curie: p.curie,
      kind: p.kind,
      label: p.label,
      comment: p.comment,
      domains: [...p.domains],
      ranges: [...p.ranges],
      emittedCount: emittedPredCounts.get(p.curie) ?? 0,
    }))
    .sort((a, b) => a.curie.localeCompare(b.curie));

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
      const stories = [
        ...new Set(store.vals(j, 'bridge:story').map((s) => store.val(s, 'code:storyId') ?? s.split('/').pop() ?? s)),
      ].sort();

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
        stories,
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
      const severity = store.val(i, 'qa:issueSeverity') ?? store.val(i, 'qa:severity') ?? 'medium';
      const kind = store.val(i, 'qa:kind') ?? 'defect';
      const status = store.val(i, 'qa:issueStatus') ?? store.val(i, 'qa:status') ?? 'open';
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

  const codeStories = store
    .subjectsWith('rdf:type', 'code:Story')
    .map((s) => {
      const id = store.val(s, 'code:storyId') ?? '';
      const stIri = `https://wod.wiki/qa/story/${id}`;
      const hasPlay = store.val(stIri, 'qa:hasPlayTest') === 'true';
      const steps = store
        .vals(stIri, 'qa:hasStep')
        .map((stepIri) => ({
          beat: (store.val(stepIri, 'qa:hasBeat') ?? '').replace(/^qa:/, ''),
          label: store.val(stepIri, 'rdfs:label') ?? '',
          order: Number(store.val(stepIri, 'qa:beatOrder') ?? 0),
        }))
        .sort((a, b) => a.order - b.order);
      const seedNouns = [...new Set(store.vals(stIri, 'bridge:seedNoun'))].sort();
      const testIds = [
        ...new Set(store.vals(stIri, 'bridge:testId').map((t) => store.val(t, 'code:testIdValue') ?? t)),
      ].sort();
      const touchedFiles = [
        ...new Set(
          store
            .vals(stIri, 'bridge:touches')
            .map((f) => store.val(f, 'code:filePath'))
            .filter((p): p is string => Boolean(p)),
        ),
      ].sort();
      const componentIri = store.val(s, 'code:storyComponent') ?? '';
      const component = componentIri ? (store.val(componentIri, 'code:symbolName') ?? '') : '';
      const journeys = [
        ...new Set([
          ...store.incoming(s, 'bridge:story').filter((t) => t.s.includes('/qa/journey/')).map((t) => store.val(t.s, 'qa:journeyId') ?? t.s),
          ...store.vals(stIri, 'qa:verifiesJourney').map((j) => store.val(j, 'qa:journeyId') ?? j),
        ]),
      ].sort();
      const classes = [
        ...new Set(
          store
            .incoming(s, 'bridge:story')
            .filter((t) => !t.s.includes('/qa/journey/') && !t.s.includes('/qa/story/'))
            .map((t) => t.s),
        ),
      ].sort();
      return {
        id,
        title: store.val(s, 'code:storyTitle') ?? '',
        name: store.val(s, 'code:storyName') ?? '',
        domainState: store.val(s, 'code:domainStatePreset') ?? '',
        file: store.val(store.val(s, 'code:definedIn') ?? '', 'code:filePath') ?? '',
        component,
        hasPlay,
        steps,
        seedNouns,
        testIds,
        touchedFiles,
        journeys,
        classes,
      };
    })
    .filter((s) => s.id)
    .sort((a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name));

  const payload = {
    stereotypes,
    classes,
    properties,
    metrics: Object.values(ONTOLOGY_METRICS).sort((a, b) => a.curie.localeCompare(b.curie)),
    qaDomains,
    qaRuns,
    qaJourneys,
    qaIssues,
    codeFiles,
    codeRoutes,
    codeTestIds,
    codeTools,
    codeStories,
    health: {
      bridgeRawTotal,
      bridgeDistinctTotal,
      duplicateBridgePreds,
      undeclaredEmitted,
      zeroEdgeProps,
    },
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
    color-scheme: dark light;
    --bg: #0b0e14; --panel: #121722; --panel2: #181f2e; --subbar: #0e131d; --listbg: #0d111a; --graphbg: #090c12;
    --hudbg: rgba(18,23,34,.9); --border: #263044; --rowline: rgba(38,48,68,.5);
    --text: #e5ecf4; --muted: #8b9bb4; --accent: #38bdf8;
    --c-patterns: #a78bfa; --c-domain: #34d399; --c-qa: #fbbf24;
    --c-code: #38bdf8; --c-bridge: #fb7185;
    --sev-high: #ef4444; --sev-high-text: #fca5a5; --sev-med: #f59e0b; --sev-med-text: #fcd34d; --sev-low: #64748b;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --bg: #f8fafc; --panel: #ffffff; --panel2: #f1f5f9; --subbar: #f1f5f9; --listbg: #f8fafc; --graphbg: #f1f5f9;
      --hudbg: rgba(255,255,255,.92); --border: #cbd5e1; --rowline: rgba(203,213,225,.6);
      --text: #0f172a; --muted: #475569; --accent: #0284c7;
      --c-patterns: #7c3aed; --c-domain: #059669; --c-qa: #d97706;
      --c-code: #0284c7; --c-bridge: #e11d48;
      --sev-high: #dc2626; --sev-high-text: #b91c1c; --sev-med: #d97706; --sev-med-text: #b45309; --sev-low: #64748b;
    }
  }
  :root[data-theme="light"] {
    --bg: #f8fafc; --panel: #ffffff; --panel2: #f1f5f9; --subbar: #f1f5f9; --listbg: #f8fafc; --graphbg: #f1f5f9;
    --hudbg: rgba(255,255,255,.92); --border: #cbd5e1; --rowline: rgba(203,213,225,.6);
    --text: #0f172a; --muted: #475569; --accent: #0284c7;
    --c-patterns: #7c3aed; --c-domain: #059669; --c-qa: #d97706;
    --c-code: #0284c7; --c-bridge: #e11d48;
    --sev-high: #dc2626; --sev-high-text: #b91c1c; --sev-med: #d97706; --sev-med-text: #b45309; --sev-low: #64748b;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); font-size: 13px; line-height: 1.45; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
  header { padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--panel); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
  header h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; }
  .pill { padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--panel2); font-size: 11px; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .layer-bar { padding: 8px 20px; border-bottom: 1px solid var(--border); background: var(--subbar); display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .layer-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel); cursor: pointer; font-size: 12px; user-select: none; }
  .layer-toggle input { accent-color: var(--accent); margin: 0; }
  .toolbar { padding: 10px 20px; border-bottom: 1px solid var(--border); background: var(--panel); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  input[type="search"], select { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 12px; }
  input[type="search"] { min-width: 260px; flex: 1; max-width: 420px; }
  .tabs { display: flex; gap: 4px; padding: 8px 20px 0; border-bottom: 1px solid var(--border); background: var(--panel); overflow-x: auto; }
  .tab { padding: 8px 14px; border: 1px solid transparent; border-bottom: none; border-radius: 6px 6px 0 0; cursor: pointer; color: var(--muted); background: transparent; font-size: 12px; font-weight: 500; white-space: nowrap; }
  .tab.active { background: var(--bg); color: var(--text); border-color: var(--border); }
  main { display: grid; grid-template-columns: 380px 1fr; height: calc(100vh - 178px); min-height: 480px; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; height: auto; } }
  .list-pane { border-right: 1px solid var(--border); overflow-y: auto; padding: 8px; background: var(--listbg); }
  .detail-pane { overflow-y: auto; padding: 18px 22px; }
  .card { padding: 9px 11px; border: 1px solid var(--border); border-radius: 7px; margin-bottom: 6px; background: var(--panel); cursor: pointer; transition: border-color .12s; }
  .card:hover, .card.selected { border-color: var(--accent); background: var(--panel2); }
  .card-title { font-weight: 600; font-size: 12.5px; display: flex; justify-content: space-between; gap: 6px; }
  .card-sub { color: var(--muted); font-size: 11px; margin-top: 3px; word-break: break-all; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10.5px; border: 1px solid var(--border); background: var(--panel2); color: var(--text); margin: 2px 3px 2px 0; }
  .badge.clickable { cursor: pointer; }
  .badge.clickable:hover { border-color: var(--accent); color: var(--accent); }
  .b-patterns { border-color: rgba(167,139,250,.45); color: var(--c-patterns); }
  .b-domain { border-color: rgba(52,211,153,.45); color: var(--c-domain); }
  .b-qa { border-color: rgba(251,191,36,.45); color: var(--c-qa); }
  .b-code { border-color: rgba(56,189,248,.45); color: var(--c-code); }
  .b-bridge { border-color: rgba(251,113,133,.45); color: var(--c-bridge); }
  .b-high { border-color: rgba(239,68,68,.5); color: var(--sev-high-text); }
  .b-med { border-color: rgba(245,158,11,.5); color: var(--sev-med-text); }
  .section { margin-bottom: 18px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
  .section h3 { margin: 0 0 10px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .beat-row { display: grid; grid-template-columns: 80px 1fr; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--rowline); }
  .beat-row:last-child { border-bottom: none; }
  .subtabs { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
  .subtab { padding: 4px 9px; border-radius: 5px; border: 1px solid var(--border); background: var(--panel); color: var(--muted); cursor: pointer; font-size: 11px; }
  .subtab.active { border-color: var(--accent); color: var(--text); background: var(--panel2); }
  .breadcrumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 12px; }
  .btn { padding: 4px 10px; border-radius: 5px; border: 1px solid var(--border); background: var(--panel2); color: var(--text); cursor: pointer; font-size: 11.5px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .ext-links { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }
  a.badge { text-decoration: none; }
  svg.graph { width: 100%; height: 540px; border: 1px solid var(--border); border-radius: 8px; background: var(--graphbg); display: block; cursor: grab; user-select: none; }
  svg.graph:active { cursor: grabbing; }
  .graph-fullscreen main { grid-template-columns: 0px 1fr; }
  .graph-fullscreen .list-pane { display: none; }
  .graph-controls { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
  .graph-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .picker-wrap { position: relative; flex: 1; min-width: 220px; }
  .picker-input { width: 100%; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 12px; }
  .picker-input:focus { outline: none; border-color: var(--accent); }
  .picker-dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 50; max-height: 260px; overflow-y: auto; background: var(--panel2); border: 1px solid var(--accent); border-radius: 6px; margin-top: 3px; box-shadow: 0 10px 28px rgba(0,0,0,.35); display: none; }
  .picker-dropdown.open { display: block; }
  .picker-item { padding: 6px 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; border-bottom: 1px solid var(--rowline); font-size: 12px; }
  .picker-item:last-child { border-bottom: none; }
  .picker-item:hover { background: rgba(56,189,248,.12); }
  .chip-bar { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg); color: var(--muted); font-size: 11px; cursor: pointer; user-select: none; }
  .chip.active { background: var(--panel2); color: var(--text); border-color: var(--accent); }
  .chip:hover { border-color: var(--accent); }
  .graph-stage { position: relative; }
  .graph-hud { position: absolute; top: 10px; right: 10px; display: flex; gap: 4px; z-index: 10; }
  .graph-hud .btn { background: var(--hudbg); backdrop-filter: blur(4px); }
  .graph-legend { position: absolute; bottom: 10px; left: 10px; display: flex; flex-wrap: wrap; gap: 8px; padding: 5px 9px; border-radius: 6px; background: var(--hudbg); border: 1px solid var(--border); font-size: 10.5px; color: var(--muted); pointer-events: none; }
  .graph-grid { display: grid; grid-template-columns: 1fr 340px; gap: 12px; align-items: start; }
  @media (max-width: 1200px) { .graph-grid { grid-template-columns: 1fr; } }
  .path-item { padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 5px; background: var(--bg); cursor: pointer; font-size: 11.5px; }
  .path-item:hover, .path-item.active { border-color: var(--accent); background: var(--panel2); }
  .cockpit-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin-bottom: 16px; }
  .stat-card { padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
  .stat-num { font-size: 22px; font-weight: 700; margin: 4px 0; }
  .family-header { display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; border: 1px solid var(--border); border-radius: 7px; margin-bottom: 5px; background: var(--panel2); cursor: pointer; font-weight: 600; font-size: 12px; }
  .family-members { padding-left: 10px; border-left: 2px solid var(--border); margin-bottom: 8px; }
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
    <select id="theme-select" title="Color theme (defaults to OS/system preference)">
      <option value="system">Theme: System</option>
      <option value="dark">Theme: Dark</option>
      <option value="light">Theme: Light</option>
    </select>
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
    <option value="Critical">Critical</option>
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
  <button class="tab active" data-tab="overview">Overview &amp; Health</button>
  <button class="tab" data-tab="journeys">Journeys &amp; 5-Beat Flows</button>
  <button class="tab" data-tab="domain">Domain &amp; Patterns</button>
  <button class="tab" data-tab="code">Code &amp; Reverse Lookup</button>
  <button class="tab" data-tab="issues">Issues &amp; Provenance</button>
  <button class="tab" data-tab="graph">Interactive Graph &amp; Path Explorer</button>
</div>
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
  const storyById = new Map((DATA.codeStories || []).map(s => [s.id, s]));

  const storiesByFile = new Map();
  const storiesByClass = new Map();
  for (const s of DATA.codeStories || []) {
    if (s.file) {
      if (!storiesByFile.has(s.file)) storiesByFile.set(s.file, []);
      storiesByFile.get(s.file).push(s);
    }
    for (const c of s.classes || []) {
      if (!storiesByClass.has(c)) storiesByClass.set(c, []);
      storiesByClass.get(c).push(s);
    }
  }

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

  const ALIAS_TO_CANONICAL = {
    'wod:Session': 'wod:SessionRecord',
    'wod:Query': 'wod:WQLQuery',
    'wod:FieldValue': 'wod:FieldValueRecord',
  };
  const CANONICAL_TO_ALIAS = {
    'wod:SessionRecord': 'wod:Session',
    'wod:WQLQuery': 'wod:Query',
    'wod:FieldValueRecord': 'wod:FieldValue',
  };
  const PROJECTION_PREDS = new Set(['wod:hasTag', 'wod:placedOn', 'wod:hasEvent']);
  const VERB_FAMILY_PARENTS = new Set(['wod:RuntimeAction', 'wod:Activity', 'qa:Beat']);

  const incomingPropsByClass = new Map();
  for (const c of DATA.classes) {
    for (const p of c.props || []) {
      if (p.kind === 'object' && p.range) {
        if (!incomingPropsByClass.has(p.range)) incomingPropsByClass.set(p.range, []);
        incomingPropsByClass.get(p.range).push({ from: c.curie, curie: p.curie, isProjection: PROJECTION_PREDS.has(p.curie) });
      }
    }
  }

  let savedTheme = 'system';
  try { savedTheme = localStorage.getItem('wod-ontology-theme') || 'system'; } catch {}

  const state = {
    tab: 'overview',
    codeSubtab: 'files',
    domainSimplify: true,
    expandedFamilies: new Set(),
    theme: savedTheme,
    search: '',
    domain: '',
    priority: '',
    stereotype: '',
    severity: '',
    status: '',
    env: 'auto',
    layers: { patterns: true, domain: true, qa: true, code: true, bridge: true },
    selected: { kind: 'journey', id: DATA.qaJourneys[0]?.id || '' },
    graph: {
      mode: 'neighborhood', // 'neighborhood' | 'path'
      from: { kind: 'journey', id: DATA.qaJourneys[0]?.id || '' },
      to: { kind: 'stereotype', id: DATA.stereotypes[0] || 'ufo:Kind' },
      hops: 1,              // 1 | 2 for neighborhood
      pathBudget: 'plus1',  // 'shortest' | 'plus1' | 'plus2' | 'max4' | 'max5' | 'max6'
      enabledKinds: {
        stereotype: true, class: true, journey: true, issue: true,
        story: true, testFile: true, sourceFile: true, route: true, testid: true, tool: true
      },
      disabledPreds: new Set(),
      nodeFilter: '',
      nodeFilterMode: 'highlight', // 'highlight' | 'isolate'
      inspectedKey: '',
      activePathIdx: -1,
      fullscreen: false,
      showAllNodes: false,
      panX: 0, panY: 0, zoom: 1,
      customPos: {}
    }
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
    if (kind === 'class' || kind === 'stereotype') return 'domain';
    if (kind === 'file' || kind === 'story') return 'code';
    if (kind === 'issue') return 'issues';
    if (kind === 'route' || kind === 'testid' || kind === 'tool') return 'graph';
    return 'journeys';
  }

  const VALID_TABS = new Set(['overview', 'journeys', 'domain', 'code', 'issues', 'graph']);
  const VALID_SUBTABS = new Set(['files', 'stories', 'routes', 'testids', 'webmcp']);
  const VALID_KINDS = new Set(['journey', 'class', 'stereotype', 'file', 'issue', 'story', 'route', 'testid', 'tool']);
  const LAYER_NAMES = ['patterns', 'domain', 'qa', 'code', 'bridge'];
  const KIND_BUCKETS = ['stereotype', 'class', 'journey', 'issue', 'story', 'testFile', 'sourceFile', 'route', 'testid', 'tool'];
  const VALID_BUDGETS = new Set(['shortest', 'plus1', 'plus2', 'max4', 'max5', 'max6']);

  function buildHash(kind, id, tab, codeSubtab) {
    const encodedId = kind === 'file'
      ? id.split('/').map(encodeURIComponent).join('/')
      : encodeURIComponent(id);
    const params = new URLSearchParams();
    if (tab && tab !== defaultTabForKind(kind)) params.set('tab', tab);
    if (tab === 'code' && codeSubtab && codeSubtab !== 'files') params.set('sub', codeSubtab);

    const enabledLayers = LAYER_NAMES.filter(l => state.layers[l]);
    if (enabledLayers.length === 0) {
      params.set('layers', 'none');
    } else if (enabledLayers.length < LAYER_NAMES.length) {
      params.set('layers', enabledLayers.join(','));
    }

    if (tab === 'graph') {
      const g = state.graph;
      if (g.mode !== 'neighborhood') params.set('gmode', g.mode);
      if (g.mode === 'path' && g.to?.id) {
        params.set('to', g.to.kind + ':' + g.to.id);
      }
      if (g.hops !== 1) params.set('hops', String(g.hops));
      const disabledKinds = KIND_BUCKETS.filter(k => !g.enabledKinds[k]);
      if (disabledKinds.length === KIND_BUCKETS.length) {
        params.set('kinds', 'none');
      } else if (disabledKinds.length > 0) {
        if (disabledKinds.length <= KIND_BUCKETS.length / 2) {
          params.set('kinds', disabledKinds.map(k => '-' + k).join(','));
        } else {
          const enabledKinds = KIND_BUCKETS.filter(k => g.enabledKinds[k]);
          params.set('kinds', enabledKinds.join(','));
        }
      }
      if (g.disabledPreds.size > 0) {
        params.set('preds', [...g.disabledPreds].sort().map(p => '-' + p).join(','));
      }
      if (g.nodeFilter) params.set('nf', g.nodeFilter);
      if (g.nodeFilterMode !== 'highlight') params.set('nfmode', g.nodeFilterMode);
      if (g.pathBudget !== 'plus1') params.set('budget', g.pathBudget);
      if (g.activePathIdx >= 0) params.set('path', String(g.activePathIdx));
      if (g.fullscreen) params.set('fs', '1');
    }

    if (state.search) params.set('q', state.search);
    if (state.domain) params.set('dom', state.domain);
    if (state.priority) params.set('pri', state.priority);
    if (state.stereotype) params.set('st', state.stereotype);
    if (state.severity) params.set('sev', state.severity);
    if (state.status) params.set('stat', state.status);

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
    if (!VALID_KINDS.has(kind)) return null;
    let id = '';
    try {
      id = kind === 'file'
        ? parts.slice(1).map(decodeURIComponent).join('/')
        : decodeURIComponent(parts.slice(1).join('/'));
    } catch {
      id = parts.slice(1).join('/');
    }
    const params = new URLSearchParams(qs || '');
    return {
      kind,
      id,
      tab: params.get('tab'),
      sub: params.get('sub'),
      gmode: params.get('gmode'),
      to: params.get('to'),
      layers: params.get('layers'),
      kinds: params.get('kinds'),
      preds: params.get('preds'),
      hops: params.get('hops'),
      nf: params.get('nf'),
      nfmode: params.get('nfmode'),
      budget: params.get('budget'),
      path: params.get('path'),
      fs: params.get('fs'),
      q: params.get('q'),
      dom: params.get('dom'),
      pri: params.get('pri'),
      st: params.get('st'),
      sev: params.get('sev'),
      stat: params.get('stat')
    };
  }

  function syncHash(replace) {
    const activeRef = state.tab === 'graph' ? state.graph.from : state.selected;
    const next = buildHash(activeRef.kind, activeRef.id, state.tab, state.codeSubtab);
    if (window.location.hash !== next) {
      if (replace && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', next);
      } else {
        window.location.hash = next;
      }
    }
  }

  function syncFilterInputsUI() {
    document.querySelectorAll('.layer-toggle input').forEach(cb => {
      const l = cb.dataset.layer;
      if (l && l in state.layers) cb.checked = Boolean(state.layers[l]);
    });
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('search-input', state.search);
    setVal('filter-domain', state.domain);
    setVal('filter-priority', state.priority);
    setVal('filter-stereotype', state.stereotype);
    setVal('filter-severity', state.severity);
    setVal('filter-status', state.status);
  }

  function applyHashFromLocation() {
    const parsed = parseHash(window.location.hash);
    if (!parsed) {
      if (window.location.hash) {
        console.warn('Invalid deep-link hash ignored:', window.location.hash);
        syncHash(true);
      }
      return false;
    }
    state.selected = { kind: parsed.kind, id: parsed.id };
    state.graph.from = { kind: parsed.kind, id: parsed.id };
    if (parsed.tab) {
      if (VALID_TABS.has(parsed.tab)) {
        state.tab = parsed.tab;
      } else {
        console.warn('Unknown tab in deep link:', parsed.tab);
        state.tab = defaultTabForKind(parsed.kind);
      }
    } else {
      state.tab = defaultTabForKind(parsed.kind);
    }

    if (parsed.sub) {
      if (VALID_SUBTABS.has(parsed.sub)) state.codeSubtab = parsed.sub;
      else {
        console.warn('Unknown code subtab in deep link:', parsed.sub);
        state.codeSubtab = parsed.kind === 'story' ? 'stories' : 'files';
      }
    } else if (parsed.kind === 'file') {
      state.codeSubtab = 'files';
    } else if (parsed.kind === 'story') {
      state.codeSubtab = 'stories';
    }

    if (parsed.layers !== null) {
      const nextLayers = {};
      LAYER_NAMES.forEach(l => { nextLayers[l] = false; });
      if (parsed.layers !== 'none') {
        parsed.layers.split(',').map(s => s.trim()).filter(Boolean).forEach(l => {
          if (l in nextLayers) nextLayers[l] = true;
          else console.warn('Unknown layer in deep link:', l);
        });
      }
      state.layers = nextLayers;
    } else {
      LAYER_NAMES.forEach(l => { state.layers[l] = true; });
    }

    if (parsed.gmode === 'path' || parsed.gmode === 'neighborhood') state.graph.mode = parsed.gmode;
    if (parsed.to) {
      const idx = parsed.to.indexOf(':');
      if (idx > 0) {
        const toKind = parsed.to.slice(0, idx);
        const toId = parsed.to.slice(idx + 1);
        if (VALID_KINDS.has(toKind)) state.graph.to = { kind: toKind, id: toId };
        else console.warn('Unknown target kind in deep link:', toKind);
      }
    }

    if (parsed.hops !== null) {
      const h = Number(parsed.hops);
      state.graph.hops = h === 2 ? 2 : 1;
    }

    if (parsed.kinds !== null) {
      const tokens = parsed.kinds.split(',').map(s => s.trim()).filter(Boolean);
      const isDelta = tokens.some(t => t.startsWith('-'));
      if (parsed.kinds === 'none') {
        KIND_BUCKETS.forEach(k => { state.graph.enabledKinds[k] = false; });
      } else if (isDelta) {
        KIND_BUCKETS.forEach(k => { state.graph.enabledKinds[k] = true; });
        tokens.forEach(t => {
          const k = t.startsWith('-') ? t.slice(1) : t;
          if (k in state.graph.enabledKinds) state.graph.enabledKinds[k] = false;
          else console.warn('Unknown node kind in deep link:', k);
        });
      } else {
        KIND_BUCKETS.forEach(k => { state.graph.enabledKinds[k] = false; });
        tokens.forEach(k => {
          if (k in state.graph.enabledKinds) state.graph.enabledKinds[k] = true;
          else console.warn('Unknown node kind in deep link:', k);
        });
      }
    } else {
      KIND_BUCKETS.forEach(k => { state.graph.enabledKinds[k] = true; });
    }

    state.graph.disabledPreds.clear();
    if (parsed.preds !== null) {
      parsed.preds.split(',').map(s => s.trim()).filter(Boolean).forEach(t => {
        const p = t.startsWith('-') ? t.slice(1) : t;
        if (p) state.graph.disabledPreds.add(p);
      });
    }

    if (parsed.nf !== null) state.graph.nodeFilter = parsed.nf;
    if (parsed.nfmode === 'highlight' || parsed.nfmode === 'isolate') state.graph.nodeFilterMode = parsed.nfmode;
    if (parsed.budget && VALID_BUDGETS.has(parsed.budget)) state.graph.pathBudget = parsed.budget;
    if (parsed.path !== null) {
      const pi = Number(parsed.path);
      state.graph.activePathIdx = Number.isInteger(pi) && pi >= 0 ? pi : -1;
    }
    state.graph.fullscreen = parsed.fs === '1' || parsed.fs === 'true';

    if (parsed.q !== null) state.search = parsed.q.toLowerCase();
    if (parsed.dom !== null) state.domain = parsed.dom;
    if (parsed.pri !== null) state.priority = parsed.pri;
    if (parsed.st !== null) state.stereotype = parsed.st;
    if (parsed.sev !== null) state.severity = parsed.sev;
    if (parsed.stat !== null) state.status = parsed.stat;

    syncFilterInputsUI();
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

  function codeJumpLinks(filePath, lineHint, labelPrefix) {
    if (!filePath) return '';
    const line = Number(lineHint) > 0 ? Number(lineHint) : 1;
    const ghHref = \`https://github.com/bitcobblers/wod-wiki/blob/main/\${filePath}#L\${line}\`;
    const ghLabel = labelPrefix ? \`\${labelPrefix} ↗\` : 'GitHub ↗';
    let vsLink = '';
    if (window.location.protocol === 'file:') {
      const repoRoot = decodeURIComponent(window.location.pathname).replace(/\\/ontology\\/generated\\/explorer\\.html$/i, '');
      if (repoRoot) {
        const vsHref = \`vscode://file\${repoRoot}/\${filePath}:\${line}\`;
        vsLink = \`<a class="btn" href="\${esc(vsHref)}" title="Open in VS Code at line \${line}">VS Code ↗</a>\`;
      }
    }
    return \`\${vsLink}<a class="btn" href="\${esc(ghHref)}" target="_blank" rel="noopener noreferrer" title="View on GitHub at line \${line}">\${esc(ghLabel)}</a>\`;
  }

  // Stats bar
  document.getElementById('stats-bar').innerHTML = [
    \`<span class="pill"><span class="dot" style="background:var(--c-patterns)"></span>\${DATA.stereotypes.length} UFO stereotypes</span>\`,
    \`<span class="pill"><span class="dot" style="background:var(--c-domain)"></span>\${DATA.classes.length} classes</span>\`,
    \`<span class="pill"><span class="dot" style="background:var(--c-qa)"></span>\${DATA.qaJourneys.length} journeys · \${DATA.qaIssues.length} issues · \${DATA.qaRuns.length} runs</span>\`,
    \`<span class="pill"><span class="dot" style="background:var(--c-code)"></span>\${DATA.codeFiles.length} files · \${DATA.codeStories.length} stories · \${DATA.codeTestIds.length} testIds · \${DATA.codeTools.length} tools</span>\`
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
      if (kind === 'story') state.codeSubtab = 'stories';
    }
    if (state.tab === 'graph') {
      if (state.graph.mode === 'neighborhood') {
        state.graph.from = { kind, id };
        state.graph.customPos = {};
        state.graph.panX = 0; state.graph.panY = 0; state.graph.zoom = 1;
      }
      state.graph.inspectedKey = kind + ':' + id;
    }
    syncTabUI();
    syncHash(false);
    render();
  }

  function syncTabUI() {
    document.querySelectorAll('#main-tabs .tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === state.tab);
    });
    document.body.classList.toggle('graph-fullscreen', state.tab === 'graph' && state.graph.fullscreen);
  }

  function matchSearch(haystack) {
    if (!state.search) return true;
    return haystack.toLowerCase().includes(state.search);
  }

  // --- Unified Graph Index ---
  const graphNodes = new Map();
  const graphEdges = [];
  const graphEdgeKeys = new Set();
  const graphAdj = new Map();

  function addGraphNode(kind, id, label, sublabel, layer, isTest) {
    if (!id) return null;
    const key = kind + ':' + id;
    if (!graphNodes.has(key)) {
      graphNodes.set(key, {
        key, kind, id,
        label: label || id,
        sublabel: sublabel || '',
        layer,
        isTest: Boolean(isTest),
        searchText: (kind + ' ' + id + ' ' + (label || '') + ' ' + (sublabel || '')).toLowerCase()
      });
      graphAdj.set(key, []);
    }
    return key;
  }

  function addGraphEdge(fromKey, toKey, pred, layer, detail, isProjection) {
    if (!fromKey || !toKey || fromKey === toKey) return;
    const ek = fromKey + '|' + toKey + '|' + pred + '|' + (detail || '');
    if (graphEdgeKeys.has(ek)) return;
    graphEdgeKeys.add(ek);
    const idx = graphEdges.length;
    graphEdges.push({ idx, from: fromKey, to: toKey, pred, layer, detail: detail || '', isProjection: Boolean(isProjection) });
    graphAdj.get(fromKey).push({ edgeIdx: idx, neighbor: toKey });
    graphAdj.get(toKey).push({ edgeIdx: idx, neighbor: fromKey });
  }

  (function buildGraphIndex() {
    for (const s of DATA.stereotypes) {
      addGraphNode('stereotype', s, s, 'UFO Pattern', 'patterns', false);
    }
    for (const c of DATA.classes) {
      const ck = addGraphNode('class', c.curie, c.curie, c.label + ' (' + c.module + ')', 'domain', false);
      if (c.stereotype) {
        const sk = addGraphNode('stereotype', c.stereotype, c.stereotype, 'UFO Pattern', 'patterns', false);
        addGraphEdge(ck, sk, 'stereotype', 'patterns');
      }
    }
    for (const c of DATA.classes) {
      const ck = 'class:' + c.curie;
      for (const sc of c.superClasses || []) {
        if (graphNodes.has('class:' + sc)) {
          addGraphEdge(ck, 'class:' + sc, 'subClassOf', 'domain');
        }
      }
      for (const p of c.props || []) {
        if (p.kind === 'object' && p.range && graphNodes.has('class:' + p.range)) {
          addGraphEdge(ck, 'class:' + p.range, 'domainProp', 'domain', p.curie, PROJECTION_PREDS.has(p.curie));
        }
      }
    }
    for (const f of DATA.codeFiles) {
      const fk = addGraphNode('file', f.p, f.p.split('/').pop(), f.p, 'code', f.isTest);
      for (const sym of f.syms || []) {
        for (const d of sym.d || []) {
          const ck = 'class:' + d;
          if (graphNodes.has(ck)) {
            addGraphEdge(fk, ck, 'implements', 'bridge', sym.n + (sym.l ? ':' + sym.l : ''));
          }
        }
      }
      for (const tid of f.tids || []) {
        const tk = addGraphNode('testid', tid, tid, 'TEST_ID', 'code', false);
        addGraphEdge(fk, tk, 'usesTestId', 'code');
      }
    }
    for (const r of DATA.codeRoutes) {
      addGraphNode('route', r.path, r.path, r.name || 'Route', 'code', false);
    }
    for (const t of DATA.codeTestIds) {
      addGraphNode('testid', t.val, t.val, t.key || 'TEST_ID', 'code', false);
    }
    for (const w of DATA.codeTools) {
      const wk = addGraphNode('tool', w.name, w.name, w.title || w.cli, 'code', false);
      if (w.file) {
        const fk = addGraphNode('file', w.file, w.file.split('/').pop(), w.file, 'code', false);
        addGraphEdge(wk, fk, 'definedIn', 'code');
      }
    }
    for (const st of DATA.codeStories || []) {
      const sk = addGraphNode('story', st.id, st.title + ' / ' + st.name, st.id, 'code', st.hasPlay);
      if (st.file) {
        const fk = addGraphNode('file', st.file, st.file.split('/').pop(), st.file, 'code', true);
        addGraphEdge(sk, fk, 'definedIn', 'code');
      }
      for (const sn of st.seedNouns || []) {
        if (graphNodes.has('class:' + sn)) addGraphEdge(sk, 'class:' + sn, 'seedNoun', 'bridge');
      }
      for (const tf of st.touchedFiles || []) {
        const fk = addGraphNode('file', tf, tf.split('/').pop(), tf, 'code', false);
        addGraphEdge(sk, fk, 'touches', 'bridge');
      }
      for (const tid of st.testIds || []) {
        const tk = addGraphNode('testid', tid, tid, 'TEST_ID', 'code', false);
        addGraphEdge(sk, tk, 'testId', 'bridge');
      }
      for (const cl of st.classes || []) {
        if (graphNodes.has('class:' + cl)) addGraphEdge(sk, 'class:' + cl, 'storyClass', 'bridge');
      }
    }
    for (const j of DATA.qaJourneys) {
      const jk = addGraphNode('journey', j.id, j.id + ' — ' + j.title, j.domain + ' · ' + j.priority, 'qa', false);
      if (j.specFile) {
        const fk = addGraphNode('file', j.specFile, j.specFile.split('/').pop(), j.specFile, 'code', true);
        addGraphEdge(jk, fk, 'specFile', 'bridge');
      }
      if (j.pwSpec) {
        const fk = addGraphNode('file', j.pwSpec, j.pwSpec.split('/').pop(), j.pwSpec, 'code', true);
        addGraphEdge(jk, fk, 'playwrightSpec', 'bridge');
      }
      for (const sn of j.seedNouns || []) {
        if (graphNodes.has('class:' + sn)) addGraphEdge(jk, 'class:' + sn, 'seedNoun', 'bridge');
      }
      for (const tf of j.touchedFiles || []) {
        const fk = addGraphNode('file', tf, tf.split('/').pop(), tf, 'code', false);
        addGraphEdge(jk, fk, 'touches', 'bridge');
      }
      for (const r of j.routes || []) {
        const rk = addGraphNode('route', r, r, 'Route', 'code', false);
        addGraphEdge(jk, rk, 'route', 'bridge');
      }
      for (const tid of j.testIds || []) {
        const tk = addGraphNode('testid', tid, tid, 'TEST_ID', 'code', false);
        addGraphEdge(jk, tk, 'testId', 'bridge');
      }
      for (const sid of j.stories || []) {
        const sk = 'story:' + sid;
        if (graphNodes.has(sk)) addGraphEdge(jk, sk, 'story', 'bridge');
      }
    }
    for (const iss of DATA.qaIssues) {
      const ik = addGraphNode('issue', iss.id, iss.id, iss.title, 'qa', false);
      for (const jid of iss.coveredBy || []) {
        const jk = 'journey:' + jid;
        if (graphNodes.has(jk)) addGraphEdge(ik, jk, 'coveredBy', 'qa');
      }
      for (const rc of iss.rootCauses || []) {
        if (rc.file) {
          const fk = addGraphNode('file', rc.file, rc.file.split('/').pop(), rc.file, 'code', false);
          addGraphEdge(ik, fk, 'rootCause', 'bridge', (rc.symbol || '') + (rc.lineHint ? ':' + rc.lineHint : ''));
        }
      }
    }
  })();

  const allGraphNodesSorted = [...graphNodes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));

  function nodeKindBucket(node) {
    if (node.kind === 'file') return node.isTest ? 'testFile' : 'sourceFile';
    return node.kind;
  }

  function isNodeAllowed(node, anchorA, anchorB) {
    if (!state.layers[node.layer]) return false;
    if (node.key === anchorA || node.key === anchorB) return true;
    return Boolean(state.graph.enabledKinds[nodeKindBucket(node)]);
  }

  function isEdgeAllowed(edge, anchorA, anchorB, ignorePredFilter) {
    if (!state.layers[edge.layer]) return false;
    if (!ignorePredFilter && state.graph.disabledPreds.has(edge.pred)) return false;
    const n1 = graphNodes.get(edge.from);
    const n2 = graphNodes.get(edge.to);
    if (!n1 || !n2) return false;
    return isNodeAllowed(n1, anchorA, anchorB) && isNodeAllowed(n2, anchorA, anchorB);
  }

  function bfsDistances(startKey, maxDepth, anchorA, anchorB, ignorePredFilter) {
    const dist = new Map();
    if (!startKey || !graphNodes.has(startKey)) return dist;
    dist.set(startKey, 0);
    const q = [startKey];
    let head = 0;
    while (head < q.length) {
      const u = q[head++];
      const d = dist.get(u);
      if (d >= maxDepth) continue;
      for (const adj of graphAdj.get(u) || []) {
        const edge = graphEdges[adj.edgeIdx];
        if (!isEdgeAllowed(edge, anchorA, anchorB, ignorePredFilter)) continue;
        if (!dist.has(adj.neighbor)) {
          dist.set(adj.neighbor, d + 1);
          q.push(adj.neighbor);
        }
      }
    }
    return dist;
  }

  function computeGraphSubgraph() {
    const g = state.graph;
    const fromKey = g.from.kind + ':' + g.from.id;
    const toKey = g.mode === 'path' ? (g.to.kind + ':' + g.to.id) : '';

    // First pass: discover available predicates & kinds with layers only (for filter chips)
    const kindCounts = {};
    const predCounts = {};
    const nodeKeys = new Set();
    const edgeList = [];
    const distA = new Map();
    let minDist = null;
    let maxLen = 0;
    let concretePaths = [];

    if (g.mode === 'neighborhood') {
      const dMap = bfsDistances(fromKey, g.hops, fromKey, '', false);
      for (const [k, d] of dMap.entries()) {
        nodeKeys.add(k);
        distA.set(k, d);
      }
      for (const e of graphEdges) {
        if (!nodeKeys.has(e.from) || !nodeKeys.has(e.to)) continue;
        if (!isEdgeAllowed(e, fromKey, '', true)) continue;
        predCounts[e.pred] = (predCounts[e.pred] || 0) + 1;
        if (!g.disabledPreds.has(e.pred)) edgeList.push(e);
      }
      for (const k of nodeKeys) {
        const b = nodeKindBucket(graphNodes.get(k));
        kindCounts[b] = (kindCounts[b] || 0) + 1;
      }
    } else {
      const dA = bfsDistances(fromKey, 6, fromKey, toKey, false);
      const dB = bfsDistances(toKey, 6, fromKey, toKey, false);
      minDist = dA.get(toKey);
      if (minDist !== undefined) {
        if (g.pathBudget === 'shortest') maxLen = minDist;
        else if (g.pathBudget === 'plus1') maxLen = minDist + 1;
        else if (g.pathBudget === 'plus2') maxLen = minDist + 2;
        else if (g.pathBudget === 'max4') maxLen = 4;
        else if (g.pathBudget === 'max5') maxLen = 5;
        else maxLen = 6;

        for (const [k, da] of dA.entries()) {
          const db = dB.get(k);
          if (db !== undefined && da + db <= maxLen) {
            nodeKeys.add(k);
            distA.set(k, da);
          }
        }
        for (const e of graphEdges) {
          if (!nodeKeys.has(e.from) || !nodeKeys.has(e.to)) continue;
          if (!isEdgeAllowed(e, fromKey, toKey, true)) continue;
          const d1 = dA.get(e.from) + 1 + dB.get(e.to);
          const d2 = dB.get(e.from) + 1 + dA.get(e.to);
          if (Math.min(d1, d2) <= maxLen) {
            predCounts[e.pred] = (predCounts[e.pred] || 0) + 1;
            if (!g.disabledPreds.has(e.pred)) edgeList.push(e);
          }
        }
        // Re-prune any isolated intermediate nodes if predicates were disabled
        if (g.disabledPreds.size > 0) {
          const conn = new Set([fromKey, toKey]);
          for (const e of edgeList) { conn.add(e.from); conn.add(e.to); }
          for (const k of [...nodeKeys]) { if (!conn.has(k)) nodeKeys.delete(k); }
        }
        for (const k of nodeKeys) {
          const b = nodeKindBucket(graphNodes.get(k));
          kindCounts[b] = (kindCounts[b] || 0) + 1;
        }
        // Extract up to 25 concrete simple paths on the induced subgraph
        const subAdj = new Map();
        for (const k of nodeKeys) subAdj.set(k, []);
        for (const e of edgeList) {
          subAdj.get(e.from).push({ to: e.to, edge: e });
          subAdj.get(e.to).push({ to: e.from, edge: e });
        }
        const bfsQ = [{ nodes: [fromKey], edges: [] }];
        while (bfsQ.length && concretePaths.length < 25) {
          const cur = bfsQ.shift();
          const last = cur.nodes[cur.nodes.length - 1];
          if (cur.edges.length >= maxLen) continue;
          for (const step of subAdj.get(last) || []) {
            if (cur.nodes.includes(step.to)) continue;
            const nextNodes = [...cur.nodes, step.to];
            const nextEdges = [...cur.edges, step.edge];
            if (step.to === toKey) {
              concretePaths.push({ nodes: nextNodes, edges: nextEdges });
              if (concretePaths.length >= 25) break;
            } else if (nextEdges.length < maxLen) {
              bfsQ.push({ nodes: nextNodes, edges: nextEdges });
            }
          }
        }
      }
    }

    // Optional in-graph node text filter
    const nf = (g.nodeFilter || '').trim().toLowerCase();
    const matchedKeys = new Set();
    if (nf) {
      for (const k of nodeKeys) {
        if (graphNodes.get(k).searchText.includes(nf)) matchedKeys.add(k);
      }
      if (g.nodeFilterMode === 'isolate') {
        const keep = new Set([fromKey]);
        if (toKey) keep.add(toKey);
        for (const k of matchedKeys) keep.add(k);
        // Also keep immediate neighbors on edges touching matchedKeys
        for (const e of edgeList) {
          if (matchedKeys.has(e.from) || matchedKeys.has(e.to)) {
            keep.add(e.from); keep.add(e.to);
          }
        }
        for (const k of [...nodeKeys]) { if (!keep.has(k)) nodeKeys.delete(k); }
      }
    }

    const totalNodes = nodeKeys.size;
    let truncated = false;
    let finalKeys = [...nodeKeys];
    const cap = g.showAllNodes ? 600 : 120;
    if (finalKeys.length > cap) {
      truncated = true;
      // Keep anchors first, then sort by degree/dist
      finalKeys.sort((a, b) => {
        if (a === fromKey || a === toKey) return -1;
        if (b === fromKey || b === toKey) return 1;
        return (distA.get(a) ?? 99) - (distA.get(b) ?? 99);
      });
      finalKeys = finalKeys.slice(0, cap);
    }
    const finalSet = new Set(finalKeys);
    const finalEdges = edgeList.filter(e => finalSet.has(e.from) && finalSet.has(e.to));

    return {
      fromKey, toKey,
      nodes: finalKeys.map(k => graphNodes.get(k)),
      edges: finalEdges,
      distA, minDist, maxLen,
      kindCounts, predCounts,
      matchedKeys, totalNodes, truncated,
      concretePaths
    };
  }

  function renderList() {
    const el = document.getElementById('list-pane');
    if (state.tab === 'overview') {
      const terms = [];
      for (const s of DATA.stereotypes) terms.push({ kind: 'stereotype', id: s, badgeCls: 'b-patterns', tag: 'UFO Pattern', sub: ':patterns' });
      for (const c of DATA.classes) {
        const aka = CANONICAL_TO_ALIAS[c.curie];
        terms.push({
          kind: 'class', id: c.curie, badgeCls: 'b-domain',
          tag: c.stereotype || c.module,
          sub: (aka ? 'aka ' + aka + ' · ' : '') + c.label
        });
      }
      for (const p of DATA.properties || []) {
        terms.push({
          kind: 'class', id: p.domains[0] || DATA.classes[0]?.curie || '',
          badgeCls: p.kind === 'object' ? 'b-bridge' : 'b-code',
          tag: p.kind,
          sub: (p.domains[0] || '—') + ' → ' + (p.ranges[0] || '—'),
          display: p.curie
        });
      }
      terms.sort((a, b) => (a.display || a.id).localeCompare(b.display || b.id));
      const filtered = terms.filter(t => matchSearch((t.display || t.id) + ' ' + t.tag + ' ' + t.sub)).slice(0, 260);
      el.innerHTML = \`<div style="padding:4px 4px 8px;color:var(--muted);font-size:11px;">Alphabetical Term Index (\${terms.length} terms · click to jump)</div>\` +
        (filtered.map(t => \`
          <div class="card" data-nav-kind="\${esc(t.kind)}" data-nav-id="\${esc(t.id)}">
            <div class="card-title"><span class="mono">\${esc(t.display || t.id)}</span><span class="badge \${t.badgeCls}">\${esc(t.tag)}</span></div>
            <div class="card-sub">\${esc(t.sub)}</div>
          </div>\`).join('') || '<div class="card-sub">No matching terms.</div>');
    } else if (state.tab === 'journeys') {
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
      if (!state.layers.domain && !state.layers.patterns) { el.innerHTML = '<div class="card-sub">Layers :domain and :patterns are hidden.</div>'; return; }
      const simplifyBar = \`<label class="layer-toggle" style="width:100%;margin-bottom:8px;justify-content:space-between;">
        <span>Simplify (collapse aliases &amp; verb families)</span>
        <input type="checkbox" id="chk-domain-simplify" \${state.domainSimplify ? 'checked' : ''} />
      </label>\`;
      const patCards = state.layers.patterns ? DATA.stereotypes.filter(s => matchSearch(s + ' ufo pattern')).map(s => {
        const cnt = DATA.classes.filter(c => c.stereotype === s).length;
        return \`<div class="card \${state.selected.kind === 'stereotype' && state.selected.id === s ? 'selected' : ''}" data-nav-kind="stereotype" data-nav-id="\${esc(s)}">
          <div class="card-title"><span class="mono">\${esc(s)}</span><span class="badge b-patterns">UFO Pattern · \${cnt}</span></div>
        </div>\`;
      }).join('') : '';

      let items = state.layers.domain ? DATA.classes.filter(c => {
        if (state.stereotype && c.stereotype !== state.stereotype) return false;
        const aka = CANONICAL_TO_ALIAS[c.curie] || '';
        return matchSearch(\`\${c.curie} \${aka} \${c.label} \${c.module} \${c.stereotype}\`);
      }) : [];

      if (state.domainSimplify) {
        items = items.filter(c => !ALIAS_TO_CANONICAL[c.curie]);
      }

      const familyBuckets = new Map();
      const standalone = [];
      for (const c of items) {
        const famParent = state.domainSimplify ? (c.superClasses || []).find(sc => VERB_FAMILY_PARENTS.has(sc)) : null;
        if (famParent) {
          if (!familyBuckets.has(famParent)) familyBuckets.set(famParent, []);
          familyBuckets.get(famParent).push(c);
        } else {
          standalone.push(c);
        }
      }

      const renderClassCard = (c) => {
        const aka = CANONICAL_TO_ALIAS[c.curie];
        const objCnt = c.props.filter(p => p.kind === 'object').length;
        const dtCnt = c.props.length - objCnt;
        return \`<div class="card \${state.selected.kind === 'class' && state.selected.id === c.curie ? 'selected' : ''}" data-nav-kind="class" data-nav-id="\${esc(c.curie)}">
          <div class="card-title"><span class="mono">\${esc(c.curie)}</span><span class="badge b-patterns">\${esc(c.stereotype || 'class')}</span></div>
          <div class="card-sub">\${aka ? badge('aka ' + aka, 'b-bridge') : ''}\${esc(c.label)} · \${objCnt} edges · \${dtCnt} attrs</div>
        </div>\`;
      };

      const familyHtml = [...familyBuckets.entries()].map(([fam, members]) => {
        const open = state.expandedFamilies.has(fam) || Boolean(state.search);
        return \`<div class="family-header" data-toggle-family="\${esc(fam)}">
          <span class="mono">\${open ? '▾' : '▸'} \${esc(fam)} family</span>
          <span class="badge b-domain">\${members.length} members</span>
        </div>\${open ? \`<div class="family-members">\${members.map(renderClassCard).join('')}</div>\` : ''}\`;
      }).join('');

      el.innerHTML = simplifyBar + patCards + familyHtml + (standalone.map(renderClassCard).join('') || (!familyHtml ? '<div class="card-sub">No matching classes.</div>' : ''));
    } else if (state.tab === 'code') {
      if (!state.layers.code) { el.innerHTML = '<div class="card-sub">Layer :code is hidden.</div>'; return; }
      const subTabs = \`<div class="subtabs">
        <button class="subtab \${state.codeSubtab === 'files' ? 'active' : ''}" data-subtab="files">Files (\${DATA.codeFiles.length})</button>
        <button class="subtab \${state.codeSubtab === 'stories' ? 'active' : ''}" data-subtab="stories">Stories (\${(DATA.codeStories || []).length})</button>
        <button class="subtab \${state.codeSubtab === 'routes' ? 'active' : ''}" data-subtab="routes">Routes (\${DATA.codeRoutes.length})</button>
        <button class="subtab \${state.codeSubtab === 'testids' ? 'active' : ''}" data-subtab="testids">TEST_IDS (\${DATA.codeTestIds.length})</button>
        <button class="subtab \${state.codeSubtab === 'tools' ? 'active' : ''}" data-subtab="tools">WebMCP (\${DATA.codeTools.length})</button>
      </div>\`;
      if (state.codeSubtab === 'files') {
        const allItems = DATA.codeFiles.filter(f => matchSearch(\`\${f.p} \${f.syms.map(s => s.n).join(' ')}\`));
        const items = allItems.slice(0, 120);
        const truncNote = allItems.length > items.length ? \`<div class="card-sub" style="padding:6px 4px;">Showing \${items.length} of \${allItems.length} files — use Search to narrow.</div>\` : '';
        el.innerHTML = subTabs + items.map(f => {
          const jc = (fileToJourneys.get(f.p)?.size) || 0;
          const ic = (fileToIssues.get(f.p)?.size) || 0;
          return \`<div class="card \${state.selected.kind === 'file' && state.selected.id === f.p ? 'selected' : ''}" data-nav-kind="file" data-nav-id="\${esc(f.p)}">
            <div class="card-title"><span class="mono">\${esc(f.p.split('/').pop())}</span><span class="badge b-code">\${f.syms.length} syms</span></div>
            <div class="card-sub">\${esc(f.p)} · \${jc} journeys · \${ic} issues</div>
          </div>\`;
        }).join('') + truncNote || subTabs + '<div class="card-sub">No matching files.</div>';
      } else if (state.codeSubtab === 'stories') {
        const origins = resolveOrigins();
        const allItems = (DATA.codeStories || []).filter(s => matchSearch(\`\${s.id} \${s.title} \${s.name} \${s.domainState} \${s.file}\`));
        const items = allItems.slice(0, 150);
        const truncNote = allItems.length > items.length ? \`<div class="card-sub" style="padding:6px 4px;">Showing \${items.length} of \${allItems.length} stories — use Search to narrow.</div>\` : '';
        el.innerHTML = subTabs + (items.map(s => {
          const sbHref = \`\${origins.storybook}/?path=/story/\${encodeURIComponent(s.id)}\`;
          return \`<div class="card \${state.selected.kind === 'story' && state.selected.id === s.id ? 'selected' : ''}" data-nav-kind="story" data-nav-id="\${esc(s.id)}">
            <div class="card-title"><span>\${esc(s.title)} / \${esc(s.name)}</span><span>\${s.hasPlay ? badge('play()', 'b-qa') : ''}<a class="badge b-code clickable" href="\${esc(sbHref)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Storybook ↗</a></span></div>
            <div class="card-sub">\${s.domainState ? badge('domainState: ' + s.domainState, 'b-domain') : ''} \${s.journeys.map(j => badge(j, 'b-qa', 'journey', j)).join('')} <code>\${esc(s.id)}</code></div>
          </div>\`;
        }).join('') + truncNote || '<div class="card-sub">No matching stories.</div>');
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
      // Graph tab: quick jump list of top entities matching search (or UFO patterns)
      const cards = [];
      for (const s of DATA.stereotypes.filter(x => matchSearch(x)).slice(0, 9)) {
        cards.push(\`<div class="card" data-nav-kind="stereotype" data-nav-id="\${esc(s)}"><div class="card-title"><span class="mono">\${esc(s)}</span><span class="badge b-patterns">Pattern</span></div></div>\`);
      }
      for (const j of DATA.qaJourneys.filter(x => matchSearch(x.id + ' ' + x.title)).slice(0, 12)) {
        cards.push(\`<div class="card" data-nav-kind="journey" data-nav-id="\${esc(j.id)}"><div class="card-title"><span>\${esc(j.id)}</span><span class="badge b-qa">Journey</span></div><div class="card-sub">\${esc(j.title)}</div></div>\`);
      }
      for (const st of (DATA.codeStories || []).filter(x => matchSearch(x.id + ' ' + x.title + ' ' + x.name)).slice(0, 10)) {
        cards.push(\`<div class="card" data-nav-kind="story" data-nav-id="\${esc(st.id)}"><div class="card-title"><span>\${esc(st.title)} / \${esc(st.name)}</span><span class="badge b-code">\${st.hasPlay ? 'play() Test' : 'Story'}</span></div></div>\`);
      }
      for (const c of DATA.classes.filter(x => matchSearch(x.curie + ' ' + x.label)).slice(0, 10)) {
        cards.push(\`<div class="card" data-nav-kind="class" data-nav-id="\${esc(c.curie)}"><div class="card-title"><span class="mono">\${esc(c.curie)}</span><span class="badge b-domain">Class</span></div></div>\`);
      }
      for (const i of DATA.qaIssues.filter(x => matchSearch(x.id + ' ' + x.title)).slice(0, 8)) {
        cards.push(\`<div class="card" data-nav-kind="issue" data-nav-id="\${esc(i.id)}"><div class="card-title"><span>\${esc(i.id)}</span><span class="badge b-qa">Issue</span></div><div class="card-sub">\${esc(i.title)}</div></div>\`);
      }
      for (const f of DATA.codeFiles.filter(x => matchSearch(x.p)).slice(0, 12)) {
        cards.push(\`<div class="card" data-nav-kind="file" data-nav-id="\${esc(f.p)}"><div class="card-title"><span class="mono">\${esc(f.p.split('/').pop())}</span><span class="badge b-code">\${f.isTest ? 'Test File' : 'File'}</span></div><div class="card-sub">\${esc(f.p)}</div></div>\`);
      }
      el.innerHTML = cards.join('') || '<div class="card-sub">Search to jump to any node.</div>';
    }
  }

  function renderGraphWorkspace() {
    const g = state.graph;
    const sub = computeGraphSubgraph();
    const fromNode = graphNodes.get(sub.fromKey);
    const toNode = sub.toKey ? graphNodes.get(sub.toKey) : null;

    const kindDefs = [
      ['stereotype', 'UFO Pattern', 'b-patterns'],
      ['class', 'Domain Class', 'b-domain'],
      ['journey', 'Journey', 'b-qa'],
      ['issue', 'Issue', 'b-high'],
      ['story', 'Story / Tier 2', 'b-code'],
      ['testFile', 'Test File', 'b-code'],
      ['sourceFile', 'Source File', 'b-code'],
      ['route', 'Route', 'b-code'],
      ['testid', 'TEST_ID', 'b-code'],
      ['tool', 'WebMCP Tool', 'b-code']
    ];

    const kindChips = kindDefs.map(([k, lbl, cls]) => {
      const cnt = sub.kindCounts[k] || 0;
      const active = g.enabledKinds[k];
      const dimStyle = cnt === 0 ? ' style="opacity:0.45;"' : '';
      return \`<button class="chip \${active ? 'active' : ''}" data-g-kind="\${k}"\${dimStyle}><span class="badge \${cls}" style="margin:0;padding:0 4px;">\${cnt}</span>\${lbl}</button>\`;
    }).join('');

    const allPreds = Object.keys(sub.predCounts).sort();
    const predChips = allPreds.map(p => {
      const active = !g.disabledPreds.has(p);
      return \`<button class="chip \${active ? 'active' : ''}" data-g-pred="\${esc(p)}">\${esc(p)} (\${sub.predCounts[p]})</button>\`;
    }).join('') || '<span class="card-sub">No active predicates.</span>';

    // Compute SVG layout
    const W = 900, H = 540;
    const colors = { patterns: '#a78bfa', domain: '#34d399', qa: '#fbbf24', code: '#38bdf8', bridge: '#fb7185' };
    const pos = new Map();

    if (g.mode === 'path' && sub.minDist !== undefined) {
      // Layered left-to-right layout by distA
      const cols = new Map();
      for (const n of sub.nodes) {
        const d = sub.distA.get(n.key) ?? 0;
        if (!cols.has(d)) cols.set(d, []);
        cols.get(d).push(n);
      }
      const maxCol = Math.max(1, ...cols.keys());
      const padX = 85, padY = 48;
      const usableW = W - padX * 2;
      const sortedCols = [...cols.keys()].sort((a, b) => a - b);
      for (const colIdx of sortedCols) {
        const list = cols.get(colIdx);
        list.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
        const x = padX + (colIdx / maxCol) * usableW;
        const stepY = (H - padY * 2) / Math.max(1, list.length);
        list.forEach((n, i) => {
          const y = list.length === 1 ? H / 2 : padY + stepY * (i + 0.5);
          pos.set(n.key, g.customPos[n.key] || { x, y });
        });
      }
    } else {
      // Concentric radial layout by distA (0, 1, 2)
      const cx = W / 2, cy = H / 2;
      const ring1 = sub.nodes.filter(n => (sub.distA.get(n.key) ?? 0) === 1);
      const ring2 = sub.nodes.filter(n => (sub.distA.get(n.key) ?? 0) >= 2);
      pos.set(sub.fromKey, g.customPos[sub.fromKey] || { x: cx, y: cy });
      ring1.sort((a, b) => a.layer.localeCompare(b.layer) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
      ring1.forEach((n, i) => {
        const angle = (i / Math.max(1, ring1.length)) * Math.PI * 2 - Math.PI / 2;
        const r = ring2.length > 0 ? 150 + (i % 2) * 26 : 190 + (i % 2) * 30;
        pos.set(n.key, g.customPos[n.key] || { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
      });
      ring2.sort((a, b) => a.layer.localeCompare(b.layer) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
      ring2.forEach((n, i) => {
        const angle = (i / Math.max(1, ring2.length)) * Math.PI * 2 - Math.PI / 2;
        const r = 245 + (i % 2) * 24;
        pos.set(n.key, g.customPos[n.key] || { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
      });
    }

    const activePath = g.activePathIdx >= 0 ? sub.concretePaths[g.activePathIdx] : null;
    const activePathEdgeSet = new Set(activePath ? activePath.edges.map(e => e.idx) : []);
    const activePathNodeSet = new Set(activePath ? activePath.nodes : []);

    const edgeSvg = sub.edges.map(e => {
      const p1 = pos.get(e.from), p2 = pos.get(e.to);
      if (!p1 || !p2) return '';
      const isHi = activePathEdgeSet.has(e.idx);
      const stroke = isHi ? 'var(--accent)' : (colors[e.layer] || 'var(--muted)');
      const opacity = activePath ? (isHi ? '0.95' : '0.16') : '0.58';
      const sw = isHi ? '2.4' : '1.4';
      const dash = e.isProjection ? ' stroke-dasharray="4 3"' : '';
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const lbl = e.detail ? e.pred + ' (' + e.detail.split(':')[0] + ')' : e.pred;
      return \`<g class="g-edge" data-from="\${esc(e.from)}" data-to="\${esc(e.to)}" opacity="\${opacity}">
        <line x1="\${p1.x}" y1="\${p1.y}" x2="\${p2.x}" y2="\${p2.y}" stroke="\${stroke}" stroke-width="\${sw}"\${dash} />
        <text x="\${mx}" y="\${my - 4}" fill="var(--muted)" font-size="8.5" text-anchor="middle">\${esc(lbl.slice(0, 26))}</text>
      </g>\`;
    }).join('');

    const nodeSvg = sub.nodes.map(n => {
      const p = pos.get(n.key);
      if (!p) return '';
      const isA = n.key === sub.fromKey;
      const isB = n.key === sub.toKey;
      const isInsp = n.key === g.inspectedKey;
      const isMatch = sub.matchedKeys.size > 0 && sub.matchedKeys.has(n.key);
      const col = colors[n.layer] || 'var(--accent)';
      const r = (isA || isB) ? 20 : (isInsp ? 17 : 13);
      let stroke = col;
      if (isA) stroke = 'var(--c-domain)';
      if (isB) stroke = 'var(--c-bridge)';
      if (isMatch) stroke = 'var(--c-qa)';
      const dim = (activePath && !activePathNodeSet.has(n.key)) || (g.nodeFilter && g.nodeFilterMode === 'highlight' && sub.matchedKeys.size > 0 && !isMatch && !isA && !isB);
      return \`<g class="g-node" data-node-key="\${esc(n.key)}" data-nav-kind="\${esc(n.kind)}" data-nav-id="\${esc(n.id)}" style="cursor:pointer" opacity="\${dim ? '0.28' : '1'}">
        <circle cx="\${p.x}" cy="\${p.y}" r="\${r}" fill="\${isInsp ? 'var(--panel2)' : 'var(--panel)'}" stroke="\${stroke}" stroke-width="\${(isA || isB || isInsp || isMatch) ? 3 : 2}" />
        <text x="\${p.x}" y="\${p.y + r + 12}" fill="var(--text)" font-size="10.5" font-weight="\${(isA || isB) ? '700' : '500'}" text-anchor="middle">\${esc(n.label.slice(0, 30))}</text>
        \${(isA || isB) ? \`<text x="\${p.x}" y="\${p.y + 4}" fill="\${stroke}" font-size="10" font-weight="700" text-anchor="middle">\${isA ? 'A' : 'B'}</text>\` : ''}
      </g>\`;
    }).join('');

    // Inspector for clicked/selected node
    const inspKey = g.inspectedKey && graphNodes.has(g.inspectedKey) ? g.inspectedKey : sub.fromKey;
    const inspNode = graphNodes.get(inspKey);
    const inspHtml = renderGraphInspector(inspNode);

    const statusLine = g.mode === 'path'
      ? (sub.minDist === undefined
        ? \`<span class="badge b-high">No path found within 6 hops under current filters</span>\`
        : \`<span class="badge b-domain">Shortest: \${sub.minDist} hops · Showing ≤ \${sub.maxLen} hops · \${sub.nodes.length} nodes · \${sub.edges.length} links</span>\`)
      : \`<span class="badge b-domain">\${g.hops}-Hop Neighborhood · \${sub.nodes.length} nodes · \${sub.edges.length} links</span>\`;

    const truncBanner = sub.truncated
      ? \`<span class="badge b-med">Showing \${sub.nodes.length} of \${sub.totalNodes} nodes <button class="btn" id="btn-show-all-nodes" style="padding:1px 6px;margin-left:4px;">Show all</button></span>\`
      : '';

    const pathsHtml = g.mode === 'path' && sub.concretePaths.length ? \`
      <div class="section" style="margin-top:12px;">
        <h3>Shared Paths (\${sub.concretePaths.length}\${sub.concretePaths.length >= 25 ? '+' : ''}) — Click to highlight</h3>
        \${sub.concretePaths.map((cp, idx) => {
          const chain = cp.nodes.map((nk, i) => {
            const nd = graphNodes.get(nk);
            const edgeStr = i < cp.edges.length ? \` <span style="color:var(--muted)">—[\${esc(cp.edges[i].pred)}]→</span> \` : '';
            return \`<span class="mono" style="color:var(--text)">\${esc(nd ? nd.label.slice(0, 26) : nk)}</span>\${edgeStr}\`;
          }).join('');
          return \`<div class="path-item \${g.activePathIdx === idx ? 'active' : ''}" data-path-idx="\${idx}">\${chain}</div>\`;
        }).join('')}
      </div>\` : '';

    return \`
      <div class="graph-controls">
        <div class="graph-row">
          <div class="subtabs" style="margin:0;">
            <button class="subtab \${g.mode === 'neighborhood' ? 'active' : ''}" id="btn-gmode-neigh">Neighborhood</button>
            <button class="subtab \${g.mode === 'path' ? 'active' : ''}" id="btn-gmode-path">Shared Path (A ↔ B)</button>
          </div>
          \${g.mode === 'neighborhood' ? \`
            <select id="sel-g-hops">
              <option value="1" \${g.hops === 1 ? 'selected' : ''}>1 Hop</option>
              <option value="2" \${g.hops === 2 ? 'selected' : ''}>2 Hops</option>
            </select>
          \` : \`
            <select id="sel-g-budget" title="Maximum path length">
              <option value="shortest" \${g.pathBudget === 'shortest' ? 'selected' : ''}>Shortest path only</option>
              <option value="plus1" \${g.pathBudget === 'plus1' ? 'selected' : ''}>Shortest + 1 hop (recommended)</option>
              <option value="plus2" \${g.pathBudget === 'plus2' ? 'selected' : ''}>Shortest + 2 hops</option>
              <option value="max4" \${g.pathBudget === 'max4' ? 'selected' : ''}>All paths ≤ 4 hops</option>
              <option value="max5" \${g.pathBudget === 'max5' ? 'selected' : ''}>All paths ≤ 5 hops</option>
              <option value="max6" \${g.pathBudget === 'max6' ? 'selected' : ''}>All paths ≤ 6 hops</option>
            </select>
          \`}
          \${statusLine}
          \${truncBanner}
          <button class="btn" id="btn-g-fullscreen" style="margin-left:auto;">\${g.fullscreen ? 'Show Sidebar' : 'Expand Graph'}</button>
        </div>

        <div class="graph-row">
          <div class="picker-wrap">
            <input class="picker-input" id="picker-from" placeholder="Point A (search journey, pattern, class, file, test...)" value="\${esc(fromNode ? fromNode.kind + ': ' + fromNode.label : g.from.id)}" autocomplete="off" />
            <div class="picker-dropdown" id="dropdown-from"></div>
          </div>
          \${g.mode === 'path' ? \`
            <button class="btn" id="btn-g-swap" title="Swap Point A and Point B">⇄ Swap</button>
            <div class="picker-wrap">
              <input class="picker-input" id="picker-to" placeholder="Point B (search test, story, journey, pattern, file...)" value="\${esc(toNode ? toNode.kind + ': ' + toNode.label : g.to.id)}" autocomplete="off" />
              <div class="picker-dropdown" id="dropdown-to"></div>
            </div>
          \` : ''}
          <button class="btn" id="btn-preset-jrn-test" title="Example: Path between current Journey and a Storybook/E2E Test">Preset: Journey ↔ Test</button>
          <button class="btn" id="btn-preset-pat-jrn" title="Example: Trace a UFO Pattern across a Journey">Preset: Pattern ↔ Journey</button>
        </div>

        <div class="graph-row">
          <span style="color:var(--muted);font-size:11px;min-width:72px;">Elements:</span>
          <div class="chip-bar">\${kindChips}</div>
          <button class="btn" id="btn-kinds-all" style="padding:2px 7px;font-size:10.5px;">All</button>
          <button class="btn" id="btn-kinds-none" style="padding:2px 7px;font-size:10.5px;">None</button>
        </div>

        <div class="graph-row">
          <span style="color:var(--muted);font-size:11px;min-width:72px;">Links:</span>
          <div class="chip-bar">\${predChips}</div>
          <button class="btn" id="btn-preds-all" style="padding:2px 7px;font-size:10.5px;">All</button>
        </div>

        <div class="graph-row">
          <span style="color:var(--muted);font-size:11px;min-width:72px;">Finetune:</span>
          <input type="search" id="input-g-nodefilter" placeholder="Filter/highlight nodes in graph (e.g. timer, .test., Note)..." value="\${esc(g.nodeFilter)}" style="min-width:220px;max-width:340px;" />
          <select id="sel-g-filtermode">
            <option value="highlight" \${g.nodeFilterMode === 'highlight' ? 'selected' : ''}>Highlight matches</option>
            <option value="isolate" \${g.nodeFilterMode === 'isolate' ? 'selected' : ''}>Isolate matching subgraph</option>
          </select>
          \${g.activePathIdx >= 0 ? '<button class="btn" id="btn-clear-path">Clear Path Highlight</button>' : ''}
        </div>
      </div>

      <div class="graph-grid">
        <div>
          <div class="graph-stage">
            <div class="graph-hud">
              <button class="btn" id="btn-zoom-in" title="Zoom In">+</button>
              <button class="btn" id="btn-zoom-out" title="Zoom Out">−</button>
              <button class="btn" id="btn-zoom-reset" title="Reset View &amp; Node Positions">Reset</button>
            </div>
            <div style="position:absolute;bottom:8px;left:10px;z-index:2;display:flex;flex-wrap:wrap;gap:8px;font-size:10.5px;color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:3px 8px;opacity:0.9;">
              <span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#a78bfa;margin-right:4px;"></span>:patterns</span>
              <span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#34d399;margin-right:4px;"></span>:domain</span>
              <span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fbbf24;margin-right:4px;"></span>:qa</span>
              <span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#38bdf8;margin-right:4px;"></span>:code</span>
              <span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fb7185;margin-right:4px;"></span>:bridge</span>
            </div>
            <svg class="graph" id="graph-svg" viewBox="0 0 \${W} \${H}">
              <g id="graph-viewport" transform="translate(\${g.panX},\${g.panY}) scale(\${g.zoom})">
                \${edgeSvg}
                \${nodeSvg}
              </g>
            </svg>
            <div class="graph-legend">
              <span><span class="dot" style="background:var(--c-patterns)"></span> :patterns</span>
              <span><span class="dot" style="background:var(--c-domain)"></span> :domain</span>
              <span><span class="dot" style="background:var(--c-qa)"></span> :qa</span>
              <span><span class="dot" style="background:var(--c-code)"></span> :code</span>
              <span><span class="dot" style="background:var(--c-bridge)"></span> :bridge</span>
              <span>· Wheel to zoom · Drag canvas to pan · Drag nodes to arrange</span>
            </div>
          </div>
          \${pathsHtml}
        </div>
        <div>\${inspHtml}</div>
      </div>\`;
  }

  function renderGraphInspector(node) {
    if (!node) return '<div class="section"><h3>Node Inspector</h3><p class="card-sub">Click any node in the graph to inspect it and jump into code.</p></div>';
    const origins = resolveOrigins();
    let extra = '';
    if (node.kind === 'file') {
      const f = fileByPath.get(node.id);
      const syms = f?.syms || [];
      extra = \`
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">
          \${codeJumpLinks(node.id, syms[0]?.l || 1)}
          <button class="btn" data-open-detail-kind="file" data-open-detail-id="\${esc(node.id)}">Open in Code Tab</button>
        </div>
        <p class="card-sub">Package: <code>\${esc(f?.pkg || '—')}</code> · \${node.isTest ? 'Test file' : 'Source file'}</p>
        \${syms.length ? \`<p><strong>Symbols (\${syms.length}):</strong><br/>\${syms.slice(0, 14).map(s => \`<span class="badge b-code">\${esc(s.n)}:\${s.l}</span>\`).join('')}</p>\` : ''}\`;
    } else if (node.kind === 'story') {
      const st = storyById.get(node.id);
      const sbHref = \`\${origins.storybook}/?path=/story/\${encodeURIComponent(node.id)}\`;
      extra = \`
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">
          \${st?.file ? codeJumpLinks(st.file, 1) : ''}
          <a class="btn" href="\${esc(sbHref)}" target="_blank" rel="noopener noreferrer">Storybook ↗</a>
          <button class="btn" data-open-detail-kind="story" data-open-detail-id="\${esc(node.id)}">Open in Code Tab</button>
        </div>
        \${st?.file ? \`<p class="card-sub">File: <code>\${esc(st.file)}</code></p>\` : ''}\`;
    } else if (node.kind === 'journey') {
      const j = journeyById.get(node.id);
      extra = \`
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">
          \${j?.specFile ? codeJumpLinks(j.specFile, 1, 'Spec (GitHub)') : ''}
          \${j?.pwSpec ? codeJumpLinks(j.pwSpec, 1, 'E2E (GitHub)') : ''}
          <button class="btn" data-open-detail-kind="journey" data-open-detail-id="\${esc(node.id)}">Open Journey Detail</button>
        </div>
        <p class="card-sub">\${esc(j?.title || '')}</p>\`;
    } else if (node.kind === 'class') {
      const c = classByCurie.get(node.id);
      extra = \`
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">
          <button class="btn" data-open-detail-kind="class" data-open-detail-id="\${esc(node.id)}">Open Class Detail</button>
        </div>
        <p class="card-sub">\${esc(c?.comment || '')}</p>
        \${c?.implSymbols?.length ? \`<p><strong>Implemented in:</strong><br/>\${c.implSymbols.slice(0, 6).map(s => badge(s.name + ' (' + s.file.split('/').pop() + ')', 'b-code', 'file', s.file)).join('')}</p>\` : ''}\`;
    } else if (node.kind === 'stereotype') {
      const clsCount = DATA.classes.filter(c => c.stereotype === node.id).length;
      extra = \`
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">
          <button class="btn" data-open-detail-kind="stereotype" data-open-detail-id="\${esc(node.id)}">Open Pattern Detail</button>
        </div>
        <p class="card-sub">\${clsCount} domain classes carry this UFO stereotype.</p>\`;
    } else if (node.kind === 'issue') {
      const iss = issueById.get(node.id);
      extra = \`
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">
          \${iss?.rootCauses?.[0]?.file ? codeJumpLinks(iss.rootCauses[0].file, iss.rootCauses[0].lineHint) : ''}
          <button class="btn" data-open-detail-kind="issue" data-open-detail-id="\${esc(node.id)}">Open Issue Detail</button>
        </div>
        <p class="card-sub">\${esc(iss?.title || '')}</p>\`;
    } else if (node.kind === 'tool') {
      const t = DATA.codeTools.find(x => x.name === node.id);
      extra = t?.file ? \`<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">\${codeJumpLinks(t.file, 1)}</div><p class="card-sub"><code>\${esc(t.cli)}</code></p>\` : '';
    } else if (node.kind === 'route') {
      const isStatic = !node.id.includes(':');
      const href = origins.playground + (node.id.startsWith('/') ? node.id : '/' + node.id);
      extra = isStatic ? \`<div style="margin:8px 0;"><a class="btn" href="\${esc(href)}" target="_blank" rel="noopener noreferrer">Open Route ↗</a></div>\` : '';
    }

    return \`<div class="section">
      <h3>Node Inspector</h3>
      <div style="margin-bottom:6px;"><span class="badge b-\${node.layer}">\${esc(node.kind)}</span> <strong class="mono">\${esc(node.label)}</strong></div>
      <div class="card-sub" style="margin-bottom:8px;">\${esc(node.id)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
        <button class="btn" id="btn-insp-set-a" data-k="\${esc(node.kind)}" data-id="\${esc(node.id)}">Set as Point A</button>
        <button class="btn" id="btn-insp-set-b" data-k="\${esc(node.kind)}" data-id="\${esc(node.id)}">Set as Point B</button>
        <button class="btn" id="btn-insp-neigh" data-k="\${esc(node.kind)}" data-id="\${esc(node.id)}">Neighborhood</button>
      </div>
      \${extra}
    </div>\`;
  }

  function renderOverviewCockpit() {
    const objProps = (DATA.properties || []).filter(p => p.kind === 'object');
    const dtProps = (DATA.properties || []).filter(p => p.kind !== 'object');
    const simplifiedClasses = DATA.classes.filter(c => !ALIAS_TO_CANONICAL[c.curie]);
    const h = DATA.health || { bridgeRawTotal: 0, bridgeDistinctTotal: 0, duplicateBridgePreds: [], undeclaredEmitted: [], zeroEdgeProps: [] };

    // Top hub nodes by degree across the unified graph
    const hubs = [...graphNodes.values()]
      .map(n => ({ node: n, degree: (graphAdj.get(n.key) || []).length }))
      .sort((a, b) => b.degree - a.degree || a.node.id.localeCompare(b.node.id))
      .slice(0, 18);

    // Orphan classes (0 graph edges except stereotype/subClassOf)
    const orphanClasses = DATA.classes.filter(c => {
      const edges = (graphAdj.get('class:' + c.curie) || []).filter(a => {
        const e = graphEdges[a.edgeIdx];
        return e.pred !== 'stereotype' && e.pred !== 'subClassOf';
      });
      return edges.length === 0 && !ALIAS_TO_CANONICAL[c.curie];
    });

    return \`
      <div class="section">
        <h2 style="margin:0 0 6px;">Ontology Review Cockpit — 5-Named-Graph Surface</h2>
        <p class="card-sub">Start at a hub, jump to any named term from the alphabetical index on the left, or scan health exceptions below. Datatype attributes are rendered in class tables; only object/bridge relations are drawn as graph edges.</p>
      </div>

      <div class="cockpit-grid">
        <div class="stat-card">
          <div class="card-sub"><span class="dot" style="background:var(--c-patterns)"></span> :patterns</div>
          <div class="stat-num">\${DATA.stereotypes.length}</div>
          <div class="card-sub">UFO stereotypes</div>
        </div>
        <div class="stat-card">
          <div class="card-sub"><span class="dot" style="background:var(--c-domain)"></span> :domain (classes)</div>
          <div class="stat-num">\${simplifiedClasses.length} <span style="font-size:12px;color:var(--muted);font-weight:400;">/ \${DATA.classes.length} raw</span></div>
          <div class="card-sub">\${objProps.length} object edges · \${dtProps.length} scalar attrs</div>
        </div>
        <div class="stat-card">
          <div class="card-sub"><span class="dot" style="background:var(--c-qa)"></span> :qa</div>
          <div class="stat-num">\${DATA.qaJourneys.length} <span style="font-size:12px;color:var(--muted);font-weight:400;">journeys</span></div>
          <div class="card-sub">\${DATA.qaIssues.length} issues · \${DATA.qaRuns.length} runs</div>
        </div>
        <div class="stat-card">
          <div class="card-sub"><span class="dot" style="background:var(--c-code)"></span> :code</div>
          <div class="stat-num">\${DATA.codeFiles.length} <span style="font-size:12px;color:var(--muted);font-weight:400;">files</span></div>
          <div class="card-sub">\${DATA.codeStories.length} stories · \${DATA.codeTestIds.length} testIds · \${DATA.codeTools.length} tools</div>
        </div>
        <div class="stat-card">
          <div class="card-sub"><span class="dot" style="background:var(--c-bridge)"></span> :bridge</div>
          <div class="stat-num">\${h.bridgeDistinctTotal} <span style="font-size:12px;color:var(--muted);font-weight:400;">distinct</span></div>
          <div class="card-sub">\${h.bridgeRawTotal} raw assertions</div>
        </div>
      </div>

      <div class="section">
        <h3>Top Hub Nodes (Highest Degree — Start Review Here)</h3>
        <table>
          <tr><th>Node</th><th>Kind</th><th>Layer</th><th>Degree</th><th>Actions</th></tr>
          \${hubs.map(x => \`<tr>
            <td><span class="mono">\${esc(x.node.label.slice(0, 48))}</span></td>
            <td>\${badge(x.node.kind, 'b-' + x.node.layer)}</td>
            <td>:\${esc(x.node.layer)}</td>
            <td><strong>\${x.degree}</strong></td>
            <td>
              <button class="btn" data-nav-kind="\${esc(x.node.kind)}" data-nav-id="\${esc(x.node.id)}">Inspect</button>
              <button class="btn" data-graph-node-kind="\${esc(x.node.kind)}" data-graph-node-id="\${esc(x.node.id)}">Graph</button>
            </td>
          </tr>\`).join('')}
        </table>
      </div>

      <div class="section">
        <h3>Health &amp; Exceptions</h3>
        <p><strong>Canonical Alias Pairs (owl:equivalentClass / view-collapsed):</strong>
          \${Object.entries(ALIAS_TO_CANONICAL).map(([al, can]) => badge(al + ' → ' + can, 'b-domain', 'class', can)).join(' ')}
        </p>
        <p><strong>Zero-Edge Declared Properties (\${h.zeroEdgeProps.length}):</strong><br/>
          \${h.zeroEdgeProps.slice(0, 20).map(p => badge(p.curie + ' (' + p.kind + ')', 'b-med', p.domains[0] ? 'class' : '', p.domains[0] || '')).join('') || 'None.'}
        </p>
        <p><strong>Undeclared Emitted Predicates (\${h.undeclaredEmitted.length}):</strong><br/>
          \${h.undeclaredEmitted.map(u => badge(u.pred + ' (' + u.count + ')', 'b-high')).join('') || 'None.'}
        </p>
        <p><strong>Duplicate Bridge Assertions (\${h.duplicateBridgePreds.length} predicates):</strong><br/>
          \${h.duplicateBridgePreds.map(d => badge(d.pred + ': ' + d.raw + ' → ' + d.distinct + ' distinct', 'b-med')).join('') || 'None.'}
        </p>
        <p><strong>Classes Without Object/Bridge Edges (\${orphanClasses.length}):</strong><br/>
          \${orphanClasses.map(c => badge(c.curie, 'b-domain', 'class', c.curie)).join('') || 'None.'}
        </p>
      </div>
    \`;
  }

  function renderDetail() {
    const el = document.getElementById('detail-pane');
    const origins = resolveOrigins();
    const activeRef = state.tab === 'graph' ? state.graph.from : state.selected;
    const crumbs = \`<div class="breadcrumbs">
      <button class="btn" id="btn-back" title="Browser Back">← Back</button>
      <button class="btn" id="btn-fwd" title="Browser Forward">Forward →</button>
      <span class="badge b-bridge">\${esc(activeRef.kind)}: \${esc(activeRef.id)}</span>
      \${state.tab !== 'graph' ? '<button class="btn" id="btn-open-graph">Open in Graph Explorer</button>' : ''}
      \${state.tab !== 'graph' ? '<button class="btn" id="btn-find-path">Find Shared Path (A ↔ B)</button>' : ''}
      <button class="btn" id="btn-copy-link" title="Copy deep link">Copy # Link</button>
    </div>\`;

    if (state.tab === 'overview') {
      el.innerHTML = renderOverviewCockpit();
      return;
    }

    if (state.tab === 'graph') {
      el.innerHTML = crumbs + renderGraphWorkspace();
      wireGraphInteractions();
      return;
    }

    function renderNotFound(kindLabel, idVal, candidates, navKind) {
      const q = (idVal || '').toLowerCase();
      const sugg = candidates
        .filter(x => x.id.toLowerCase().includes(q) || q.includes(x.id.toLowerCase()) || (x.label && x.label.toLowerCase().includes(q)))
        .slice(0, 6);
      const fallback = sugg.length ? sugg : candidates.slice(0, 6);
      return crumbs + \`
        <div class="section">
          <h2 style="margin:0 0 6px;">\${esc(kindLabel)} not found</h2>
          <p class="card-sub">No \${esc(kindLabel.toLowerCase())} matched <code>\${esc(idVal)}</code>.</p>
          <p><strong>\${sugg.length ? 'Did you mean:' : 'Available examples:'}</strong><br/>
          \${fallback.map(x => badge(x.label ? \`\${x.id} — \${x.label}\` : x.id, 'b-bridge', navKind, x.id)).join('')}</p>
        </div>\`;
    }

    const { kind, id } = state.selected;
    if (kind === 'journey') {
      const j = journeyById.get(id);
      if (!j) { el.innerHTML = renderNotFound('Journey', id, DATA.qaJourneys.map(x => ({ id: x.id, label: x.title })), 'journey'); return; }
      const e2eHref = \`\${origins.e2e}/#?q=\${encodeURIComponent(j.id)}\`;
      el.innerHTML = crumbs + \`
        <div class="section">
          <h2 style="margin:0 0 6px;">\${esc(j.id)} — \${esc(j.title)}</h2>
          <div>\${badge(j.domain, 'b-qa')} \${badge(j.priority, 'b-qa')} \${badge(j.status, 'b-qa')} \${j.pwSpec ? \`<a class="badge b-code clickable" href="\${esc(e2eHref)}" target="_blank" rel="noopener noreferrer">E2E Report ↗</a>\` : ''}</div>
          <p class="card-sub">Spec: \${j.specFile ? badge(j.specFile, 'b-code', 'file', j.specFile) + ' ' + codeJumpLinks(j.specFile, 1) : '<code>proposed</code>'} · Playwright: \${j.pwSpec ? badge(j.pwSpec, 'b-code', 'file', j.pwSpec) + ' ' + codeJumpLinks(j.pwSpec, 1) : '<code>—</code>'}</p>
        </div>
        <div class="section">
          <h3>5-Beat Causal Chain (Seed → Enter → Sense → Drive → Prove)</h3>
          \${j.steps.length ? j.steps.map(s => \`<div class="beat-row"><div>\${badge(s.beat, 'b-qa')}</div><div>\${esc(s.label)}</div></div>\`).join('') : '<p class="card-sub">Proposed open journey slot (no 5-beat spec authored yet).</p>'}
        </div>
        \${state.layers.bridge ? \`<div class="section">
          <h3>Bridge Connections</h3>
          <p><strong>Seed Nouns (:domain):</strong> \${j.seedNouns.map(s => badge(s, 'b-domain', 'class', s)).join('') || '—'}</p>
          <p><strong>Routes (:code):</strong> \${j.routes.map(r => !r.includes(':') ? \`<a class="badge b-code clickable" href="\${esc(origins.playground + (r.startsWith('/') ? r : '/' + r))}" target="_blank" rel="noopener noreferrer">\${esc(r)} ↗</a>\` : badge(r, 'b-code')).join('') || '—'}</p>
          <p><strong>Storybook Stories (:code):</strong> \${(j.stories || []).map(sid => badge(sid, 'b-code', 'story', sid)).join('') || '—'}</p>
          <p><strong>TEST_IDS (:code):</strong> \${j.testIds.map(t => badge(t, 'b-code')).join('') || '—'}</p>
          <p><strong>Touched Files (\${j.touchedFiles.length}):</strong><br/>\${j.touchedFiles.map(f => badge(f, 'b-code', 'file', f)).join('') || '—'}</p>
          <p><strong>Covering / Affected Issues (\${j.issueIds.length}):</strong><br/>\${j.issueIds.map(i => badge(i, 'b-qa', 'issue', i)).join('') || '—'}</p>
        </div>\` : ''}\`;
    } else if (kind === 'stereotype') {
      const matchingClasses = DATA.classes.filter(c => c.stereotype === id);
      const jSet = new Set();
      for (const c of matchingClasses) for (const jid of c.seededJourneys) jSet.add(jid);
      const jList = [...jSet].sort();
      el.innerHTML = crumbs + \`
        <div class="section">
          <h2 style="margin:0 0 6px;" class="mono">\${esc(id)}</h2>
          <div>\${badge('UFO Pattern', 'b-patterns')} \${badge(matchingClasses.length + ' classes', 'b-domain')} \${badge(jList.length + ' journeys', 'b-qa')}</div>
        </div>
        <div class="section">
          <h3>Domain Classes with \${esc(id)} (\${matchingClasses.length})</h3>
          <p>\${matchingClasses.map(c => badge(c.curie, 'b-domain', 'class', c.curie)).join('') || 'None.'}</p>
        </div>
        <div class="section">
          <h3>Journeys Exercising \${esc(id)} (\${jList.length})</h3>
          <p>\${jList.map(j => badge(j, 'b-qa', 'journey', j)).join('') || 'None.'}</p>
        </div>\`;
    } else if (kind === 'class') {
      const c = classByCurie.get(id);
      if (!c) { el.innerHTML = renderNotFound('Class', id, DATA.classes.map(x => ({ id: x.curie, label: x.module })), 'class'); return; }
      const objProps = c.props.filter(p => p.kind === 'object');
      const dtProps = c.props.filter(p => p.kind !== 'object');
      const incProps = incomingPropsByClass.get(c.curie) || [];
      const aka = CANONICAL_TO_ALIAS[c.curie];
      const canon = ALIAS_TO_CANONICAL[c.curie];
      const ttlPath = 'ontology/' + c.module + '.ttl';
      el.innerHTML = crumbs + \`
        <div class="section">
          <h2 style="margin:0 0 6px;" class="mono">\${esc(c.curie)}</h2>
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
            \${c.stereotype ? badge(c.stereotype, 'b-patterns', 'stereotype', c.stereotype) : badge('owl:Class', 'b-patterns')}
            \${badge(c.module, 'b-domain')}
            \${aka ? badge('aka ' + aka, 'b-bridge', 'class', aka) : ''}
            \${canon ? badge('canonical → ' + canon, 'b-bridge', 'class', canon) : ''}
            \${c.superClasses.map(sc => badge('subClassOf ' + sc, 'b-domain', 'class', sc)).join('')}
            \${codeJumpLinks(ttlPath, 1)}
          </div>
          <p>\${esc(c.comment)}</p>
        </div>
        <div class="section">
          <h3>Connected Via — Object Properties (Out: \${objProps.length} · In: \${incProps.length})</h3>
          <table><tr><th>Dir</th><th>Property</th><th>Connected Class</th><th>Notes</th></tr>
          \${objProps.map(p => \`<tr>
            <td>out →</td>
            <td class="mono">\${esc(p.curie)}</td>
            <td>\${classByCurie.has(p.range) ? badge(p.range, 'b-domain', 'class', p.range) : \`<span class="mono">\${esc(p.range)}</span>\`}</td>
            <td>\${PROJECTION_PREDS.has(p.curie) ? badge('projection (dashed)', 'b-med') : 'canonical'}</td>
          </tr>\`).join('')}
          \${incProps.map(ip => \`<tr>
            <td>← in</td>
            <td class="mono">\${esc(ip.curie)}</td>
            <td>\${badge(ip.from, 'b-domain', 'class', ip.from)}</td>
            <td>\${ip.isProjection ? badge('projection (dashed)', 'b-med') : 'canonical'}</td>
          </tr>\`).join('')}
          \${(!objProps.length && !incProps.length) ? '<tr><td colspan="4">No object property edges.</td></tr>' : ''}
          </table>
        </div>
        <div class="section">
          <h3>Datatype Attributes (\${dtProps.length} scalar fields — not drawn as graph edges)</h3>
          <table><tr><th>Attribute</th><th>Kind</th><th>Datatype</th></tr>
          \${dtProps.map(p => \`<tr><td class="mono">\${esc(p.curie)}</td><td>\${esc(p.kind)}</td><td class="mono">\${esc(p.range)}</td></tr>\`).join('') || '<tr><td colspan="3">None declared directly.</td></tr>'}
          </table>
        </div>
        <div class="section">
          <h3>Constrained By — SHACL Shapes (\${c.shapes.length})</h3>
          <table><tr><th>Path</th><th>Card</th><th>Type / Values</th></tr>
          \${c.shapes.map(s => \`<tr><td class="mono">\${esc(s.path)}</td><td>[\${s.min ?? 0}..\${s.max ?? '*'}]</td><td class="mono">\${s.cls && classByCurie.has(s.cls) ? badge(s.cls, 'b-domain', 'class', s.cls) : esc(s.dt || s.cls || (s.inVals ? s.inVals.join(' | ') : ''))}</td></tr>\`).join('') || '<tr><td colspan="3">None.</td></tr>'}
          </table>
        </div>
        <div class="section">
          <h3>Reverse Bridge Links</h3>
          <p><strong>Seeded Journeys:</strong> \${c.seededJourneys.map(j => badge(j, 'b-qa', 'journey', j)).join('') || '—'}</p>
          <p><strong>Storybook Stories:</strong> \${(storiesByClass.get(c.curie) || []).map(s => badge(s.title + ' / ' + s.name, 'b-code', 'story', s.id)).join('') || '—'}</p>
          <p><strong>Implementing Symbols:</strong> \${c.implSymbols.map(s => badge(s.name + ' (' + s.file + ')', 'b-code', 'file', s.file)).join('') || '—'}</p>
        </div>\`;
    } else if (kind === 'file') {
      const f = fileByPath.get(id);
      const jIds = [...(fileToJourneys.get(id) || [])].sort();
      const iIds = [...(fileToIssues.get(id) || [])].sort();
      el.innerHTML = crumbs + \`
        <div class="section">
          <h2 style="margin:0 0 6px;" class="mono">\${esc(id)}</h2>
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">\${f ? badge(f.pkg, 'b-code') : ''} \${badge(jIds.length + ' journeys', 'b-qa')} \${badge(iIds.length + ' issues', 'b-qa')} \${codeJumpLinks(id, f?.syms?.[0]?.l || 1)}</div>
        </div>
        <div class="section">
          <h3>Exported Symbols (\${f ? f.syms.length : 0})</h3>
          <table><tr><th>Symbol</th><th>Kind</th><th>lineHint</th><th>Implements</th><th>Jump</th></tr>
          \${(f?.syms || []).map(s => \`<tr><td class="mono">\${esc(s.n)}</td><td>\${esc(s.k)}</td><td>\${s.l}</td><td>\${s.d.map(d => badge(d, 'b-domain', 'class', d)).join('')}</td><td>\${codeJumpLinks(id, s.l)}</td></tr>\`).join('') || '<tr><td colspan="5">No exported symbols.</td></tr>'}
          </table>
        </div>
        <div class="section">
          <h3>Connected Journeys (\${jIds.length}) &amp; Root-Cause Issues (\${iIds.length})</h3>
          <p><strong>Journeys:</strong> \${jIds.map(j => badge(j + ' — ' + (journeyById.get(j)?.title || ''), 'b-qa', 'journey', j)).join('') || '—'}</p>
          <p><strong>Issues:</strong> \${iIds.map(i => badge(i + ' — ' + (issueById.get(i)?.title || ''), 'b-high', 'issue', i)).join('') || '—'}</p>
          \${(storiesByFile.get(id) || []).length ? \`<p><strong>Storybook Stories:</strong> \${(storiesByFile.get(id) || []).map(s => badge(s.name, 'b-code', 'story', s.id)).join('')}</p>\` : ''}
          \${f?.tids.length ? \`<p><strong>TEST_IDS used:</strong> \${f.tids.map(t => badge(t, 'b-code')).join('')}</p>\` : ''}
        </div>\`;
    } else if (kind === 'story') {
      const st = storyById.get(id);
      if (!st) { el.innerHTML = renderNotFound('Story', id, (DATA.codeStories || []).map(x => ({ id: x.id, label: x.title + ' / ' + x.name })), 'story'); return; }
      const sbHref = \`\${origins.storybook}/?path=/story/\${encodeURIComponent(st.id)}\`;
      el.innerHTML = crumbs + \`
        <div class="section">
          <h2 style="margin:0 0 6px;">\${esc(st.title)} / \${esc(st.name)}</h2>
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">\${badge(st.hasPlay ? 'Tier 2 play() test' : 'Visual story', 'b-qa')} \${st.domainState ? badge('domainState: ' + st.domainState, 'b-domain') : ''} \${st.component ? badge(st.component, 'b-code') : ''} <a class="badge b-code clickable" href="\${esc(sbHref)}" target="_blank" rel="noopener noreferrer">Open in Storybook ↗</a> \${codeJumpLinks(st.file, 1)}</div>
          <p class="card-sub">Story ID: <code>\${esc(st.id)}</code> · File: \${badge(st.file, 'b-code', 'file', st.file)}</p>
        </div>
        <div class="section">
          <h3>5-Beat Causal Chain (Seed → Enter → Sense → Drive → Prove)</h3>
          \${(st.steps || []).length ? st.steps.map(s => \`<div class="beat-row"><div>\${badge(s.beat, 'b-qa')}</div><div>\${esc(s.label)}</div></div>\`).join('') : '<p class="card-sub">No 5-beat chain recorded.</p>'}
        </div>
        \${state.layers.bridge ? \`<div class="section">
          <h3>Bridge Connections</h3>
          <p><strong>Seed Nouns (:domain):</strong> \${st.seedNouns.map(s => badge(s, 'b-domain', 'class', s)).join('') || '—'}</p>
          <p><strong>Scoped TEST_IDS (:code):</strong> \${st.testIds.map(t => badge(t, 'b-code')).join('') || '—'}</p>
          <p><strong>Touched Files (\${st.touchedFiles.length}):</strong><br/>\${st.touchedFiles.map(f => badge(f, 'b-code', 'file', f)).join('') || '—'}</p>
          <p><strong>Verifies Journeys (\${st.journeys.length}):</strong> \${st.journeys.map(j => badge(j, 'b-qa', 'journey', j)).join('') || '—'}</p>
        </div>\` : ''}\`;
    } else if (kind === 'issue') {
      const iss = issueById.get(id);
      if (!iss) { el.innerHTML = renderNotFound('Issue', id, DATA.qaIssues.map(x => ({ id: x.id, label: x.title })), 'issue'); return; }
      const qaIssueHref = \`\${origins.qa}/issues/\${encodeURIComponent(iss.id)}\`;
      const fmtRun = (runId) => runId
        ? \`<a class="badge b-qa clickable" href="\${esc(origins.qa + '/sessions/' + encodeURIComponent(runId))}" target="_blank" rel="noopener noreferrer">\${esc(runId)} ↗</a>\`
        : '<code>n/a</code>';
      el.innerHTML = crumbs + \`
        <div class="section">
          <h2 style="margin:0 0 6px;">\${esc(iss.id)} — \${esc(iss.title)}</h2>
          <div>\${badge(iss.severity, (iss.severity === 'High' || iss.severity === 'Critical') ? 'b-high' : 'b-med')} \${badge(iss.status, 'b-qa')} \${badge(iss.kind, 'b-qa')} \${iss.coverageStatus ? badge(iss.coverageStatus, 'b-qa') : ''} <a class="badge b-code clickable" href="\${esc(qaIssueHref)}" target="_blank" rel="noopener noreferrer">Dogfood QA ↗</a></div>
          <p class="card-sub">PROV Runs: firstSeen=\${fmtRun(iss.firstSeenRun)} · lastSeen=\${fmtRun(iss.lastSeenRun)}</p>
        </div>
        <div class="section">
          <h3>Affected Domains &amp; Covering Journeys</h3>
          <p><strong>Domains:</strong> \${iss.affects.map(d => badge(d, 'b-qa')).join('') || '—'}</p>
          <p><strong>Covered By:</strong> \${iss.coveredBy.map(j => badge(j, 'b-qa', 'journey', j)).join('') || '—'}</p>
        </div>
        <div class="section">
          <h3>Root-Cause Files &amp; Symbols (bridge:rootCause)</h3>
          <table><tr><th>Type</th><th>File</th><th>Symbol</th><th>lineHint</th><th>Jump</th></tr>
          \${iss.rootCauses.map(rc => \`<tr><td>\${esc(rc.type)}</td><td>\${badge(rc.file, 'b-code', 'file', rc.file)}</td><td class="mono">\${esc(rc.symbol || '—')}</td><td>\${rc.lineHint || '—'}</td><td>\${codeJumpLinks(rc.file, rc.lineHint)}</td></tr>\`).join('') || '<tr><td colspan="5">None recorded.</td></tr>'}
          </table>
        </div>\`;
    }
  }

  function wirePicker(inputId, dropdownId, onSelect) {
    const inp = document.getElementById(inputId);
    const dd = document.getElementById(dropdownId);
    if (!inp || !dd) return;
    function showMatches(q) {
      const ql = (q || '').trim().toLowerCase();
      const matches = (ql
        ? allGraphNodesSorted.filter(n => n.searchText.includes(ql))
        : allGraphNodesSorted.filter(n => ['journey', 'stereotype', 'story', 'class'].includes(n.kind))
      ).slice(0, 40);
      dd.innerHTML = matches.map(n => \`
        <div class="picker-item" data-pk-kind="\${esc(n.kind)}" data-pk-id="\${esc(n.id)}">
          <span><span class="badge b-\${n.layer}">\${esc(n.kind)}</span> \${esc(n.label)}</span>
          <span class="card-sub" style="margin:0;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${esc(n.sublabel)}</span>
        </div>\`).join('') || '<div class="picker-item">No matches</div>';
      dd.classList.add('open');
    }
    inp.addEventListener('focus', () => { inp.select(); showMatches(''); });
    inp.addEventListener('input', () => showMatches(inp.value));
    dd.addEventListener('mousedown', (e) => {
      const item = e.target.closest('[data-pk-kind]');
      if (!item) return;
      e.preventDefault();
      dd.classList.remove('open');
      onSelect(item.dataset.pkKind, item.dataset.pkId);
    });
    inp.addEventListener('blur', () => setTimeout(() => dd.classList.remove('open'), 150));
  }

  function wireGraphInteractions() {
    const g = state.graph;
    wirePicker('picker-from', 'dropdown-from', (kind, id) => {
      g.from = { kind, id };
      g.inspectedKey = kind + ':' + id;
      g.customPos = {}; g.activePathIdx = -1;
      syncHash(false); render();
    });
    wirePicker('picker-to', 'dropdown-to', (kind, id) => {
      g.to = { kind, id };
      g.inspectedKey = kind + ':' + id;
      g.customPos = {}; g.activePathIdx = -1;
      syncHash(false); render();
    });

    const nfInput = document.getElementById('input-g-nodefilter');
    if (nfInput) {
      nfInput.addEventListener('input', (e) => {
        g.nodeFilter = e.target.value;
        const selStart = e.target.selectionStart;
        syncHash(true);
        render();
        const nextInp = document.getElementById('input-g-nodefilter');
        if (nextInp) { nextInp.focus(); nextInp.setSelectionRange(selStart, selStart); }
      });
    }

    const svg = document.getElementById('graph-svg');
    const vp = document.getElementById('graph-viewport');
    if (!svg || !vp) return;

    function applyTransform() {
      vp.setAttribute('transform', \`translate(\${g.panX},\${g.panY}) scale(\${g.zoom})\`);
    }

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const nextZoom = Math.max(0.25, Math.min(4, g.zoom * factor));
      const rect = svg.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 900;
      const my = ((e.clientY - rect.top) / rect.height) * 540;
      g.panX = mx - (mx - g.panX) * (nextZoom / g.zoom);
      g.panY = my - (my - g.panY) * (nextZoom / g.zoom);
      g.zoom = nextZoom;
      applyTransform();
    }, { passive: false });

    svg.addEventListener('mousedown', (e) => {
      const nodeEl = e.target.closest('.g-node');
      const rect = svg.getBoundingClientRect();
      const scaleX = 900 / rect.width;
      const scaleY = 540 / rect.height;
      if (nodeEl) {
        e.stopPropagation();
        const key = nodeEl.dataset.nodeKey;
        const circle = nodeEl.querySelector('circle');
        activeDrag = {
          type: 'node',
          svg, vp,
          key,
          startX: e.clientX,
          startY: e.clientY,
          origX: Number(circle.getAttribute('cx')),
          origY: Number(circle.getAttribute('cy')),
          scaleX, scaleY,
          moved: false
        };
      } else {
        activeDrag = {
          type: 'pan',
          svg, vp,
          startX: e.clientX,
          startY: e.clientY,
          origPanX: g.panX,
          origPanY: g.panY,
          scaleX, scaleY,
          moved: false
        };
      }
    });
  }

  let activeDrag = null;
  window.addEventListener('mousemove', (e) => {
    if (!activeDrag) return;
    const g = state.graph;
    const dx = (e.clientX - activeDrag.startX) * activeDrag.scaleX;
    const dy = (e.clientY - activeDrag.startY) * activeDrag.scaleY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) activeDrag.moved = true;
    if (activeDrag.type === 'pan') {
      g.panX = activeDrag.origPanX + dx;
      g.panY = activeDrag.origPanY + dy;
      activeDrag.vp.setAttribute('transform', \`translate(\${g.panX},\${g.panY}) scale(\${g.zoom})\`);
    } else if (activeDrag.type === 'node' && activeDrag.moved) {
      const nx = activeDrag.origX + dx / g.zoom;
      const ny = activeDrag.origY + dy / g.zoom;
      g.customPos[activeDrag.key] = { x: nx, y: ny };
      const nodeEl = activeDrag.svg.querySelector(\`.g-node[data-node-key="\${CSS.escape(activeDrag.key)}"]\`);
      if (nodeEl) {
        const circle = nodeEl.querySelector('circle');
        const r = Number(circle.getAttribute('r'));
        circle.setAttribute('cx', nx);
        circle.setAttribute('cy', ny);
        const texts = nodeEl.querySelectorAll('text');
        if (texts[0]) { texts[0].setAttribute('x', nx); texts[0].setAttribute('y', ny + r + 12); }
        if (texts[1]) { texts[1].setAttribute('x', nx); texts[1].setAttribute('y', ny + 4); }
      }
      activeDrag.svg.querySelectorAll('.g-edge').forEach(eg => {
        const isFrom = eg.dataset.from === activeDrag.key;
        const isTo = eg.dataset.to === activeDrag.key;
        if (!isFrom && !isTo) return;
        const line = eg.querySelector('line');
        const txt = eg.querySelector('text');
        if (isFrom) { line.setAttribute('x1', nx); line.setAttribute('y1', ny); }
        if (isTo) { line.setAttribute('x2', nx); line.setAttribute('y2', ny); }
        const x1 = Number(line.getAttribute('x1')), y1 = Number(line.getAttribute('y1'));
        const x2 = Number(line.getAttribute('x2')), y2 = Number(line.getAttribute('y2'));
        txt.setAttribute('x', (x1 + x2) / 2);
        txt.setAttribute('y', (y1 + y2) / 2 - 4);
      });
    }
  });

  window.addEventListener('mouseup', () => {
    if (activeDrag && activeDrag.type === 'node' && !activeDrag.moved) {
      state.graph.inspectedKey = activeDrag.key;
      activeDrag = null;
      render();
      return;
    }
    activeDrag = null;
  });

  function render() {
    renderList();
    renderDetail();
  }

  // Event delegation
  document.addEventListener('click', (e) => {
    if (e.target.closest('.g-node')) return; // handled by svg mouseup for drag vs click

    const graphBtn = e.target.closest('[data-graph-node-kind]');
    if (graphBtn) {
      const k = graphBtn.dataset.graphNodeKind;
      const id = graphBtn.dataset.graphNodeId;
      state.selected = { kind: k, id };
      state.graph.mode = 'neighborhood';
      state.graph.from = { kind: k, id };
      state.graph.inspectedKey = k + ':' + id;
      state.graph.customPos = {}; state.graph.activePathIdx = -1;
      state.tab = 'graph';
      syncTabUI(); syncHash(false); render();
      return;
    }

    const famEl = e.target.closest('[data-toggle-family]');
    if (famEl) {
      const fam = famEl.dataset.toggleFamily;
      if (state.expandedFamilies.has(fam)) state.expandedFamilies.delete(fam);
      else state.expandedFamilies.add(fam);
      renderList();
      return;
    }

    const openDet = e.target.closest('[data-open-detail-kind]');
    if (openDet) {
      const k = openDet.dataset.openDetailKind;
      const id = openDet.dataset.openDetailId;
      state.selected = { kind: k, id };
      state.tab = defaultTabForKind(k);
      if (k === 'file') state.codeSubtab = 'files';
      if (k === 'story') state.codeSubtab = 'stories';
      syncTabUI(); syncHash(false); render();
      return;
    }

    const navEl = e.target.closest('[data-nav-kind]');
    if (navEl) {
      navigateTo(navEl.dataset.navKind, navEl.dataset.navId);
      return;
    }
    const tabEl = e.target.closest('#main-tabs .tab');
    if (tabEl) {
      state.tab = tabEl.dataset.tab;
      if (state.tab === 'domain' && state.selected.kind !== 'class' && state.selected.kind !== 'stereotype' && DATA.classes[0]) state.selected = { kind: 'class', id: DATA.classes[0].curie };
      if (state.tab === 'issues' && state.selected.kind !== 'issue' && DATA.qaIssues[0]) state.selected = { kind: 'issue', id: DATA.qaIssues[0].id };
      if (state.tab === 'code' && state.selected.kind !== 'file' && DATA.codeFiles[0]) state.selected = { kind: 'file', id: DATA.codeFiles[0].p };
      if (state.tab === 'graph' && !state.graph.from.id) state.graph.from = { ...state.selected };
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

    // Graph controls
    if (e.target.id === 'btn-gmode-neigh') { state.graph.mode = 'neighborhood'; state.graph.customPos = {}; state.graph.activePathIdx = -1; syncHash(false); render(); return; }
    if (e.target.id === 'btn-gmode-path') { state.graph.mode = 'path'; state.graph.customPos = {}; state.graph.activePathIdx = -1; syncHash(false); render(); return; }
    if (e.target.id === 'btn-g-swap') {
      const tmp = state.graph.from; state.graph.from = state.graph.to; state.graph.to = tmp;
      state.graph.customPos = {}; state.graph.activePathIdx = -1; syncHash(false); render(); return;
    }
    if (e.target.id === 'btn-g-fullscreen') {
      state.graph.fullscreen = !state.graph.fullscreen; syncTabUI(); syncHash(true); render(); return;
    }
    if (e.target.id === 'btn-show-all-nodes') { state.graph.showAllNodes = true; render(); return; }
    if (e.target.id === 'btn-clear-path') { state.graph.activePathIdx = -1; syncHash(true); render(); return; }
    if (e.target.id === 'btn-zoom-in') { state.graph.zoom = Math.min(4, state.graph.zoom * 1.25); render(); return; }
    if (e.target.id === 'btn-zoom-out') { state.graph.zoom = Math.max(0.25, state.graph.zoom * 0.8); render(); return; }
    if (e.target.id === 'btn-zoom-reset') { state.graph.zoom = 1; state.graph.panX = 0; state.graph.panY = 0; state.graph.customPos = {}; render(); return; }

    if (e.target.id === 'btn-preset-jrn-test') {
      const j = (state.selected.kind === 'journey' ? journeyById.get(state.selected.id) : null) || DATA.qaJourneys.find(x => x.stories?.length || x.pwSpec) || DATA.qaJourneys[0];
      if (j) {
        state.graph.mode = 'path';
        state.graph.from = { kind: 'journey', id: j.id };
        if (j.stories?.length) state.graph.to = { kind: 'story', id: j.stories[0] };
        else if (j.pwSpec) state.graph.to = { kind: 'file', id: j.pwSpec };
        else if (DATA.codeStories?.[0]) state.graph.to = { kind: 'story', id: DATA.codeStories[0].id };
        state.graph.customPos = {}; state.graph.activePathIdx = -1; syncHash(false); render();
      }
      return;
    }
    if (e.target.id === 'btn-preset-pat-jrn') {
      const j = (state.selected.kind === 'journey' ? journeyById.get(state.selected.id) : null) || DATA.qaJourneys.find(x => x.seedNouns?.length) || DATA.qaJourneys[0];
      const firstClass = j?.seedNouns?.[0] ? classByCurie.get(j.seedNouns[0]) : null;
      const st = firstClass?.stereotype || DATA.stereotypes[0] || 'ufo:Kind';
      state.graph.mode = 'path';
      state.graph.from = { kind: 'stereotype', id: st };
      if (j) state.graph.to = { kind: 'journey', id: j.id };
      state.graph.customPos = {}; state.graph.activePathIdx = -1; syncHash(false); render();
      return;
    }

    const kindChip = e.target.closest('[data-g-kind]');
    if (kindChip) {
      const k = kindChip.dataset.gKind;
      state.graph.enabledKinds[k] = !state.graph.enabledKinds[k];
      state.graph.activePathIdx = -1;
      syncHash(true);
      render();
      return;
    }
    const predChip = e.target.closest('[data-g-pred]');
    if (predChip) {
      const p = predChip.dataset.gPred;
      if (state.graph.disabledPreds.has(p)) state.graph.disabledPreds.delete(p);
      else state.graph.disabledPreds.add(p);
      state.graph.activePathIdx = -1;
      syncHash(true);
      render();
      return;
    }
    if (e.target.id === 'btn-kinds-all') {
      Object.keys(state.graph.enabledKinds).forEach(k => { state.graph.enabledKinds[k] = true; });
      syncHash(true);
      render(); return;
    }
    if (e.target.id === 'btn-kinds-none') {
      Object.keys(state.graph.enabledKinds).forEach(k => { state.graph.enabledKinds[k] = false; });
      syncHash(true);
      render(); return;
    }
    if (e.target.id === 'btn-preds-all') {
      state.graph.disabledPreds.clear();
      syncHash(true);
      render(); return;
    }
    const pathItem = e.target.closest('[data-path-idx]');
    if (pathItem) {
      const idx = Number(pathItem.dataset.pathIdx);
      state.graph.activePathIdx = state.graph.activePathIdx === idx ? -1 : idx;
      syncHash(true);
      render(); return;
    }
    if (e.target.id === 'btn-insp-set-a') {
      state.graph.mode = 'path';
      state.graph.from = { kind: e.target.dataset.k, id: e.target.dataset.id };
      state.graph.customPos = {}; state.graph.activePathIdx = -1; syncHash(false); render(); return;
    }
    if (e.target.id === 'btn-insp-set-b') {
      state.graph.mode = 'path';
      state.graph.to = { kind: e.target.dataset.k, id: e.target.dataset.id };
      state.graph.customPos = {}; state.graph.activePathIdx = -1; syncHash(false); render(); return;
    }
    if (e.target.id === 'btn-insp-neigh') {
      state.graph.mode = 'neighborhood';
      state.graph.from = { kind: e.target.dataset.k, id: e.target.dataset.id };
      state.graph.customPos = {}; state.graph.activePathIdx = -1; syncHash(false); render(); return;
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
      state.graph.mode = 'neighborhood';
      state.graph.from = { ...state.selected };
      state.graph.inspectedKey = state.selected.kind + ':' + state.selected.id;
      state.graph.customPos = {}; state.graph.activePathIdx = -1;
      state.tab = 'graph';
      syncTabUI();
      syncHash(false);
      render();
      return;
    }
    if (e.target.id === 'btn-find-path') {
      state.graph.mode = 'path';
      state.graph.from = { ...state.selected };
      state.graph.inspectedKey = state.selected.kind + ':' + state.selected.id;
      state.graph.customPos = {}; state.graph.activePathIdx = -1;
      state.tab = 'graph';
      syncTabUI();
      syncHash(false);
      render();
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'sel-g-hops') { state.graph.hops = Number(e.target.value); state.graph.customPos = {}; syncHash(true); render(); }
    if (e.target.id === 'sel-g-budget') { state.graph.pathBudget = e.target.value; state.graph.customPos = {}; state.graph.activePathIdx = -1; syncHash(true); render(); }
    if (e.target.id === 'sel-g-filtermode') { state.graph.nodeFilterMode = e.target.value; syncHash(true); render(); }
    if (e.target.id === 'chk-domain-simplify') { state.domainSimplify = e.target.checked; renderList(); }
  });

  function applyTheme(mode) {
    state.theme = mode || 'system';
    if (state.theme === 'light' || state.theme === 'dark') {
      document.documentElement.dataset.theme = state.theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
    const sel = document.getElementById('theme-select');
    if (sel) sel.value = state.theme;
    try { localStorage.setItem('wod-ontology-theme', state.theme); } catch {}
  }

  document.getElementById('theme-select').addEventListener('change', (e) => {
    applyTheme(e.target.value);
  });

  window.addEventListener('hashchange', () => {
    if (applyHashFromLocation()) render();
  });

  document.getElementById('env-select').addEventListener('change', (e) => {
    state.env = e.target.value;
    syncSurfaceLinks();
    render();
  });
  document.getElementById('search-input').addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); syncHash(true); render(); });
  document.getElementById('filter-domain').addEventListener('change', (e) => { state.domain = e.target.value; syncHash(true); render(); });
  document.getElementById('filter-priority').addEventListener('change', (e) => { state.priority = e.target.value; syncHash(true); render(); });
  document.getElementById('filter-stereotype').addEventListener('change', (e) => { state.stereotype = e.target.value; syncHash(true); render(); });
  document.getElementById('filter-severity').addEventListener('change', (e) => { state.severity = e.target.value; syncHash(true); render(); });
  document.getElementById('filter-status').addEventListener('change', (e) => { state.status = e.target.value; syncHash(true); render(); });
  document.querySelectorAll('.layer-toggle input').forEach(cb => {
    cb.addEventListener('change', (e) => { state.layers[e.target.dataset.layer] = e.target.checked; syncHash(true); render(); });
  });

  applyTheme(state.theme);
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
