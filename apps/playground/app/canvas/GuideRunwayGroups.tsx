/**
 * GuideRunwayGroups.tsx — grouped parallax rendering for the live syntax
 * guides (the eight /guide/* chapters). Each page's parsed CanvasSections
 * are partitioned into small semantic runs (guideGroups.ts) rendered through
 * the shared RunwayShell (the home first-four pattern); the caption rail
 * hosts the FULL existing CanvasSectionCard content (prose, buttons,
 * examples, quests) in plain caption typography with shared cross-fade
 * transitions and internal scrollable overflow — nothing is duplicated into
 * brief captions.
 *
 * Terminal meta sections (the compact reference) stay out of the runways
 * and render as normal flow after the last group so they remain
 * fully accessible.
 *
 * Deep links: each stage renders an invisible marker INSIDE the group's
 * track geometry at its runway start, carrying the section's `id` and
 * `data-section-id` — so every existing consumer (initial `?h=`,
 * usePageScrollSync L3 scrolls, header challenge badges) lands at real
 * runway progress instead of a hidden, visibility-gated caption panel. The
 * caption cards themselves carry no routable anchors, so scroll-spies can
 * never mistake them for the active content.
 *
 * Activation: a group only reports stage entries while it OWNS the reading
 * zone (its sticky window pinned, progress < 1); regaining ownership
 * re-notifies the current stage so scrolling back between groups restores
 * the panel even when the stage index did not change. Source ownership,
 * example selection, runtime/Run and the `?h=` param stay in the host.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RunwayShell } from './RunwayShell'
import { useScrollRunway } from './useScrollRunway'
import { guideStages, groupGuideSections } from './guideGroups'
import { CanvasSection as CanvasSectionCard } from '../components/molecules/CanvasSection'
import type { CanvasSection, Chapter, Quest } from './parseCanvasMarkdown'
import type { NavActionDeps } from '../nav/navTypes'
import type { RunButtonState } from '../components/molecules/SectionButtons'

// ── Caption rail ─────────────────────────────────────────────────────────────

export interface GuideCardArgs {
  activeSectionId: string | null
  selectedExamples: Record<string, number>
  onExampleSelect: (section: CanvasSection, index: number) => void
  runState?: RunButtonState
  deps: NavActionDeps
  hasViewDef?: boolean
  chapters?: Chapter[]
  challengeQuests?: Array<Quest & { isCompleted: boolean }>
  onScrollToSection?: (sectionId: string) => void
}

function GuideCaptionRail({
  sections,
  activeIndex,
  part,
  args,
}: {
  sections: CanvasSection[]
  activeIndex: number
  part: number
  args: GuideCardArgs
}) {
  return (
    <div className="h-full min-h-0 pr-1" data-testid={`guide-captions-${part}`}>
      {sections.map((section, i) => {
        const active = i === activeIndex
        return (
          // Absolute-stacked cross-fade rail — same shared transition as the
          // tour/scroll caption rails. Inactive cards are visibility-gated so
          // their controls leave the tab order; blockId is namespaced so the
          // hidden copies never win id/data-section-id lookups (the stage
          // markers below own those).
          <div
            key={section.id}
            className={`absolute inset-0 min-h-0 overflow-y-auto transition-opacity duration-300 ${
              active ? 'opacity-100' : 'pointer-events-none invisible opacity-0'
            }`}
            aria-hidden={!active}
          >
            <CanvasSectionCard
              section={section}
              idx={i}
              blockId={`guide-caption-${section.id}`}
              keySuffix="caption"
              variant="caption"
              isActive={active}
              hasViewDef={args.hasViewDef ?? true}
              runState={args.runState}
              deps={args.deps}
              onExampleSelect={args.onExampleSelect}
              selectedExampleIndex={args.selectedExamples[section.id] ?? 0}
              chapters={args.chapters}
              challengeQuests={args.challengeQuests}
              onScrollToSection={args.onScrollToSection}
            />
          </div>
        )
      })}
    </div>
  )
}

// ── One group runway ─────────────────────────────────────────────────────────

interface GuideRunwayGroupProps {
  sections: CanvasSection[]
  part: number
  partCount: number
  title: string
  pane: ReactNode
  cardArgs: GuideCardArgs
  onActivateSection: (section: CanvasSection) => void
}

function GuideRunwayGroup({
  sections,
  part,
  partCount,
  title,
  pane,
  cardArgs,
  onActivateSection,
}: GuideRunwayGroupProps) {
  const trackRef = useRef<HTMLElement | null>(null)
  const stages = useMemo(() => guideStages(sections), [sections])

  const { slice, subscribe } = useScrollRunway(trackRef, false, stages)

  // Sections are parsed once per route; keep a ref so the effects below key
  // on reach/stage only, not on host re-renders.
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections

  // Reached-once: mount the pane lazily, like the home tour's screens — a
  // group's editor display only exists once its track scrolls near the
  // viewport. (No IntersectionObserver → treat as reached, matching the
  // tour's degraded mode.)
  const [reached, setReached] = useState(false)
  useEffect(() => {
    const el = trackRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setReached(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setReached(true)
          observer.disconnect()
        }
      },
      { rootMargin: '100px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Reading-zone owner gate: a group claims activation only while its sticky
  // window is the pinned context (track top above the viewport top, progress
  // < 1). Ownership rides the per-frame subscription — `progress` is a ref,
  // not reactive state, so the boolean flips state exactly at the top/bottom
  // edges and nowhere else. Regaining ownership (scrolling back into a
  // consumed/above group) re-notifies the current stage even when the index
  // did not change — that restores the panel on backward entry between
  // groups. Stage changes while owning always notify (same contract as the
  // old per-section IO tracking; source swaps stay guarded in the host).
  const trackOwnsReadingZone = () => {
    const track = trackRef.current
    if (!track) return false
    const { top, bottom } = track.getBoundingClientRect()
    return top <= 0 && bottom > window.innerHeight
  }
  const [owns, setOwns] = useState(false)
  useEffect(
    () =>
      subscribe(() => {
        const next = trackOwnsReadingZone()
        setOwns((previous) => previous === next ? previous : next)
      }),
    [subscribe],
  )
  const ownerRef = useRef(false)
  const lastIndexRef = useRef(-1)
  const onActivateRef = useRef(onActivateSection)
  onActivateRef.current = onActivateSection
  useEffect(() => {
    const prevOwner = ownerRef.current
    const prevIndex = lastIndexRef.current
    ownerRef.current = owns
    lastIndexRef.current = slice.index
    if (!owns) return
    if (prevOwner && prevIndex === slice.index) return
    const section = sectionsRef.current[slice.index]
    if (section) onActivateRef.current(section)
  }, [owns, slice.index])

  const active = sections[slice.index] ?? null

  return (
    <div>
      {/* header break between runs */}
      <header
        data-testid={`guide-runway-header-${part}`}
        className="mx-auto w-full max-w-[1500px] px-6 pt-12 pb-6 lg:px-12"
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Part {part} / {partCount}
        </div>
        <h2 className="mt-1 text-xl font-black uppercase tracking-tight text-foreground">{title}</h2>
      </header>
      <div className="relative">
        <RunwayShell
          trackRef={trackRef}
          height={`${(sections.length + 1) * 100}vh`}
          stages={stages}
          activeIndex={slice.index}
          pane={reached ? pane : null}
          captions={<GuideCaptionRail sections={sections} activeIndex={slice.index} part={part} args={cardArgs} />}
          status={
            <div className="truncate font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              {String(slice.index + 1).padStart(2, '0')}
              {active ? ` — ${active.heading}` : ''}
            </div>
          }
          testId={`guide-runway-${part}`}
        />
        {/* Stage markers: zero-size anchors inside each stage's runway slice
            (identical box geometry to the track). +160px keeps every scroll
            landing (desktop 96px, mobile 75px) strictly inside stage i's
            [i/n, (i+1)/n) progress window (rect.top <= 0). */}
        {sections.map((section, i) => (
          <span
            key={section.id}
            id={section.id}
            data-section-id={section.id}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 h-px w-px"
            style={{ top: `calc((100% - 100vh) * ${i / sections.length} + 160px)` }}
          />
        ))}
      </div>
    </div>
  )
}

// ── Page-level composition ───────────────────────────────────────────────────

export interface GuideRunwayGroupsProps {
  /** Content sections (hero excluded) in document order. */
  sections: CanvasSection[]
  /** Guide slug used to pick the semantic run map ('start', 'wql', …). */
  groupKey?: string
  /** Page title shown in each group's header break. */
  title: string
  /** The host's editor display — mounted (lazily) in every reached group's pane slot. */
  pane: ReactNode
  cardArgs: GuideCardArgs
  onActivateSection: (section: CanvasSection) => void
}

export function GuideRunwayGroups({
  sections,
  groupKey,
  title,
  pane,
  cardArgs,
  onActivateSection,
}: GuideRunwayGroupsProps) {
  const { groups, tail } = groupGuideSections(sections, groupKey)

  return (
    <>
      {groups.map((group, i) => (
        <GuideRunwayGroup
          key={group[0]?.id ?? i}
          sections={group}
          part={i + 1}
          partCount={groups.length}
          title={title}
          pane={pane}
          cardArgs={cardArgs}
          onActivateSection={onActivateSection}
        />
      ))}
      {tail.length > 0 && (
        <div className="mx-auto w-full max-w-[1500px] px-6 lg:px-12" data-testid="guide-static-tail">
          <div className="lg:max-w-[50%]">
            {tail.map((section, i) => (
              <CanvasSectionCard
                key={`tail-${section.id}`}
                section={section}
                idx={i}
                blockId={section.id}
                keySuffix="default"
                isActive={cardArgs.activeSectionId === section.id}
                hasViewDef={cardArgs.hasViewDef ?? true}
                runState={cardArgs.runState}
                deps={cardArgs.deps}
                onExampleSelect={cardArgs.onExampleSelect}
                selectedExampleIndex={cardArgs.selectedExamples[section.id] ?? 0}
                chapters={cardArgs.chapters}
                challengeQuests={cardArgs.challengeQuests}
                onScrollToSection={cardArgs.onScrollToSection}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
