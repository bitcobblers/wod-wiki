/**
 * openInPlayground — time/log block actions that use the zip-load mechanism.
 *
 * Both "Open in Playground" and "Share" encode the block's content as a
 * gzip+base64 URL (/load?zip=<encoded>). useZipProcessor (GlobalState) picks
 * up the param, creates a new playground page in IndexedDB, and redirects.
 *
 * - openBlockInPlayground        → navigate to /load?zip=... in the same tab
 * - openBlockInPlaygroundNewTab  → open /load?zip=... in a new tab
 * - shareBlock                   → copy that URL to the clipboard + show toast
 */

import type { NavigateFunction } from 'react-router-dom'
import type { ScriptBlock } from '@/components/Editor/types'
import { encodeZip } from './encodeZip'
import { buildPlaygroundLoadUrl } from '../lib/routes'
import { toast } from '@/hooks/use-toast'
import { getProfileDisplayName } from '@/services/profile'

/** Build the /load?zip= URL for a time/log block. `src` (the current page
 *  path) rides along so the spawned playground note carries provenance. */
export async function buildZipUrl(block: ScriptBlock, src?: string): Promise<string> {
  const dialect = block.dialect || 'time'
  const fenceTag = block.sport ? `${dialect}:${block.sport}` : dialect
  const markdown = `\`\`\`${fenceTag}\n${block.content.trimEnd()}\n\`\`\`\n`
  const encoded = await encodeZip(markdown)
  const base = `${window.location.origin}${buildPlaygroundLoadUrl({ zip: encoded })}`
  return src ? `${base}&src=${encodeURIComponent(src)}` : base
}

/**
 * Navigate directly to a new playground page pre-loaded with the time/log block's
 * content. Uses the same /load?zip= mechanism as WhiteboardPlaygroundButton.
 * The current page path becomes the spawned note's provenance stamp.
 */
export async function openBlockInPlayground(
  block: ScriptBlock,
  navigate: NavigateFunction,
): Promise<void> {
  const url = await buildZipUrl(block, window.location.pathname)
  // Extract just the path+query so we navigate within the SPA router
  const { pathname, search } = new URL(url)
  void navigate(`${pathname}${search}`)
}
/**
 * Open the /load?zip= URL for the time/log block in a new browser tab.
 */
export async function openBlockInPlaygroundNewTab(
  block: ScriptBlock,
): Promise<void> {
  const url = await buildZipUrl(block, window.location.pathname)
  window.open(url, '_blank')
}


/** Build the /?z= home-share URL for a time/log block. */
export async function buildHomeShareUrl(block: ScriptBlock): Promise<string> {
  const dialect = block.dialect || 'time'
  const fenceTag = block.sport ? `${dialect}:${block.sport}` : dialect
  const markdown = `\`\`\`${fenceTag}\n${block.content.trimEnd()}\n\`\`\`\n`
  const encoded = await encodeZip(markdown)
  const by = `shared by ${getProfileDisplayName()}`
  return `${window.location.origin}/?z=${encoded}&by=${encodeURIComponent(by)}`
}

/**
 * Copy the /?z= home-share URL for the time/log block to the clipboard and show a
 * toast confirmation. The recipient opens the workout directly on the home page.
 */
export function shareBlock(block: ScriptBlock): void {
  void buildHomeShareUrl(block).then(url => {
    navigator.clipboard.writeText(url).then(() => {
      toast({
        title: 'Link copied',
        description: 'Share link copied to clipboard.',
      })
    }).catch(() => {
      toast({
        title: 'Could not copy',
        description: url,
        variant: 'destructive',
      })
    })
  })
}
