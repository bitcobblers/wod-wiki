/**
 * CanvasProse — rich markdown renderer for canvas section prose.
 *
 * Supports:
 *  - GitHub Flavored Markdown (tables, strikethrough, task lists, etc.)
 *  - YAML frontmatter blocks → rendered as a styled metadata card
 *  - Embedded images with lazy loading
 *  - Links (external ones open in new tab)
 *  - Code blocks with syntax-styled presentation
 *  - File links (.pdf, .mov, etc.) with a download/open icon
 */

import { Children } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { parseFrontmatter, type ParsedFrontmatter } from '@/lib/frontmatter'
import { QueryBlockView } from '@bitcobblers/wod-wiki-ui'
import { parseQueryWidgetSuffix } from '@bitcobblers/wod-wiki-wql'
import { queryService } from '@/services/queryService'
import { usePageSourcesReady } from '@/hooks/usePageSourcesReady'
import { entryOpenHref } from '../lib/entryActions'
import { wqlStreamHref } from '../lib/wqlLink'
import { toEntry, blockToEntry } from '../lib/entryMapper'
import type { Note } from '@/types/storage'

// ── File-type helpers ─────────────────────────────────────────────────────────

const FILE_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'tar', 'gz', 'rar',
  'mp4', 'mov', 'avi', 'mkv', 'webm',
  'mp3', 'wav', 'flac',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp',
])

function isFileLink(href: string): boolean {
  const ext = href.split('.').pop()?.split('?')[0]?.toLowerCase() ?? ''
  return FILE_EXTENSIONS.has(ext)
}

function isExternalLink(href: string): boolean {
  return /^https?:\/\//.test(href) || href.startsWith('//')
}

// ── YAML frontmatter renderer ─────────────────────────────────────────────────

/**
 * Query fence block — gated on page-source population so `@session`/`@today`
 * dataset pipelines evaluate against a populated registry on first paint.
 */
function CanvasQueryBlock({
  queryText,
  widgetType,
  widgetError,
}: {
  queryText: string
  widgetType?: string
  widgetError?: string
}) {
  const sourcesReady = usePageSourcesReady()
  if (!sourcesReady) {
    return (
      <div className="my-5 not-prose text-xs text-muted-foreground py-2">Loading…</div>
    )
  }
  return (
    <div className="my-5 not-prose">
      <QueryBlockView
        query={queryText}
        widgetType={widgetType}
        widgetError={widgetError}
        executor={queryService}
        readOnly={true}
        noteHref={(item) => {
          const isBlock = 'blockContentId' in item || 'dataType' in item
          const entry = isBlock
            ? blockToEntry(item as unknown as Parameters<typeof blockToEntry>[0])
            : toEntry(item as unknown as Parameters<typeof toEntry>[0])
          return entryOpenHref(entry)
        }}
      />
    </div>
  )
}

function splitFrontmatter(prose: string): { fields: ParsedFrontmatter['meta'] | null; body: string } {
  const { meta, body } = parseFrontmatter(prose)
  if (Object.keys(meta).length === 0 && body === prose) return { fields: null, body: prose }
  return { fields: meta, body: body.trim() }
}

// ── Custom component map ──────────────────────────────────────────────────────

const components: Components = {
  // Tables — GFM styled
  table({ children }) {
    return (
      <div className="my-6 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    )
  },
  thead({ children }) {
    return <thead className="bg-muted/50 text-left">{children}</thead>
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-border/50">{children}</tbody>
  },
  tr({ children }) {
    return <tr className="hover:bg-muted/20 transition-colors">{children}</tr>
  },
  th({ children }) {
    return (
      <th className="px-4 py-2.5 text-[11px] font-black tracking-widest uppercase text-muted-foreground border-b border-border">
        {children}
      </th>
    )
  },
  td({ children }) {
    return <td className="px-4 py-2.5 text-sm text-foreground">{children}</td>
  },

  // Images — lazy loaded, rounded
  img({ src, alt, node }) {
    const props = (node as unknown as { properties?: Record<string, unknown> })?.properties ?? {}
    const width = props['width'] as string | undefined
    const height = props['height'] as string | undefined
    return (
      <figure className="my-6">
        <img
          src={src ?? ''}
          alt={alt ?? ''}
          loading="lazy"
          width={width}
          height={height}
          className="rounded-xl border border-border max-w-full h-auto"
        />
        {alt && (
          <figcaption className="mt-2 text-center text-xs text-muted-foreground italic">
            {alt}
          </figcaption>
        )}
      </figure>
    )
  },

  // Links — external opens in new tab; file links get a download hint;
  // WQL links (`[label](:effort{…})`, spaces percent-encoded) route to the
  // stream page that runs the query.
  a({ href, children }) {
    const h = href ?? ''
    if (h.startsWith(':')) {
      let decoded = h
      try {
        decoded = decodeURIComponent(h)
      } catch {
        // Not percent-encoded — use the raw destination.
      }
      const to = wqlStreamHref(decoded)
      if (to) {
        return (
          <Link
            to={to}
            className="underline underline-offset-2 transition-colors text-primary hover:text-primary/70"
          >
            {children}
          </Link>
        )
      }
    }
    const external = isExternalLink(h)
    const file = isFileLink(h)
    return (
      <a
        href={h}
        rel={external ? 'noopener noreferrer' : undefined}
        target={external || file ? '_blank' : undefined}
        className={cn(
          'underline underline-offset-2 transition-colors',
          file
            ? 'text-primary font-medium'
            : 'text-primary hover:text-primary/70',
        )}
      >
        {children}
        {external && (
          <span className="ml-0.5 text-[10px] align-super opacity-60">↗</span>
        )}
        {file && !external && (
          <span className="ml-0.5 text-[10px] align-super opacity-60">⬇</span>
        )}
      </a>
    )
  },

  // Code blocks — mono styled with language label
  code({ children, className }) {
    const language = className?.replace('language-', '') ?? ''
    // A fence with no info string still arrives without a className — tell it
    // apart from inline code by its newlines (inline spans never contain any).
    const rawText = typeof children === 'string'
      ? children
      : Array.isArray(children)
        ? children.join('')
        : String(children ?? '')
    const isInline = !className && !rawText.includes('\n')
    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 rounded-md bg-muted font-mono text-[0.85em] text-foreground">
          {children}
        </code>
      )
    }
    if (language === 'query' || language.startsWith('query:') || language.startsWith('query ')) {
      const queryText = (typeof children === 'string'
        ? children
        : Array.isArray(children)
          ? children.join('')
          : String(children ?? '')
      ).trim()
      const rawSuffix = language.replace(/^query[:\s]?/, '').trim()
      const parsedSuffix = rawSuffix ? parseQueryWidgetSuffix(rawSuffix) : undefined
      return (
        <CanvasQueryBlock
          queryText={queryText}
          widgetType={parsedSuffix?.type}
          widgetError={parsedSuffix?.error}
        />
      )
    }
    return (
      <div className="my-5 rounded-xl overflow-hidden border border-border">
        {language && (
          <div className="flex items-center gap-2 px-4 py-2 bg-muted border-b border-border">
            <span className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">
              {language}
            </span>
          </div>
        )}
        <pre className="overflow-x-auto p-4 bg-muted/30">
          <code className="font-mono text-sm text-foreground">{children}</code>
        </pre>
      </div>
    )
  },

  // Headings — styled to match the canvas design language
  h1({ children, id }) {
    return (
      <h1 id={id} className="text-2xl lg:text-3xl font-black tracking-tight text-foreground uppercase leading-tight mt-10 mb-4 first:mt-0">
        {children}
      </h1>
    )
  },
  h2({ children, id }) {
    return (
      <h2 id={id} className="text-xl lg:text-2xl font-black tracking-tight text-foreground uppercase leading-tight mt-8 mb-3 first:mt-0">
        {children}
      </h2>
    )
  },
  h3({ children, id }) {
    return (
      <h3 id={id} className="text-base lg:text-lg font-black tracking-wide text-foreground uppercase mt-6 mb-2 first:mt-0">
        {children}
      </h3>
    )
  },
  h4({ children, id }) {
    return (
      <h4 id={id} className="text-sm font-black tracking-widest text-primary uppercase mt-5 mb-2 first:mt-0">
        {children}
      </h4>
    )
  },

  // Paragraphs
  p({ children }) {
    return (
      <p className="text-sm lg:text-[15px] font-medium text-muted-foreground leading-relaxed my-4 first:mt-0">
        {children}
      </p>
    )
  },

  // Lists
  ul({ children }) {
    return (
      <ul className="my-4 pl-5 space-y-1.5 list-disc list-outside text-left text-sm text-muted-foreground font-medium leading-relaxed">
        {children}
      </ul>
    )
  },
  ol({ children }) {
    return (
      <ol className="my-4 pl-5 space-y-1.5 list-decimal list-outside text-left text-sm text-muted-foreground font-medium leading-relaxed">
        {children}
      </ol>
    )
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>
  },

  // Blockquote
  blockquote({ children }) {
    return (
      <blockquote className="my-5 pl-4 border-l-2 border-primary/40 text-muted-foreground italic text-sm">
        {children}
      </blockquote>
    )
  },

  // Horizontal rule
  hr() {
    return <hr className="my-8 border-border/50" />
  },

  // Strong / em
  strong({ children }) {
    return <strong className="font-black text-foreground">{children}</strong>
  },
  em({ children }) {
    return <em className="italic text-foreground/80">{children}</em>
  },
}

// A big, high-contrast headline treatment for a hero section's lead
// sentence — swapped in for just the first paragraph, so it reads as
// marketing copy rather than another documentation paragraph.
const heroLeadComponents: Components = {
  ...components,
  p({ children }) {
    return (
      <p className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-foreground leading-[1.08] my-0">
        {children}
      </p>
    )
  },
  strong({ children }) {
    const text = Children.toArray(children)
      .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
      .join('')
      .trim()

    if (
      text.includes('Write it in Markdown') &&
      text.includes('Run it as a Timer') &&
      text.includes('Own the Analytics')
    ) {
      return (
        <span className="flex flex-col select-none mt-4 w-full gap-5 sm:gap-7">
          <span className="block text-3xl sm:text-4xl lg:text-5xl text-primary font-black text-left pl-[5%] sm:pl-[10%] transform hover:translate-x-1 transition-transform duration-200">
            Write it in <span className="inline-block border-b-4 border-primary/70 pb-1 hover:scale-105 transition-transform duration-200">Markdown</span>.
          </span>
          <span className="block text-3xl sm:text-4xl lg:text-5xl text-primary font-black text-center transform hover:scale-[1.02] transition-transform duration-200">
            <span className="inline-block border-b-4 border-primary/70 pb-1 hover:scale-105 transition-transform duration-200">Run</span> it as a Timer.
          </span>
          <span className="block text-3xl sm:text-4xl lg:text-5xl text-primary font-black text-right pr-[5%] sm:pr-[10%] transform hover:-translate-x-1 transition-transform duration-200">
            Own the <span className="inline-block border-b-4 border-primary/70 pb-1 hover:scale-105 transition-transform duration-200">Analytics</span>.
          </span>
        </span>
      )
    }
    return <strong className="font-black text-foreground">{children}</strong>
  },
}

// A step up from the default body copy — for a hero's supporting
// paragraphs, which should read as subhead copy, not the same muted
// small-print used by every other section's explainer text.
const heroBodyComponents: Components = {
  ...components,
  p({ children }) {
    return (
      <p className="text-base lg:text-lg font-medium text-foreground/75 leading-relaxed my-4 first:mt-0">
        {children}
      </p>
    )
  },
}

// ── Plugins ───────────────────────────────────────────────────────────────────

const remarkPlugins = [remarkGfm]

// WQL link destinations (`[x](:effort{…})`) are scheme-less but NOT relative
// paths — the default transform would blank them. Pass `:`-prefixed URLs
// through untouched; everything else keeps the safe default.
function canvasUrlTransform(url: string): string {
  return url.startsWith(':') ? url : defaultUrlTransform(url)
}

// ── Heading ids ───────────────────────────────────────────────────────────────

interface HastNode {
  type: string
  value?: unknown
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

function headingText(node: HastNode): string {
  if (node.type === 'text' && typeof node.value === 'string') return node.value
  return (node.children ?? []).map(headingText).join('')
}

/** Slug scheme mirrors GitHub's: lowercase, spaces → dashes, alphanumerics
 *  and dashes kept; duplicates get -1, -2, … so repeated headings stay
 *  addressable. */
function slugifyHeading(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-')
    .replace(/-+/g, '-')
  return base || 'heading'
}

/** rehype plugin — id on every heading so prose indexes (`[2026](#2026)`)
 *  can anchor to them. Dependency-free (no rehype-slug). */
const rehypeHeadingIds = () => (tree: HastNode) => {
  const counts = new Map<string, number>()
  const walk = (node: HastNode): void => {
    if (node.tagName && /^h[1-6]$/.test(node.tagName)) {
      const base = slugifyHeading(headingText(node))
      const seen = counts.get(base) ?? 0
      counts.set(base, seen + 1)
      ;(node.properties ??= {}).id = seen === 0 ? base : `${base}-${seen}`
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
}

// ── FrontmatterCard — styled metadata block ───────────────────────────────────

function FrontmatterCard({ fields }: { fields: ParsedFrontmatter['meta'] }) {
  const entries = Object.entries(fields)
  if (entries.length === 0) return null
  return (
    <div className="my-6 rounded-xl border border-border bg-muted/30 overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-muted/50">
        <span className="text-[10px] font-black tracking-[0.2em] uppercase text-muted-foreground">
          Metadata
        </span>
      </div>
      <dl className="divide-y divide-border/50">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-baseline gap-4 px-4 py-2">
            <dt className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide min-w-[100px] shrink-0">
              {key}
            </dt>
            <dd className="text-sm text-foreground break-words">{Array.isArray(val) ? val.join(', ') : String(val)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export interface CanvasProseProps {
  prose: string
  className?: string
  /** 'heroLead' for a hero's big headline sentence, 'heroBody' for its supporting paragraphs. */
  variant?: 'default' | 'heroLead' | 'heroBody'
}

const componentsByVariant: Record<NonNullable<CanvasProseProps['variant']>, Components> = {
  default: components,
  heroLead: heroLeadComponents,
  heroBody: heroBodyComponents,
}

export function CanvasProse({ prose, className, variant = 'default' }: CanvasProseProps) {
  if (!prose) return null
  const { fields, body } = splitFrontmatter(prose)
  return (
    <div className={cn('prose-canvas', className)}>
      {fields && <FrontmatterCard fields={fields} />}
      {body && (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={[rehypeHeadingIds]}
          urlTransform={canvasUrlTransform}
          components={componentsByVariant[variant]}
        >
          {body}
        </ReactMarkdown>
      )}
    </div>
  )
}
