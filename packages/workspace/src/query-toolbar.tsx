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
  useEffect(() => setSearch(props.query.search ?? ""), [props.query.search]);
  const searchError = textLimitError(search, MAX_SEARCH_SCALARS, "Search", true);
  const activeCount = useMemo(() => countActiveFilters(props.query), [props.query]);

  const commitSearch = () => {
    if (searchError) return;
    const normalized = search.trim();
    props.onChange({ ...props.query, search: normalized || null });
  };

  const clearAll = () => {
    setSearch("");
    props.onChange({
      ...props.query,
      search: null,
      rootId: null,
      reviewStates: [],
      availability: [],
      collectionId: null,
      categories: [],
      extensions: [],
      mediaFamilies: [],
      tags: [],
      usedIn: [],
    });
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
        <button disabled={props.disabled || Boolean(searchError)} type="submit">Search</button>
        <label>
          <span>Root</span>
          <select disabled={props.disabled} value={props.query.rootId ?? ""} onChange={(event) => props.onChange({ ...props.query, rootId: event.target.value || null })}>
            <option value="">All Roots</option>
            {props.roots.map((root) => <option key={root.rootId} value={root.rootId}>{root.displayName}</option>)}
          </select>
        </label>
        <label>
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
        <label>
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
        {activeCount > 0 && (
          <button className="button--quiet query-toolbar__clear" disabled={props.disabled} type="button" onClick={clearAll}>
            Clear {activeCount} {activeCount === 1 ? "filter" : "filters"}
          </button>
        )}
        {searchError && <p className="field-error" id="search-limit-error" role="alert">{searchError}</p>}
      </form>

      <div className="facet-rails" aria-label="Library facets">
        <FacetRail
          label="Categories"
          items={props.facets.categories}
          selected={props.query.categories}
          disabled={props.disabled}
          onChange={(categories) => props.onChange({ ...props.query, categories })}
        />
        <FacetRail
          label="File types"
          items={props.facets.extensions}
          selected={props.query.extensions}
          prefix="."
          disabled={props.disabled}
          onChange={(extensions) => props.onChange({ ...props.query, extensions })}
        />
        <FacetRail
          label="Media"
          items={props.facets.mediaFamilies}
          selected={props.query.mediaFamilies}
          disabled={props.disabled}
          onChange={(mediaFamilies) => props.onChange({ ...props.query, mediaFamilies })}
        />
        <FacetRail
          label="Tags"
          items={props.facets.tags}
          selected={props.query.tags}
          prefix="#"
          disabled={props.disabled}
          onChange={(tags) => props.onChange({ ...props.query, tags })}
        />
        <FacetRail
          label="Used in"
          items={props.facets.usedIn}
          selected={props.query.usedIn}
          disabled={props.disabled}
          onChange={(usedIn) => props.onChange({ ...props.query, usedIn })}
        />
      </div>
    </div>
  );
}

function FacetRail(props: {
  label: string;
  items: FacetCount[];
  selected: string[];
  prefix?: string;
  disabled?: boolean;
  onChange(values: string[]): void;
}) {
  if (props.items.length === 0 && props.selected.length === 0) return null;
  const available = new Map(props.items.map((item) => [item.value, item]));
  for (const value of props.selected) {
    if (!available.has(value)) available.set(value, { value, count: 0 });
  }
  return (
    <section className="facet-rail" aria-label={props.label}>
      <h3>{props.label}</h3>
      <div className="facet-rail__scroller">
        {[...available.values()].map((item) => {
          const selected = props.selected.includes(item.value);
          return (
            <button
              className="facet-chip"
              aria-pressed={selected}
              disabled={props.disabled}
              key={item.value}
              type="button"
              onClick={() => props.onChange(toggleValue(props.selected, item.value))}
            >
              <span>{props.prefix}{item.value}</span>
              <small>{item.count}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function countActiveFilters(query: AssetQuery): number {
  return Number(Boolean(query.search)) +
    Number(Boolean(query.rootId)) +
    Number(Boolean(query.collectionId)) +
    query.reviewStates.length +
    query.availability.length +
    query.categories.length +
    query.extensions.length +
    query.mediaFamilies.length +
    query.tags.length +
    query.usedIn.length;
}
