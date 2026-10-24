/**
 * PaletteQuerySettings — the ⌘/ command palette's own surface settings,
 * rendered INSIDE the palette (the palette is a focus-trapped dialog, so a
 * nested modal on top of it would be unreachable).
 *
 * The palette composes find queries, so it configures the same things every
 * other surface does: the seed query it opens with and the storage scopes
 * its picker prioritizes. Both live in `routeWqlConfig` under the palette's
 * synthetic route id.
 */
import { PALETTE_SURFACE } from '../../../lib/queryConfigSurfaces'
import { QuerySettingsPanel } from './QuerySettingsDialog'

export function PaletteQuerySettings() {
  return <QuerySettingsPanel surface={PALETTE_SURFACE} />
}
