import { IDialect, DialectAnalysis } from '@bitcobblers/wod-wiki-core';
import { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { hintsToContainer } from '../metrics/hints';
import { EMPTY_UNIT } from "../runtime/compiler/metrics/dimensionFactory";
export const ClimbMetricType = {
  Discipline: 'climb-discipline',
  Grade: 'climb-grade',
  SendType: 'climb-send-type',
  AttemptCount: 'climb-attempt-count',
  RouteName: 'climb-route-name',
  HighPoint: 'climb-high-point',
} as const;

export type ClimbGradeSystem =
  | 'v-scale'
  | 'font'
  | 'yds'
  | 'french'
  | 'uiaa'
  | 'ewbank'
  | 'british'
  | 'dankyu'
  | 'unknown';

export interface ClimbGradeMetricValue {
  raw: string;
  system: ClimbGradeSystem;
  normalizedRank?: number;
}

type SendType =
  | 'onsight'
  | 'flash'
  | 'redpoint'
  | 'repeat'
  | 'dogged'
  | 'top-rope'
  | 'did-not-finish';

export const SEND_ALIASES: Record<string, SendType> = {
  onsight: 'onsight',
  os: 'onsight',
  flash: 'flash',
  fl: 'flash',
  redpoint: 'redpoint',
  rp: 'redpoint',
  sent: 'redpoint',
  send: 'redpoint',
  repeat: 'repeat',
  're-send': 'repeat',
  resend: 'repeat',
  dogged: 'dogged',
  hangdog: 'dogged',
  a0: 'dogged',
  tr: 'top-rope',
  toprope: 'top-rope',
  'top-rope': 'top-rope',
  dnf: 'did-not-finish',
  attempted: 'did-not-finish',
};

export const DISCIPLINE_KEYWORDS: Record<string, string> = {
  boulder: 'bouldering',
  bouldering: 'bouldering',
  sport: 'sport',
  trad: 'trad',
  'top rope': 'top-rope',
  toprope: 'top-rope',
  hangboard: 'hangboard',
  moonboard: 'training-board',
  kilter: 'training-board',
  board: 'training-board',
};

function metricText(metric?: IMetric): string {
  if (!metric) return '';
  if (typeof metric.value === 'string') return metric.value;
  if (metric.value && typeof metric.value === 'object' && 'text' in metric.value) {
    return String((metric.value as { text?: unknown }).text ?? '');
  }
  if (typeof metric.value === 'number') return String(metric.value);
  return '';
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[_\s]+/g, '-').trim();
}

function addMetric(metrics: MetricContainer, type: string, value: unknown, unit?: string): void {
  metrics.add({ type, value, origin: 'dialect', unit });
}

function uniquePush(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

/**
 * Climbing dialect for recognizing route/problem logs and climbing training.
 *
 * Recognizes:
 * - route/problem names from Action metrics
 * - V-scale, YDS, Fontainebleau, and French-style grades
 * - send type aliases such as OS, flash, RP, TR, and DNF
 * - attempt counts from climb-only `@N` shorthand parsed as empty-unit resistance
 * - high-point notes such as `bolt 6` and `move 9`
 */
export class ClimbDialect implements IDialect {
  id = 'climb';
  name = 'Climb Dialect';

  analyze(statement: ICodeStatement): DialectAnalysis {
    const hints: string[] = [];
    const dialectMetrics = MetricContainer.empty('climb-dialect');
    const metrics = MetricContainer.from(statement.metrics);
    const rawMetrics = metrics.toArray();
    const text = rawMetrics.map(metricText).filter(Boolean).join(' ');

    const routeName = this.findRouteName(rawMetrics);
    if (routeName) addMetric(dialectMetrics, ClimbMetricType.RouteName, routeName);

    const grade = this.findGrade(rawMetrics);
    if (grade) addMetric(dialectMetrics, ClimbMetricType.Grade, grade);

    const sendType = this.findSendType(text);
    if (sendType) addMetric(dialectMetrics, ClimbMetricType.SendType, sendType);

    const attemptCount = this.findAttemptCount(rawMetrics);
    if (attemptCount !== undefined) addMetric(dialectMetrics, ClimbMetricType.AttemptCount, attemptCount);

    const highPoint = this.findHighPoint(text);
    if (highPoint) addMetric(dialectMetrics, ClimbMetricType.HighPoint, highPoint);

    const disciplines = this.findDisciplines(text, grade);
    for (const discipline of disciplines) {
      addMetric(dialectMetrics, ClimbMetricType.Discipline, discipline);
    }

    const hasClimbSignal = Boolean(
      routeName || grade || sendType || highPoint || disciplines.length > 0,
    );

    if (hasClimbSignal) {
      hints.push('domain.climb');
      hints.push('behavior.route_based');
    }

    if (grade) hints.push('behavior.grade_based');
    if (attemptCount !== undefined) hints.push('behavior.attempt_based');
    if (sendType === 'did-not-finish') hints.push('climb.project');

    for (const discipline of disciplines) {
      hints.push(`climb.${discipline.replace('-', '_')}`);
    }

    return { metrics: hintsToContainer(hints, dialectMetrics) };
  }

  private findRouteName(metrics: IMetric[]): string | undefined {
    const action = metrics.find(metric => metric.type === MetricType.Action && typeof metric.value === 'string');
    return action?.value ? String(action.value) : undefined;
  }

  private findGrade(metrics: IMetric[]): ClimbGradeMetricValue | undefined {
    for (let index = 0; index < metrics.length; index += 1) {
      const metric = metrics[index];
      const current = metricText(metric);
      const next = metricText(metrics[index + 1] as IMetric);

      const vScale = current.match(/\bV(\d{1,2})(?:[-+])?\b/i);
      if (vScale) {
        const gradeNumber = Number(vScale[1]);
        return { raw: vScale[0].toUpperCase(), system: 'v-scale', normalizedRank: gradeNumber };
      }

      if (typeof metric.value === 'number' && metric.value >= 5 && metric.value < 6) {
        const suffix = next.match(/^\s*([abcd])\b/i)?.[1];
        const raw = suffix ? `${metric.value}${suffix}` : String(metric.value);
        if (/^5\.\d{1,2}[abcd]?$/i.test(raw)) {
          return { raw, system: 'yds', normalizedRank: this.ydsRank(raw) };
        }
      }

      const ydsInline = current.match(/\b5\.(\d{1,2})([abcd])?\b/i);
      if (ydsInline) {
        return { raw: ydsInline[0], system: 'yds', normalizedRank: this.ydsRank(ydsInline[0]) };
      }

      const fontInline = current.match(/\b([3-9][ABC](?:\+)?)\b/);
      if (fontInline) return { raw: fontInline[1], system: 'font' };

      if (typeof metric.value === 'number' && metric.value >= 3 && metric.value <= 9) {
        const suffix = next.match(/^\s*([ABC]\+?)\b/)?.[1];
        if (suffix) return { raw: `${metric.value}${suffix}`, system: 'font' };
      }

      const frenchInline = current.match(/\b([3-9][abc](?:\+)?)\b/);
      if (frenchInline) return { raw: frenchInline[1], system: 'french' };
    }

    return undefined;
  }

  private ydsRank(raw: string): number | undefined {
    const match = raw.match(/^5\.(\d{1,2})([abcd])?$/i);
    if (!match) return undefined;
    const base = Number(match[1]);
    const suffix = match[2]?.toLowerCase();
    const suffixRank = suffix ? ['a', 'b', 'c', 'd'].indexOf(suffix) / 4 : 0;
    return base + suffixRank;
  }

  private findSendType(text: string): SendType | undefined {
    const tokens = text
      .toLowerCase()
      .match(/[a-z0-9-]+/g) ?? [];

    for (const token of tokens) {
      const normalized = normalizeText(token);
      if (normalized in SEND_ALIASES) return SEND_ALIASES[normalized];
    }

    if (/\bnot\s+sent\b/i.test(text)) return 'did-not-finish';
    if (/\bwith\s+falls\b/i.test(text)) return 'dogged';

    return undefined;
  }

  private findAttemptCount(metrics: IMetric[]): number | undefined {
    const attemptMetric = metrics.find(metric => {
      if (metric.type !== MetricType.Resistance) return false;
      const value = metric.value as { amount?: unknown; unit?: unknown } | undefined;
      return value && typeof value.amount === 'number' && String(value.unit ?? metric.unit ?? EMPTY_UNIT) === EMPTY_UNIT;
    });

    return (attemptMetric?.value as { amount?: number } | undefined)?.amount;
  }

  private findHighPoint(text: string): string | undefined {
    const highPoint = text.match(/\b(?:bolt|move|crux|high\s*point)\s*\d+\b/i)?.[0];
    return highPoint ? highPoint.toLowerCase().replace(/\s+/g, ' ') : undefined;
  }

  private findDisciplines(text: string, grade?: ClimbGradeMetricValue): string[] {
    const found: string[] = [];
    const lower = text.toLowerCase();

    for (const [keyword, discipline] of Object.entries(DISCIPLINE_KEYWORDS)) {
      if (lower.includes(keyword)) uniquePush(found, discipline);
    }

    if (grade?.system === 'v-scale' || grade?.system === 'font') uniquePush(found, 'bouldering');
    if (grade?.system === 'yds' || grade?.system === 'french') uniquePush(found, 'sport');

    return found;
  }
}
