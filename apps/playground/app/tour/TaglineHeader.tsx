/**
 * TaglineHeader.tsx — static half-viewport header introducing a tagged
 * section (index + accented title + blurb). Leaf module: shared by the
 * home data sections and the chapter runway without importing the
 * HomeTour barrel (no circular imports).
 */
export function TaglineHeader({
  index,
  before,
  accentText,
  after,
  accent: _accent,
  blurb,
}: {
  index: string
  before: string
  accentText: string
  after: string
  accent: string
  blurb: string
}) {
  return (
    <header className="flex items-center px-6 py-14 lg:px-12 xl:py-20 2xl:py-24 xl:px-16">
      <div className="mx-auto w-full max-w-[1500px] 2xl:max-w-[1720px]">
        <h2 className="flex items-baseline gap-4 xl:gap-6 text-[clamp(26px,3.6vw,52px)] font-extrabold leading-[1.1] tracking-[-0.03em]">
          <span className="font-mono text-xs font-normal tracking-normal text-muted-foreground">{index}</span>
          <span>{before}{accentText}{after}</span>
        </h2>
        <p className="mt-3 xl:mt-4 max-w-xl xl:max-w-2xl 2xl:max-w-3xl text-[clamp(14px,1.2vw,18px)] leading-[1.65] text-muted-foreground">
          {blurb}
        </p>
      </div>
    </header>
  )
}
