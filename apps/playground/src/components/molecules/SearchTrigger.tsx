import React from 'react';
import { Search } from 'lucide-react';
import { Button } from "@bitcobblers/wod-wiki-ui/primitives";

interface SearchTriggerProps {
  onSearch?: () => void;
  isMobile?: boolean;
}

export const SearchTrigger: React.FC<SearchTriggerProps> = ({ onSearch, isMobile = false }) => {
  if (isMobile) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onSearch?.()}
        className="text-muted-foreground hover:text-foreground"
      >
        <Search className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="relative mx-2 w-full max-w-[200px] hidden md:block">
      <Button
        variant="outline"
        className="w-full justify-start text-sm text-muted-foreground font-normal px-2 h-8"
        onClick={() => onSearch?.()}
      >
        <Search className="mr-2 h-4 w-4" />
        Search...
        <span className="ml-auto text-xs opacity-50">Ctrl+/</span>
      </Button>
    </div>
  );
};
