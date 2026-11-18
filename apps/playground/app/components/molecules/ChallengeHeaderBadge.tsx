import { useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@bitcobblers/wod-wiki-ui/primitives';
import type { Quest } from '../../canvas/parseCanvasMarkdown';
import { usePageQuests } from '../../hooks/usePageQuests';
import { cn } from '@/lib/utils';
import { ChallengeCard } from './ChallengeCard';

export interface ChallengeHeaderBadgeProps {
  pageRoute: string;
  quests: Quest[];
  challengeSectionMap: Map<string, string>;
  onScrollToSection?: (sectionId: string) => void;
}

export function ChallengeHeaderBadge({
  pageRoute,
  quests,
  challengeSectionMap,
  onScrollToSection,
}: ChallengeHeaderBadgeProps) {
  const { quests: questsWithStatus, stepsComplete, totalSteps, isComplete } = usePageQuests(pageRoute, quests);
  const [open, setOpen] = useState(false);

  if (totalSteps === 0) return null;

  const handleChallengeClick = (questId: string) => {
    const sectionId = challengeSectionMap.get(questId);
    if (sectionId) {
      onScrollToSection?.(sectionId);
    }
    setOpen(false);
  };

  return (
    <div className="py-1.5 shrink-0">
      <Popover
        open={open}
        openOnHover
        delay={0}
        closeDelay={150}
        onOpenChange={(next, details) => {
          // Hover already opens on desktop; ignore toggle-off clicks so clicking an open hover trigger doesn't immediately dismiss it.
          if (!next && details.reason === 'trigger-press') {
            details.cancel();
            return;
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger
          aria-label={`${stepsComplete} of ${totalSteps} challenges complete`}
          title={`${stepsComplete} of ${totalSteps} challenges complete`}
          className="inline-flex h-auto min-h-11 items-center gap-1.5 cursor-pointer select-none text-left rounded-full border border-border/70 bg-background px-3 py-1 hover:bg-muted/40 hover:border-border transition-colors shadow-sm"
        >
          {isComplete ? (
            <Check className="size-4 text-emerald-500" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          <span
            className={cn(
              'text-[10px] font-black uppercase tracking-wider',
              isComplete ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
            )}
          >
            {stepsComplete}/{totalSteps}
          </span>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          initialFocus="none"
          finalFocus="none"
          aria-label="Syntax Challenges"
          className="w-64 rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl p-3"
        >
          <div className="mb-2.5 pb-2 border-b border-border/60 flex items-center justify-between gap-2">
            <div>
              <h5 className="text-[10px] font-black uppercase tracking-widest text-foreground">
                Syntax Challenges
              </h5>
              <p className="text-[9px] text-muted-foreground mt-0.5">
                Click a challenge to jump to its section.
              </p>
            </div>
            <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground tabular-nums">
              {stepsComplete}/{totalSteps}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            {questsWithStatus.map((q) => {
              const sectionId = challengeSectionMap.get(q.id);
              return (
                <ChallengeCard
                  key={q.id}
                  quest={q}
                  onClick={sectionId ? () => handleChallengeClick(q.id) : undefined}
                  disabled={!sectionId}
                  compact
                  className="border-0 bg-transparent hover:bg-muted/40"
                />
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
