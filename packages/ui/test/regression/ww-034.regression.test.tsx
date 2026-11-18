import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WqlComposer } from '../../src/composer/WqlComposer';

afterEach(cleanup);

describe('WW-034 — WqlComposer plain-text fallback leaves no stale parse alert', () => {
  it('renders no "Cannot parse" alert for bare-word fallback query "kettlebell"', () => {
    render(<WqlComposer query="kettlebell" showDiagnostics={false} />);
    const alerts = screen.queryAllByRole('alert');
    const parseAlerts = alerts.filter((el) => /Cannot parse/i.test(el.textContent ?? ''));
    expect(parseAlerts).toHaveLength(0);
  });
});
