/**
 * TagsPage — /tags.
 *
 * A tag is a named bundle a script can reference with `#slug`. This page
 * is where those bundles are written: what each tag contributes (metrics
 * with typed values and units, other tags, and functions), and which kind it
 * is.
 *
 * A tag's slug is its label — that is what a script writes. The catalogue
 * holds one namespace, so a user-defined tag layers over a seeded tag of
 * the same slug.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BUILTIN_CALCS, findTagContributionCycles } from '@bitcobblers/wod-wiki-engine';
import type { Tag, TagContribution, TagTypeRecord } from '@bitcobblers/wod-wiki-core';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/atoms/primitives/button';
import { storageService } from '@/services/storage';
import { refreshTagIndex } from '@/services/tags/tagCatalogue';
import { useTagIndex } from '@/hooks/useTagIndex';
import { hydrateUserCalcs } from '@/stores/userCalcStore';

/** A function a tag can carry, with the grain it runs at. */
interface FunctionOption {
  name: string;
  grain: string;
}

const GRAIN_BY_SCOPE: Record<string, string> = {
  segment: 'per record',
  workout: 'at workout end',
};

/**
 * The scopes a function can run at. Store scope has no evaluator yet, so a
 * function that spans workouts is not offered.
 */
const RUNNABLE_SCOPES = new Set(['segment', 'workout']);

export function TagsPage() {
  const [searchParams] = useSearchParams();
  const requestedTag = searchParams.get('tag');
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagTypes, setTagTypes] = useState<TagTypeRecord[]>([]);
  const [functions, setFunctions] = useState<FunctionOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('');
  const [contributions, setContributions] = useState<TagContribution[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState('');
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const [storedTags, storedTypes] = await Promise.all([
      storageService.getAllTags(),
      storageService.getAllTagTypes(),
    ]);
    // A calc that does not compile must not keep the page from listing tags.
    const hydration = await hydrateUserCalcs().catch(() => ({ defs: [], errors: [] }));
    setTags(storedTags);
    setTagTypes(storedTypes);
    const options: FunctionOption[] = BUILTIN_CALCS.filter(calc =>
      RUNNABLE_SCOPES.has(calc.scope),
    ).map(calc => ({
      name: calc.id,
      grain: GRAIN_BY_SCOPE[calc.scope] ?? calc.scope,
    }));
    for (const calc of hydration.defs) {
      if (!RUNNABLE_SCOPES.has(calc.scope)) continue;
      options.push({ name: calc.id, grain: GRAIN_BY_SCOPE[calc.scope] ?? calc.scope });
    }
    setFunctions(options);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A link from the editor points at a tag: open it.
  useEffect(() => {
    if (!requestedTag || tags.length === 0) return;
    const match = tags.find(tag => tag.label === requestedTag);
    if (match) setSelectedId(match.id);
  }, [requestedTag, tags]);

  const selected = tags.find(tag => tag.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    setLabel(selected.label);
    setKind(selected.type ?? '');
    setContributions(selected.contributions ?? []);
  }, [selected]);

  const tagIndex = useTagIndex();
  const cycles = useMemo(() => findTagContributionCycles(tagIndex), [tagIndex]);

  const save = async (): Promise<boolean> => {
    if (!selected) return false;
    const trimmed = label.trim();
    if (trimmed.length === 0) {
      setError('A tag needs a name — that name is what `#slug` refers to.');
      return false;
    }
    const clash = tags.find(tag => tag.id !== selected.id && tag.label.trim() === trimmed);
    if (clash) {
      setError(`Another tag is already called "${trimmed}".`);
      return false;
    }
    await storageService.putTag({
      ...selected,
      label: trimmed,
      type: kind || undefined,
      contributions,
    });
    await refreshTagIndex();
    await load();
    setError(null);
    setSaved(true);
    return true;
  };

  const create = async (): Promise<void> => {
    const trimmed = newLabel.trim();
    if (trimmed.length === 0) {
      setError('A tag needs a name.');
      return;
    }
    if (tags.some(tag => tag.label.trim() === trimmed)) {
      setError(`A tag called "${trimmed}" already exists.`);
      return;
    }
    const tag: Tag = {
      id: `tag-${trimmed}-${Date.now().toString(36)}`,
      label: trimmed,
      type: newKind || undefined,
      contributions: [],
      createdAt: Date.now(),
    };
    await storageService.putTag(tag);
    await refreshTagIndex();
    await load();
    setSelectedId(tag.id);
    setNewLabel('');
    setError(null);
  };

  const remove = async (): Promise<void> => {
    if (!selected) return;
    await storageService.deleteTag(selected.id);
    await refreshTagIndex();
    await load();
    setSelectedId(null);
  };

  const updateContribution = (index: number, contribution: TagContribution): void => {
    setSaved(false);
    setContributions(current => current.map((entry, i) => (i === index ? contribution : entry)));
  };

  const removeContribution = (index: number): void => {
    setContributions(current => current.filter((_, i) => i !== index));
  };

  const visibleTags = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tags.filter(tag => {
      if (needle && !tag.label.toLowerCase().includes(needle)) return false;
      if (kindFilter && (tag.type ?? '') !== kindFilter) return false;
      return true;
    });
  }, [tags, search, kindFilter]);

  // The kinds a tag can have: the registered types, plus the kinds the tags
  // actually use (a kind can be written without being registered).
  const kindOptions = useMemo(() => {
    const names = new Set(tagTypes.map(type => type.name));
    for (const tag of tags) {
      if (tag.type) names.add(tag.type);
    }
    if (kind && !names.has(kind)) names.add(kind);
    return [...names].sort();
  }, [tagTypes, tags, kind]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <section className="space-y-2">
        <h1 className="text-lg font-semibold text-foreground">Tags</h1>
        <p className="text-sm text-muted-foreground">
          A tag is a named bundle a script can point at:{' '}
          <code className="font-mono">5 reps @ 100 kg {'#heavy'}</code>. What the tag brings
          applies to the line it sits on. A tag can contribute a metric (a typed value with a unit),
          another tag, or a function — a named calculation that runs where the tag applies.
        </p>
        {cycles.length > 0 && (
          <p className="text-xs text-destructive">
            These tags apply each other in a loop: {cycles.map(cycle => cycle.join(' → ')).join('; ')}.
            A loop contributes nothing.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">New tag</h2>
        <div className="p-4 sm:p-5 rounded-xl border border-border bg-card shadow-xs space-y-3">
          <form
            onSubmit={event => {
              event.preventDefault();
              void create();
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
              <input
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-primary"
                placeholder="heavy"
                value={newLabel}
                onChange={event => setNewLabel(event.target.value)}
              />
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Kind</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
                value={newKind}
                onChange={event => setNewKind(event.target.value)}
              >
                <option value="">—</option>
                {kindOptions.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" className="h-9">
              <Plus className="size-3.5 mr-1" /> Add Tag
            </Button>
          </form>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">Tags</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Filter tags"
              className="h-8 w-44 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
              placeholder="Filter by name…"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
            <select
              aria-label="Filter by kind"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
              value={kindFilter}
              onChange={event => setKindFilter(event.target.value)}
            >
              <option value="">All kinds</option>
              {kindOptions.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No tags yet.</p>
        ) : visibleTags.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No tags match the filter.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visibleTags.map(tag => (
              <button
                key={tag.id}
                type="button"
                onClick={() => setSelectedId(tag.id)}
                className={
                  tag.id === selectedId
                    ? 'px-2.5 py-1 rounded-md border border-primary bg-primary/10 font-mono text-xs text-foreground'
                    : 'px-2.5 py-1 rounded-md border border-border bg-card font-mono text-xs text-muted-foreground hover:text-foreground'
                }
              >
                {tag.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Edit {selected.label}</h2>
          <div className="p-4 sm:p-5 rounded-xl border border-border bg-card shadow-xs space-y-4">
            <p className="text-xs text-muted-foreground">
              Created {new Date(selected.createdAt).toLocaleDateString()}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
                <input
                  className="w-full h-9 rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus:border-primary"
                  value={label}
                  onChange={event => setLabel(event.target.value)}
                />
              </div>
              <div className="w-40">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Kind</label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
                  value={kind}
                  onChange={event => setKind(event.target.value)}
                >
                  <option value="">—</option>
                  {kindOptions.map(name => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-muted-foreground">Contributions</h3>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      setContributions(current => [
                        ...current,
                        { kind: 'metric', type: '', value: '' },
                      ])
                    }
                  >
                    <Plus className="size-3 mr-1" /> Metric
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      setContributions(current => [...current, { kind: 'tag', slug: '' }])
                    }
                  >
                    <Plus className="size-3 mr-1" /> Tag
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      setContributions(current => [...current, { kind: 'function', name: '' }])
                    }
                  >
                    <Plus className="size-3 mr-1" /> Function
                  </Button>
                </div>
              </div>

              {contributions.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  This tag contributes nothing yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {contributions.map((contribution, index) => (
                    <ContributionRow
                      key={index}
                      contribution={contribution}
                      tagOptions={tags
                        .filter(tag => tag.id !== selected.id)
                        .map(tag => tag.label.trim())}
                      functionOptions={functions}
                      onChange={next => updateContribution(index, next)}
                      onRemove={() => removeContribution(index)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button type="button" size="sm" className="h-9" onClick={() => void save()}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9"
                onClick={() => void remove()}
              >
                <Trash2 className="size-3.5 mr-1" /> Delete
              </Button>
              {saved && (
                <span className="text-xs text-muted-foreground self-center">Saved</span>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/** The props a contribution row is edited with. */
interface ContributionRowProps {
  /** The contribution being edited. */
  contribution: TagContribution;
  /** The tags this one may apply. */
  tagOptions: string[];
  /** The functions that may be carried. */
  functionOptions: FunctionOption[];
  /** Called with the edited contribution. */
  onChange: (contribution: TagContribution) => void;
  /** Called when the contribution is removed. */
  onRemove: () => void;
}

/** One contribution, edited in place. */
function ContributionRow({
  contribution,
  tagOptions,
  functionOptions,
  onChange,
  onRemove,
}: ContributionRowProps) {
  const inputClass =
    'h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {contribution.kind === 'metric' && (
        <>
          <input
            aria-label="Metric type"
            className={`${inputClass} w-32 font-mono`}
            placeholder="type"
            value={contribution.type}
            onChange={event => onChange({ ...contribution, type: event.target.value })}
          />
          <input
            aria-label="Metric value"
            className={`${inputClass} w-32`}
            placeholder="value"
            value={String(contribution.value)}
            onChange={event => onChange({ ...contribution, value: event.target.value })}
          />
          <input
            aria-label="Metric unit"
            className={`${inputClass} w-24`}
            placeholder="unit"
            value={contribution.unit ?? ''}
            onChange={event =>
              onChange({
                ...contribution,
                ...(event.target.value ? { unit: event.target.value } : { unit: undefined }),
              })
            }
          />
        </>
      )}

      {contribution.kind === 'tag' && (
        <>
          <select
            aria-label="Applied tag"
            className={`${inputClass} w-48 font-mono`}
            value={contribution.slug}
            onChange={event => onChange({ ...contribution, slug: event.target.value })}
          >
            <option value="">choose a tag…</option>
            {tagOptions.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </>
      )}

      {contribution.kind === 'function' && (
        <>
          <select
            aria-label="Function"
            className={`${inputClass} w-56 font-mono`}
            value={contribution.name}
            onChange={event => onChange({ ...contribution, name: event.target.value })}
          >
            <option value="">choose a function…</option>
            {functionOptions.map(option => (
              <option key={option.name} value={option.name}>
                {option.name} — {option.grain}
              </option>
            ))}
          </select>
        </>
      )}

      <button
        type="button"
        aria-label="Remove contribution"
        className="text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
