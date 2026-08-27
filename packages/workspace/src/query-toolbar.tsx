import { useEffect, useState } from "react";
import {
  MAX_SEARCH_SCALARS,
  type AssetQuery,
  type Availability,
  type ReviewState,
  type RootSummary,
} from "@pitchdog/reference-bridge";
import { textLimitError } from "./text-boundaries";

export function QueryToolbar(props: {
  query: AssetQuery;
  roots: RootSummary[];
  disabled?: boolean;
  onChange(query: AssetQuery): void;
}) {
  const [search, setSearch] = useState(props.query.search ?? "");
  useEffect(() => setSearch(props.query.search ?? ""), [props.query.search]);
  const searchError = textLimitError(search, MAX_SEARCH_SCALARS, "Search", true);

  const commitSearch = () => {
    if (searchError) return;
    const normalized = search.trim();
    props.onChange({ ...props.query, search: normalized || null });
  };

  return (
    <form className="query-toolbar" aria-label="Filter and sort Assets" onSubmit={(event) => { event.preventDefault(); commitSearch(); }}>
      <label className="query-toolbar__search">
        Search
        <input
          aria-invalid={Boolean(searchError)}
          aria-describedby={searchError ? "search-limit-error" : undefined}
          disabled={props.disabled}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <button disabled={props.disabled || Boolean(searchError)} type="submit">Apply</button>
      {props.query.search && (
        <button className="button--quiet" disabled={props.disabled} type="button" onClick={() => { setSearch(""); props.onChange({ ...props.query, search: null }); }}>
          Clear
        </button>
      )}
      <label>
        Root
        <select disabled={props.disabled} value={props.query.rootId ?? ""} onChange={(event) => props.onChange({ ...props.query, rootId: event.target.value || null })}>
          <option value="">All</option>
          {props.roots.map((root) => <option key={root.rootId} value={root.rootId}>{root.displayName}</option>)}
        </select>
      </label>
      <label>
        Review
        <select
          disabled={props.disabled}
          value={props.query.reviewStates[0] ?? ""}
          onChange={(event) => props.onChange({ ...props.query, reviewStates: event.target.value ? [event.target.value as ReviewState] : [] })}
        >
          <option value="">All</option>
          <option value="unreviewed">Unreviewed</option>
          <option value="keep">Keep</option>
          <option value="maybe">Maybe</option>
          <option value="reject">Reject</option>
        </select>
      </label>
      <label>
        Availability
        <select
          disabled={props.disabled}
          value={props.query.availability[0] ?? ""}
          onChange={(event) => props.onChange({ ...props.query, availability: event.target.value ? [event.target.value as Availability] : [] })}
        >
          <option value="">All</option>
          <option value="present">Present</option>
          <option value="missing">Missing</option>
          <option value="needs_permission">Needs permission</option>
          <option value="offline_volume">Offline volume</option>
          <option value="unreadable">Unreadable</option>
          <option value="unavailable">Unavailable</option>
          <option value="unsupported">Unsupported (catalogue only)</option>
        </select>
      </label>
      <label>
        Sort
        <select disabled={props.disabled} value={props.query.sort} onChange={(event) => props.onChange({ ...props.query, sort: event.target.value as AssetQuery["sort"] })}>
          <option value="created_ascending">Added, oldest first</option>
          <option value="created_descending">Added, newest first</option>
          <option value="name_ascending">Name, A–Z</option>
          <option value="name_descending">Name, Z–A</option>
          <option value="review_state">Review state</option>
        </select>
      </label>
      {searchError && <p className="field-error" id="search-limit-error" role="alert">{searchError}</p>}
    </form>
  );
}
