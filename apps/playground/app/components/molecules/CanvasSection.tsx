import React from 'react'
import { cn } from '@/lib/utils'
import { HeroCarousel } from '../organisms/landing/HeroCarousel'
import { CollectionWorkoutsList } from '../../views/queriable-list/CollectionWorkoutsList'
import type { CanvasSection as CanvasSectionType, ButtonBlock, Chapter, Quest } from '../../canvas/parseCanvasMarkdown'
import { SECTION_THEME_STYLES } from '../../canvas/parseCanvasMarkdown'
import { buttonToActivation } from '../../nav/navTypes'
import type { NavActionDeps } from '../../nav/navTypes'
import { CanvasProse } from '../../canvas/CanvasProse'
import { SectionButtons } from './SectionButtons'
import { ExampleTabs } from './ExampleTabs'
import { ChallengeCard } from './ChallengeCard'
import type { RunButtonState } from './SectionButtons'
import type { WorkoutItem } from '../../App'
/** Splits prose at the first blank line — used to pull a hero's opening
 *  sentence out as a big headline, with everything after it as subtext. */
function splitLeadParagraph(text: string): { lead: string; rest: string } {
  const trimmed = text.replace(/^\s+/, '')
  const match = trimmed.match(/\n\s*\n/)
  if (!match || match.index === undefined) return { lead: trimmed, rest: '' }
  return { lead: trimmed.slice(0, match.index), rest: trimmed.slice(match.index).trimStart() }
}

interface CanvasSectionProps {
  section: CanvasSectionType
  idx: number
  prose?: string
  blockId: string
  keySuffix: string
  showHeading?: boolean
  showEyebrow?: boolean
  renderButtons?: boolean
  isActive?: boolean
  hasViewDef?: boolean
  runState?: RunButtonState
  deps: NavActionDeps
  onExampleSelect: (section: CanvasSectionType, index: number) => void
  selectedExampleIndex: number
  chapters?: Chapter[]
  challengeQuests?: Array<Quest & { isCompleted: boolean }>
  isCollection?: boolean
  collectionSlug?: string | null
  workoutItems?: WorkoutItem[]
  handleSelectWorkout?: (item: WorkoutItem) => void
  /** Called when an inline challenge asks to scroll to its section. */
  onScrollToSection?: (sectionId: string) => void
  /** 'caption' — runway caption-rail presentation: same rich content, plain
   *  sentence-case heading, no card chrome (accent rails / zebra / dark). */
  variant?: 'default' | 'caption'
}

export const CanvasSection: React.FC<CanvasSectionProps> = ({
  section,
  idx,
  prose,
  blockId,
  keySuffix,
  showHeading = true,
  showEyebrow = true,
  renderButtons = true,
  isActive = false,
  hasViewDef = false,
  runState,
  deps,
  onExampleSelect,
  selectedExampleIndex,
  chapters = [],
  challengeQuests = [],
  isCollection = false,
  collectionSlug = null,
  workoutItems = [],
  handleSelectWorkout,
  onScrollToSection,
  variant = 'default',
}) => {
  const fullBleed = !!section.isFullBleed
  const dark = !!section.isDark && variant !== 'caption'
  const density = section.density
  const sectionTheme = SECTION_THEME_STYLES[section.theme || 'slate'] ?? SECTION_THEME_STYLES.slate
  const examples = section.examples ?? []
  const isHero = idx === -1

  // Find if this section has an associated quest
  const linkedQuest = React.useMemo(() => {
    if (!chapters || !challengeQuests) return null
    for (const ch of chapters) {
      const secIdx = ch.sectionIds.indexOf(section.id)
      if (secIdx >= 0 && ch.questIds[secIdx]) {
        const qId = ch.questIds[secIdx]
        const quest = challengeQuests.find(q => q.id === qId)
        if (quest) {
          return {
            quest,
            chapterTitle: ch.title,
          }
        }
      }
    }
    return null
  }, [chapters, challengeQuests, section.id])

  // The hero gets a dedicated layout — a kicker badge, a big lead headline
  // pulled out of the opening sentence, subtext, and every CTA button
  // grouped into one row — rather than the generic numbered-card treatment
  // used for every other section.
  if (isHero) {
    const heroButtons: ButtonBlock[] = section.proseChunks
      .filter((c) => c.kind === 'button')
      .map((c) => (c as { kind: 'button'; button: ButtonBlock }).button)

    const firstProseIndex = section.proseChunks.findIndex(
      (c) => c.kind === 'prose' && c.text.trim() !== '',
    )
    const firstProse = firstProseIndex >= 0 ? section.proseChunks[firstProseIndex] : null
    const { lead, rest } = firstProse && firstProse.kind === 'prose'
      ? splitLeadParagraph(firstProse.text.trim())
      : { lead: '', rest: '' }

    // Everything after the first prose chunk (challenge cards, sub-headings, etc.)
    const remainingChunks = section.proseChunks.slice(firstProseIndex + 1)

    return (
      <div
        id={blockId}
        data-section-id={keySuffix === 'default' ? section.id : undefined}
        className="group relative flex min-h-[70vh] lg:min-h-[80vh] items-center justify-center overflow-hidden border-b-2 border-primary/10 bg-gradient-to-b from-primary/[0.08] via-muted/30 to-background px-6 py-16 lg:px-10 lg:py-24"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_60%_at_50%_0%,_var(--tw-gradient-stops))] from-primary/30 via-primary/5 to-transparent" />
        <div
          className="pointer-events-none absolute inset-0 text-primary opacity-[0.15]"
          style={{
            backgroundImage: 'radial-gradient(circle, currentColor 1.5px, transparent 1.5px)',
            backgroundSize: '24px 24px',
            maskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black 40%, transparent 90%)',
            WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black 40%, transparent 90%)',
          }}
        />

        <div className="relative max-w-2xl w-full text-center">

          {lead && <CanvasProse prose={lead} variant="heroLead" className="mb-5" />}
          {rest && <CanvasProse prose={rest} variant="heroBody" className="mb-2" />}

          {remainingChunks.map((chunk, chunkIdx) => {
            if (chunk.kind === 'prose') {
              const text = chunk.text.trim()
              if (!text) return null
              return (
                <CanvasProse
                  key={`hero-prose-${chunkIdx}`}
                  prose={text}
                  className="mt-6 mb-2"
                />
              )
            }
            if (chunk.kind === 'challenge') {
              const quest = challengeQuests.find((q) => q.id === chunk.id)
              if (!quest) return null
              return (
                <div key={`hero-challenge-${chunkIdx}`} className="my-4 flex justify-center">
                  <ChallengeCard
                    quest={quest}
                    onClick={() => onScrollToSection?.(blockId)}
                    compact
                  />
                </div>
              )
            }
            return null
          })}

          {heroButtons.length > 0 && (
            <SectionButtons
              activations={heroButtons.map((b, i) => buttonToActivation(b, i))}
              fullBleed
              runState={hasViewDef ? runState : undefined}
              deps={deps}
            />
          )}
        </div>
      </div>
    )
  }

  // When the parent supplies an override `prose` string (e.g. the
  // `{{workouts}}` split in collection mode), we render it as a single
  // chunk and fall back to the bottom button group. Otherwise we use the
  // parser's `proseChunks`, which already interleave each button with the
  // paragraph it was authored under.
  const useInlineChunks = prose === undefined
  const chunks = useInlineChunks
    ? section.proseChunks ?? []
    : [{ kind: 'prose' as const, text: prose }]
  const hasInlineButtons = chunks.some((c) => c.kind === 'button')
  const renderBottomButtonGroup = !hasInlineButtons && (section.buttons ?? []).length > 0

  return (
    <div
      key={`${section.id}-${keySuffix}`}
      id={blockId}
      data-section-id={keySuffix === 'default' || keySuffix === 'before-workouts' ? section.id : undefined}
      className={cn(
        'group relative border-b border-border/50 transition-colors duration-300',
        variant === 'caption'
          ? 'py-6 pb-10'
          : hasViewDef
            ? fullBleed
              ? 'flex items-center justify-center min-h-[35vh] py-12 lg:py-16 px-6 lg:px-10'
              : density === 'compact'
                ? 'py-10 lg:py-12 px-6 lg:px-10'
                : 'py-14 lg:py-20 px-6 lg:px-10'
            : density === 'compact'
              ? 'py-10 lg:py-12 px-6 lg:px-12'
              : 'py-16 lg:py-20 px-6 lg:px-12',
        !variant || variant === 'default' ? (dark && 'bg-muted/20 overflow-hidden') : undefined,
        variant !== 'caption' && !dark && !fullBleed && (idx % 2 === 0 ? 'bg-background' : 'bg-muted/[0.18]'),
      )}
    >
      {variant !== 'caption' && (
        <>
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b opacity-0 transition-opacity duration-300',
              sectionTheme.accent,
              isActive && 'opacity-100',
            )}
          />
          <div
            className={cn(
              'pointer-events-none absolute left-0 top-0 h-full w-1 origin-top rounded-r-full bg-gradient-to-b transition-all duration-300',
              sectionTheme.progress,
              isActive ? 'scale-y-100 opacity-100' : 'scale-y-[0.18] opacity-25',
            )}
          />
        </>
      )}
      {dark && (
        <div className="pointer-events-none absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent" />
      )}

      <div className={cn(
        'relative',
        variant === 'caption'
          ? 'max-w-none'
          : hasViewDef
            ? fullBleed ? 'max-w-md w-full text-center' : 'max-w-sm'
            : 'max-w-4xl w-full mx-auto',
      )}>
        {showEyebrow && (!fullBleed || !hasViewDef) && linkedQuest && (
          <div className="mb-4 flex items-center gap-2 select-none min-h-[14px]">
            {linkedQuest.quest.isCompleted ? (
              <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                Challenge Complete
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-muted-foreground/80 bg-muted/60 px-2 py-0.5 rounded-full border border-border/50">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                {linkedQuest.chapterTitle}: Challenge Pending
              </span>
            )}
          </div>
        )}


        {showHeading ? (
          <h2
            className={cn(
              'font-bold tracking-tight text-foreground leading-tight',
              variant === 'caption'
                ? 'text-xl lg:text-2xl mb-4'
                : 'text-2xl lg:text-3xl font-black uppercase mb-5',
            )}
          >
            {section.heading}
          </h2>
        ) : null}

        {chunks.map((chunk, chunkIdx) => {
          if (chunk.kind === 'prose') {
            const text = chunk.text.trim()
            if (!text) return null
            // Tighter spacing on the first prose chunk so it hugs the heading;
            // subsequent chunks get a top margin so a button following prose
            // reads as a continuation of the same paragraph block.
            return (
              <CanvasProse
                key={`prose-${chunkIdx}`}
                prose={text}
                className={chunkIdx === 0 ? 'mb-6' : 'mt-4 mb-6'}
              />
            )
          }
          if (chunk.kind === 'button') {
            return (
              <SectionButtons
                key={`button-${chunkIdx}`}
                activations={[buttonToActivation(chunk.button, chunkIdx)]}
                fullBleed={fullBleed}
                runState={hasViewDef ? runState : undefined}
                deps={deps}
              />
            )
          }
          if (chunk.kind === 'widget') {
            if (chunk.widget === 'hero-carousel') {
              return (
                <div key={`hero-carousel-${chunkIdx}`} className="my-6">
                  <HeroCarousel />
                </div>
              )
            }
            if (chunk.widget === 'workouts-list') {
              if (isCollection && collectionSlug && handleSelectWorkout) {
                // The wrapper is the `notebook-workouts` nav anchor — render it
                // even when this collection has no items, so the L3 "Explore"
                // link never targets a missing id (the list shows its own empty state).
                return (
                  <div
                    key={`workouts-${chunkIdx}`}
                    id="notebook-workouts"
                    className="border-b border-border/50 bg-card my-6"
                  >
                    <div className="w-full mx-auto">
                      <CollectionWorkoutsList
                        category={collectionSlug}
                        workoutItems={workoutItems}
                        onSelect={handleSelectWorkout}
                        showSearch={false}
                        variant="flat"
                      />
                    </div>
                  </div>
                )
              }
            }
          }
          if (chunk.kind === 'challenge') {
            const quest = challengeQuests.find((q) => q.id === chunk.id)
            if (!quest) return null
            return (
              <div key={`challenge-${chunkIdx}`} className="my-4">
                <ChallengeCard
                  quest={quest}
                  onClick={() => onScrollToSection?.(blockId)}
                  compact
                />
              </div>
            )
          }
          return null
        })}

        {examples.length > 0 ? (
          <ExampleTabs
            examples={examples}
            activeIndex={Math.min(selectedExampleIndex, examples.length - 1)}
            onSelect={(index) => onExampleSelect(section, index)}
          />
        ) : null}

        {renderButtons && renderBottomButtonGroup ? (
          <SectionButtons
            activations={section.buttons.map((b, i) => buttonToActivation(b, i))}
            fullBleed={fullBleed}
            runState={hasViewDef ? runState : undefined}
            deps={deps}
          />
        ) : null}
      </div>
    </div>
  )
}
