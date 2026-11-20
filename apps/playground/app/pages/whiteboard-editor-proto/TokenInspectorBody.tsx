import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react';
import {
  ACTION_CUES,
  PROPERTY_CUES,
  SPORT_DIALECTS,
  WORKOUT_TEMPLATES,
  formatMmSs,
  fuzzyMatches,
  searchEfforts,
  searchTags,
  searchWikiNotes,
  slugify,
  type CatalogStore,
  type Dialect,
  type DocBlock,
  type ParsedToken,
  type TimerMode,
} from './whiteboardProtoEngine';

export type InspectorMode = 'token' | 'add' | 'block' | 'wiki' | 'prose-tag' | 'fm-tag';

export interface TokenInspectorBodyProps {
  mode: InspectorMode;
  token: ParsedToken | null;
  block: DocBlock | null;
  catalogs: CatalogStore;
  activeNotebook: string;
  activeFrontmatterTags: string[];
  useScrubber?: boolean;
  onToggleScrubber?: () => void;
  showHeader?: boolean;
  showFooter?: boolean;
  showStepButtons?: boolean;
  showClose?: boolean;
  onReplaceToken: (token: ParsedToken, nextText: string, label?: string) => void;
  onDeleteToken: (token: ParsedToken) => void;
  onInsertToken: (text: string) => void;
  onDefineUnresolved: (
    rawToken: string,
    actionType: 'effort' | 'equipment' | 'tag' | 'alias',
    aliasTargetId?: string,
    replaceCurrentToken?: boolean,
  ) => void;
  onUpdateFence: (patch: { dialect?: Dialect; sport?: string }) => void;
  onInsertTemplate: (templateId: string) => void;
  onPickWiki: (noteTitle: string) => void;
  onPickTag: (tagWithHash: string) => void;
  onCreateAndPickTag: (slug: string, replaceToken?: ParsedToken | null) => void;
  onStepToken?: (delta: -1 | 1) => void;
  onClose?: () => void;
}

export const TokenInspectorBody: React.FC<TokenInspectorBodyProps> = ({
  mode,
  token,
  block,
  catalogs,
  activeNotebook,
  activeFrontmatterTags,
  useScrubber = false,
  onToggleScrubber,
  showHeader = true,
  showFooter = true,
  showStepButtons = false,
  showClose = false,
  onReplaceToken,
  onDeleteToken,
  onInsertToken,
  onDefineUnresolved,
  onUpdateFence,
  onInsertTemplate,
  onPickWiki,
  onPickTag,
  onCreateAndPickTag,
  onStepToken,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAliasList, setShowAliasList] = useState(false);
  const searchInputId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSearchQuery('');
    setShowAliasList(false);
  }, [mode, token?.id]);

  // Center selected row inside fixed-height 50cqh numeric/duration scrubber
  useEffect(() => {
    if (!useScrubber || !rootRef.current) return;
    const scrollers = rootRef.current.querySelectorAll<HTMLElement>('.wb-scrubber-scroll');
    scrollers.forEach((scroller) => {
      const sel = scroller.querySelector<HTMLElement>('.wb-scrubber-row.is-selected');
      if (!sel) return;
      const targetTop = sel.offsetTop - (scroller.clientHeight - sel.offsetHeight) / 2;
      scroller.scrollTop = Math.max(0, targetTop);
    });
  }, [useScrubber, token?.raw, mode]);

  let title = 'Edit Token';
  let badge = token?.raw ?? '';
  let desc = '';

  if (mode === 'block' && block) {
    title = 'Timer Block Settings';
    badge = '```' + block.dialect + (block.sport ? `:${block.sport}` : '');
    desc = 'Configure block dialect, sport defaults, or insert a grammar-verified template.';
  } else if (mode === 'wiki') {
    title = 'Insert [[Wiki Link]]';
    badge = 'Note Graph';
    desc = 'Link directly to another workout, benchmark, or guide in your library.';
  } else if (mode === 'prose-tag' || mode === 'fm-tag') {
    title = mode === 'fm-tag' ? 'Toggle Note Tags' : 'Insert #Tag';
    badge = '#taxonomy';
    desc = 'Choose from grouped WOD Wiki tags or create a new tag inline.';
  } else if (mode === 'add') {
    title = 'Add Syntax Element';
    badge = '+ Token';
    desc = 'Insert a valid WhiteboardScript construct onto the current line.';
  } else if (token) {
    if (token.kind === 'duration') {
      title = 'Timer & Duration';
      desc = 'Switch interval mode without losing minutes/seconds or newlines.';
    } else if (token.kind === 'scheme' || token.kind === 'rounds') {
      title = token.kind === 'scheme' ? 'Sets × Reps Scheme' : 'Rounds & Structure';
      desc = 'Switch between NxM sets, round counts, ladders, or interval keywords.';
    } else if (token.kind === 'rep') {
      title = 'Repetitions';
      desc = 'Adjust target rep count with fast steppers or presets.';
    } else if (token.kind === 'resistance') {
      title = 'Resistance & Load';
      desc = 'Preserves @ prefix, alternatives (|), and preferred unit.';
    } else if (token.kind === 'distance') {
      title = 'Distance & Calories';
      desc = 'Select standard distances or switch units.';
    } else if (token.kind === 'effort' || token.kind === 'equipment') {
      title = token.kind === 'effort' ? 'Effort / Movement' : 'Equipment';
      desc = 'Fuzzy alias search — rewrites clean WhiteboardScript text (never raw JSON).';
    } else if (token.kind === 'tag') {
      title = 'Wiki Tag (#tag)';
      desc = 'Select an existing taxonomy tag or create a new tag inline.';
    } else if (token.kind === 'unresolved') {
      title = token.meta.isTag ? 'Unrecognized Tag' : 'Unrecognized Movement / Term';
      desc = token.meta.isTag
        ? 'This #tag is not in your taxonomy yet. Add it now in one tap.'
        : `Define "${token.raw}" in your WOD Wiki catalog or link it as an alias.`;
    } else if (token.kind === 'lintError') {
      title = 'Syntax Repair';
      desc = token.meta.message ?? 'Fix invalid WhiteboardScript syntax.';
    } else if (token.kind === 'action' || token.kind === 'property') {
      title = 'Actions & Block Properties';
      desc = 'Replace with a timer action cue or line property.';
    }
  }

  const renderContent = () => {
    if (mode === 'block' && block) {
      return (
        <>
          <div className="wb-control-section">
            <div className="wb-control-label">Block Dialect</div>
            <div className="wb-seg-pills">
              {(['time', 'log', 'query'] as Dialect[]).map((d) => {
                const lbl = d === 'time' ? 'TIMER (```time)' : d === 'log' ? 'LOG (```log)' : 'QUERY (```query)';
                return (
                  <button
                    key={d}
                    type="button"
                    className={`wb-choice-pill${block.dialect === d ? ' is-selected' : ''}`}
                    onClick={() => onUpdateFence({ dialect: d })}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="wb-control-section">
            <div className="wb-control-label">Sport Vocabulary (:sport)</div>
            <div className="wb-seg-pills">
              {SPORT_DIALECTS.map((sp) => (
                <button
                  key={sp.id || 'general'}
                  type="button"
                  className={`wb-choice-pill${(block.sport || '') === sp.id ? ' is-selected' : ''}`}
                  onClick={() => onUpdateFence({ sport: sp.id })}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>

          <div className="wb-control-section">
            <div className="wb-control-label">Block Summary</div>
            <div className="wb-summary-box">
              <div className="wb-option-title">
                {block.summary.nonEmptyLines} statements · {block.summary.durLabel} clocked
              </div>
              <div className="wb-option-sub">
                {block.summary.errCount} syntax errors · {block.summary.unresolvedCount} unresolved entities
              </div>
            </div>
          </div>

          <div className="wb-control-section">
            <div className="wb-control-label">Insert Workout Template</div>
            <div className="wb-catalog-list">
              {WORKOUT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className="wb-option-row"
                  onClick={() => onInsertTemplate(tpl.id)}
                >
                  <span className="wb-option-main">
                    <span className="wb-option-title">{tpl.name}</span>
                    <span className="wb-option-sub">{tpl.desc}</span>
                  </span>
                  <span className="wb-option-code">{tpl.lines[0]}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      );
    }

    if (mode === 'wiki') {
      const notes = searchWikiNotes(searchQuery, catalogs);
      return (
        <>
          <div>
            <label className="sr-only" htmlFor={searchInputId}>
              Search wiki notes
            </label>
            <input
              id={searchInputId}
              type="text"
              className="wb-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes & benchmarks (e.g. Fran, Squat)…"
            />
          </div>
          <div className="wb-catalog-list">
            {notes.length ? (
              notes.map((n) => (
                <button
                  key={n.slug}
                  type="button"
                  className="wb-option-row"
                  data-ed="pick-wiki"
                  onClick={() => onPickWiki(n.title)}
                >
                  <span className="wb-option-main">
                    <span className="wb-option-title">{n.title}</span>
                    <span className="wb-option-sub">{n.summary}</span>
                  </span>
                  <span className="wb-option-code">[[{n.title}]]</span>
                </button>
              ))
            ) : (
              <div className="wb-editor-desc">No matching wiki notes.</div>
            )}
          </div>
        </>
      );
    }

    if (mode === 'prose-tag' || mode === 'fm-tag') {
      const tagGroups = searchTags(searchQuery, catalogs);
      const cleanQ = slugify(searchQuery.replace(/^#/, ''));
      const hasExact = Boolean(searchQuery.trim()) && catalogs.tags.some((t) => t.slug === cleanQ);
      return (
        <>
          <div>
            <label className="sr-only" htmlFor={searchInputId}>
              Search tags
            </label>
            <input
              id={searchInputId}
              type="text"
              className="wb-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search #tags (e.g. emom, heavy, kettlebell)…"
            />
          </div>
          {searchQuery.trim() && !hasExact && (
            <button
              type="button"
              className="wb-btn wb-btn-primary"
              onClick={() => onCreateAndPickTag(cleanQ, null)}
            >
              + Create #{cleanQ}
            </button>
          )}
          {Object.entries(tagGroups).map(([grp, list]) => (
            <div key={grp} className="wb-catalog-group">
              <div className="wb-catalog-group-title">{grp}</div>
              <div className="wb-catalog-list">
                {list.map((t) => {
                  const isApplied = mode === 'fm-tag' && activeFrontmatterTags.includes(`#${t.slug}`);
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      className={`wb-option-row${isApplied ? ' is-selected' : ''}`}
                      onClick={() => onPickTag(`#${t.slug}`)}
                    >
                      <span className="wb-option-main">
                        <span className="wb-option-title">#{t.slug}</span>
                        <span className="wb-option-sub">{t.desc}</span>
                      </span>
                      <span className="wb-option-code">{isApplied ? 'Active' : `#${t.slug}`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      );
    }

    if (mode === 'add') {
      return (
        <>
          <div className="wb-control-section">
            <div className="wb-control-label">Timers &amp; Rest</div>
            <div className="wb-seg-pills">
              {[
                { label: '1:00 Timer', val: '1:00' },
                { label: '*1:00 Rest', val: '*1:00' },
                { label: '^5:00 Count-up', val: '^5:00' },
                { label: ':? Measure', val: ':?' },
              ].map((it) => (
                <button key={it.val} type="button" className="wb-choice-pill" onClick={() => onInsertToken(it.val)}>
                  {it.label}
                </button>
              ))}
            </div>
          </div>

          <div className="wb-control-section">
            <div className="wb-control-label">Reps, Load &amp; Distance</div>
            <div className="wb-seg-pills">
              {[
                { label: '10 Reps', val: '10' },
                { label: '5x5 Scheme', val: '5x5' },
                { label: '@20kg Load', val: '@20kg' },
                { label: '400m Dist', val: '400m' },
              ].map((it) => (
                <button key={it.val} type="button" className="wb-choice-pill" onClick={() => onInsertToken(it.val)}>
                  {it.label}
                </button>
              ))}
            </div>
          </div>

          <div className="wb-control-section">
            <div className="wb-control-label">Catalog &amp; Wiki</div>
            <div className="wb-seg-pills">
              {[
                { label: 'Effort…', val: 'Kettlebell Swing' },
                { label: 'Equipment…', val: 'Kettlebell' },
                { label: '#Tag…', val: '#conditioning' },
                { label: '(3) Rounds', val: '(3)' },
              ].map((it) => (
                <button key={it.val} type="button" className="wb-choice-pill" onClick={() => onInsertToken(it.val)}>
                  {it.label}
                </button>
              ))}
            </div>
          </div>

          <div className="wb-control-section">
            <div className="wb-control-label">Actions &amp; Properties</div>
            <div className="wb-seg-pills">
              {ACTION_CUES.map((a) => (
                <button key={a.code} type="button" className="wb-choice-pill" onClick={() => onInsertToken(a.code)}>
                  {a.code}
                </button>
              ))}
            </div>
          </div>
        </>
      );
    }

    if (!token) {
      return <div className="wb-editor-desc">Select any parsed token chip or click + Add to edit this line.</div>;
    }

    if (token.kind === 'duration') {
      const dMode: TimerMode = token.meta.mode ?? 'countdown';
      const mins = token.meta.mins ?? 0;
      const secs = token.meta.secs ?? 0;
      const minOpts = Array.from({ length: 31 }, (_, i) => i);
      const secOpts = Array.from(new Set([0, 5, 10, 15, 20, 30, 40, 45, 50, secs])).sort((a, b) => a - b);

      const updateDuration = (nextM: number, nextS: number, nextMode: TimerMode = dMode) => {
        let m = Math.max(0, nextM);
        let s = nextS;
        if (s >= 60) {
          m += 1;
          s -= 60;
        }
        if (s < 0) {
          if (m > 0) {
            m -= 1;
            s += 60;
          } else {
            s = 0;
          }
        }
        if (m === 0 && s === 0) s = 30;
        const val = formatMmSs(nextMode === 'collectible' ? 'countdown' : nextMode, m, s);
        onReplaceToken(token, val);
      };

      return (
        <>
          <div className="wb-control-section">
            <div className="wb-control-row-head">
              <span className="wb-control-label">Timer Mode</span>
              {onToggleScrubber && dMode !== 'collectible' && (
                <button type="button" className="wb-inline-link" onClick={onToggleScrubber}>
                  {useScrubber ? 'Use Steppers' : 'Use Scrubber'}
                </button>
              )}
            </div>
            <div className="wb-seg-pills">
              {(
                [
                  { id: 'countdown', lbl: 'Countdown (1:00)' },
                  { id: 'rest', lbl: 'Rest (*1:00)' },
                  { id: 'countup', lbl: 'Count-up (^5:00)' },
                  { id: 'collectible', lbl: 'Measure (:?)' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`wb-choice-pill${dMode === opt.id ? ' is-selected' : ''}`}
                  onClick={() => onReplaceToken(token, formatMmSs(opt.id, mins || 1, secs))}
                >
                  {opt.lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="wb-control-section">
            <div className="wb-control-label">Quick Presets</div>
            <div className="wb-seg-pills">
              {[
                { m: 0, s: 20 },
                { m: 0, s: 30 },
                { m: 1, s: 0 },
                { m: 2, s: 0 },
                { m: 5, s: 0 },
                { m: 10, s: 0 },
              ].map((p) => {
                const valStr = formatMmSs(dMode === 'collectible' ? 'countdown' : dMode, p.m, p.s);
                const isCur = dMode !== 'collectible' && mins === p.m && secs === p.s;
                return (
                  <button
                    key={valStr}
                    type="button"
                    className={`wb-choice-pill${isCur ? ' is-selected' : ''}`}
                    data-ed="replace-val"
                    data-val={valStr}
                    onClick={() => onReplaceToken(token, valStr)}
                  >
                    {valStr}
                  </button>
                );
              })}
            </div>
          </div>

          {dMode !== 'collectible' &&
            (useScrubber ? (
              <div className="wb-scrubber-grid">
                <div className="wb-scrubber-col">
                  <div className="wb-control-label">Minutes</div>
                  <div className="wb-scrubber-drum" data-scrubber="mins">
                    <div className="wb-scrubber-reticle" />
                    <div className="wb-scrubber-scroll" role="listbox" aria-label="Minutes">
                      {minOpts.map((mv) => {
                        const sel = mv === mins;
                        return (
                          <button
                            key={mv}
                            type="button"
                            role="option"
                            aria-selected={sel}
                            className={`wb-scrubber-row${sel ? ' is-selected' : ''}`}
                            onClick={() => updateDuration(mv, secs)}
                          >
                            {mv}m
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="wb-scrubber-col">
                  <div className="wb-control-label">Seconds</div>
                  <div className="wb-scrubber-drum" data-scrubber="secs">
                    <div className="wb-scrubber-reticle" />
                    <div className="wb-scrubber-scroll" role="listbox" aria-label="Seconds">
                      {secOpts.map((sv) => {
                        const sel = sv === secs;
                        return (
                          <button
                            key={sv}
                            type="button"
                            role="option"
                            aria-selected={sel}
                            className={`wb-scrubber-row${sel ? ' is-selected' : ''}`}
                            onClick={() => updateDuration(mins, sv)}
                          >
                            :{sv < 10 ? '0' : ''}
                            {sv}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="wb-stepper-grid">
                <div className="wb-stepper-card">
                  <button
                    type="button"
                    className="wb-stepper-btn"
                    aria-label="Decrease minutes"
                    onClick={() => updateDuration(mins - 1, secs)}
                  >
                    −
                  </button>
                  <div className="wb-stepper-readout">
                    <span className="wb-stepper-val wb-tabular">{mins}</span>
                    <span className="wb-stepper-unit">min</span>
                  </div>
                  <button
                    type="button"
                    className="wb-stepper-btn"
                    aria-label="Increase minutes"
                    onClick={() => updateDuration(mins + 1, secs)}
                  >
                    +
                  </button>
                </div>
                <div className="wb-stepper-card">
                  <button
                    type="button"
                    className="wb-stepper-btn"
                    aria-label="Decrease seconds"
                    onClick={() => updateDuration(mins, secs - 5)}
                  >
                    −
                  </button>
                  <div className="wb-stepper-readout">
                    <span className="wb-stepper-val wb-tabular">
                      {secs < 10 ? '0' : ''}
                      {secs}
                    </span>
                    <span className="wb-stepper-unit">sec</span>
                  </div>
                  <button
                    type="button"
                    className="wb-stepper-btn"
                    aria-label="Increase seconds"
                    onClick={() => updateDuration(mins, secs + 5)}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
        </>
      );
    }

    if (token.kind === 'scheme' || token.kind === 'rounds') {
      const sets = token.meta.sets ?? 5;
      const reps = token.meta.reps ?? 5;
      return (
        <>
          {token.kind === 'scheme' && (
            <div className="wb-stepper-grid">
              <div className="wb-stepper-card">
                <button
                  type="button"
                  className="wb-stepper-btn"
                  aria-label="Decrease sets"
                  onClick={() => onReplaceToken(token, `${Math.max(1, sets - 1)}x${reps}`)}
                >
                  −
                </button>
                <div className="wb-stepper-readout">
                  <span className="wb-stepper-val wb-tabular">{sets}</span>
                  <span className="wb-stepper-unit">sets</span>
                </div>
                <button
                  type="button"
                  className="wb-stepper-btn"
                  aria-label="Increase sets"
                  onClick={() => onReplaceToken(token, `${sets + 1}x${reps}`)}
                >
                  +
                </button>
              </div>
              <div className="wb-stepper-card">
                <button
                  type="button"
                  className="wb-stepper-btn"
                  aria-label="Decrease reps"
                  onClick={() => onReplaceToken(token, `${sets}x${Math.max(1, reps - 1)}`)}
                >
                  −
                </button>
                <div className="wb-stepper-readout">
                  <span className="wb-stepper-val wb-tabular">{reps}</span>
                  <span className="wb-stepper-unit">reps</span>
                </div>
                <button
                  type="button"
                  className="wb-stepper-btn"
                  aria-label="Increase reps"
                  onClick={() => onReplaceToken(token, `${sets}x${reps + 1}`)}
                >
                  +
                </button>
              </div>
            </div>
          )}
          <div className="wb-control-section">
            <div className="wb-control-label">Common Structures</div>
            <div className="wb-seg-pills">
              {['(3)', '(5)', '(21-15-9)', '5x5', '3x8', 'EMOM', 'AMRAP', 'Tabata'].map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`wb-choice-pill${token.raw.toUpperCase() === v.toUpperCase() ? ' is-selected' : ''}`}
                  onClick={() => onReplaceToken(token, v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </>
      );
    }

    if (token.kind === 'rep') {
      const curReps = Math.round(token.meta.reps ?? 10);
      return (
        <>
          <div className="wb-stepper-grid">
            <div className="wb-stepper-card">
              <button type="button" className="wb-stepper-btn" onClick={() => onReplaceToken(token, String(Math.max(1, curReps - 5)))}>
                -5
              </button>
              <button type="button" className="wb-stepper-btn" onClick={() => onReplaceToken(token, String(Math.max(1, curReps - 1)))}>
                −
              </button>
              <div className="wb-stepper-readout">
                <span className="wb-stepper-val wb-tabular">{curReps}</span>
                <span className="wb-stepper-unit">reps</span>
              </div>
              <button type="button" className="wb-stepper-btn" onClick={() => onReplaceToken(token, String(curReps + 1))}>
                +
              </button>
              <button type="button" className="wb-stepper-btn" onClick={() => onReplaceToken(token, String(curReps + 5))}>
                +5
              </button>
            </div>
          </div>
          <div className="wb-control-section">
            <div className="wb-control-label">Presets</div>
            <div className="wb-seg-pills">
              {['5', '8', '10', '12', '15', '20', '30'].map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`wb-choice-pill${String(curReps) === v ? ' is-selected' : ''}`}
                  onClick={() => onReplaceToken(token, v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </>
      );
    }

    if (token.kind === 'resistance') {
      const hasAt = Boolean(token.meta.hasAt);
      const amt = token.meta.amount ?? '20';
      const numAmt = parseFloat(String(amt));
      const unit = token.meta.unit ?? 'kg';
      const altAmt = token.meta.altAmount ?? null;
      const baseLoads = unit === 'kg' ? [16, 20, 24, 32, 43, 60, 80, 100, 105, 120] : [35, 53, 70, 95, 115, 135, 155, 185, 225];
      const loads = !Number.isNaN(numAmt) && !baseLoads.includes(numAmt) ? [...baseLoads, numAmt].sort((a, b) => a - b) : baseLoads;

      const buildRes = (nextHasAt: boolean, nextAmt: string | number, nextAlt: number | null, nextUnit: string) =>
        `${nextHasAt ? '@' : ''}${nextAmt}${nextAlt ? ` | ${nextAlt} ` : ''}${nextUnit}`;

      return (
        <>
          <div className="wb-control-section">
            <div className="wb-control-row-head">
              <span className="wb-control-label">Prefix &amp; Alternatives</span>
              {onToggleScrubber && !Number.isNaN(numAmt) && (
                <button type="button" className="wb-inline-link" onClick={onToggleScrubber}>
                  {useScrubber ? 'Use Steppers' : 'Use Scrubber'}
                </button>
              )}
            </div>
            <div className="wb-seg-pills">
              <button
                type="button"
                className={`wb-choice-pill${hasAt ? ' is-selected' : ''}`}
                onClick={() => onReplaceToken(token, buildRes(!hasAt, amt, altAmt, unit))}
              >
                @ Load Prefix ({hasAt ? 'On' : 'Off'})
              </button>
              <button
                type="button"
                className="wb-choice-pill"
                onClick={() =>
                  onReplaceToken(
                    token,
                    buildRes(hasAt, amt, altAmt ? null : Math.max(5, Math.round((numAmt || 20) * 0.7)), unit),
                  )
                }
              >
                {altAmt ? 'Single Value' : 'Rx | Scaled (|)'}
              </button>
            </div>
          </div>

          <div className="wb-control-section">
            <div className="wb-control-label">Unit</div>
            <div className="wb-seg-pills">
              {['kg', 'lb', 'pood', '%'].map((u) => (
                <button
                  key={u}
                  type="button"
                  className={`wb-choice-pill${unit === u ? ' is-selected' : ''}`}
                  onClick={() => onReplaceToken(token, buildRes(hasAt, amt, altAmt, u))}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          {!Number.isNaN(numAmt) &&
            (useScrubber ? (
              <div className="wb-scrubber-col">
                <div className="wb-control-label">
                  Amount ({hasAt ? '@' : ''}
                  {unit})
                </div>
                <div className="wb-scrubber-drum" data-scrubber="load">
                  <div className="wb-scrubber-reticle" />
                  <div className="wb-scrubber-scroll" role="listbox" aria-label="Load amount">
                    {loads.map((lv) => {
                      const sel = lv === numAmt;
                      return (
                        <button
                          key={lv}
                          type="button"
                          role="option"
                          aria-selected={sel}
                          className={`wb-scrubber-row${sel ? ' is-selected' : ''}`}
                          onClick={() => onReplaceToken(token, buildRes(hasAt, lv, altAmt, unit))}
                        >
                          {hasAt ? '@' : ''}
                          {lv}
                          {unit}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="wb-stepper-grid">
                <div className="wb-stepper-card">
                  <button
                    type="button"
                    className="wb-stepper-btn"
                    aria-label="Decrease load by 5"
                    onClick={() => onReplaceToken(token, buildRes(hasAt, Math.max(1, numAmt - 5), altAmt, unit))}
                  >
                    -5
                  </button>
                  <div className="wb-stepper-readout">
                    <span className="wb-stepper-val wb-tabular">
                      {hasAt ? '@' : ''}
                      {numAmt}
                    </span>
                    <span className="wb-stepper-unit">{unit}</span>
                  </div>
                  <button
                    type="button"
                    className="wb-stepper-btn"
                    aria-label="Increase load by 5"
                    onClick={() => onReplaceToken(token, buildRes(hasAt, numAmt + 5, altAmt, unit))}
                  >
                    +5
                  </button>
                </div>
              </div>
            ))}

          <div className="wb-control-section">
            <div className="wb-control-label">Quick Loads</div>
            <div className="wb-seg-pills">
              {loads.slice(0, 6).map((lv) => {
                const txt = buildRes(hasAt, lv, null, unit);
                return (
                  <button
                    key={lv}
                    type="button"
                    className={`wb-choice-pill${lv === numAmt ? ' is-selected' : ''}`}
                    onClick={() => onReplaceToken(token, txt)}
                  >
                    {txt}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      );
    }

    if (token.kind === 'distance') {
      const dUnit = token.meta.unit ?? 'm';
      const dAmt = String(token.meta.amount ?? '400');
      const presets =
        dUnit === 'cal'
          ? ['10', '15', '20', '30', '50']
          : dUnit === 'mile'
            ? ['1/4', '1/2', '1', '3']
            : ['100', '200', '400', '800', '1000', '2000'];

      const fmtDist = (amtStr: string, u: string) => `${amtStr}${u === 'mile' || u === 'cal' || u === 'ft' ? ` ${u}` : u}`;
      return (
        <>
          <div className="wb-control-section">
            <div className="wb-control-label">Unit</div>
            <div className="wb-seg-pills">
              {['m', 'km', 'cal', 'ft', 'mile'].map((u) => (
                <button
                  key={u}
                  type="button"
                  className={`wb-choice-pill${dUnit === u ? ' is-selected' : ''}`}
                  onClick={() => onReplaceToken(token, fmtDist(dAmt, u))}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <div className="wb-control-section">
            <div className="wb-control-label">Presets</div>
            <div className="wb-seg-pills">
              {presets.map((amtStr) => {
                const valStr = fmtDist(amtStr, dUnit);
                return (
                  <button
                    key={valStr}
                    type="button"
                    className={`wb-choice-pill${token.raw === valStr ? ' is-selected' : ''}`}
                    onClick={() => onReplaceToken(token, valStr)}
                  >
                    {valStr}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      );
    }

    if (token.kind === 'effort') {
      const effRes = searchEfforts(searchQuery, activeNotebook, catalogs);
      const cleanEff = searchQuery.trim();
      const exactEff = cleanEff && catalogs.efforts.some((e) => e.name.toLowerCase() === cleanEff.toLowerCase());
      return (
        <>
          <div>
            <label className="sr-only" htmlFor={searchInputId}>
              Search efforts
            </label>
            <input
              id={searchInputId}
              type="text"
              className="wb-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search efforts or aliases (e.g. swing, kb, squat)…"
            />
          </div>
          {cleanEff && !exactEff && (
            <button
              type="button"
              className="wb-btn wb-btn-primary"
              onClick={() => onDefineUnresolved(cleanEff, 'effort', undefined, true)}
            >
              + Create Effort &ldquo;{cleanEff}&rdquo;
            </button>
          )}
          {effRes.scoped.length > 0 && (
            <div className="wb-catalog-group">
              <div className="wb-catalog-group-title">Notebook &amp; Recent ({activeNotebook || 'general'})</div>
              <div className="wb-catalog-list">
                {effRes.scoped.map((e) => {
                  const sel = token.meta.effortId === e.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className={`wb-option-row${sel ? ' is-selected' : ''}`}
                      onClick={() => onReplaceToken(token, e.name)}
                    >
                      <span className="wb-option-main">
                        <span className="wb-option-title">{e.name}</span>
                        <span className="wb-option-sub">
                          {e.category}
                          {e.defaultEquipment ? ` · ${e.defaultEquipment}` : ''}
                          {e.aliases.length ? ` · ${e.aliases.slice(0, 2).join(', ')}` : ''}
                        </span>
                      </span>
                      <span className="wb-option-code">{sel ? 'Active' : 'Select'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {effRes.other.length > 0 && (
            <div className="wb-catalog-group">
              <div className="wb-catalog-group-title">All Movements</div>
              <div className="wb-catalog-list">
                {effRes.other.map((e) => {
                  const sel = token.meta.effortId === e.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className={`wb-option-row${sel ? ' is-selected' : ''}`}
                      onClick={() => onReplaceToken(token, e.name)}
                    >
                      <span className="wb-option-main">
                        <span className="wb-option-title">{e.name}</span>
                        <span className="wb-option-sub">
                          {e.category}
                          {e.aliases.length ? ` · ${e.aliases.slice(0, 2).join(', ')}` : ''}
                        </span>
                      </span>
                      <span className="wb-option-code">{sel ? 'Active' : 'Select'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!effRes.scoped.length && !effRes.other.length && (
            <div className="wb-editor-desc">No catalog match — create &ldquo;{cleanEff}&rdquo; above.</div>
          )}
        </>
      );
    }

    if (token.kind === 'equipment') {
      const filtered = catalogs.equipment.filter((eq) => fuzzyMatches(searchQuery, [eq.name, eq.desc]));
      return (
        <>
          <div>
            <label className="sr-only" htmlFor={searchInputId}>
              Search equipment
            </label>
            <input
              id={searchInputId}
              type="text"
              className="wb-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter equipment…"
            />
          </div>
          <div className="wb-catalog-list">
            {filtered.map((eq) => {
              const sel = token.meta.equipmentId === eq.id;
              return (
                <button
                  key={eq.id}
                  type="button"
                  className={`wb-option-row${sel ? ' is-selected' : ''}`}
                  onClick={() => onReplaceToken(token, eq.name)}
                >
                  <span className="wb-option-main">
                    <span className="wb-option-title">{eq.name}</span>
                    <span className="wb-option-sub">{eq.desc}</span>
                  </span>
                  <span className="wb-option-code">{sel ? 'Active' : 'Select'}</span>
                </button>
              );
            })}
          </div>
        </>
      );
    }

    if (token.kind === 'tag') {
      const tGroups = searchTags(searchQuery, catalogs);
      const cleanSlug = slugify(searchQuery.replace(/^#/, ''));
      const exactT = Boolean(searchQuery.trim()) && catalogs.tags.some((t) => t.slug === cleanSlug);
      return (
        <>
          <div>
            <label className="sr-only" htmlFor={searchInputId}>
              Search tags
            </label>
            <input
              id={searchInputId}
              type="text"
              className="wb-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search #tags…"
            />
          </div>
          {searchQuery.trim() && !exactT && (
            <button
              type="button"
              className="wb-btn wb-btn-primary"
              onClick={() => onCreateAndPickTag(cleanSlug, token)}
            >
              + Create &amp; Use #{cleanSlug}
            </button>
          )}
          {Object.entries(tGroups).map(([grp, list]) => (
            <div key={grp} className="wb-catalog-group">
              <div className="wb-catalog-group-title">{grp}</div>
              <div className="wb-catalog-list">
                {list.map((t) => {
                  const sel = token.raw.toLowerCase() === `#${t.slug}`.toLowerCase();
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      className={`wb-option-row${sel ? ' is-selected' : ''}`}
                      onClick={() => onReplaceToken(token, `#${t.slug}`)}
                    >
                      <span className="wb-option-main">
                        <span className="wb-option-title">#{t.slug}</span>
                        <span className="wb-option-sub">{t.desc}</span>
                      </span>
                      <span className="wb-option-code">{sel ? 'Active' : 'Select'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      );
    }

    if (token.kind === 'unresolved') {
      if (token.meta.isTag) {
        return (
          <>
            {token.raw.length > 1 && (
              <div className="wb-seg-pills">
                <button
                  type="button"
                  className="wb-btn wb-btn-primary"
                  onClick={() => onDefineUnresolved(token.raw, 'tag')}
                >
                  + Create Tag {token.raw}
                </button>
              </div>
            )}
            <div className="wb-control-section">
              <div className="wb-control-label">
                {token.raw.length > 1 ? 'Or Replace With Existing Tag' : 'Choose a Tag'}
              </div>
              <div className="wb-seg-pills">
                {catalogs.tags.slice(0, 6).map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    className="wb-choice-pill"
                    onClick={() => onReplaceToken(token, `#${t.slug}`)}
                  >
                    #{t.slug}
                  </button>
                ))}
              </div>
            </div>
          </>
        );
      }
      return (
        <>
          <div className="wb-seg-pills">
            <button
              type="button"
              className="wb-btn wb-btn-primary"
              data-wb-define-effort="true"
              onClick={() => onDefineUnresolved(token.raw, 'effort')}
            >
              + Define Effort
            </button>
            <button
              type="button"
              className="wb-btn wb-btn-secondary"
              onClick={() => setShowAliasList((prev) => !prev)}
            >
              + Alias to Existing
            </button>
            <button
              type="button"
              className="wb-btn wb-btn-secondary"
              onClick={() => onDefineUnresolved(token.raw, 'equipment')}
            >
              + Equipment
            </button>
          </div>
          {showAliasList && (
            <div className="wb-control-section">
              <div className="wb-control-label">Pick Target Effort for Alias</div>
              <div className="wb-catalog-list">
                {catalogs.efforts.slice(0, 8).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="wb-option-row"
                    onClick={() => onDefineUnresolved(token.raw, 'alias', e.id)}
                  >
                    <span className="wb-option-main">
                      <span className="wb-option-title">{e.name}</span>
                      <span className="wb-option-sub">{e.category}</span>
                    </span>
                    <span className="wb-option-code">Link Alias</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      );
    }

    if (token.kind === 'lintError') {
      return (
        <div className="wb-control-section">
          <div className="wb-control-label">1-Click Fixes</div>
          <div className="wb-seg-pills">
            {(token.meta.fixes ?? []).map((fx) => (
              <button key={fx} type="button" className="wb-btn wb-btn-primary" onClick={() => onReplaceToken(token, fx)}>
                Use {fx}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (token.kind === 'action' || token.kind === 'property') {
      return (
        <>
          <div className="wb-control-section">
            <div className="wb-control-label">Actions</div>
            <div className="wb-catalog-list">
              {ACTION_CUES.map((a) => (
                <button
                  key={a.code}
                  type="button"
                  className={`wb-option-row${token.raw === a.code ? ' is-selected' : ''}`}
                  onClick={() => onReplaceToken(token, a.code)}
                >
                  <span className="wb-option-main">
                    <span className="wb-option-title">{a.label}</span>
                    <span className="wb-option-sub">{a.desc}</span>
                  </span>
                  <span className="wb-option-code">{a.code}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="wb-control-section">
            <div className="wb-control-label">Properties</div>
            <div className="wb-catalog-list">
              {PROPERTY_CUES.map((p) => (
                <button
                  key={p.code}
                  type="button"
                  className={`wb-option-row${token.raw === p.code ? ' is-selected' : ''}`}
                  onClick={() => onReplaceToken(token, p.code)}
                >
                  <span className="wb-option-main">
                    <span className="wb-option-title">{p.label}</span>
                    <span className="wb-option-sub">{p.desc}</span>
                  </span>
                  <span className="wb-option-code">{p.code}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      );
    }

    return <div className="wb-editor-desc">Select a token to edit.</div>;
  };

  const canDelete = mode === 'token' && Boolean(token);

  return (
    <div ref={rootRef} className="wb-inspector-content">
      {showHeader && (
        <div className="wb-editor-head">
          <div className="wb-editor-head-meta">
            <div className="wb-editor-head-title">
              <span>{title}</span>
              {badge && <span className="wb-kbd-chip">{badge}</span>}
            </div>
            <div className="wb-editor-desc">{desc}</div>
          </div>
          <div className="wb-editor-head-actions">
            {canDelete && token && (
              <button
                type="button"
                className="wb-icon-btn"
                aria-label="Delete token"
                title="Delete token"
                onClick={() => onDeleteToken(token)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            )}
            {showStepButtons && onStepToken && (
              <>
                <button
                  type="button"
                  className="wb-icon-btn"
                  aria-label="Previous token"
                  title="Previous token"
                  onClick={() => onStepToken(-1)}
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="wb-icon-btn"
                  aria-label="Next token"
                  title="Next token"
                  onClick={() => onStepToken(1)}
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </>
            )}
            {showClose && onClose && (
              <button
                type="button"
                className="wb-icon-btn"
                aria-label="Close inspector"
                title="Close (Esc)"
                onClick={onClose}
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="wb-editor-body">{renderContent()}</div>

      {showFooter && (
        <div className="wb-editor-footer">
          <span>Line-safe CodeMirror transaction</span>
          <span>Esc returns to editor</span>
        </div>
      )}
    </div>
  );
};
