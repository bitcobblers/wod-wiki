import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useJournalZipProcessor } from './useJournalZipProcessor';

// Mock dependencies
mock.module('../services/decodeZip', () => ({
  decodeZip: mock(() => Promise.resolve('# Journal Entry\n\n```time\n\n```\n')),
}));

mock.module('../services/parseJournalDate', () => ({
  parseJournalDate: mock((dateString) => {
    // Simple mock that only validates YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return { dateKey: dateString, date: new Date(dateString) };
    }
    return null;
  }),
}));

mock.module('../services/dateUtils', () => ({
  getTodayDateKey: mock(() => '2026-05-26'),
  isDateInPast: mock((dateKey) => dateKey < '2026-05-26'),
  formatDateKey: mock((date) => date.toISOString().split('T')[0]),
}));

mock.module('../lib/routes', () => ({
  notePath: mock((id) => `/notes/${id}`),
  ROUTE_PATTERNS: {
    journal: '/journal',
  },
}));

mock.module('../services/playgroundContent', () => ({
  playgroundContent: {
    savePage: mock(() => Promise.resolve()),
  },
}));

mock.module('@/hooks/use-toast', () => ({
  toast: mock(() => {}),
}));

// Mock React Router
let mockNavigate = mock(() => {});
let mockDateParam = undefined;

mock.module('react-router-dom', () => ({
  useNavigate: mock(() => mockNavigate),
  useParams: mock(() => ({ date: mockDateParam })),
  // The hook reads `location.pathname` to confirm it is on the /load/journal
  // route. Provide a complete stub so this file passes in isolation rather than
  // depending on another test file's react-router-dom mock leaking in.
  useLocation: mock(() => ({
    pathname: '/load/journal',
    search: '',
    hash: '',
    state: null,
    key: 'test',
  })),
}));

// Mock nuqs (query state)
let mockZip = 'encoded-zip-content';

mock.module('nuqs', () => ({
  useQueryState: mock(() => [mockZip, mock(() => {})]),
}));

describe('useJournalZipProcessor', () => {
  beforeEach(() => {
    mockNavigate = mock(() => {});
    mockDateParam = undefined;
    mockZip = 'encoded-zip-content';
  });

  afterEach(() => {
    // Clean up mocks after each test
  });

  it('redirects to /journal when no zip parameter is provided', async () => {
    mockZip = null;
    const { result } = renderHook(() => useJournalZipProcessor());

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/journal', { replace: true });
    });
  });

  it('loads with loading state initially', () => {
    const { result } = renderHook(() => useJournalZipProcessor());
    expect(result.current.state).toBe('loading');
  });

  it('creates entry and redirects for today without date param', async () => {
    const { result } = renderHook(() => useJournalZipProcessor());

    await waitFor(() => {
      expect(result.current.state).toBe('success');
    });

    expect(result.current.dateKey).toBe('2026-05-26');
    expect(mockNavigate.mock.calls[0]?.[0]).toMatch(/^\/notes\/[0-9a-f-]+$/);
    expect(mockNavigate.mock.calls[0]?.[1]).toEqual({ replace: true });
  });

  it('sets pending-confirmation state for past dates', async () => {
    mockDateParam = '2026-05-20'; // Past date
    const { result } = renderHook(() => useJournalZipProcessor());

    await waitFor(() => {
      expect(result.current.state).toBe('pending-confirmation');
    });

    expect(result.current.dateKey).toBe('2026-05-20');
    expect(result.current.content).toBeDefined();
    expect(result.current.onConfirmBackdate).toBeDefined();
  });

  it('creates entry directly for future dates', async () => {
    mockDateParam = '2026-06-01'; // Future date
    const { result } = renderHook(() => useJournalZipProcessor());

    await waitFor(() => {
      expect(result.current.state).toBe('success');
    });

    expect(result.current.dateKey).toBe('2026-06-01');
    expect(mockNavigate.mock.calls[0]?.[0]).toMatch(/^\/notes\/[0-9a-f-]+$/);
    expect(mockNavigate.mock.calls[0]?.[1]).toEqual({ replace: true });
  });

  it('sets error state and redirects on invalid date format', async () => {
    mockDateParam = 'invalid-date';
    const { result } = renderHook(() => useJournalZipProcessor());

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });

    expect(result.current.error).toBe('Invalid date format');
    expect(mockNavigate).toHaveBeenCalledWith('/journal', { replace: true });
  });

  it('returns onConfirmBackdate callback for past dates', async () => {
    mockDateParam = '2026-05-20';
    const { result } = renderHook(() => useJournalZipProcessor());

    await waitFor(() => {
      expect(result.current.state).toBe('pending-confirmation');
    });

    expect(typeof result.current.onConfirmBackdate).toBe('function');
  });

  it('sets error state for invalid dates', async () => {
    mockDateParam = 'invalid-date';
    const { result } = renderHook(() => useJournalZipProcessor());

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });

    expect(result.current.error).toBe('Invalid date format');
  });
});
