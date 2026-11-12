import React from 'react';
import {
  Play,
  ShoppingCart,
  Globe,
  BookOpen,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { withAffiliateTag } from '@/lib/affiliateLink';
import type { LinkWidget } from '@/lib/frontmatter';

// ─────────────────────────────────────────────────────────────────────────────
// Styling maps
// ─────────────────────────────────────────────────────────────────────────────

const ICON_MAP: Record<LinkWidget['kind'], React.ElementType> = {
  youtube: Play,
  amazon: ShoppingCart,
  strava: ExternalLink,
  source: ExternalLink,
  website: Globe,
  book: BookOpen,
};

const KIND_STYLES: Record<LinkWidget['kind'], string> = {
  youtube:
    'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50',
  amazon:
    'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50',
  website:
    'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50',
  source:
    'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-900/30 dark:text-slate-400 dark:hover:bg-slate-900/50',
  book:
    'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50',
  strava:
    'bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:hover:bg-orange-900/50',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export interface LinkChipProps {
  widget: LinkWidget;
}

export const LinkChip: React.FC<LinkChipProps> = ({ widget }) => {
  const Icon = ICON_MAP[widget.kind];
  const label = widget.label || getDefaultLabel(widget.kind);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
  };

  return (
    <a
      href={widget.url ? withAffiliateTag(widget.url) : '#'}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-medium',
        'px-2 py-0.5 rounded-full transition-colors duration-150',
        KIND_STYLES[widget.kind],
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{label}</span>
    </a>
  );
};

function getDefaultLabel(kind: LinkWidget['kind']): string {
  switch (kind) {
    case 'youtube':
      return 'Video';
    case 'amazon':
      return 'Amazon';
    case 'website':
      return 'Website';
    case 'source':
      return 'Source';
    case 'book':
      return 'Book';
    case 'strava':
      return 'Strava';
    default:
      return 'Link';
  }
}
