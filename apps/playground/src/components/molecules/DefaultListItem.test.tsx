import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { DefaultListItem } from './DefaultListItem';
import type { IListItem, ListItemContext } from './types';

describe('DefaultListItem', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  const mockContext: ListItemContext = {
    actions: [],
    isActive: false,
    isSelected: false,
    onSelect: () => {},
    executeAction: () => {},
  };

  const mockItem: IListItem = {
    id: 'test-item',
    label: 'Test Item',
    payload: null,
  };

  describe('Basic rendering', () => {
    it('renders item label', () => {
      render(
        <DefaultListItem item={mockItem} ctx={mockContext} />
      );

      expect(screen.getByText('Test Item')).toBeDefined();
    });

    it('renders with correct role and aria attributes', () => {
      const { container } = render(
        <DefaultListItem item={mockItem} ctx={mockContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv).toBeTruthy();
      expect(itemDiv?.getAttribute('aria-selected')).toBe('false');
    });

    it('renders item icon when provided', () => {
      const itemWithIcon: IListItem = {
        ...mockItem,
        icon: <span data-testid="test-icon">📁</span>,
      };

      render(
        <DefaultListItem item={itemWithIcon} ctx={mockContext} />
      );

      expect(screen.getByTestId('test-icon')).toBeDefined();
    });

    it('renders subtitle when provided', () => {
      const itemWithSubtitle: IListItem = {
        ...mockItem,
        subtitle: 'This is a subtitle',
      };

      render(<DefaultListItem item={itemWithSubtitle} ctx={mockContext} />);

      expect(screen.getByText('This is a subtitle')).toBeDefined();
    });
  });

  describe('Badge rendering', () => {
    it('renders badge when provided', () => {
      const itemWithBadge: IListItem = {
        ...mockItem,
        badge: '5',
      };

      render(<DefaultListItem item={itemWithBadge} ctx={mockContext} />);

      expect(screen.getByText('5')).toBeDefined();
    });

    it('applies correct badge styling', () => {
      const itemWithBadge: IListItem = {
        ...mockItem,
        badge: 'New',
      };

      const { container } = render(
        <DefaultListItem item={itemWithBadge} ctx={mockContext} />
      );

      const badge = container.querySelector('.rounded-full');
      expect(badge).toBeTruthy();
      expect(badge?.className).toContain('bg-zinc-200');
    });

    it('does not render badge when not provided', () => {
      const { container } = render(
        <DefaultListItem item={mockItem} ctx={mockContext} />
      );

      const badge = container.querySelector('.rounded-full');
      expect(badge).toBeNull();
    });
  });

  describe('Action buttons', () => {
    it('renders primary action button when provided', () => {
      const contextWithAction: ListItemContext = {
        ...mockContext,
        actions: [
          {
            id: 'primary',
            label: 'Add',
            action: 'add',
            isPrimary: true,
          },
        ],
      };

      render(<DefaultListItem item={mockItem} ctx={contextWithAction} />);

      expect(screen.getByText('Add')).toBeDefined();
    });

    it('renders secondary action buttons when provided', () => {
      const contextWithActions: ListItemContext = {
        ...mockContext,
        actions: [
          {
            id: 'delete',
            label: 'Delete',
            action: 'delete',
            isPrimary: false,
            icon: <span data-testid="delete-icon">🗑️</span>,
          },
        ],
      };

      render(
        <DefaultListItem item={mockItem} ctx={contextWithActions} />
      );

      expect(screen.getByTestId('delete-icon')).toBeDefined();
    });

    it('executes primary action when button is clicked', () => {
      let actionExecuted = false;
      const contextWithAction: ListItemContext = {
        ...mockContext,
        actions: [
          {
            id: 'primary',
            label: 'Add',
            action: 'add',
            isPrimary: true,
          },
        ],
        executeAction: (action) => {
          if (action === 'add') actionExecuted = true;
        },
      };

      render(
        <DefaultListItem item={mockItem} ctx={contextWithAction} />
      );

      const actionButton = screen.getByText('Add');
      fireEvent.click(actionButton);

      expect(actionExecuted).toBe(true);
    });

    it('executes secondary action when button is clicked', () => {
      let actionExecuted = false;
      const contextWithActions: ListItemContext = {
        ...mockContext,
        actions: [
          {
            id: 'delete',
            label: 'Delete',
            action: 'delete',
            isPrimary: false,
            icon: <span>🗑️</span>,
          },
        ],
        executeAction: (action) => {
          if (action === 'delete') actionExecuted = true;
        },
      };

      const { container } = render(
        <DefaultListItem item={mockItem} ctx={contextWithActions} />
      );

      const deleteButton = container.querySelector('button');
      fireEvent.click(deleteButton!);

      expect(actionExecuted).toBe(true);
    });

    it('stops event propagation when action button is clicked', () => {
      let itemSelected = false;
      let actionExecuted = false;

      const contextWithAction: ListItemContext = {
        ...mockContext,
        actions: [
          {
            id: 'primary',
            label: 'Add',
            action: 'add',
            isPrimary: true,
          },
        ],
        onSelect: () => {
          itemSelected = true;
        },
        executeAction: (action) => {
          if (action === 'add') actionExecuted = true;
        },
      };

      render(
        <DefaultListItem item={mockItem} ctx={contextWithAction} />
      );

      const actionButton = screen.getByText('Add');
      fireEvent.click(actionButton);

      expect(actionExecuted).toBe(true);
      expect(itemSelected).toBe(false);
    });
  });

  describe('Selection states', () => {
    it('applies active styling when isActive is true', () => {
      const activeContext: ListItemContext = {
        ...mockContext,
        isActive: true,
      };

      const { container } = render(
        <DefaultListItem item={mockItem} ctx={activeContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).toContain('bg-primary/10');
      expect(itemDiv?.className).toContain('text-primary');
    });

    it('applies selected styling when isSelected is true', () => {
      const selectedContext: ListItemContext = {
        ...mockContext,
        isSelected: true,
      };

      const { container } = render(
        <DefaultListItem item={mockItem} ctx={selectedContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).toContain('bg-primary/10');
      expect(itemDiv?.className).toContain('text-primary');
    });

    it('sets aria-selected when isSelected is true', () => {
      const selectedContext: ListItemContext = {
        ...mockContext,
        isSelected: true,
      };

      const { container } = render(
        <DefaultListItem item={mockItem} ctx={selectedContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.getAttribute('aria-selected')).toBe('true');
    });

    it('applies default styling when not active or selected', () => {
      const { container } = render(
        <DefaultListItem item={mockItem} ctx={mockContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).toContain('hover:bg-zinc-100');
      expect(itemDiv?.className).toContain('text-zinc-700');
    });
  });

  describe('Disabled state', () => {
    it('applies disabled styling when item is disabled', () => {
      const disabledItem: IListItem = {
        ...mockItem,
        isDisabled: true,
      };

      const { container } = render(
        <DefaultListItem item={disabledItem} ctx={mockContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).toContain('opacity-40');
      expect(itemDiv?.className).toContain('pointer-events-none');
    });

    it('does not call onSelect when disabled item is clicked', () => {
      let selected = false;
      const contextWithSelect: ListItemContext = {
        ...mockContext,
        onSelect: () => {
          selected = true;
        },
      };

      const disabledItem: IListItem = {
        ...mockItem,
        isDisabled: true,
      };

      const { container } = render(
        <DefaultListItem item={disabledItem} ctx={contextWithSelect} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      fireEvent.click(itemDiv!);

      expect(selected).toBe(false);
    });
  });

  describe('Click handling', () => {
    it('calls onSelect when item is clicked', () => {
      let selected = false;
      const contextWithSelect: ListItemContext = {
        ...mockContext,
        onSelect: () => {
          selected = true;
        },
      };

      const { container } = render(
        <DefaultListItem item={mockItem} ctx={contextWithSelect} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      fireEvent.click(itemDiv!);

      expect(selected).toBe(true);
    });

    it('applies cursor pointer styling', () => {
      const { container } = render(
        <DefaultListItem item={mockItem} ctx={mockContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).toContain('cursor-pointer');
    });
  });

  describe('Depth indentation', () => {
    it('applies correct padding for depth 1', () => {
      const itemWithDepth: IListItem = {
        ...mockItem,
        depth: 1,
      };

      const { container } = render(
        <DefaultListItem item={itemWithDepth} ctx={mockContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).toContain('pl-7');
    });

    it('applies correct padding for depth 2', () => {
      const itemWithDepth: IListItem = {
        ...mockItem,
        depth: 2,
      };

      const { container } = render(
        <DefaultListItem item={itemWithDepth} ctx={mockContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).toContain('pl-11');
    });

    it('caps padding at pl-16 for deep nesting', () => {
      const itemWithDeepDepth: IListItem = {
        ...mockItem,
        depth: 10,
      };

      const { container } = render(
        <DefaultListItem item={itemWithDeepDepth} ctx={mockContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).toContain('pl-16');
    });

    it('does not apply padding when depth is 0 or not provided', () => {
      const { container } = render(
        <DefaultListItem item={mockItem} ctx={mockContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).not.toContain('pl-');
    });
  });

  describe('Shortcut rendering', () => {
    it('renders ShortcutBadge when shortcut is provided', () => {
      const itemWithShortcut: IListItem = {
        ...mockItem,
        shortcut: ['⌘', 'K'],
      };

      const { container } = render(
        <DefaultListItem item={itemWithShortcut} ctx={mockContext} />
      );

      // ShortcutBadge should be rendered
      const shortcutContainer = container.querySelector('.shrink-0');
      expect(shortcutContainer).toBeTruthy();
    });

    it('does not render ShortcutBadge when shortcut is empty', () => {
      const itemWithEmptyShortcut: IListItem = {
        ...mockItem,
        shortcut: [],
      };

      const { container } = render(
        <DefaultListItem item={itemWithEmptyShortcut} ctx={mockContext} />
      );

      // ShortcutBadge component should not be rendered
      // Check that no shortcut-related elements exist
      const shortcutElements = container.querySelectorAll('[class*="shortcut"]');
      expect(shortcutElements.length).toBe(0);
    });
  });

  describe('Styling and layout', () => {
    it('applies flex layout', () => {
      const { container } = render(
        <DefaultListItem item={mockItem} ctx={mockContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).toContain('flex');
    });

    it('applies transition classes', () => {
      const { container } = render(
        <DefaultListItem item={mockItem} ctx={mockContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).toContain('transition-colors');
    });

    it('applies select-none to prevent text selection', () => {
      const { container } = render(
        <DefaultListItem item={mockItem} ctx={mockContext} />
      );

      const itemDiv = container.querySelector('[role="option"]');
      expect(itemDiv?.className).toContain('select-none');
    });
  });

  describe('Edge cases', () => {
    it('handles item with only label', () => {
      const minimalItem: IListItem = {
        id: 'minimal',
        label: 'Minimal Item',
        payload: null,
      };

      render(
        <DefaultListItem item={minimalItem} ctx={mockContext} />
      );

      expect(screen.getByText('Minimal Item')).toBeDefined();
    });

    it('handles action without icon (uses label)', () => {
      const contextWithAction: ListItemContext = {
        ...mockContext,
        actions: [
          {
            id: 'action1',
            label: 'Click Me',
            action: 'click',
            isPrimary: true,
          },
        ],
      };

      render(<DefaultListItem item={mockItem} ctx={contextWithAction} />);

      expect(screen.getByText('Click Me')).toBeDefined();
    });

    it('handles empty actions array', () => {
      const contextWithEmptyActions: ListItemContext = {
        ...mockContext,
        actions: [],
      };

      const { container } = render(
        <DefaultListItem item={mockItem} ctx={contextWithEmptyActions} />
      );

      // Should render without action buttons
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(0);
    });
  });
});
