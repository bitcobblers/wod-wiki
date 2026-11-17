/**
 * WhiteboardPlaygroundButton
 *
 * Split pill that: (a) opens the Playground pre-loaded with a WOD
 * block's content, and (b) copies that URL to the clipboard.
 *
 * URL formats (both carry the same gzip+base64 encoded markdown):
 *  - Playground link: {origin}/load?zip=… → saved as a new playground page,
 *    redirects to /playground/{id}.
 *  - Copy:            {origin}/load?z=…    → the home-share contract: decoded
 *    onto the home page, where the shared workout replaces the hero editor's
 *    existing ```time section until the visitor resets it.
 */

import React, { useCallback, useState } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getProfileDisplayName } from '@/hooks/useWorkbenchServices';

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/**
 * Gzip-compress a string and return a URL-safe base64 representation.
 * Falls back to plain base64 if CompressionStream is unavailable (e.g. older
 * browser / non-secure context — very unlikely in modern Storybook).
 */
export async function gzipBase64(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);

  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      const reader = cs.readable.getReader();
      void writer.write(bytes);
      void writer.close();

      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const len = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(len);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      return btoa(String.fromCharCode(...merged))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    } catch { /* fall through */ }
  }

  // Fallback: plain base64 (no compression)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Builds the full absolute playground URL for the given WOD content string
 * (raw inner content of the time fence, without the opening/closing fences).
 */
export async function buildPlaygroundUrl(wodContent: string): Promise<string> {
  // Wrap in a markdown time fence so the playground receives valid markdown
  const markdown = `\`\`\`time\n${wodContent.trimEnd()}\n\`\`\`\n`;
  const encoded = await gzipBase64(markdown);
  const base = window.location.origin;
  return `${base}/load?zip=${encoded}`;
}

/**
 * Builds the home-share URL for the given WOD content string. `/load?z=`
 * decodes onto the home page (see useZipProcessor), where the hero editor
 * renders the shared workout instead of the default ```time section.
 */
export async function buildHomeShareUrl(wodContent: string): Promise<string> {
  const markdown = `\`\`\`time\n${wodContent.trimEnd()}\n\`\`\`\n`;
  const encoded = await gzipBase64(markdown);
  const by = `shared by ${getProfileDisplayName()}`;
  return `${window.location.origin}/?z=${encoded}&by=${encodeURIComponent(by)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface WhiteboardPlaygroundButtonProps {
  /** Raw inner WOD content (without the surrounding ``` fences) */
  wodContent: string;
  className?: string;
}

/** Copy-state: idle | copying | copied */
type CopyState = 'idle' | 'copying' | 'copied';

export const WhiteboardPlaygroundButton: React.FC<WhiteboardPlaygroundButtonProps> = ({
  wodContent,
  className,
}) => {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [href, setHref] = useState<string>('#');
  const [homeHref, setHomeHref] = useState<string | null>(null);

  // Lazily compute the URL the first time the user interacts with either half.
  // Avoids doing async work on every render that contains a WOD block.
  const resolveUrl = useCallback(async (): Promise<string> => {
    if (href !== '#') return href;
    const url = await buildPlaygroundUrl(wodContent);
    setHref(url);
    return url;
  }, [href, wodContent]);

  const resolveHomeUrl = useCallback(async (): Promise<string> => {
    if (homeHref) return homeHref;
    const url = await buildHomeShareUrl(wodContent);
    setHomeHref(url);
    return url;
  }, [homeHref, wodContent]);

  const handleLinkClick = useCallback(async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const url = await resolveUrl();
    const tab = window.open(url, 'wodwiki-playground');
    if (tab) tab.focus();
  }, [resolveUrl]);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (copyState === 'copying') return;
    setCopyState('copying');
    try {
      // Copy shares the home-page version — the recipient edits/runs the
      // workout right on '/', not in a spawned playground note.
      const url = await resolveHomeUrl();
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('idle');
    }
  }, [copyState, resolveHomeUrl]);

  return (
    <div
      className={cn(
        'inline-flex items-stretch rounded-lg overflow-hidden text-xs font-medium shadow-md border border-border/70 hover:shadow-lg transition-shadow',
        'bg-muted text-muted-foreground',
        className,
      )}
      title="Open in Playground"
    >
      {/* Left half — open link */}
      <a
        href={href}
        onClick={handleLinkClick}
        className={cn(
          'flex items-center gap-2 px-3 py-2 transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
        )}
        rel="noopener noreferrer"
      >
        <ExternalLink className="h-4 w-4" />
        <span>Playground</span>
      </a>

      {/* Divider */}
      <div className="w-px bg-border/60 self-stretch" />

      {/* Right half — copy URL */}
      <button
        onClick={handleCopy}
        disabled={copyState === 'copying'}
        className={cn(
          'flex items-center justify-center px-2.5 py-2 transition-all duration-300',
          copyState === 'copied'
            ? 'text-emerald-600 bg-emerald-500/15 dark:text-emerald-400 dark:bg-emerald-500/20 scale-105'
            : 'hover:bg-accent hover:text-accent-foreground',
        )}
        title="Copy home-page link to clipboard"
        type="button"
      >
        {copyState === 'copied'
          ? <Check className="h-4 w-4" />
          : <Copy className="h-4 w-4" />
        }
      </button>
    </div>
  );
};
