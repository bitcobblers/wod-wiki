import { CalendarPlus, ChartBarIcon, CirclePlay, Database } from 'lucide-react'

// ponytail: static 4-item hero layout; extract to array map if tagline items become configurable.
export function TourHeroHeading() {
  return (
    <div className="@container flex w-full flex-col items-center text-center">
      <h1 className="text-[clamp(32px,6.5cqi,64px)] font-extrabold leading-[1.02] tracking-[-0.04em]">
        <span className="block">
          <span className="inline-flex items-center gap-[0.2em] mr-[0.35em]">            
            Write it.
          </span>
          <span className="inline-flex items-center gap-[0.2em]">
            <CirclePlay className="size-[0.8em] text-emerald-400 dark:text-emerald-300 shrink-0" aria-hidden="true" />
            Time it.
          </span>
        </span>
        <span className="block">
          <span className="inline-flex items-center gap-[0.2em] mr-[0.35em]">
            <ChartBarIcon className="size-[0.8em] text-amber-400 dark:text-amber-300 shrink-0" aria-hidden="true" />
            Track it.
          </span>
          <span className="inline-flex items-center gap-[0.2em]">
                        Own it.
          </span>
        </span>
      </h1>
      <p className="mt-4 xl:mt-6 max-w-xl xl:max-w-2xl 2xl:max-w-3xl text-[15px] sm:text-base xl:text-lg leading-relaxed text-muted-foreground">
        Plain-text Markdown becomes a step-through workout clock, <br></br>line and splits become queryable training data points.
      </p>
    </div>
  )
}

