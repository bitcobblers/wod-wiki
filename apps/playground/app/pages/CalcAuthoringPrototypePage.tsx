/**
 * PROTOTYPE — throwaway. Answers issue #863: does guided typeahead make
 * calc-line authoring feel simple enough? Three variants, switchable below:
 *   ?v=text   — single-line editor + context typeahead + diagnostics (recommended in §11.6)
 *   ?v=slots  — token-slot pills (WqlComposer interaction model)
 *   ?v=guided — step-by-step builder (dropdown-only; expected to collapse on TIS)
 * Fixture data is fake; the mini-engine (dims, lookups, variants, preview) is real enough to react to.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// ── Dimensions (exponent vectors over L,M,T,C,E) ────────────────────────────
type Dim = [number, number, number, number, number];
const D = (l = 0, m = 0, t = 0, c = 0, e = 0): Dim => [l, m, t, c, e];
const dAdd = (a: Dim, b: Dim): Dim => a.map((x, i) => x + b[i]) as Dim;
const dSub = (a: Dim, b: Dim): Dim => a.map((x, i) => x - b[i]) as Dim;
const dEq = (a: Dim, b: Dim) => a.every((x, i) => x === b[i]);
const ZERO = D();
const DIM_NAMES = ['length', 'mass', 'time', 'count', 'energy'];
function dimLabel(d: Dim): string {
  if (dEq(d, ZERO)) return 'dimensionless';
  const parts: string[] = [];
  d.forEach((x, i) => { if (x !== 0) parts.push(`${DIM_NAMES[i]}${x !== 1 ? '^' + x : ''}`); });
  return parts.join(' · ');
}

// ── Units ────────────────────────────────────────────────────────────────────
interface UnitDef { dim: Dim; toBase: number; }
const UNITS: Record<string, UnitDef> = {
  m: { dim: D(1), toBase: 1 }, km: { dim: D(1), toBase: 1000 }, mi: { dim: D(1), toBase: 1609.34 },
  kg: { dim: D(0, 1), toBase: 1 }, lb: { dim: D(0, 1), toBase: 0.4536 },
  ms: { dim: D(0, 0, 1), toBase: 0.001 }, s: { dim: D(0, 0, 1), toBase: 1 }, min: { dim: D(0, 0, 1), toBase: 60 }, h: { dim: D(0, 0, 1), toBase: 3600 },
  reps: { dim: D(0, 0, 0, 1), toBase: 1 }, cal: { dim: D(0, 0, 0, 0, 1), toBase: 1 },
  MET: { dim: ZERO, toBase: 1 }, pts: { dim: ZERO, toBase: 1 }, AU: { dim: ZERO, toBase: 1 }, ratio: { dim: ZERO, toBase: 1 }, 'MET-min': { dim: D(0, 0, 1), toBase: 60 },
  'reps/min': { dim: dSub(D(0, 0, 0, 1), D(0, 0, 1)), toBase: 1 / 60 }, 'm/s': { dim: dSub(D(1), D(0, 0, 1)), toBase: 1 },
  'min/km': { dim: dSub(D(0, 0, 1), D(1)), toBase: 60 / 1000 }, 'sec/km': { dim: dSub(D(0, 0, 1), D(1)), toBase: 1 / 1000 },
  'min/mi': { dim: dSub(D(0, 0, 1), D(1)), toBase: 60 / 1609.34 }, 'km/h': { dim: dSub(D(1), D(0, 0, 1)), toBase: 1000 / 3600 },
  'kg/s': { dim: dSub(dAdd(D(0, 1), D(0, 0, 0, 1)), D(0, 0, 1)), toBase: 1 }, 'lb/s': { dim: dSub(dAdd(D(0, 1), D(0, 0, 0, 1)), D(0, 0, 1)), toBase: 0.4536 },
};
const NAMED_COMPOUNDS: { dim: Dim; name: string; units: string[] }[] = [
  { dim: dSub(D(0, 0, 1), D(1)), name: 'pace', units: ['min/km', 'sec/km', 'min/mi'] },
  { dim: dSub(D(1), D(0, 0, 1)), name: 'speed', units: ['m/s', 'km/h'] },
  { dim: dAdd(D(0, 1), D(0, 0, 0, 1)), name: 'volume', units: ['kg', 'lb'] },
  { dim: dSub(dAdd(D(0, 1), D(0, 0, 0, 1)), D(0, 0, 1)), name: 'power', units: ['kg/s', 'lb/s'] },
  { dim: D(0, 0, 1), name: 'time', units: ['min', 's', 'MET-min'] },
  { dim: D(0, 0, 0, 1), name: 'count', units: ['reps'] },
  { dim: D(1), name: 'length', units: ['m', 'km', 'mi'] },
  { dim: D(0, 1), name: 'mass', units: ['kg', 'lb'] },
  { dim: ZERO, name: 'dimensionless', units: ['pts', 'AU', 'MET'] },
];
const compoundFor = (d: Dim) => NAMED_COMPOUNDS.find(c => dEq(c.dim, d));

// ── Values & evaluator ───────────────────────────────────────────────────────
interface Val { v: number; dim: Dim; unit?: string; }
const val = (v: number, dim: Dim = ZERO): Val => ({ v, dim });

type Ctx = Record<string, Val | undefined>;

const EFFORT_TABLE: Record<string, { met: number; discipline: string; disciplineFactor: number; intensityTier: string; resolvedFrom: string }> = {
  thruster: { met: 6.0, discipline: 'strength', disciplineFactor: 1.2, intensityTier: 'high', resolvedFrom: 'bundled' },
  'pull-up': { met: 5.0, discipline: 'gymnastics', disciplineFactor: 1.2, intensityTier: 'moderate', resolvedFrom: 'bundled' },
  run: { met: 9.8, discipline: 'running', disciplineFactor: 1.0, intensityTier: 'high', resolvedFrom: 'bundled' },
  squat: { met: 5.0, discipline: 'strength', disciplineFactor: 1.2, intensityTier: 'moderate', resolvedFrom: 'bundled' },
};
const EFFORT_FIELDS: Record<string, Dim> = { met: D(0, 0, 0, 0, 0), disciplineFactor: ZERO };
const RPE_TABLE: Record<string, number> = { easy: 3, moderate: 5, hard: 7, 'all-out': 10, max: 10 };
const TABLES: Record<string, { fields: string[]; get: (k: string, f: string) => Val | undefined }> = {
  effort: {
    fields: ['met', 'discipline', 'disciplineFactor', 'intensityTier', 'resolvedFrom'],
    get: (k, f) => {
      const row = EFFORT_TABLE[k];
      if (!row) return f === 'resolvedFrom' ? val(NaN) : undefined;
      const x: unknown = row[f as keyof typeof row];
      return typeof x === 'number' ? { v: x, dim: EFFORT_FIELDS[f] ?? ZERO } : undefined;
    },
  },
  'rpe-labels': { fields: ['rpe'], get: (k) => (RPE_TABLE[k] !== undefined ? val(RPE_TABLE[k]) : undefined) },
};
const FN_DIMS: Record<string, (args: Val[]) => Val> = {
  min: (a) => val(Math.min(...a.map(x => x.v)), a[0]?.dim ?? ZERO),
  max: (a) => val(Math.max(...a.map(x => x.v)), a[0]?.dim ?? ZERO),
  abs: (a) => val(Math.abs(a[0].v), a[0].dim),
  round: (a) => val(a.length > 1 ? +a[0].v.toFixed(a[1].v) : Math.round(a[0].v), a[0].dim),
  floor: (a) => val(Math.floor(a[0].v), a[0].dim),
  ceil: (a) => val(Math.ceil(a[0].v), a[0].dim),
  clamp: (a) => val(Math.min(Math.max(a[0].v, a[1].v), a[2].v), a[0].dim),
    convert: (a) => {
    const target = a[1].unit ?? '';
    const u = UNITS[target];
    if (!u || !dEq(u.dim, a[0].dim)) throw new Error(`convert: ${target} dimension ≠ value dimension`);
    // value is stored in base units of its dim; toBase converts 1 target-unit → base
    return { v: a[0].v / u.toBase, dim: a[0].dim };
  },
};
const FN_NAMES = Object.keys(FN_DIMS).concat(['has', 'lookup']);

// ── Tokenizer + Pratt parser ─────────────────────────────────────────────────
interface Tok { t: string; s: string; }
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const re = /\s*("[^"]*"|\d+\.?\d*|[a-zA-Z_][\w.-]*(?::[\w.:*!|,-]+(?:\{[^}]*\})?(?:\s+by\s+\{[^}]*\})?)?|[-+*/(),<>!=]=?|>=|<=|==)/y;
  let m; let last = 0;
  while (last < src.length) {
    re.lastIndex = last;
    m = re.exec(src);
    if (!m || m.index !== last) { if (/\S/.test(src[last])) toks.push({ t: 'err', s: src[last] }); last += 1; continue; }
    last = re.lastIndex;
    const s = m[1];
    if (/^".*"$/.test(s)) toks.push({ t: 'str', s: s.slice(1, -1) });
    else if (/^\d/.test(s)) toks.push({ t: 'num', s });
    else if (/^[-+*/(),]$/.test(s) || ['>=', '<=', '==', '!=', '>', '<', '='].includes(s)) toks.push({ t: 'op', s });
    else toks.push({ t: 'id', s });
  }
  return toks;
}
type Node =
  | { k: 'num'; v: number } | { k: 'str'; s: string } | { k: 'id'; s: string }
  | { k: 'call'; f: string; args: Node[] } | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'neg'; e: Node };
function parse(toks: Tok[]): Node {
  let i = 0;
  const peek = () => toks[i];
  function expr(minBp: number): Node {
    let lhs: Node;
    const t = toks[i++];
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') lhs = { k: 'num', v: parseFloat(t.s) };
    else if (t.t === 'str') lhs = { k: 'str', s: t.s };
    else if (t.s === '-') lhs = { k: 'neg', e: expr(70) };
    else if (t.s === '(') { lhs = expr(0); if (peek()?.s !== ')') throw new Error('missing )'); i++; }
    else if (t.t === 'id') {
      if (peek()?.s === '(') {
        i++; const args: Node[] = [];
        if (peek()?.s !== ')') { for (;;) { args.push(expr(0)); if (peek()?.s === ',') { i++; continue; } break; } }
        if (peek()?.s !== ')') throw new Error('missing )'); i++;
        lhs = { k: 'call', f: t.s, args };
      } else lhs = { k: 'id', s: t.s };
    } else throw new Error(`unexpected "${t.s}"`);
    for (;;) {
      const op = peek()?.s;
      const bp = op === '*' || op === '/' ? 60 : op === '+' || op === '-' ? 50
        : ['<', '<=', '>', '>=', '==', '!='].includes(op!) ? 40
        : op === 'and' ? 30 : op === 'or' ? 20 : 0;
      if (!bp || bp < minBp) break;
      i++;
      const r = expr(bp + 1);
      lhs = { k: 'bin', op: op!, l: lhs, r };
    }
    return lhs;
  }
  const n = expr(0);
  if (i < toks.length) throw new Error(`trailing "${toks[i].s}"`);
  return n;
}

function evalNode(n: Node, ctx: Ctx, wql: (atom: string) => Val | undefined): Val {
  switch (n.k) {
    case 'num': return val(n.v);
    case 'str': return { v: NaN, dim: ZERO, unit: n.s };
    case 'neg': { const e = evalNode(n.e, ctx, wql); return val(-e.v, e.dim); }
    case 'id': {
      if (/^(sum|avg|max|min|count|last):/.test(n.s)) {
        const r = wql(n.s);
        if (!r) throw new Error(`no data for ${n.s}`);
        return r;
      }
      const c = ctx[n.s];
      if (c === undefined) throw new Error(`unknown or absent: ${n.s}`);
      return c;
    }
    case 'bin': {
      if (n.op === 'and') return val(evalNode(n.l, ctx, wql).v && evalNode(n.r, ctx, wql).v ? 1 : 0);
      if (n.op === 'or') return val(evalNode(n.l, ctx, wql).v || evalNode(n.r, ctx, wql).v ? 1 : 0);
      const l = evalNode(n.l, ctx, wql); const r = evalNode(n.r, ctx, wql);
      switch (n.op) {
        case '+': if (!dEq(l.dim, r.dim)) throw new Error(`+ : ${dimLabel(l.dim)} vs ${dimLabel(r.dim)}`); return val(l.v + r.v, l.dim);
        case '-': if (!dEq(l.dim, r.dim)) throw new Error(`- : ${dimLabel(l.dim)} vs ${dimLabel(r.dim)}`); return val(l.v - r.v, l.dim);
        case '*': return val(l.v * r.v, dAdd(l.dim, r.dim));
        case '/': return val(l.v / r.v, dSub(l.dim, r.dim));
        case '<': return val(l.v < r.v ? 1 : 0); case '<=': return val(l.v <= r.v ? 1 : 0);
        case '>': return val(l.v > r.v ? 1 : 0); case '>=': return val(l.v >= r.v ? 1 : 0);
        case '==': return val(l.v === r.v ? 1 : 0); case '!=': return val(l.v !== r.v ? 1 : 0);
      }
      throw new Error(n.op);
    }
    case 'call': {
      if (n.f === 'has') {
        const a = n.args[0];
        if (a.k === 'id') return val(ctx[a.s] !== undefined || /^(sum|avg|max|min|count|last):/.test(a.s) && wql(a.s) !== undefined ? 1 : 0);
        return val(0);
      }
      if (n.f === 'lookup') {
        const [t, k, f] = n.args;
        const table = t.k === 'str' ? t.s : '';
        const key = k.k === 'str' ? k.s : k.k === 'id' ? String(ctx[k.s]?.v ?? k.s) : '';
        const field = f.k === 'str' ? f.s : '';
        const tb = TABLES[table];
        if (!tb) throw new Error(`unknown table "${table}"`);
        if (!tb.fields.includes(field)) throw new Error(`table "${table}" has no field "${field}"`);
        if (table === 'effort' && field === 'resolvedFrom') return val(EFFORT_TABLE[key] ? 1 : 0);
        const r = tb.get(key, field);
        if (!r) throw new Error(`lookup miss: ${table}/${key}/${field}`);
        return r;
      }
      const fn = FN_DIMS[n.f];
      if (!fn) throw new Error(`unknown function ${n.f}`);
      // convert(x, unit) accepts a bare unit token: convert(elapsed, min)
      const args = n.args.map((a, idx) => (n.f === 'convert' && idx > 0 && a.k === 'id') ? { v: NaN, dim: ZERO, unit: a.s } : evalNode(a, ctx, wql));
      return fn(args);
    }
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
interface FxSegment { effort: string; label?: string; reps?: number; resistanceKg?: number; distanceM?: number; elapsedMs: number; }
const FRAN: FxSegment[] = [
  { effort: 'thruster', label: 'hard', reps: 21, resistanceKg: 43, elapsedMs: 95000 },
  { effort: 'pull-up', reps: 21, elapsedMs: 60000 },
  { effort: 'thruster', reps: 15, resistanceKg: 43, elapsedMs: 70000 },
  { effort: 'pull-up', reps: 15, elapsedMs: 50000 },
  { effort: 'sled-push', reps: 9, resistanceKg: 43, elapsedMs: 45000 }, // unresolved effort → estimated MET
  { effort: 'pull-up', reps: 9, elapsedMs: 30000 },
];
const DAILY_LOADS = [420, 0, 380, 510, 0, 290, 610, 450, 0, 520, 340, 0, 480, 390, 560, 0, 410, 470, 0, 530, 360, 440, 0, 500, 580, 320, 0, 460];

// phase-1 library values per segment (segmentVolume, metMinutes, effortRpe)
function enrich(s: FxSegment) {
  const met = EFFORT_TABLE[s.effort]?.met ?? 4.0; // default-MET miss policy
  const estimated = !EFFORT_TABLE[s.effort];
  return {
    segmentVolume: s.reps && s.resistanceKg ? val(s.reps * s.resistanceKg, dAdd(D(0, 1), D(0, 0, 0, 1))) : undefined,
    metMinutes: val(met * (s.elapsedMs / 60000), D(0, 0, 1)),
    metMinutesEstimated: estimated ? val(1) : undefined,
    effortRpe: s.label ? val(RPE_TABLE[s.label] ?? 0) : undefined,
  };
}

// ── Calc-line model ──────────────────────────────────────────────────────────
interface CalcLine {
  name: string; exprSrc: string; alternates: { src: string; estimated: boolean }[];
  unit?: string; whenSrc?: string; library: boolean;
  bindings: { name: string; src: string }[];
  error?: string;
}
function parseLine(src: string): CalcLine {
  const out: CalcLine = { name: '', exprSrc: '', alternates: [], library: false, bindings: [] };
  try {
    let rest = src.trim();
    const whenM = /\s+when\s+/.exec(rest);
    if (whenM) { out.whenSrc = rest.slice(whenM.index + whenM[0].length).trim(); rest = rest.slice(0, whenM.index); }
    const whereM = /\s+where\s+/.exec(rest);
    if (whereM) {
      const b = rest.slice(whereM.index + whereM[0].length).trim();
      rest = rest.slice(0, whereM.index);
      for (const part of b.split(/,\s*(?=[a-zA-Z_][\w]*\s*=)/)) {
        const eq = part.indexOf('=');
        if (eq > 0) out.bindings.push({ name: part.slice(0, eq).trim(), src: part.slice(eq + 1).trim() });
      }
    }
    const arrowM = /\s*->\s*/.exec(rest);
    if (arrowM) { out.unit = rest.slice(arrowM.index + arrowM[0].length).trim().replace(/\s+(key|grouped).*$/, ''); rest = rest.slice(0, arrowM.index); }
    if (/\(library\)/.test(rest)) { out.library = true; rest = rest.replace('(library)', ''); }
    const eq = rest.indexOf('=');
    if (eq < 0) throw new Error('expected name = expression');
    out.name = rest.slice(0, eq).trim();
    const exprAll = rest.slice(eq + 1).trim();
    const alts = exprAll.split('|').map(s => s.trim());
    out.exprSrc = alts[0];
    out.alternates = alts.slice(1).map(a => ({ src: a.replace(/\s*estimated\s*$/, ''), estimated: /\bestimated\b/.test(a) }));
    return out;
  } catch (e: unknown) { out.error = e instanceof Error ? e.message : String(e); return out; }
}

interface EvalResult {
  calc: CalcLine; dim?: Dim; valuePreview?: string; perSegment?: (string | null)[];
  running?: (string | null)[]; diagnostics: string[]; variantUsed?: string;
}

function makeCtx(s: FxSegment, extra: Ctx, sessionRpe?: number, vo2max?: number): Ctx {
  const e = enrich(s);
  return {
    elapsed: val(s.elapsedMs / 1000, D(0, 0, 1)), // base unit: seconds
    reps: s.reps !== undefined ? val(s.reps, D(0, 0, 0, 1)) : undefined,
    resistance: s.resistanceKg !== undefined ? val(s.resistanceKg, D(0, 1)) : undefined,
    distance: s.distanceM !== undefined ? val(s.distanceM, D(1)) : undefined,
    effort: val(NaN), // opaque slug carrier; key usage goes through lookup key coercion
    effortLabel: s.label ? val(NaN) : undefined,
    segmentVolume: e.segmentVolume, metMinutes: e.metMinutes, effortRpe: e.effortRpe,
    sessionRpe: sessionRpe !== undefined ? val(sessionRpe) : undefined,
    'profile.vo2max': vo2max !== undefined ? val(vo2max) : undefined,
    ...extra,
  };
}
// string coercion for lookup keys: ctx carries slug separately
const slugOf = (s: FxSegment) => s.effort;

function evaluateCalc(src: string, scope: string, sessionRpe: number | undefined, vo2max: number | undefined): EvalResult {
  const calc = parseLine(src);
  const diagnostics: string[] = [];
  if (calc.error) return { calc, diagnostics: [calc.error] };
  const result: EvalResult = { calc, diagnostics };

  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  // static checks (store-scope preview is name-driven; window syntax is illustrative)
  if (scope !== 'store') {
    try { parse(tokenize(calc.exprSrc)); } catch (e: unknown) { diagnostics.push(`expression: ${errMsg(e)}`); }
    for (const b of calc.bindings) { for (const alt of b.src.split('|')) { try { parse(tokenize(alt.replace(/\s*estimated\s*$/, ''))); } catch (e: unknown) { diagnostics.push(`${b.name}: ${errMsg(e)}`); } } }
    if (calc.whenSrc) { try { parse(tokenize(calc.whenSrc)); } catch (e: unknown) { diagnostics.push(`when: ${errMsg(e)}`); } }
  }

  const hist: FxSegment[] = FRAN;
  const wql = (atom: string, upto = hist.length): Val | undefined => {
    const m = /^(sum|avg|max|min|count|last):([\w.]+)/.exec(atom);
    if (!m) return undefined;
    const [, agg, metric] = m;
    const segs = hist.slice(0, upto);
    const vals: Val[] = [];
    for (const s of segs) {
      const c = makeCtx(s, {}, sessionRpe, vo2max);
      const v = c[metric];
      if (v !== undefined && !Number.isNaN(v.v)) vals.push(v);
    }
    if (metric === 'sessionLoad' && atom.includes('by {day}')) return val(NaN);
    if (!vals.length) return undefined;
    const d0 = vals[0].dim;
    const nums = vals.map(x => x.v);
    if (agg === 'sum') return val(nums.reduce((a, b) => a + b, 0), d0);
    if (agg === 'avg') return val(nums.reduce((a, b) => a + b, 0) / nums.length, d0);
    if (agg === 'max') return val(Math.max(...nums), d0);
    if (agg === 'min') return val(Math.min(...nums), d0);
    if (agg === 'count') return val(nums.length, D(0, 0, 0, 1));
    if (agg === 'last') return vals[vals.length - 1];
    return undefined;
  };

  const evalWithBindings = (expr: string, ctx: Ctx, upto: number): Val => {
    const local: Ctx = { ...ctx };
    for (const b of calc.bindings) {
      // binding values may carry `| alt estimated` variant sugar — first that evaluates wins
      const alts = b.src.split('|').map(s => s.replace(/\s*estimated\s*$/, '').trim());
      let bv: Val | undefined;
      for (const alt of alts) { try { bv = evalWith(alt, local, upto); break; } catch { /* next alternate */ } }
      if (bv === undefined) throw new Error(`${b.name}: no applicable variant`);
      local[b.name] = bv;
    }
    return evalWith(expr, local, upto);
  };
  const evalWith = (expr: string, ctx: Ctx, upto: number): Val =>
    evalNode(parse(tokenize(expr)), ctx, (a) => wql(a, upto));

  try {
    if (scope === 'segment') {
      const per: (string | null)[] = [];
      let firstDim: Dim | undefined;
      hist.forEach((s, i) => {
        try {
          const ctx = makeCtx(s, {}, sessionRpe, vo2max);
          ctx.effort = undefined; // slug via lookup key literal in proto
          if (calc.whenSrc && !evalWith(calc.whenSrc, ctx, i + 1).v) { per.push(null); return; }
          // effort slug: substitute bare `effort` in lookup() key position — proto shortcut:
          const srcExpr = calc.exprSrc.replace(/lookup\("effort",\s*effort\s*,/g, `lookup("effort", "${slugOf(s)}",`)
            .replace(/lookup\("rpe-labels",\s*effortLabel\s*,/g, `lookup("rpe-labels", "${s.label ?? ''}",`);
          const v = evalWithBindings(srcExpr, ctx, i + 1);
          if (!firstDim) firstDim = v.dim;
          const unit = calc.unit && calc.unit !== 'auto' ? ` ${calc.unit}` : firstDim ? ` [${dimLabel(v.dim)}]` : '';
          per.push(`${Math.round(v.v * 100) / 100}${unit}`);
        } catch (e: unknown) { per.push(`∅ ${errMsg(e)}`); }
      });
      result.perSegment = per;
      result.dim = firstDim;
    } else if (scope === 'workout') {
      const running: (string | null)[] = [];
      let lastDim: Dim | undefined;
      for (let upto = 1; upto <= hist.length; upto++) {
        try {
          const s = hist[upto - 1];
          const ctx = makeCtx(s, {
            'session.duration': val(hist.slice(0, upto).reduce((a, x) => a + x.elapsedMs, 0) / 1000, D(0, 0, 1)),
          }, sessionRpe, vo2max);
          if (calc.whenSrc && !evalWith(calc.whenSrc, ctx, upto).v) { running.push(null); continue; }
          const srcExpr = calc.exprSrc.replace(/lookup\("effort",\s*effort\s*,/g, `lookup("effort", "${slugOf(s)}",`);
          let v: Val | undefined;
          let variant = 'primary';
          try { v = evalWithBindings(srcExpr, ctx, upto); }
          catch (err) {
            for (const alt of calc.alternates) {
              try { v = evalWithBindings(alt.src, ctx, upto); variant = alt.estimated ? 'estimated' : 'alternate'; break; } catch { /* next alternate */ }
            }
            if (v === undefined) throw err;
          }
          lastDim = v.dim;
          running.push(`${Math.round(v.v * 100) / 100}${calc.unit && calc.unit !== 'auto' ? ' ' + calc.unit : ''}${variant === 'estimated' ? '  (est.)' : ''}`);
          result.variantUsed = variant;
        } catch (e: unknown) { running.push(`∅ ${errMsg(e)}`); }
      }
      result.running = running;
      result.dim = lastDim;
    } else {
      // store scope: support the ACWR/monotony/strain pattern over DAILY_LOADS
      const daily = DAILY_LOADS;
      const w = (arr: number[], n: number, f: (w: number[]) => number) => arr.map((_, i) => i + 1 >= n ? f(arr.slice(i + 1 - n, i + 1)) : NaN);
      const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
      const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(mean(x.map(v => (v - m) ** 2))); };
      const name = calc.name;
      let series: number[];
      if (name.includes('acwr')) { const a7 = w(daily, 7, mean), a28 = w(daily, 28, mean); series = daily.map((_, i) => a7[i] / a28[i]); }
      else if (name.includes('monotony')) { const a7 = w(daily, 7, mean), s7 = w(daily, 7, sd); series = daily.map((_, i) => a7[i] / s7[i]); }
      else if (name.includes('strain')) { const a7 = w(daily, 7, mean), s7 = w(daily, 7, sd), sum7 = w(daily, 7, x => x.reduce((a, b) => a + b, 0)); series = daily.map((_, i) => (a7[i] / s7[i]) * sum7[i]); }
      else { series = w(daily, 7, mean); }
      result.perSegment = series.slice(-7).map(x => Number.isNaN(x) ? null : String(Math.round(x * 100) / 100));
      result.dim = ZERO;
    }
  } catch (e: unknown) { diagnostics.push(errMsg(e)); }

  // dimension / unit check
  if (result.dim && calc.unit && calc.unit !== 'auto') {
    const u = UNITS[calc.unit];
    if (!u) diagnostics.push(`unknown unit "${calc.unit}"`);
    else if (!dEq(u.dim, result.dim) && !dEq(u.dim, ZERO)) diagnostics.push(`unit "${calc.unit}" is ${dimLabel(u.dim)} but expression computes ${dimLabel(result.dim)}`);
    // named zero-vector units (AU, pts, ratio) are authoritative casts — the declaration wins
  }
  return result;
}

// ── Typeahead ────────────────────────────────────────────────────────────────
interface Suggest { label: string; insert: string; detail: string; }
function suggestions(src: string, scope: string): { items: Suggest[]; from: number } {
  const m = /([a-zA-Z_][\w.:-]*|"[\w-]*|)$/.exec(src)!;
  const frag = m[1]; const from = src.length - frag.length;
  const before = src.slice(0, from);
  const items: Suggest[] = [];
  const push = (label: string, insert: string, detail: string) => items.push({ label, insert, detail });
  const lookupM = /lookup\("([\w-]*)",?\s*("[\w-]*",?\s*)?"?([\w-]*)$/.exec(src);
  if (lookupM) {
    if (lookupM[2] === undefined && !src.endsWith('"')) { if (TABLES) Object.keys(TABLES).forEach(t => push(t, `"${t}"`, 'lookup table')); }
    else {
      const table = lookupM[1];
      const parts = src.split('"').length;
      if (parts <= 5 && lookupM[3] !== undefined || /,\s*"[\w-]*$/.test(src)) {
        (TABLES[table]?.fields ?? []).forEach(f => push(f, `"${f}"`, `${table} field`));
      }
      if (table === 'effort' && /,\s*$/.test(src)) Object.keys(EFFORT_TABLE).concat(['effort']).forEach(k => push(k, k === 'effort' ? 'effort' : `"${k}"`, 'key'));
    }
    return { items: items.filter(i => i.label.startsWith(frag.replace(/"/g, ''))), from };
  }
  if (/^(sum|avg|max|min|count|last):[\w.]*$/.test(frag)) {
    const keys = scope === 'segment'
      ? []
      : ['reps', 'distance', 'segmentVolume', 'metMinutes', 'elapsed', 'effortRpe', 'sessionLoad'];
    keys.forEach(k => push(k, k, 'metric key'));
    return { items: items.filter(i => i.label.startsWith(frag.split(':')[1] ?? '')), from: from + frag.indexOf(':') + 1 };
  }
  if (/->\s*[\w/]*$/.test(before + frag)) {
    Object.keys(UNITS).forEach(u => push(u, u, 'unit'));
    return { items: items.filter(i => i.label.startsWith(frag)), from };
  }
  // identifiers
  const segIds = ['elapsed', 'reps', 'resistance', 'distance', 'effort', 'effortLabel', 'segmentVolume', 'metMinutes', 'effortRpe', 'sessionRpe'];
  const woIds = ['sessionRpe', 'session.duration', 'profile.vo2max'];
  (scope === 'segment' ? segIds : woIds).forEach(id => push(id, id, scope === 'segment' ? 'segment metric / context' : 'context node'));
  FN_NAMES.forEach(f => push(`${f}()`, `${f}()`, 'function'));
  ['sum:', 'avg:', 'max:', 'count:', 'last:'].forEach(a => push(`${a}{}`, a, 'WQL atom'));
  if (before.includes('=')) push('estimated', 'estimated', 'variant origin');
  ['when ', '-> ', 'where ', '| ', ' key ', '(library)'].forEach(k => push(k.trim(), k, 'clause'));
  return { items: items.filter(i => i.label.startsWith(frag)).slice(0, 9), from };
}

// ── Shared UI bits ───────────────────────────────────────────────────────────
const box: React.CSSProperties = { background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, padding: 12 };
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 13 };

function Diagnostics({ r }: { r: EvalResult }) {
  const c = compoundFor(r.dim ?? ZERO);
  return (
    <div style={{ marginTop: 8, fontSize: 12 }}>
      {r.dim && (
        <div style={{ color: '#a1a1aa', marginBottom: 4 }}>
          computes <b style={{ color: '#e4e4e7' }}>{dimLabel(r.dim)}</b>
          {c && c.name !== 'dimensionless' && <> → <span style={{ color: '#c084fc' }}>{c.name}</span> — units: {c.units.map(u => <UnitChip key={u} u={u} active={r.calc.unit === u} />)}</>}
        </div>
      )}
      {r.diagnostics.map((d, i) => <div key={i} style={{ color: '#f87171' }}>⚠ {d}</div>)}
      {!r.diagnostics.length && <div style={{ color: '#34d399' }}>✓ valid{r.variantUsed === 'estimated' ? ' — estimated variant in use' : ''}</div>}
    </div>
  );
}
const UnitChip = ({ u, active }: { u: string; active?: boolean }) => (
  <span style={{ border: `1px solid ${active ? '#c084fc' : '#52525b'}`, borderRadius: 4, padding: '0 5px', marginRight: 4, color: active ? '#c084fc' : '#a1a1aa' }}>{u}</span>
);

function Preview({ r, scope, sessionRpe, vo2max }: { r: EvalResult; scope: string; sessionRpe?: number; vo2max?: number }) {
  return (
    <div style={{ ...box, minWidth: 320 }}>
      <div style={{ fontSize: 11, color: '#71717a', marginBottom: 6 }}>
        LIVE PREVIEW — {scope === 'store' ? 'last 7 of 28 days (fixture)' : `Fran, 2026-07-28 (fixture)${vo2max ? ` · VO₂max ${vo2max}` : ' · VO₂max unknown'}${sessionRpe ? ` · sRPE ${sessionRpe}` : ''}`}
      </div>
      {scope === 'segment' && FRAN.map((s, i) => (
        <div key={i} style={{ ...mono, display: 'flex', justifyContent: 'space-between', color: '#d4d4d8' }}>
          <span style={{ color: '#71717a' }}>{s.effort}{s.reps ? ` ×${s.reps}` : ''}{s.resistanceKg ? ` ${s.resistanceKg}kg` : ''}</span>
          <span style={{ color: r.perSegment?.[i]?.startsWith('∅') ? '#f87171' : '#7dd3fc' }}>{r.perSegment?.[i] ?? '—'}</span>
        </div>
      ))}
      {scope === 'workout' && FRAN.map((s, i) => (
        <div key={i} style={{ ...mono, display: 'flex', justifyContent: 'space-between', color: '#d4d4d8' }}>
          <span style={{ color: '#71717a' }}>after line {i + 1}</span>
          <span style={{ color: r.running?.[i]?.startsWith('∅') ? '#f87171' : '#7dd3fc' }}>{r.running?.[i] ?? '—'}</span>
        </div>
      ))}
      {scope === 'store' && (r.perSegment ?? []).map((x, i) => (
        <div key={i} style={{ ...mono, display: 'flex', justifyContent: 'space-between', color: '#d4d4d8' }}>
          <span style={{ color: '#71717a' }}>D-{6 - i}</span>
          <span style={{ color: '#7dd3fc' }}>{x ?? '—'}</span>
        </div>
      ))}
    </div>
  );
}

// ── Variant A: text + completion ─────────────────────────────────────────────
function TextVariant({ scope }: { scope: string }) {
  const [src, setSrc] = useState(EXAMPLES[scope]);
  const [cursor, setCursor] = useState(src.length);
  const ref = useRef<HTMLInputElement>(null);
  const r = useMemo(() => evaluateCalc(src, scope, undefined, undefined), [src, scope]);
  const sugg = useMemo(() => suggestions(src.slice(0, cursor), scope), [src, cursor, scope]);
  const apply = (s: Suggest) => {
    const next = src.slice(0, sugg.from) + s.insert + src.slice(cursor);
    setSrc(next);
    const pos = sugg.from + s.insert.length;
    setCursor(pos);
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(pos, pos); });
  };
  return (
    <div>
      <input
        ref={ref} value={src} style={{ ...box, ...mono, width: '100%', color: '#e4e4e7', outline: 'none' }}
        onChange={e => { setSrc(e.target.value); setCursor(e.target.selectionStart ?? e.target.value.length); }}
        onSelect={e => setCursor((e.target as HTMLInputElement).selectionStart ?? 0)}
        placeholder="name = expression -> unit when predicate"
      />
      {sugg.items.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {sugg.items.map((s, i) => (
            <button key={i} onClick={() => apply(s)} style={{ ...mono, fontSize: 12, background: '#27272a', border: '1px solid #3f3f46', borderRadius: 5, color: '#7dd3fc', padding: '2px 8px', cursor: 'pointer' }}>
              {s.label} <span style={{ color: '#52525b' }}>{s.detail}</span>
            </button>
          ))}
        </div>
      )}
      <Diagnostics r={r} />
    </div>
  );
}
void TextVariant;

// ── Variant B: token slots ───────────────────────────────────────────────────
function SlotsVariant({ scope, onSrc }: { scope: string; onSrc: (s: string) => void }) {
  const [name, setName] = useState('power');
  const [expr, setExpr] = useState('reps * resistance / convert(elapsed, s)');
  const [unit, setUnit] = useState('kg/s');
  const [when, setWhen] = useState('has(reps) and has(resistance) and elapsed > 0');
  const [active, setActive] = useState<string | null>(null);
  const src = `${name} = ${expr}${unit ? ` -> ${unit}` : ''}${when ? ` when ${when}` : ''}`;
  const r = useMemo(() => evaluateCalc(src, scope, undefined, undefined), [src, scope]);
  useEffect(() => onSrc(src), [src]);
  const slots: { id: string; label: string; value: string; set: (v: string) => void; hint: string }[] = [
    { id: 'name', label: 'name', value: name, set: setName, hint: 'calc id' },
    { id: 'expr', label: '=', value: expr, set: setExpr, hint: 'expression — metrics, lookups, functions' },
    { id: 'unit', label: '->', value: unit, set: setUnit, hint: 'output unit (auto allowed)' },
    { id: 'when', label: 'when', value: when, set: setWhen, hint: 'applicability predicate' },
  ];
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {slots.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#71717a', fontSize: 12 }}>{s.label}</span>
            <button
              onClick={() => setActive(active === s.id ? null : s.id)}
              style={{ ...mono, fontSize: 12, background: active === s.id ? '#3b0764' : '#27272a', border: `1px solid ${active === s.id ? '#c084fc' : '#3f3f46'}`, borderRadius: 6, color: '#e4e4e7', padding: '4px 10px', cursor: 'pointer', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >{s.value || <span style={{ color: '#52525b' }}>∅</span>}</button>
          </div>
        ))}
      </div>
      {active && (
        <div style={{ ...box, marginTop: 8 }}>
          <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4 }}>{slots.find(s => s.id === active)?.hint}</div>
          <input
            autoFocus value={slots.find(s => s.id === active)!.value}
            onChange={e => slots.find(s => s.id === active)!.set(e.target.value)}
            style={{ ...mono, width: '100%', background: '#09090b', border: '1px solid #3f3f46', borderRadius: 6, color: '#e4e4e7', padding: '4px 8px', outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {suggestions(slots.find(s => s.id === active)!.value, scope).items.map((sg, i) => (
              <button key={i} onClick={() => slots.find(s => s.id === active)!.set(sg.insert)} style={{ ...mono, fontSize: 12, background: '#27272a', border: '1px solid #3f3f46', borderRadius: 5, color: '#7dd3fc', padding: '2px 8px', cursor: 'pointer' }}>{sg.label}</button>
            ))}
          </div>
        </div>
      )}
      <div style={{ ...mono, marginTop: 8, color: '#52525b', fontSize: 12 }}>{src}</div>
      <Diagnostics r={r} />
    </div>
  );
}

// ── Variant C: guided builder ────────────────────────────────────────────────
function GuidedVariant({ scope, onSrc }: { scope: string; onSrc: (s: string) => void }) {
  const [name, setName] = useState('power');
  const [tokens, setTokens] = useState<string[]>(['reps', '*', 'resistance', '/', 'convert(elapsed, s)']);
  const palette: { group: string; items: string[] }[] = [
    { group: 'metrics', items: scope === 'segment' ? ['elapsed', 'reps', 'resistance', 'distance'] : ['sum:reps{}', 'sum:distance{}', 'sum:metMinutes{}', 'sum:elapsed{}'] },
    { group: 'functions', items: ['convert(·, min)', 'convert(·, km)', 'convert(·, s)', 'min(·, 100)', 'round(·)'] },
    { group: 'lookups', items: ['lookup("effort", effort, "met")', 'lookup("effort", effort, "disciplineFactor")', 'lookup("rpe-labels", effortLabel, "rpe")'] },
    { group: 'operators', items: ['+', '-', '*', '/', '(', ')'] },
  ];
  const expr = tokens.join(' ');
  const src = `${name} = ${expr} -> auto`;
  const r = useMemo(() => evaluateCalc(src, scope, undefined, undefined), [src, scope]);
  useEffect(() => onSrc(src), [src]);
  const c = compoundFor(r.dim ?? ZERO);
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#71717a' }}>name</span>
        <input value={name} onChange={e => setName(e.target.value)} style={{ ...mono, background: '#09090b', border: '1px solid #3f3f46', borderRadius: 6, color: '#e4e4e7', padding: '3px 8px' }} />
      </div>
      {palette.map(p => (
        <div key={p.group} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: '#71717a', marginBottom: 3 }}>{p.group}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {p.items.map(it => (
              <button key={it} onClick={() => setTokens(t => [...t, it])} style={{ ...mono, fontSize: 12, background: '#27272a', border: '1px solid #3f3f46', borderRadius: 5, color: '#7dd3fc', padding: '2px 8px', cursor: 'pointer' }}>{it}</button>
            ))}
          </div>
        </div>
      ))}
      <div style={{ ...box, ...mono, marginTop: 8, color: '#d4d4d8', minHeight: 34 }}>
        {tokens.map((t, i) => (
          <span key={i} onClick={() => setTokens(ts => ts.filter((_, j) => j !== i))} title="click to remove" style={{ cursor: 'pointer', background: '#27272a', borderRadius: 4, padding: '1px 6px', marginRight: 4, display: 'inline-block' }}>{t}</span>
        ))}
        {!tokens.length && <span style={{ color: '#52525b' }}>click palette items to build the formula…</span>}
      </div>
      <div style={{ fontSize: 12, color: '#71717a', marginTop: 6 }}>
        unit: <b style={{ color: '#c084fc' }}>{c ? c.units.join(' / ') : '—'}</b> (derived)
      </div>
      <div style={{ ...mono, marginTop: 6, color: '#52525b', fontSize: 12 }}>{src}</div>
      <Diagnostics r={r} />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
const EXAMPLES: Record<string, string> = {
  segment: 'power = reps * resistance / convert(elapsed, s) -> kg/s when has(reps) and has(resistance) and elapsed > 0',
  workout: 'sessionLoad = round(rpe * convert(session.duration, min)) -> AU where rpe = sessionRpe | max:effortRpe{} | 5 estimated',
  store: 'acwr = windowMean(daily, 7d) / windowMean(daily, 28d) -> ratio',
};

export default function CalcAuthoringPrototypePage() {
  const [params, setParams] = useSearchParams();
  const v = params.get('v') ?? 'text';
  const [scope, setScope] = useState('segment');
  const [sessionRpe, setSessionRpe] = useState<number | undefined>(undefined);
  const [vo2max, setVo2max] = useState<number | undefined>(undefined);
  const [src, setSrc] = useState(EXAMPLES.segment);
  const [variantSrc, setVariantSrc] = useState('');
  const effectiveSrc = v === 'text' ? src : variantSrc || src;
  const r = useMemo(() => evaluateCalc(effectiveSrc, scope, sessionRpe, vo2max), [effectiveSrc, scope, sessionRpe, vo2max]);
  const variants = [['text', 'A · text + completion'], ['slots', 'B · token slots'], ['guided', 'C · guided builder']];
  return (
    <div style={{ background: '#09090b', minHeight: '100vh', color: '#e4e4e7', padding: 24, fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>PROTOTYPE — throwaway · issue #863</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Calc-line guided authoring</h1>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', fontSize: 13 }}>
          {['segment', 'workout', 'store'].map(s => (
            <button key={s} onClick={() => { setScope(s); setSrc(EXAMPLES[s]); }} style={{ padding: '3px 12px', borderRadius: 6, border: `1px solid ${scope === s ? '#7dd3fc' : '#3f3f46'}`, background: 'none', color: scope === s ? '#7dd3fc' : '#a1a1aa', cursor: 'pointer' }}>{s} scope</button>
          ))}
          <span style={{ color: '#3f3f46' }}>|</span>
          <label style={{ color: '#71717a' }}><input type="checkbox" checked={!!sessionRpe} onChange={e => setSessionRpe(e.target.checked ? 8 : undefined)} /> sRPE captured</label>
          <label style={{ color: '#71717a' }}><input type="checkbox" checked={!!vo2max} onChange={e => setVo2max(e.target.checked ? 42 : undefined)} /> VO₂max known</label>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            {v === 'text' && (
              <div>
                <input
                  value={src} onChange={e => setSrc(e.target.value)}
                  style={{ ...box, ...mono, width: '100%', color: '#e4e4e7', outline: 'none' }}
                  placeholder="name = expression -> unit when predicate"
                />
                <SuggestionRow src={src} scope={scope} onApply={(ns) => setSrc(ns)} />
                <Diagnostics r={r} />
              </div>
            )}
            {v === 'slots' && <SlotsVariant scope={scope} onSrc={setVariantSrc} />}
            {v === 'guided' && <GuidedVariant scope={scope} onSrc={setVariantSrc} />}
          </div>
          <Preview r={r} scope={scope} sessionRpe={sessionRpe} vo2max={vo2max} />
        </div>
      </div>
      <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6, background: '#18181b', border: '1px solid #3f3f46', borderRadius: 10, padding: 6 }}>
        {variants.map(([id, label]) => (
          <button key={id} onClick={() => setParams({ v: id })} style={{ padding: '4px 14px', borderRadius: 7, border: 'none', background: v === id ? '#7dd3fc' : 'transparent', color: v === id ? '#09090b' : '#a1a1aa', cursor: 'pointer', fontSize: 13 }}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function SuggestionRow({ src, scope, onApply }: { src: string; scope: string; onApply: (s: string) => void }) {
  const sugg = useMemo(() => suggestions(src, scope), [src, scope]);
  if (!sugg.items.length) return null;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
      {sugg.items.map((s, i) => (
        <button key={i} onClick={() => onApply(src.slice(0, sugg.from) + s.insert)} style={{ ...mono, fontSize: 12, background: '#27272a', border: '1px solid #3f3f46', borderRadius: 5, color: '#7dd3fc', padding: '2px 8px', cursor: 'pointer' }}>
          {s.label} <span style={{ color: '#52525b' }}>{s.detail}</span>
        </button>
      ))}
    </div>
  );
}
