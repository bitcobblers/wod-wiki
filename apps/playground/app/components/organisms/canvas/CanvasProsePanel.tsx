import React from 'react'
import { type CanvasSection, type Chapter, type Quest } from '../../../canvas/parseCanvasMarkdown'
import type { WorkoutItem } from '../../../App'
import { CanvasSection as CanvasSectionComponent } from '../../molecules/CanvasSection'
import { CollectionWorkoutsList } from '../../../views/queriable-list/CollectionWorkoutsList'
import type { RunButtonState } from '../../molecules/SectionButtons'
import type { NavActionDeps } from '../../../nav/navTypes'

interface CanvasProsePanelProps {
  heroSlot?: React.ReactNode
  mobilePanel?: React.ReactNode
  desktopPanel?: React.ReactNode
  /** "left" | "right" — which side the desktop panel sticks to in the split view. */
  stickyAlign?: 'left' | 'right'
  /** Width of the desktop panel column (CSS length). */
  editorWidth?: string
  contentSections: CanvasSection[]
  isCollection: boolean
  collectionSlug: string | null
  workoutItems: WorkoutItem[] | undefined
  handleSelectWorkout: (item: WorkoutItem) => void
  activeSectionId: string | null
  selectedExamples: Record<string, number>
  runState?: RunButtonState
  deps: NavActionDeps
  handleExampleSelect: (section: CanvasSection, index: number) => void
  hasWorkoutsTag: boolean
  hasViewDef: boolean
  chapters?: Chapter[]
  challengeQuests?: Array<Quest & { isCompleted: boolean }>
  /** Called when an inline challenge asks to scroll to its owning section. */
  onScrollToSection?: (sectionId: string) => void
  /**
   * Section id at which the editor panel should appear. Sections before this
   * render full-width (no panel). From this section onward, the layout
   * switches to a split view with the panel sticky on the side specified by
   * `stickyAlign`. Undefined = panel is present from the first section
   * (original behavior).
   */
  editorAppearsAtSectionId?: string
}

interface RenderSectionArgs {
  activeSectionId: string | null
  selectedExamples: Record<string, number>
  handleExampleSelect: (section: CanvasSection, index: number) => void
  hasViewDef: boolean
  runState?: RunButtonState
  deps: NavActionDeps
  chapters?: Chapter[]
  challengeQuests?: Array<Quest & { isCompleted: boolean }>
  isCollection: boolean
  collectionSlug: string | null
  workoutItems: WorkoutItem[] | undefined
  handleSelectWorkout: (item: WorkoutItem) => void
  onScrollToSection?: (sectionId: string) => void
}

const renderSection = (
  section: CanvasSection,
  idx: number,
  args: RenderSectionArgs,
) => (
  <CanvasSectionComponent
    key={`${section.id}-default`}
    section={section}
    idx={idx}
    blockId={section.id}
    keySuffix="default"
    isActive={args.activeSectionId === section.id}
    hasViewDef={args.hasViewDef}
    runState={args.runState}
    deps={args.deps}
    onExampleSelect={args.handleExampleSelect}
    selectedExampleIndex={args.selectedExamples[section.id] ?? 0}
    chapters={args.chapters}
    challengeQuests={args.challengeQuests}
    isCollection={args.isCollection}
    collectionSlug={args.collectionSlug}
    workoutItems={args.workoutItems}
    handleSelectWorkout={args.handleSelectWorkout}
    onScrollToSection={args.onScrollToSection}
  />
)

export const CanvasProsePanel: React.FC<CanvasProsePanelProps> = ({
  heroSlot,
  mobilePanel,
  desktopPanel,
  stickyAlign = 'right',
  editorWidth = '50%',
  contentSections,
  isCollection,
  collectionSlug,
  workoutItems,
  handleSelectWorkout,
  activeSectionId,
  selectedExamples,
  runState,
  deps,
  handleExampleSelect,
  hasWorkoutsTag,
  hasViewDef,
  chapters = [],
  challengeQuests = [],
  onScrollToSection,
  editorAppearsAtSectionId,
}) => {
  // Split content sections at the boundary. Sections before the boundary
  // render full-width (no panel); sections from the boundary onward render
  // in a split layout with the desktop panel sticky on the chosen side.
  // If the boundary section isn't found in contentSections, fall back to
  // the default layout (panel present from the first section).
  const splitIndex = editorAppearsAtSectionId
    ? contentSections.findIndex((s) => s.id === editorAppearsAtSectionId)
    : -1
  const hasSplit = splitIndex > 0 && !!desktopPanel

  const renderArgs: RenderSectionArgs = {
    activeSectionId,
    selectedExamples,
    handleExampleSelect,
    hasViewDef,
    runState,
    deps,
    chapters,
    challengeQuests,
    isCollection,
    collectionSlug,
    workoutItems,
    handleSelectWorkout,
    onScrollToSection,
  }

  // CSS owns arrangement; no viewport listener or DOM measurement is needed.
  const proseWidthStyle: React.CSSProperties = hasSplit
    ? { width: `calc(100% - ${editorWidth})`, flexBasis: `calc(100% - ${editorWidth})`, maxWidth: `calc(100% - ${editorWidth})` }
    : {}

  const collectionList = isCollection && collectionSlug && workoutItems ? (
    <div id="notebook-workouts" className="border-b border-border/50 bg-card">
      <div className="w-full mx-auto">
        <CollectionWorkoutsList
          category={collectionSlug ?? ''}
          workoutItems={workoutItems ?? []}
          onSelect={handleSelectWorkout}
          showSearch={false}
          variant="flat"
        />
      </div>
    </div>
  ) : null

  if (hasSplit) {
    const preSections = contentSections.slice(0, splitIndex)
    const postSections = contentSections.slice(splitIndex)
    return (
      <>
        {heroSlot}
        {preSections.map((section, idx) => renderSection(section, idx, renderArgs))}
        <div className="lg:flex">
          {stickyAlign === 'left' && desktopPanel}
          <div className="w-full min-w-0" style={proseWidthStyle}>
            {mobilePanel}
            {postSections.map((section, idx) => renderSection(section, idx, renderArgs))}
            {collectionList}
          </div>
          {stickyAlign === 'right' && desktopPanel}
        </div>
      </>
    )
  }

  return (
    <>
      {mobilePanel}
      <div className="lg:flex">
        {stickyAlign === 'left' && desktopPanel}
        <div className="w-full min-w-0" style={proseWidthStyle}>
          {heroSlot}
          {contentSections.map((section, idx) => renderSection(section, idx, renderArgs))}
          {collectionList}
        </div>
        {stickyAlign === 'right' && desktopPanel}
      </div>
    </>
  )
}