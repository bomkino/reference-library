import { useEffect, useMemo, useState } from "react";
import {
  MAX_SEARCH_SCALARS,
  type AssetFacets,
  type AssetQuery,
  type Availability,
  type FacetCount,
  type ReviewState,
  type RootSummary,
} from "@pitchdog/reference-bridge";
import { textLimitError } from "./text-boundaries";

export function QueryToolbar(props: {
  query: AssetQuery;
  roots: RootSummary[];
  facets: AssetFacets;
  disabled?: boolean;
  onChange(query: AssetQuery): void;
}) {
  const [search, setSearch] = useState(props.query.search ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => setSearch(props.query.search ?? ""), [props.query.search]);
  const searchError = textLimitError(search, MAX_SEARCH_SCALARS, "Search", true);
  const activeCount = useMemo(() => countActiveFilters(props.query), [props.query]);
  const advancedCount = useMemo(() => countAdvancedFilters(props.query), [props.query]);

  const commitSearch = () => {
    if (searchError) return;
    const normalized = search.trim();
    props.onChange({ ...props.query, search: normalized || null });
  };

  const clearAll = () => {
    setSearch("");
    props.onChange(clearQuery(props.query));
  };

  return (
    <div className="query-surface">
      <form
        className="query-toolbar"
        aria-label="Search, filter and sort Assets"
        onSubmit={(event) => { event.preventDefault(); commitSearch(); }}
      >
        <label className="query-toolbar__search">
          <span>Search</span>
          <input
            aria-invalid={Boolean(searchError)}
            aria-describedby={searchError ? "search-limit-error" : undefined}
            disabled={props.disabled}
            type="search"
            placeholder="Names, notes, tags, file types…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button className="query-toolbar__submit" disabled={props.disabled || Boolean(searchError)} type="submit">Search</button>
        <label className="query-toolbar__review">
          <span>Review</span>
          <select
            disabled={props.disabled}
            value={props.query.reviewStates[0] ?? ""}
            onChange={(event) => props.onChange({ ...props.query, reviewStates: event.target.value ? [event.target.value as ReviewState] : [] })}
          >
            <option value="">All states</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="keep">Keep</option>
            <option value="maybe">Maybe</option>
            <option value="reject">Reject</option>
          </select>
        </label>
        <label className="query-toolbar__sort">
          <span>Sort</span>
          <select disabled={props.disabled} value={props.query.sort} onChange={(event) => props.onChange({ ...props.query, sort: event.target.value as AssetQuery["sort"] })}>
            <option value="created_descending">Newest first</option>
            <option value="created_ascending">Oldest first</option>
            <option value="name_ascending">Name, A–Z</option>
            <option value="name_descending">Name, Z–A</option>
            <option value="size_descending">Largest first</option>
            <option value="size_ascending">Smallest first</option>
            <option value="review_state">Review state</option>
          </select>
        </label>
        <button
          className="button--secondary query-toolbar__filters"
          aria-expanded={filtersOpen}
          aria-controls="advanced-filters"
          disabled={props.disabled}
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filters{advancedCount > 0 ? ` · ${advancedCount}` : ""}
        </button>
        {activeCount > 0 && (
          <button className="button--quiet query-toolbar__clear" disabled={props.disabled} type="button" onClick={clearAll}>
            Clear all
          </button>
        )}
        {searchError && <p className="field-error" id="search-limit-error" role="alert">{searchError}</p>}
      </form>

      <ActiveFilters query={props.query} disabled={props.disabled} onChange={props.onChange} />

      <div className={`query-drawer${filtersOpen ? " query-drawer--open" : ""}`} id="advanced-filters" aria-hidden={!filtersOpen}>
        <div className="query-drawer__selects">
          <label>
            <span>Root</span>
            <select disabled={props.disabled} value={props.query.rootId ?? ""} onChange={(event) => props.onChange({ ...props.query, rootId: event.target.value || null })}>
              <option value="">All Roots</option>
              {props.roots.map((root) => <option key={root.rootId} value={root.rootId}>{root.displayName}</option>)}
            </select>
          </label>
          <label>
            <span>Source</span>
            <select
              disabled={props.disabled}
              value={props.query.availability[0] ?? ""}
              onChange={(event) => props.onChange({ ...props.query, availability: event.target.value ? [event.target.value as Availability] : [] })}
            >
              <option value="">Any availability</option>
              <option value="present">Present</option>
              <option value="missing">Missing</option>
              <option value="needs_permission">Needs permission</option>
              <option value="offline_volume">Offline volume</option>
              <option value="unreadable">Unreadable</option>
              <option value="unavailable">Unavailable</option>
              <option value="unsupported">Catalogue only</option>
            </select>
          </label>
        </div>
        <div className="facet-rails" aria-label="Library facets">
          <FacetRail label="Categories" items={props.facets.categories} selected={props.query.categories} disabled={props.disabled} onChange={(categories) => props.onChange({ ...props.query, categories })} />
          <FacetRail label="File types" items={props.facets.extensions} selected={props.query.extensions} prefix="." disabled={props.disabled} onChange={(extensions) => props.onChange({ ...props.query, extensions })} />
          <FacetRail label="Media" items={props.facets.mediaFamilies} selected={props.query.mediaFamilies} disabled={props.disabled} onChange={(mediaFamilies) => props.onChange({ ...props.query, mediaFamilies })} />
          <FacetRail label="Tags" items={props.facets.tags} selected={props.query.tags} prefix="#" disabled={props.disabled} onChange={(tags) => props.onChange({ ...props.query, tags })} />
          <FacetRail label="Used in" items={props.facets.usedIn} selected={props.query.usedIn} disabled={props.disabled} onChange={(usedIn) => props.onChange({ ...props.query, usedIn })} />
        </div>
      </div>
    </div>
  );
}

function ActiveFilters(props: { query: AssetQuery; disabled?: boolean; onChange(query: AssetQuery): void }) {
  const filters = [
    ...(props.query.rootId ? [{ key: "root", label: "One Root", remove: () => props.onChange({ ...props.query, rootId: null }) }] : []),
    ...props.query.reviewStates.map((value) => ({ key: `review-${value}`, label: value, remove: () => props.onChange({ ...props.query, reviewStates: props.query.reviewStates.filter((item) => item !== value) }) })),
    ...props.query.availability.map((value) => ({ key: `availability-${value}`, label: availabilityLabel(value), remove: () => props.onChange({ ...props.query, availability: props.query.availability.filter((item) => item !== value) }) })),
    ...props.query.categories.map((value) => ({ key: `category-${value}`, label: value, remove: () => props.onChange({ ...props.query, categories: props.query.categories.filter((item) => item !== value) }) })),
    ...props.query.extensions.map((value) => ({ key: `extension-${value}`, label: `.${value}`, remove: () => props.onChange({ ...props.query, extensions: props.query.extensions.filter((item) => item !== value) }) })),
    ...props.query.mediaFamilies.map((value) => ({ key: `media-${value}`, label: value, remove: () => props.onChange({ ...props.query, mediaFamilies: props.query.mediaFamilies.filter((item) => item !== value) }) })),
    ...props.query.tags.map((value) => ({ key: `tag-${value}`, label: `#${value}`, remove: () => props.onChange({ ...props.query, tags: props.query.tags.filter((item) => item !== value) }) })),
    ...props.query.usedIn.map((value) => ({ key: `used-${value}`, label: `Used in ${value}`, remove: () => props.onChange({ ...props.query, usedIn: props.query.usedIn.filter((item) => item !== value) }) })),
    ...(props.query.collectionId ? [{ key: "collection", label: "Collection", remove: () => props.onChange({ ...props.query, collectionId: null }) }] : []),
  ];
  if (filters.length === 0) return null;
  return (
    <div className="active-filter-row" aria-label="Active filters">
      {filters.map((filter) => (
        <button className="active-filter-chip" disabled={props.disabled} key={filter.key} type="button" onClick={filter.remove}>
          {filter.label}<span aria-hidden>×</span>
        </button>
      ))}
    </div>
  );
}

function FacetRail(props: { label: string; items: FacetCount[]; selected: string[]; prefix?: string; disabled?: boolean; onChange(values: string[]): void }) {
  if (props.items.length === 0 && props.selected.length === 0) return null;
  const available = new Map(props.items.map((item) => [item.value, item]));
  for (const value of props.selected) if (!available.has(value)) available.set(value, { value, count: 0 });
  return (
    <section className="facet-rail" aria-label={props.label}>
      <h3>{props.label}</h3>
      <div className="facet-rail__scroller">
        {[...available.values()].map((item) => {
          const selected = props.selected.includes(item.value);
          return <button className="facet-chip" aria-pressed={selected} disabled={props.disabled} key={item.value} type="button" onClick={() => props.onChange(toggleValue(props.selected, item.value))}><span>{props.prefix}{item.value}</span><small>{item.count}</small></button>;
        })}
      </div>
    </section>
  );
}

function clearQuery(query: AssetQuery): AssetQuery {
  return { ...query, search: null, rootId: null, reviewStates: [], availability: [], collectionId: null, categories: [], extensions: [], mediaFamilies: [], tags: [], usedIn: [] };
}
function toggleValue(values: string[], value: string): string[] { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }
function countActiveFilters(query: AssetQuery): number { return Number(Boolean(query.search)) + countAdvancedFilters(query) + query.reviewStates.length; }
function countAdvancedFilters(query: AssetQuery): number { return Number(Boolean(query.rootId)) + Number(Boolean(query.collectionId)) + query.availability.length + query.categories.length + query.extensions.length + query.mediaFamilies.length + query.tags.length + query.usedIn.length; }
function availabilityLabel(value: Availability): string { return ({ needs_permission: "Needs permission", offline_volume: "Offline volume", unreadable: "Unreadable", unsupported: "Catalogue only" } as Partial<Record<Availability, string>>)[value] ?? value; }
