export * from '@/nav/navTypes';

import type React from 'react';
import type {
  NavState as BaseNavState,
  NavStateAction as BaseNavStateAction,
} from '@/nav/navTypes';

export interface NavState extends BaseNavState {
  inspectorDrawerOpen: boolean;
}

export type NavStateAction =
  | BaseNavStateAction
  | { type: 'SET_INSPECTOR_DRAWER'; open: boolean };

export type NavDispatch = React.Dispatch<NavStateAction>;
