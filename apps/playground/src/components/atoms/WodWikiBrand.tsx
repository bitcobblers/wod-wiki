import type { SVGAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface WodWikiMarkProps extends SVGAttributes<SVGSVGElement> {
  /** Width and height in pixels. Defaults to 32. */
  size?: number;
}

/**
 * Executable Fence brand mark (Mineral Slate squircle tile).
 * Decorative by default (`aria-hidden="true"`); pass `aria-label` or `aria-labelledby` to expose as `role="img"`.
 */
export function WodWikiMark({ size = 32, className, ...props }: WodWikiMarkProps) {
  const isDecorative = !props['aria-label'] && !props['aria-labelledby'];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden={isDecorative ? true : undefined}
      role={isDecorative ? undefined : 'img'}
      className={className}
      {...props}
    >
      <rect x="0" y="0" width="32" height="32" rx="8" fill="#49698d" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.5"
        fill="none"
        stroke="#fcfbf8"
        strokeOpacity="0.16"
        strokeWidth="1"
      />
      <g transform="translate(3.2 3.2) scale(0.8)">
        <path
          d="M10.5 6.5H7a1.5 1.5 0 0 0-1.5 1.5v16A1.5 1.5 0 0 0 7 25.5h3.5"
          fill="none"
          stroke="#fcfbf8"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M21.5 6.5H25a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5h-3.5"
          fill="none"
          stroke="#fcfbf8"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12.5 10.6a1.1 1.1 0 0 1 1.66-.95l7.9 4.86a1.15 1.15 0 0 1 0 1.98l-7.9 4.86a1.1 1.1 0 0 1-1.66-.95V10.6Z"
          fill="#d6e4f0"
        />
      </g>
    </svg>
  );
}

export interface WodWikiWordmarkProps {
  size?: 'sm' | 'md' | 'lg';
  showMark?: boolean;
  className?: string;
}

const WORDMARK_SIZE_MAP = {
  sm: { mark: 20, gap: 'gap-2', text: 'text-base' },
  md: { mark: 28, gap: 'gap-2.5', text: 'text-xl' },
  lg: { mark: 36, gap: 'gap-3', text: 'text-2xl' },
} as const;

/**
 * Hybrid Sans + Mono wordmark (`WOD` bold sans + monospace `.wiki`),
 * optionally preceded by the Executable Fence squircle mark.
 */
export function WodWikiWordmark({
  size = 'md',
  showMark = true,
  className,
}: WodWikiWordmarkProps) {
  const spec = WORDMARK_SIZE_MAP[size];

  return (
    <span className={cn('inline-flex items-center', spec.gap, className)}>
      {showMark && <WodWikiMark size={spec.mark} className="shrink-0" />}
      <span className={cn('leading-none tracking-[-0.03em] text-foreground', spec.text)}>
        <span className="font-extrabold">WOD</span>
        <span className="font-mono font-medium text-primary text-[0.88em]">.wiki</span>
      </span>
    </span>
  );
}
