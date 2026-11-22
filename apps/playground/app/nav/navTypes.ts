export * from '@/nav/navTypes';

import type React from 'react';
import type {
  NavState as BaseNavState,
  NavStateAction as BaseNavStateAction,
} from '@/nav/navTypes';

export type EntityPeekTarget =
  | { kind: 'effort'; slug: string; label?: string }
  | { kind: 'equipment'; slug: string; label?: string }
  | { kind: 'tag'; tagType?: string; label: string }
  | { kind: 'unrecognized'; term: string }
  | { kind: 'note'; noteId: string; title?: string }
  | { kind: 'notebook'; slug: string; title?: string }
  | { kind: 'schedule'; entry: unknown }
  | { kind: 'day'; date: string };

export interface NavState extends BaseNavState {
  inspectorDrawerOpen: boolean;
  peekTarget?: EntityPeekTarget | null;
}

export type NavStateAction =
  | BaseNavStateAction
  | { type: 'SET_INSPECTOR_DRAWER'; open: boolean }
  | { type: 'OPEN_PEEK'; target: EntityPeekTarget }
  | { type: 'CLOSE_PEEK' };

export type NavDispatch = React.Dispatch<NavStateAction>;
