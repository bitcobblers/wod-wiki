import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { X } from 'lucide-react';

export interface YouTubeLightboxProps {
  videoId: string;
  title?: string;
  onClose: () => void;
}

export function YouTubeLightbox({ videoId, title = 'YouTube video', onClose }: YouTubeLightboxProps) {
  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogBackdrop className="bg-black/90" />
      <DialogContent
        data-testid="youtube-lightbox"
        className="fixed inset-0 z-[100] m-0 w-screen max-w-none h-dvh max-h-none p-4 rounded-none border-0 bg-transparent shadow-none flex items-center justify-center"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogClose
          aria-label="Close video"
          title="Close video"
          data-testid="youtube-lightbox-close"
          className="absolute right-4 top-4 z-[110] flex size-11 items-center justify-center rounded-full border border-border bg-background/80 p-0 text-foreground transition-colors hover:bg-accent"
        >
          <X className="size-5" aria-hidden="true" />
        </DialogClose>
        <div className="aspect-video w-full max-w-5xl overflow-hidden rounded-lg border border-border bg-black shadow-2xl">
          <iframe
            className="h-full w-full border-0"
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default YouTubeLightbox;
