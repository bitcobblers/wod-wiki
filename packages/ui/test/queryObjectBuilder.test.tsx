import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  parseQueryBlock,
  serializeQueryBlock,
  type QueryBlockObject,
} from '@bitcobblers/wod-wiki-wql';
import {
  QueryObjectBuilder,
  bindTokenParamIntoWql,
  wqlToPills,
} from '../src/composer';
import { WqlQueryInspectorModal } from '../src/blocks/WqlQueryInspectorModal';

afterEach(cleanup);

describe('ParamRef pills and AST token binding', () => {
  it('represents $scope spread filters and $param values as lossless composer pills', () => {
    const pills = wqlToPills(':segment{$scope, effort:$effort} last $weeks w');
    expect(pills).not.toBeNull();
    expect(pills?.find((p) => p.type === 'scope')?.value).toBe('$scope');
    expect(pills?.find((p) => p.type === 'effort')?.value).toBe('$effort');
    expect(pills?.find((p) => p.type === 'time')?.value).toBe('last $weeks w');
  });

  it('binds $scope and named $tokens via AST without regex corruption', () => {
    const withScope = bindTokenParamIntoWql('sum:totalVolume{} by {week}', 'scope');
    expect(withScope).toBe('sum:totalVolume{$scope} by {week}');

    const withEffort = bindTokenParamIntoWql(withScope, 'effort');
    expect(withEffort).toBe('sum:totalVolume{$scope,effort:$effort} by {week}');
  });
});

describe('QueryObjectBuilder densities', () => {
  it('bar density syncs single-truth Group By into the WQL AST and switches View', () => {
    let latest: QueryBlockObject = parseQueryBlock(':note{source:journal}');
    const handleChange = vi.fn((next: QueryBlockObject) => {
      latest = next;
    });

    const { rerender } = render(
      <QueryObjectBuilder density="bar" value={latest} onChange={handleChange} />,
    );

    fireEvent.change(screen.getByTestId('query-bar-groupby'), { target: { value: 'week' } });
    expect(latest.query).toBe(':note{source:journal} by {week}');
    expect(latest.groupBy).toEqual(['week']);

    rerender(<QueryObjectBuilder density="bar" value={latest} onChange={handleChange} />);
    fireEvent.change(screen.getByTestId('query-bar-view'), { target: { value: 'list' } });
    expect(latest.view).toBe('list');
  });

  it('inline density keeps 1-line session shorthand minimal until presentation fields are customized', async () => {
    const applied: string[] = [];
    const onClose = vi.fn();

    render(
      <WqlQueryInspectorModal
        isOpen
        onClose={onClose}
        initialQuery=":session{result:r-42}"
        onApply={(q) => {
          applied.push(q);
        }}
      />,
    );

    expect(screen.getByTestId('wql-inspector-draft').textContent).toBe(':session{result:r-42}');

    // Customize presentation -> upgrades automatically to YAML
    fireEvent.change(screen.getByTestId('query-inline-title'), {
      target: { value: 'Fran Breakdown' },
    });
    fireEvent.change(screen.getByTestId('query-inline-columns'), {
      target: { value: 'effort, reps, calc.e1rm' },
    });
    fireEvent.change(screen.getByTestId('query-inline-sort'), {
      target: { value: 'calc.e1rm desc' },
    });

    const draftYaml = screen.getByTestId('wql-inspector-draft').textContent ?? '';
    expect(draftYaml).toContain('title: Fran Breakdown');
    expect(draftYaml).toContain('columns: [effort, reps, calc.e1rm]');
    expect(draftYaml).toContain('sort: [calc.e1rm desc]');

    fireEvent.click(screen.getByTestId('wql-inspector-apply'));
    expect(applied).toHaveLength(1);
    const reparsed = parseQueryBlock(applied[0]!);
    expect(reparsed.title).toBe('Fran Breakdown');
    expect(reparsed.columns).toEqual(['effort', 'reps', 'calc.e1rm']);
    expect(reparsed.sort).toEqual([{ col: 'calc.e1rm', dir: 'desc' }]);
  });

  it('studio density composes multi-series YAML with goal, rolling baseline, formula, and token chips', () => {
    let current: QueryBlockObject = parseQueryBlock('sum:totalVolume{} by {week}', {
      fenceTag: 'query:timeseries',
    });
    const { rerender } = render(
      <QueryObjectBuilder
        density="studio"
        value={current}
        onChange={(next) => {
          current = next;
        }}
        tokenValues={{ scope: 'discipline:strength' }}
      />,
    );

    // Bind +$scope via AST
    fireEvent.click(screen.getByText('+$scope'));
    rerender(
      <QueryObjectBuilder
        density="studio"
        value={current}
        onChange={(next) => {
          current = next;
        }}
        tokenValues={{ scope: 'discipline:strength' }}
      />,
    );
    expect(current.query).toBe('sum:totalVolume{$scope} by {week}');

    // Add goal + baseline layers
    fireEvent.click(screen.getByTestId('legend-chip-goal'));
    rerender(
      <QueryObjectBuilder
        density="studio"
        value={current}
        onChange={(next) => {
          current = next;
        }}
        tokenValues={{ scope: 'discipline:strength' }}
      />,
    );
    fireEvent.click(screen.getByTestId('legend-chip-baseline'));
    rerender(
      <QueryObjectBuilder
        density="studio"
        value={current}
        onChange={(next) => {
          current = next;
        }}
        tokenValues={{ scope: 'discipline:strength' }}
      />,
    );

    const yaml = serializeQueryBlock(current);
    expect(yaml).toContain('view: timeseries');
    expect(yaml).toContain('id: primary');
    expect(yaml).toContain('formula: primary * 0 + 150');
    expect(yaml).toContain('id: baseline_4w');
  });
});
