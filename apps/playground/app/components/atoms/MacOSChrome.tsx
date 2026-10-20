import { type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRunwayIndicator } from '../../canvas/runwayIndicator'

/** MacOS-style chrome wrapper for sticky panels */
export function MacOSChrome({ title, subtitle, children, onReset, headerActions, className }: { title: string; subtitle?: string; children: ReactNode; onReset?: () => void; headerActions?: ReactNode; className?: string }) {
  // Inside a RunwayShell the stage indicator (status + pips) replaces the
  // static title so it costs no extra row of the sticky window.
  const indicator = useRunwayIndicator()
  return (
    <div className={cn('flex flex-col w-full h-full rounded-2xl lg:rounded-3xl border border-border shadow-2xl bg-background', className)}>
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border/60 shrink-0 rounded-t-2xl lg:rounded-t-3xl">
        {/* Traffic lights — red is a clickable reset when onReset is provided */}
        <div className="flex gap-1.5">
          {onReset ? (
            <button
              onClick={onReset}
              title="Reset"
              className="size-2.5 rounded-full bg-red-500 hover:bg-red-400 transition-colors cursor-pointer ring-1 ring-red-500/40 hover:ring-red-400/60"
            />
          ) : (
            <div className="size-2.5 rounded-full bg-red-500/30" />
          )}
          <div className="size-2.5 rounded-full bg-amber-500/30" />
          <div className="size-2.5 rounded-full bg-emerald-500/30" />
        </div>
        <div className="flex min-w-0 items-center gap-3">
          {indicator ? (
            <>
              <div className="flex min-w-0 flex-1 justify-end">{indicator.status}</div>
              {indicator.pips}
            </>
          ) : (
            <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.2em]">
              {title}
              {subtitle && (
                <span className="ml-1.5 font-medium normal-case tracking-normal text-muted-foreground/50">
                  · {subtitle}
                </span>
              )}
            </span>
          )}
          {headerActions}
          {onReset && (
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider text-destructive-foreground bg-destructive/80 hover:bg-destructive border border-destructive/40 shadow-sm transition-all"
            >
              <RotateCcw className="size-3" />
              Reset
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden rounded-b-2xl lg:rounded-b-3xl">
        {children}
      </div>
    </div>
  )
}
