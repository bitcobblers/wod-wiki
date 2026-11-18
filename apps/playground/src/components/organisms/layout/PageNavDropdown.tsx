import { useState, useEffect } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { cn } from '@/lib/utils';
import { useActiveScrollSection } from '@/hooks/useActiveScrollSection';
import {
  DocumentTextIcon,
  ChevronDownIcon,
  PlayIcon,
  CheckIcon,
  ArrowTopRightOnSquareIcon,
  ArrowDownTrayIcon,
  PencilSquareIcon,
} from '@heroicons/react/20/solid';

export interface PageNavLink {
  id: string;
  label: string;
  type?: 'heading' | 'time' | 'log' | 'query' | 'widget';
  onRun?: () => void;
  runIcon?: 'play' | 'link' | 'edit';
  timestamp?: string;
  resultCount?: number;
  hasResult?: boolean;
}

export interface PageNavDropdownProps {
  links: PageNavLink[];
  scrollToSection: (id: string) => void;
  activeSectionId?: string;
}

export function PageNavDropdown({
  links,
  scrollToSection,
  activeSectionId,
}: PageNavDropdownProps) {
  const [open, setOpen] = useState(false);
  const [internalActiveId, setInternalActiveId] = useState(links[0]?.id ?? '');
  const activeId = activeSectionId ?? internalActiveId;

  useEffect(() => {
    if (!activeSectionId) {
      setInternalActiveId(links[0]?.id ?? '');
    }
  }, [links, activeSectionId]);

  useActiveScrollSection({
    ids: links.map((link) => link.id),
    enabled: links.length > 0 && !activeSectionId,
    rootMargin: '-60px 0px -40% 0px',
    threshold: [0, 0.3, 1.0],
    onChange: setInternalActiveId,
  });

  if (links.length === 0) return null;

  const activeLink = links.find((l) => l.id === activeId) ?? links[0];
  const activeLabel = activeLink?.label ?? 'Sections';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Page sections"
        className="flex h-auto border-0 bg-transparent px-1.5 py-1 items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <DocumentTextIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-28 truncate">
          {activeLink?.timestamp && <span className="mr-1 opacity-60 tabular-nums italic">{activeLink.timestamp}</span>}
          {activeLabel}
        </span>
        <ChevronDownIcon className="size-3 shrink-0" aria-hidden="true" />
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={6} aria-label="Page sections" className="min-w-48 p-1 space-y-0.5">
        {links.map((link) => (
          <div
            key={link.id}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted transition-colors',
              (link.type === 'time' || link.type === 'log') && 'pl-2 text-[11px]',
            )}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                if (link.onRun && link.runIcon === 'link') {
                  link.onRun();
                } else {
                  scrollToSection(link.id);
                }
              }}
              className={cn(
                'flex-1 truncate text-left text-xs',
                activeId === link.id ? 'font-bold text-foreground' : 'text-muted-foreground',
              )}
            >
              {(link.type === 'time' || link.type === 'log') && (
                <span className="mr-2 inline-flex items-center gap-1">
                  {link.resultCount && link.resultCount > 1 ? (
                    <span className="flex items-center justify-center size-3.5 rounded-full bg-primary/10 text-primary text-[9px] font-bold">
                      {link.resultCount}
                    </span>
                  ) : link.hasResult ? (
                    <CheckIcon className="size-3 text-primary" aria-hidden="true" />
                  ) : link.runIcon === 'link' ? (
                    <ArrowTopRightOnSquareIcon className="inline size-3 opacity-30" aria-hidden="true" />
                  ) : link.type === 'log' ? (
                    <ArrowDownTrayIcon className="inline size-3 opacity-30" aria-hidden="true" />
                  ) : (
                    <PlayIcon className="inline size-3 opacity-30" aria-hidden="true" />
                  )}
                </span>
              )}
              {link.timestamp && <span className="font-bold text-[10px] tabular-nums mr-2 opacity-60 italic">{link.timestamp}</span>}
              {link.label}
            </button>
            {link.onRun && (
              <button
                type="button"
                aria-label={link.runIcon === 'link' ? `View ${link.label}` : link.runIcon === 'edit' ? `Edit ${link.label}` : `Start ${link.label}`}
                title={link.runIcon === 'link' ? 'View workout' : link.runIcon === 'edit' ? 'Edit note' : 'Start workout'}
                className="flex items-center justify-center size-5 rounded text-primary hover:bg-primary/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  link.onRun!();
                }}
              >
                {link.runIcon === 'link' ? (
                  <ArrowTopRightOnSquareIcon className="size-3" aria-hidden="true" />
                ) : link.runIcon === 'edit' ? (
                  <PencilSquareIcon className="size-3" aria-hidden="true" />
                ) : (
                  <PlayIcon className="size-3" aria-hidden="true" />
                )}
              </button>
            )}
            {!link.onRun && activeId === link.id && <span className="text-primary text-xs">✓</span>}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
