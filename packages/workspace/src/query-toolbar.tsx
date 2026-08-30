import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, FunnelSimple, MagnifyingGlass, X } from "@phosphor-icons/react";
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
import { UiIcon } from "./ui-icon";

export function QueryToolbar(props: {
  query: AssetQuery;
  roots: RootSummary[];
  facets: AssetFacets;
  disabled?: boolean;
  onChange(update: (query: AssetQuery) => AssetQuery): void;
}) {
  const [search, setSearch] = useState(props.query.search ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => setSearch(props.query.search ?? ""), [props.query.search]);
  useEffect(() => {
    if (!filtersOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      setFiltersOpen(false);
      requestAnimationFrame(() => filterTrigger.current?.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [filtersOpen]);
  const emitChange = (update: (query: AssetQuery) => AssetQuery) => props.onChange(update);
  const searchError = textLimitError(search, MAX_SEARCH_SCALARS, "Search", true);
  const activeFilters = useMemo(
    () => describeActiveFilters(props.query, props.roots),
    [props.query, props.roots],
  );
  const activeCount = activeFilters.length;

  const commitSearch = () => {
    if (searchError) return;
    const normalized = search.trim();
    emitChange((current) => ({ ...current, search: normalized || null }));
  };

  const clearAll = () => {
    setSearch("");
    emitChange((current) => ({
      ...current,
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
    }));
  };

  return (
    <div className="query-surface">
      <form
        className="query-commandbar"
        aria-label="Search, filter and sort Assets"
        onSubmit={(event) => { event.preventDefault(); commitSearch(); }}
      >
        <label className="query-commandbar__search">
          <span className="visually-hidden">Search Assets</span>
          <input
            aria-invalid={Boolean(searchError)}
            aria-describedby={searchError ? "search-limit-error" : undefined}
            disabled={props.disabled}
            type="search"
            placeholder="Search names, notes, tags, file types…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button disabled={props.disabled || Boolean(searchError)} type="submit"><UiIcon icon={MagnifyingGlass} /><span>Search</span></button>
        <label className="query-commandbar__sort">
          <span className="visually-hidden">Sort Assets</span>
          <select
            aria-label="Sort Assets"
            disabled={props.disabled}
            value={props.query.sort}
            onChange={(event) => { const sort = event.target.value as AssetQuery["sort"]; emitChange((current) => ({ ...current, sort })); }}
          >
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
          ref={filterTrigger}
          className="button--secondary query-commandbar__filters"
          aria-label="Filters"
          aria-expanded={filtersOpen}
          aria-controls="asset-filter-panel"
          disabled={props.disabled}
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <UiIcon icon={FunnelSimple} />
          <span>Filters{activeCount > 0 ? ` · ${activeCount}` : ""}</span>
          <span className="button-caret"><UiIcon icon={CaretDown} /></span>
        </button>
        {searchError && <p className="field-error" id="search-limit-error" role="alert">{searchError}</p>}
      </form>

      {activeCount > 0 && (
        <div className="active-filter-strip" aria-label="Active filters">
          <span className="active-filter-strip__label">Viewing</span>
          <div className="active-filter-strip__chips">
            {activeFilters.map((filter) => (
              <button
                aria-label={`Remove ${filter.label}`}
                className="active-filter-chip"
                disabled={props.disabled}
                key={filter.key}
                title={`Remove ${filter.label}`}
                type="button"
                onClick={() => {
                  if (filter.key === "search") setSearch("");
                  emitChange(filter.clear);
                }}
              >
                <span>{filter.label}</span><UiIcon icon={X} />
              </button>
            ))}
          </div>
          <button className="button--quiet active-filter-strip__clear" disabled={props.disabled} type="button" onClick={clearAll}>Clear all</button>
        </div>
      )}

      <section
        className={`filter-panel${filtersOpen ? " filter-panel--open" : ""}`}
        id="asset-filter-panel"
        aria-labelledby="asset-filter-title"
        aria-hidden={!filtersOpen}
        inert={!filtersOpen}
      >
          <header className="filter-panel__header">
            <div>
              <p className="eyebrow">Refine view</p>
              <h2 id="asset-filter-title">Filters</h2>
            </div>
            <button
              className="button--quiet"
              type="button"
              onClick={() => {
                setFiltersOpen(false);
                requestAnimationFrame(() => filterTrigger.current?.focus());
              }}
            ><UiIcon icon={X} /><span>Close</span></button>
          </header>
          <div className="filter-panel__primary">
            <label>
              <span>Root</span>
              <select aria-label="Root" disabled={props.disabled} value={props.query.rootId ?? ""} onChange={(event) => { const rootId = event.target.value || null; emitChange((current) => ({ ...current, rootId })); }}>
                <option value="">All Roots</option>
                {props.roots.map((root) => <option key={root.rootId} value={root.rootId}>{root.displayName}</option>)}
              </select>
            </label>
            <label>
              <span>Review</span>
              <select
                aria-label="Review"
                disabled={props.disabled}
                value={props.query.reviewStates[0] ?? ""}
                onChange={(event) => { const reviewState = event.target.value as ReviewState | ""; emitChange((current) => ({ ...current, reviewStates: reviewState ? [reviewState] : [] })); }}
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
                aria-label="Source"
                disabled={props.disabled}
                value={props.query.availability[0] ?? ""}
                onChange={(event) => { const availability = event.target.value as Availability | ""; emitChange((current) => ({ ...current, availability: availability ? [availability] : [] })); }}
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
            <FacetRail
              label="Categories"
              items={props.facets.categories}
              selected={props.query.categories}
              disabled={props.disabled}
              onChange={(categories) => emitChange((current) => ({ ...current, categories }))}
            />
            <FacetRail
              label="File types"
              items={props.facets.extensions}
              selected={props.query.extensions}
              prefix="."
              disabled={props.disabled}
              onChange={(extensions) => emitChange((current) => ({ ...current, extensions }))}
            />
            <FacetRail
              label="Media"
              items={props.facets.mediaFamilies}
              selected={props.query.mediaFamilies}
              disabled={props.disabled}
              onChange={(mediaFamilies) => emitChange((current) => ({ ...current, mediaFamilies }))}
            />
            <FacetRail
              label="Tags"
              items={props.facets.tags}
              selected={props.query.tags}
              prefix="#"
              disabled={props.disabled}
              onChange={(tags) => emitChange((current) => ({ ...current, tags }))}
            />
            <FacetRail
              label="Used in"
              items={props.facets.usedIn}
              selected={props.query.usedIn}
              disabled={props.disabled}
              onChange={(usedIn) => emitChange((current) => ({ ...current, usedIn }))}
            />
          </div>
      </section>
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

interface ActiveFilter {
  key: string;
  label: string;
  clear(query: AssetQuery): AssetQuery;
}

function describeActiveFilters(query: AssetQuery, roots: RootSummary[]): ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  if (query.search) filters.push({ key: "search", label: `“${query.search}”`, clear: (current) => ({ ...current, search: null }) });
  if (query.rootId) {
    const name = roots.find((root) => root.rootId === query.rootId)?.displayName ?? "Root";
    filters.push({ key: "root", label: name, clear: (current) => ({ ...current, rootId: null }) });
  }
  if (query.collectionId) filters.push({ key: "collection", label: "Collection", clear: (current) => ({ ...current, collectionId: null }) });
  for (const value of query.reviewStates) filters.push({ key: `review-${value}`, label: reviewLabel(value), clear: (current) => ({ ...current, reviewStates: current.reviewStates.filter((item) => item !== value) }) });
  for (const value of query.availability) filters.push({ key: `availability-${value}`, label: availabilityLabel(value), clear: (current) => ({ ...current, availability: current.availability.filter((item) => item !== value) }) });
  for (const value of query.categories) filters.push({ key: `category-${value}`, label: value, clear: (current) => ({ ...current, categories: current.categories.filter((item) => item !== value) }) });
  for (const value of query.extensions) filters.push({ key: `extension-${value}`, label: `.${value}`, clear: (current) => ({ ...current, extensions: current.extensions.filter((item) => item !== value) }) });
  for (const value of query.mediaFamilies) filters.push({ key: `media-${value}`, label: value, clear: (current) => ({ ...current, mediaFamilies: current.mediaFamilies.filter((item) => item !== value) }) });
  for (const value of query.tags) filters.push({ key: `tag-${value}`, label: `#${value}`, clear: (current) => ({ ...current, tags: current.tags.filter((item) => item !== value) }) });
  for (const value of query.usedIn) filters.push({ key: `used-${value}`, label: `Used in ${value}`, clear: (current) => ({ ...current, usedIn: current.usedIn.filter((item) => item !== value) }) });
  return filters;
}

function reviewLabel(value: ReviewState): string {
  return value === "unreviewed" ? "Unreviewed" : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function availabilityLabel(value: Availability): string {
  const labels: Record<Availability, string> = {
    present: "Present",
    missing: "Missing",
    needs_permission: "Needs permission",
    offline_volume: "Offline volume",
    unreadable: "Unreadable",
    unavailable: "Unavailable",
    unsupported: "Catalogue only",
  };
  return labels[value];
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
