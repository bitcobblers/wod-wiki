/**
 * useCanvasEditorSource — owns the canvas editor's source-swap state machine.
 *
 * Tracks the active source key + original + current (per-key edits), runs the
 * 180ms opacity-fade swap, and reacts to `contentOverride` (the live signal
 * HomeView's search palette uses to inject workout content into the home
 * editor). Owns no rendering; returns state + callbacks the page wires into
 * `<CanvasPanelContent>` and `NoteEditor`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'

interface UseCanvasEditorSourceOptions {
  initialSource: string
  initialSourceKey: string
  /** Live: when HomeView's search palette loads content into the home editor. */
  contentOverride?: string
}

export interface UseCanvasEditorSourceReturn {
  editorSource: string
  editorOpacity: number
  isEditorLoading: boolean
  activeSourceKey: string
  activeOriginalSource: string
  swapSource: (raw: string, sourceKey?: string, options?: { focus?: boolean }) => void
  handleEditorChange: (value: string) => void
  resetActiveSource: () => void
  /** Forward this to `<CanvasPanelContent onViewCreated={...}>` (and onward to `NoteEditor`). */
  setEditorView: (view: EditorView | null) => void
  /** Read the latest source for imperative handles (e.g. share URL). */
  getSource: () => string
}

export function useCanvasEditorSource({
  initialSource,
  initialSourceKey,
  contentOverride,
}: UseCanvasEditorSourceOptions): UseCanvasEditorSourceReturn {
  const [editorSource, setEditorSource] = useState(initialSource)
  const [editorOpacity, setEditorOpacity] = useState(1)
  const [isEditorLoading, setIsEditorLoading] = useState(false)
  const [activeSourceKey, setActiveSourceKey] = useState(initialSourceKey)
  const [activeOriginalSource, setActiveOriginalSource] = useState(initialSource)

  const editorSourceRef = useRef(initialSource)
  const editorViewRef = useRef<EditorView | null>(null)
  const sourceEditsRef = useRef(
    new Map<string, { original: string; current: string }>([[initialSourceKey, { original: initialSource, current: initialSource }]]),
  )
  const swapTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const focusEditor = useCallback(() => {
    requestAnimationFrame(() => editorViewRef.current?.focus())
  }, [])

  const swapSource = useCallback((raw: string, sourceKey: string = raw, options?: { focus?: boolean }) => {
    const saved = sourceEditsRef.current.get(sourceKey)
    const nextSource = saved?.current ?? raw
    const originalSource = saved?.original ?? raw

    if (!saved) {
      sourceEditsRef.current.set(sourceKey, { original: raw, current: raw })
    }

    setActiveSourceKey(sourceKey)
    setActiveOriginalSource(originalSource)
    const shouldFocus = options?.focus !== false
    if (shouldFocus) focusEditor()

    if (nextSource === editorSourceRef.current) {
      setIsEditorLoading(false)
      return
    }

    clearTimeout(swapTimerRef.current)
    setIsEditorLoading(true)
    setEditorOpacity(0)
    swapTimerRef.current = setTimeout(() => {
      editorSourceRef.current = nextSource
      setEditorSource(nextSource)
      setEditorOpacity(1)
      setIsEditorLoading(false)
      swapTimerRef.current = undefined
      if (shouldFocus) focusEditor()
    }, 180)
  }, [focusEditor])

  const handleEditorChange = useCallback((value: string) => {
    setEditorSource(value)
    editorSourceRef.current = value
    const sourceState = sourceEditsRef.current.get(activeSourceKey) ?? { original: activeOriginalSource, current: activeOriginalSource }
    sourceEditsRef.current.set(activeSourceKey, { ...sourceState, current: value })
  }, [activeOriginalSource, activeSourceKey])

  const resetActiveSource = useCallback(() => {
    const sourceState = sourceEditsRef.current.get(activeSourceKey)
    const original = sourceState?.original ?? activeOriginalSource
    sourceEditsRef.current.set(activeSourceKey, { original, current: original })
    editorSourceRef.current = original
    setEditorSource(original)
    setActiveOriginalSource(original)
    focusEditor()
  }, [activeOriginalSource, activeSourceKey, focusEditor])

  const setEditorView = useCallback((view: EditorView | null) => {
    editorViewRef.current = view
  }, [])

  const getSource = useCallback(() => editorSourceRef.current, [])

  // contentOverride is live: HomeView's search palette uses it to inject
  // workout content into the home editor. Preserve the prev-ref guard so a
  // re-render with the same value doesn't re-trigger the swap.
  const prevContentOverride = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (contentOverride && contentOverride !== prevContentOverride.current) {
      prevContentOverride.current = contentOverride
      swapSource(contentOverride, `content-override:${contentOverride}`)
    }
  }, [contentOverride, swapSource])

  return {
    editorSource,
    editorOpacity,
    isEditorLoading,
    activeSourceKey,
    activeOriginalSource,
    swapSource,
    handleEditorChange,
    resetActiveSource,
    setEditorView,
    getSource,
  }
}
