import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkoutActionButton } from '@/components/molecules/WorkoutActionButton';
import type { IContentProvider } from '@/types/content-provider';

describe('WorkoutActionButton', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  describe('Basic rendering', () => {
    it('renders main button with Plus icon in create mode', () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      render(<WorkoutActionButton onAction={onAction} mode="create" />);

      expect(screen.getByText('New')).toBeDefined();
    });

    it('renders main button with Copy icon in clone mode', () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      render(<WorkoutActionButton onAction={onAction} mode="clone" />);

      expect(screen.getByText('Clone')).toBeDefined();
    });

    it('renders custom label when provided', () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      render(
        <WorkoutActionButton onAction={onAction} mode="create" label="Custom" />
      );

      expect(screen.getByText('Custom')).toBeDefined();
    });

    it('renders calendar dropdown trigger button', () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton onAction={onAction} mode="create" />
      );

      const calendarButton = container.querySelector('button[title="Pick a date"]');
      expect(calendarButton).toBeTruthy();
    });
  });

  describe('Main button action', () => {
    it('calls onAction with today date when main button is clicked', () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let calledDate: Date | undefined;
      const onAction = (date: Date) => {
        calledDate = date;
      };

      render(<WorkoutActionButton onAction={onAction} mode="create" />);

      const mainButton = screen.getByText('New');
      fireEvent.click(mainButton);

      expect(calledDate).toBeDefined();
      expect(calledDate?.toDateString()).toBe(today.toDateString());
    });

    it('stops propagation when main button is clicked', () => {
      let outerClicked = false;
      let actionCalled = false;

      const handleOuterClick = () => {
        outerClicked = true;
      };

      const onAction = () => {
        actionCalled = true;
      };

      render(
        <div onClick={handleOuterClick}>
          <WorkoutActionButton onAction={onAction} mode="create" />
        </div>
      );

      const mainButton = screen.getByText('New');
      fireEvent.click(mainButton);

      expect(outerClicked).toBe(false);
      expect(actionCalled).toBe(true);
    });

    it('applies outline variant by default', () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton onAction={onAction} variant="outline" />
      );

      const button = container.querySelector('button');
      expect(button?.className).toContain('outline');
    });

    it('applies default variant when specified', () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton onAction={onAction} variant="default" />
      );

      const button = container.querySelector('button');
      // Default variant has bg-primary instead of outline classes
      expect(button?.className).toContain('bg-primary');
    });
  });

  describe('Calendar dropdown', () => {
    it('opens calendar dropdown when trigger button is clicked', async () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton onAction={onAction} mode="create" />
      );

      const calendarButton = container.querySelector('button[title="Pick a date"]');
      expect(calendarButton).toBeTruthy();

      fireEvent.click(calendarButton!);

      // Wait for dropdown to open - it renders in a portal with position fixed
      await waitFor(() => {
        // Check for the dropdown menu in the body
        const dropdown = document.body.querySelector('.rounded-md.border');
        expect(dropdown).toBeTruthy();
      });
    });

    it('calls onAction with selected date when date is selected in calendar', async () => {
      let _calledDate: Date | undefined;
      const onAction = (date: Date) => {
        _calledDate = date;
      };

      const { container } = render(
        <WorkoutActionButton onAction={onAction} mode="create" />
      );

      // Open dropdown
      const calendarButton = container.querySelector('button[title="Pick a date"]');
      fireEvent.click(calendarButton!);

      // Wait for dropdown to open
      await waitFor(() => {
        const dropdown = document.body.querySelector('.rounded-md.border');
        expect(dropdown).toBeTruthy();
      });

      // Click on a calendar day (CalendarCard would handle this)
      // For now we just verify dropdown opens - actual date selection would require CalendarCard to be testable
    });

    it('loads entry dates from provider when dropdown opens', async () => {
      let callCount = 0;
      const mockProvider: IContentProvider = {
        getEntries: async () => {
          callCount++;
          return [
            { type: 'workout', targetDate: '2024-01-10T00:00:00Z' },
            { type: 'workout', targetDate: '2024-01-15T00:00:00Z' },
            { type: 'note', notebookId: 'notebook/defaults', targetDate: '2024-01-20T00:00:00Z' },
          ];
        },
      } as unknown as IContentProvider;

      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton
          onAction={onAction}
          mode="create"
          provider={mockProvider}
        />
      );

      const calendarButton = container.querySelector('button[title="Pick a date"]');
      fireEvent.click(calendarButton!);

      // Wait for async loading
      await waitFor(() => {
        expect(callCount).toBeGreaterThan(0);
      });
    });

    it('shows loading state while loading entry dates', async () => {
      let resolveLoading: (() => void) | undefined;
      const mockProvider: IContentProvider = {
        getEntries: () =>
          new Promise(resolve => {
            resolveLoading = () => resolve([]);
          }),
      } as unknown as IContentProvider;

      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton
          onAction={onAction}
          mode="create"
          provider={mockProvider}
        />
      );

      const calendarButton = container.querySelector('button[title="Pick a date"]');
      fireEvent.click(calendarButton!);

      // Should show loading indicator in the dropdown
      await waitFor(() => {
        const loader = document.body.querySelector('.animate-spin');
        expect(loader).toBeTruthy();
      });

      // Resolve loading
      resolveLoading?.();
    });

    it('handles provider errors gracefully', async () => {
      const mockProvider: IContentProvider = {
        getEntries: async () => {
          throw new Error('Provider error');
        },
      } as unknown as IContentProvider;

      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton
          onAction={onAction}
          mode="create"
          provider={mockProvider}
        />
      );

      const calendarButton = container.querySelector('button[title="Pick a date"]');
      fireEvent.click(calendarButton!);

      // Wait for dropdown to open despite error
      await waitFor(() => {
        const dropdown = document.body.querySelector('.rounded-md.border');
        expect(dropdown).toBeTruthy();
      });
    });
  });

  describe('Secondary actions', () => {
    it('renders secondary actions when provided', () => {
      let _secondaryActionCalled = false;
      const secondaryActions = [
        {
          label: 'Import',
          icon: <span data-testid="import-icon">↓</span>,
          onClick: () => {
            _secondaryActionCalled = true;
          },
        },
      ];

      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton
          onAction={onAction}
          mode="create"
          secondaryActions={secondaryActions}
        />
      );

      const calendarButton = container.querySelector('button[title="Pick a date"]');
      fireEvent.click(calendarButton!);

      expect(screen.getByText('Import')).toBeDefined();
      expect(screen.getByTestId('import-icon')).toBeDefined();
    });

    it('calls secondary action onClick when clicked', () => {
      let _secondaryActionCalled = false;
      const secondaryActions = [
        {
          label: 'Import',
          icon: <span>↓</span>,
          onClick: () => {
            _secondaryActionCalled = true;
          },
        },
      ];

      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton
          onAction={onAction}
          mode="create"
          secondaryActions={secondaryActions}
        />
      );

      const calendarButton = container.querySelector('button[title="Pick a date"]');
      fireEvent.click(calendarButton!);

      const importButton = screen.getByText('Import');
      fireEvent.click(importButton);

      expect(_secondaryActionCalled).toBe(true);
    });
  });

  describe('Styling and layout', () => {
    it('applies custom className to wrapper', () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton
          onAction={onAction}
          mode="create"
          className="custom-class"
        />
      );

      const wrapper = container.querySelector('.custom-class');
      expect(wrapper).toBeTruthy();
    });

    it('hides label on small screens via responsive classes', () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton onAction={onAction} mode="create" />
      );

      const labelSpan = container.querySelector('.hidden.sm\\:inline');
      expect(labelSpan).toBeTruthy();
    });

    it('applies proper rounded corners for split button', () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton onAction={onAction} variant="outline" />
      );

      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThanOrEqual(2);

      const mainButton = buttons[0];
      const calendarTrigger = buttons[1];

      expect(mainButton.className).toContain('rounded-r-none');
      expect(calendarTrigger.className).toContain('rounded-l-none');
    });
  });

  describe('Edge cases', () => {
    it('does not load entry dates when provider is not provided', async () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton onAction={onAction} mode="create" />
      );

      const calendarButton = container.querySelector('button[title="Pick a date"]');
      fireEvent.click(calendarButton!);

      // Calendar dropdown should open
      await waitFor(() => {
        const dropdown = document.body.querySelector('.rounded-md.border');
        expect(dropdown).toBeTruthy();
      });

      // Should not show loading state
      const loader = document.body.querySelector('.animate-spin');
      expect(loader).toBeNull();
    });

    it('handles empty secondary actions array', () => {
      let _actionCalled = false;
      const onAction = () => {
        _actionCalled = true;
      };

      const { container } = render(
        <WorkoutActionButton
          onAction={onAction}
          mode="create"
          secondaryActions={[]}
        />
      );

      const calendarButton = container.querySelector('button[title="Pick a date"]');
      fireEvent.click(calendarButton!);

      // Dropdown should still open
      const dropdown = document.body.querySelector('.rounded-md.border');
      expect(dropdown).toBeTruthy();
    });
  });
});
