import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetDetail, AssetPage, AssetQuery, AssetSummary, ReferenceWorkspaceBridge } from "@pitchdog/reference-bridge";
import { safeErrorMessage } from "./safe-errors";

const PAGE_SIZE = 100;
const MAX_CACHED_PAGES = 8;

export interface AssetPager {
  total: number;
  items: ReadonlyMap<number, AssetSummary>;
  loading: boolean;
  error: string | null;
  ensureWindow(startIndex: number, endIndexExclusive: number): void;
  refresh(): void;
  refreshSummary(detail: AssetDetail): void;
}

export function useAssetPager(
  bridge: ReferenceWorkspaceBridge,
  sessionId: string,
  query: AssetQuery,
  eventPulse: number,
): AssetPager {
  const [items, setItems] = useState<ReadonlyMap<number, AssetSummary>>(new Map());
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(new Map<number, Promise<void>>());
  const pageAccess = useRef(new Map<number, number>());
  const loadedPages = useRef(new Set<number>());
  const generation = useRef(0);
  const accessSequence = useRef(0);

  const loadPage = useCallback(
    (offset: number, replace = false): Promise<void> => {
      const normalizedOffset = Math.max(0, Math.floor(offset / PAGE_SIZE) * PAGE_SIZE);
      pageAccess.current.set(normalizedOffset, ++accessSequence.current);
      if (!replace && loadedPages.current.has(normalizedOffset)) return Promise.resolve();
      const existing = inFlight.current.get(normalizedOffset);
      if (existing) return existing;
      const currentGeneration = generation.current;
      const request = bridge
        .queryAssets({ sessionId, offset: normalizedOffset, limit: PAGE_SIZE, projection: "contact_sheet_standard", query })
        .then((page: AssetPage) => {
          if (currentGeneration !== generation.current) return;
          setTotal(page.total);
          if (replace) loadedPages.current.clear();
          loadedPages.current.add(normalizedOffset);
          setItems((current) => {
            const next = replace ? new Map<number, AssetSummary>() : new Map(current);
            page.items.forEach((item, index) => next.set(page.offset + index, item));
            const retained = new Set(retainedPageOffsets(pageAccess.current, MAX_CACHED_PAGES));
            for (const pageOffset of pageAccess.current.keys()) {
              if (!retained.has(pageOffset)) pageAccess.current.delete(pageOffset);
            }
            for (const pageOffset of loadedPages.current) {
              if (!retained.has(pageOffset)) loadedPages.current.delete(pageOffset);
            }
            for (const index of next.keys()) {
              if (!retained.has(Math.floor(index / PAGE_SIZE) * PAGE_SIZE)) next.delete(index);
            }
            return next;
          });
          setError(null);
        })
        .catch((reason: unknown) => {
          if (currentGeneration === generation.current) setError(messageFrom(reason));
        })
        .finally(() => {
          if (inFlight.current.get(normalizedOffset) === request) inFlight.current.delete(normalizedOffset);
          if (currentGeneration === generation.current) setLoading(false);
        });
      inFlight.current.set(normalizedOffset, request);
      return request;
    },
    [bridge, query, sessionId],
  );

  const ensureWindow = useCallback((startIndex: number, endIndexExclusive: number) => {
    const firstPage = Math.floor(Math.max(0, startIndex) / PAGE_SIZE) * PAGE_SIZE;
    const finalIndex = Math.max(startIndex, endIndexExclusive - 1);
    const lastPage = Math.floor(finalIndex / PAGE_SIZE) * PAGE_SIZE;
    for (let offset = firstPage; offset <= lastPage; offset += PAGE_SIZE) void loadPage(offset);
  }, [loadPage]);

  const refresh = useCallback(() => {
    generation.current += 1;
    inFlight.current.clear();
    pageAccess.current.clear();
    loadedPages.current.clear();
    setLoading(true);
    void loadPage(0, true);
  }, [loadPage]);

  const refreshSummary = useCallback((detail: AssetDetail) => {
    setItems((current) => {
      const next = new Map(current);
      for (const [index, item] of next) {
        if (item.assetId !== detail.assetId) continue;
        next.set(index, {
          ...item,
          displayName: detail.customTitle ?? detail.originalDisplayName,
          relativeDisplayPath: detail.relativeDisplayPath,
          availability: detail.availability,
          reviewState: detail.reviewState,
          customTitle: detail.customTitle,
          revision: detail.revision,
        });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    generation.current += 1;
    inFlight.current.clear();
    pageAccess.current.clear();
    loadedPages.current.clear();
    setItems(new Map());
    setTotal(0);
    setLoading(true);
    setError(null);
    void loadPage(0, true);
  }, [loadPage]);

  useEffect(() => {
    if (eventPulse > 0) refresh();
  }, [eventPulse, refresh]);

  return { total, items, loading, error, ensureWindow, refresh, refreshSummary };
}

function messageFrom(reason: unknown): string {
  return safeErrorMessage(reason, "Library query failed.");
}

export const PAGE_CACHE_LIMIT = MAX_CACHED_PAGES;

export function retainedPageOffsets(access: ReadonlyMap<number, number>, maximum: number): number[] {
  return [...access.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, Math.max(0, maximum))
    .map(([pageOffset]) => pageOffset);
}
