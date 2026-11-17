import { useEffect, useState } from 'react';
import {
  getSuggestionBinding,
  loadSuggestions,
  type SuggestionBinding,
  type SuggestionItem,
} from './suggestionSources';

export interface ClauseSuggestions {
  items: SuggestionItem[];
  /** True while the first load for this slot is in flight. */
  loading: boolean;
  /** The slot's binding (cache policy, open flag, empty-state copy). */
  binding?: SuggestionBinding;
}

export function useSuggestions(type: string): ClauseSuggestions {
  const binding = getSuggestionBinding(type);
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [loading, setLoading] = useState(Boolean(binding));

  useEffect(() => {
    if (!binding) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadSuggestions(type).then((result) => {
      if (cancelled) return;
      setItems(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [type, binding]);

  return { items, loading, binding };
}
