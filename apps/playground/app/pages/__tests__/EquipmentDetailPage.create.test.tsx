import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { TEST_IDS } from '@/lib/testIds';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';
import { EquipmentDetailPage } from '../EquipmentDetailPage';

describe('EquipmentDetailPage — create mode persistence (WW-090)', () => {
  let host: PlaygroundRenderResult | null = null;

  afterEach(async () => {
    cleanup();
    if (host) {
      await host.cleanup();
      host = null;
    }
  });

  it('commits a newly created equipment definition durably and navigates to /equipment/:slug', async () => {
    host = await renderWithPlaygroundHost(<EquipmentDetailPage />, {
      route: '/equipment/chalk-bucket?mode=create',
      routePath: '/equipment/:slug',
    });

    const createBtn = await screen.findByTestId(TEST_IDS.EQUIPMENT_CREATE_BTN);
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(host!.getLocation().pathname).toBe('/equipment/chalk-bucket');
    });

    const persisted = await host.storageService.getEquipment('chalk-bucket');
    expect(persisted).toBeDefined();
    expect(persisted?.slug).toBe('chalk-bucket');
    const note = await host.storageService.getNote('equipment/chalk-bucket');
    expect(note).toBeDefined();
  });

  it('opens create mode directly when navigating to /equipment/new without ?mode=create (WW-121)', async () => {
    host = await renderWithPlaygroundHost(<EquipmentDetailPage />, {
      route: '/equipment/new',
      routePath: '/equipment/:slug',
    });

    expect(await screen.findByTestId(TEST_IDS.EQUIPMENT_CREATE_BTN)).toBeDefined();
    expect(screen.getByTestId('equipment-create-editor')).toBeDefined();
    expect(screen.queryByTestId(TEST_IDS.EQUIPMENT_NOT_FOUND)).toBeNull();
  });
});
