/**
 * CatalogsManagerDrawer — the /catalogs "Manage Catalogs" dialog. Wraps the
 * /settings/sync SyncSection in the app's standard Dialog so sources can be
 * inspected, synced, unsubscribed, and deleted in place — no context switch.
 * Grouped update notifications and subscription intake deep-link here via
 * /catalogs?manage=1.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/atoms/primitives/dialog'
import { SyncSection } from './SyncSection'

export interface CatalogsManagerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CatalogsManagerDrawer({ open, onOpenChange }: CatalogsManagerDrawerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto"
        data-testid="catalogs-manager-drawer"
      >
        <DialogHeader>
          <DialogTitle>Seed Subscriptions &amp; Local Libraries</DialogTitle>
          <DialogDescription>
            Manage the seeds stored in your active data location — compare versions, sync updates,
            and subscribe, unsubscribe, or delete sources. One Subscribe imports every notebook a
            seed publishes. Your own notes are never touched.
          </DialogDescription>
        </DialogHeader>
        <SyncSection />
      </DialogContent>
    </Dialog>
  )
}
