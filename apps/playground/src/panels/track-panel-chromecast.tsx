/**
 * track-panel-chromecast.tsx — Chromecast receiver stack panel.
 *
 * Thin adapter over the shared browser visual-state panel.
 */

import React from 'react';
import { VisualStatePanel } from '@/panels/visual-state-panel';

export const ReceiverStackPanel: React.FC<{ VisualStateSlot?: React.ComponentType }> = ({
  VisualStateSlot = VisualStatePanel,
}) => {
  return <VisualStateSlot />;
};
