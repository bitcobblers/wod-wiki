import {
  Activity,
  ArrowRightToLine,
  BookOpen,
  Bookmark,
  Box,
  CalendarRange,
  Clock,
  Compass,
  Database,
  Dumbbell,
  FileText,
  Flag,
  Flame,
  Gauge,
  GitMerge,
  Globe,
  Layers,
  LayoutList,
  Link2,
  Rss,
  Ruler,
  Search,
  Sigma,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Target,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../utils/cn';

const CLAUSE_ICON_MAP: Record<string, LucideIcon> = {
  kind: Compass,
  target: Target,
  source: Database,
  text: Search,
  notebook: BookOpen,
  tag: Tag,
  tags: Tag,
  contributes: Sparkles,
  effort: Flame,
  domain: Globe,
  format: Clock,
  equipment: Dumbbell,
  quality: Zap,
  intent: Gauge,
  discipline: SlidersHorizontal,
  intensity: Activity,
  origin: Bookmark,
  type: Box,
  time: CalendarRange,
  where: GitMerge,
  agg: Sigma,
  metric: TrendingUp,
  groupby: Layers,
  rollup: CalendarRange,
  unit: Ruler,
  result: Flag,
  block: Box,
  note: FileText,
  page: FileText,
  plane: LayoutList,
  pipes: ArrowRightToLine,
  feed: Rss,
  subscribed: Star,
  scope: Link2,
};

export interface ClauseIconProps {
  /** Built-in ClauseType or custom slot type id. */
  type: string;
  className?: string;
}

/** Uniform vector icon replacing system emojis in composer pills and pickers. */
export function ClauseIcon({ type, className }: ClauseIconProps) {
  const Icon = CLAUSE_ICON_MAP[type] ?? SlidersHorizontal;
  return <Icon aria-hidden="true" className={cn('size-3 shrink-0', className)} />;
}
