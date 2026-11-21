import React, { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { Play } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { MacOSChrome } from '../../atoms/MacOSChrome'
import { NoteEditor } from '@/components/organisms/editor/NoteEditor'
import type { ScriptBlock } from '@/components/Editor/types'
import type { ScriptCommand } from '@/components/Editor/overlays/ScriptCommand'
import { cn } from '@/lib/utils'

export interface EditorWindowRunAction {
  /** Label for the run button (default: "Run") */
  label?: string
  /** Handler called with current doc and the first parsed ScriptBlock (if any) */
  onRun: (doc: string, block: ScriptBlock | null) => void
  /** Optional title attribute (default: "Run the workout") */
  title?: string
  /** Ref forwarded to the Run button if needed for target positioning (e.g. tour ring) */
  ref?: React.Ref<HTMLButtonElement>
}

export interface EditorWindowProps {
  /** Window chrome title (e.g. `protocols.md` or `WOD Editor & Autocomplete`) */
  title: string
  /** Optional subtitle next to title */
  subtitle?: string
  /** Document content */
  doc: string
  /** Called on document changes */
  onDocChange: (value: string) => void
  /** Optional Note ID for result lookup or persistence */
  noteId?: string
  /** Called when parsed ScriptBlocks change */
  onBlocksChange?: (blocks: ScriptBlock[]) => void
  /** Editor theme ("vs" | "dark") */
  theme?: string
  /** Read-only mode (default: false) */
  readonly?: boolean
  /** Show line numbers (default: false for demo windows) */
  showLineNumbers?: boolean
  /** Enable overlay panel (default: false for demo windows) */
  enableOverlay?: boolean
  /** Enable inline runtime (default: false for demo windows) */
  enableInlineRuntime?: boolean
  /** Enable block-level preview (default: true) */
  enablePreview?: boolean
  /** Show frontmatter and its controls (default: false for demo windows). */
  showFrontmatter?: boolean
  /** Enable Whiteboard Script linting (default: true) */
  enableLinting?: boolean
  /** Optional custom script commands */
  commands?: ScriptCommand[]
  /** Hide default commands */
  hideDefaultCommands?: boolean
  /** Exposed EditorView ref */
  onViewCreated?: (view: EditorView) => void
  /** Reset handler for traffic light button or reset button */
  onReset?: () => void
  /**
   * Title-bar Run action. When provided, renders a compact "Run" button in the
   * window header.
   */
  run?: EditorWindowRunAction
  /** Extra header actions rendered alongside title / Run */
  headerActions?: ReactNode
  /** Subheader slot rendered directly below the macOS chrome (e.g. breadcrumb / secondary actions bar) */
  subheader?: ReactNode
  /** Additional children rendered inside the relative editor container (e.g. Toast, Ring overlay) */
  children?: ReactNode
  /** Class name applied to the outer MacOSChrome container */
  className?: string
  /** Class name applied to the inner editor body container */
  editorClassName?: string
  /** Ref forwarded to the inner editor body container */
  bodyRef?: React.Ref<HTMLDivElement>
}

/**
 * EditorWindow — the consolidated "syntax-formatted code window" module.
 *
 * Encapsulates:
 *  - MacOSChrome title bar with traffic lights and reset support
 *  - Demo-preset NoteEditor (line numbers, overlay, inline runtime off by default)
 *  - ScriptBlock parsing and tracking via internal ref
 *  - Standardized title-bar "Run" button action
 *  - Subheader and overlay slots for annotations (toasts, rings, breadcrumbs)
 */
export function EditorWindow({
  title,
  subtitle,
  doc,
  onDocChange,
  noteId,
  onBlocksChange,
  theme,
  readonly = false,
  showLineNumbers = false,
  enableOverlay = false,
  enableInlineRuntime = false,
  enablePreview = true,
  showFrontmatter = false,
  enableLinting = true,
  commands,
  hideDefaultCommands,
  onViewCreated,
  onReset,
  run,
  headerActions,
  subheader,
  children,
  className,
  editorClassName,
  bodyRef,
}: EditorWindowProps) {
  const blocksRef = useRef<ScriptBlock[]>([])

  const handleBlocksChange = useCallback(
    (blocks: ScriptBlock[]) => {
      blocksRef.current = blocks
      onBlocksChange?.(blocks)
    },
    [onBlocksChange],
  )

  const handleRun = useCallback(() => {
    run?.onRun(doc, blocksRef.current[0] ?? null)
  }, [run, doc])

  // When EditorWindow owns the title-bar Run CTA, strip duplicate inline `run`/`play`
  // commands and suppress NoteEditor's synthesized Run bar if nothing else remains.
  const effectiveCommands = useMemo(() => {
    if (!run || !commands) return commands
    return commands.filter((cmd) => cmd.id !== 'run' && cmd.id !== 'play')
  }, [run, commands])

  const effectiveHideDefaultCommands =
    Boolean(hideDefaultCommands) ||
    (Boolean(run) && (!effectiveCommands || effectiveCommands.length === 0))

  const combinedHeaderActions = (
    <>
      {headerActions}
      {run && (
        <button
          ref={run.ref}
          type="button"
          title={run.title ?? 'Run the workout'}
          onClick={handleRun}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Play size={11} fill="currentColor" />
          {run.label ?? 'Run'}
        </button>
      )}
    </>
  )

  return (
    <MacOSChrome
      title={title}
      subtitle={subtitle}
      onReset={onReset}
      headerActions={combinedHeaderActions}
      className={className}
    >
      <div className="flex h-full flex-col min-h-0">
        {subheader}
        <div ref={bodyRef} className={cn('relative flex-1 min-h-0', editorClassName)}>
          <NoteEditor
            noteId={noteId}
            value={doc}
            onChange={onDocChange}
            onBlocksChange={handleBlocksChange}
            theme={theme}
            readonly={readonly}
            showLineNumbers={showLineNumbers}
            enableOverlay={enableOverlay}
            enableInlineRuntime={enableInlineRuntime}
            enablePreview={enablePreview}
            showFrontmatter={showFrontmatter}
            enableLinting={enableLinting}
            commands={effectiveCommands}
            hideDefaultCommands={effectiveHideDefaultCommands}
            onViewCreated={onViewCreated}
            autoFocus={false}
            className="h-full"
          />
          {children}
        </div>
      </div>
    </MacOSChrome>
  )
}
