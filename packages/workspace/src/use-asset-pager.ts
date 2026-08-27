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
  invalidationRevision: number,
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
  const snapshotRevision = useRef<number | null>(null);

  const loadPage = useCallback(
    function requestPage(offset: number, replace = false): Promise<void> {
      const normalizedOffset = Math.max(0, Math.floor(offset / PAGE_SIZE) * PAGE_SIZE);
      pageAccess.current.set(normalizedOffset, ++accessSequence.current);
      if (!replace && loadedPages.current.has(normalizedOffset)) return Promise.resolve();
      const existing = inFlight.current.get(normalizedOffset);
      if (existing) return existing;
      const currentGeneration = generation.current;
      if (normalizedOffset > 0 && snapshotRevision.current === null) {
        return requestPage(0, true).then(() => {
          if (currentGeneration !== generation.current) return;
          return requestPage(normalizedOffset, replace);
        });
      }
      const expectedLibraryRevision = normalizedOffset === 0 ? null : snapshotRevision.current;
      const restartSnapshot = () => {
        if (currentGeneration !== generation.current) return;
        generation.current += 1;
        const restartedGeneration = generation.current;
        inFlight.current.clear();
        pageAccess.current.clear();
        loadedPages.current.clear();
        snapshotRevision.current = null;
        setItems(new Map());
        setTotal(0);
        setLoading(true);
        setError(null);
        queueMicrotask(() => {
          if (restartedGeneration === generation.current) void requestPage(0, true);
        });
      };
      const request = bridge
        .queryAssets({ sessionId, offset: normalizedOffset, limit: PAGE_SIZE, projection: "contact_sheet_standard", query, expectedLibraryRevision })
        .then((page: AssetPage) => {
          if (currentGeneration !== generation.current) return;
          if (normalizedOffset === 0) snapshotRevision.current = page.libraryRevision;
          else if (page.libraryRevision !== expectedLibraryRevision) {
            restartSnapshot();
            return;
          }
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
          if (isQuerySnapshotChanged(reason)) restartSnapshot();
          else if (currentGeneration === generation.current) setError(messageFrom(reason));
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
    snapshotRevision.current = null;
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
    snapshotRevision.current = null;
    setItems(new Map());
    setTotal(0);
    setLoading(true);
    setError(null);
    void loadPage(0, true);
    return () => {
      generation.current += 1;
      inFlight.current.clear();
    };
  }, [loadPage]);

  useEffect(() => {
    if (invalidationRevision > 0) refresh();
  }, [invalidationRevision, refresh]);

  return { total, items, loading, error, ensureWindow, refresh, refreshSummary };
}

function messageFrom(reason: unknown): string {
  return safeErrorMessage(reason, "Library query failed.");
}

export const PAGE_CACHE_LIMIT = MAX_CACHED_PAGES;

export function isQuerySnapshotChanged(reason: unknown): boolean {
  return Boolean(reason && typeof reason === "object" && "code" in reason &&
    (reason as { code?: unknown }).code === "QuerySnapshotChanged");
}

export function retainedPageOffsets(access: ReadonlyMap<number, number>, maximum: number): number[] {
  return [...access.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, Math.max(0, maximum))
    .map(([pageOffset]) => pageOffset);
}
