import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssetPage,
  AssetSummary,
  ReferenceWorkspaceBridge,
} from "@pitchdog/reference-bridge";

const PAGE_SIZE = 100;

export interface AssetPager {
  total: number;
  items: ReadonlyMap<number, AssetSummary>;
  loading: boolean;
  error: string | null;
  ensureWindow(startIndex: number, endIndexExclusive: number): void;
  refresh(): void;
}

export function useAssetPager(
  bridge: ReferenceWorkspaceBridge,
  sessionId: string,
  eventPulse: number,
): AssetPager {
  const [items, setItems] = useState<ReadonlyMap<number, AssetSummary>>(new Map());
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(new Map<number, Promise<void>>());
  const generation = useRef(0);

  const loadPage = useCallback(
    (offset: number, replace = false): Promise<void> => {
      const normalizedOffset = Math.max(0, Math.floor(offset / PAGE_SIZE) * PAGE_SIZE);
      const existing = inFlight.current.get(normalizedOffset);
      if (existing) return existing;
      const currentGeneration = generation.current;
      const request = bridge
        .queryAssets({
          sessionId,
          offset: normalizedOffset,
          limit: PAGE_SIZE,
          projection: "contact_sheet_standard",
        })
        .then((page: AssetPage) => {
          if (currentGeneration !== generation.current) return;
          setTotal(page.total);
          setItems((current) => {
            const next = replace ? new Map<number, AssetSummary>() : new Map(current);
            page.items.forEach((item, index) => next.set(page.offset + index, item));
            return next;
          });
          setError(null);
        })
        .catch((reason: unknown) => {
          if (currentGeneration === generation.current) {
            setError(reason instanceof Error ? reason.message : "Library query failed");
          }
        })
        .finally(() => {
          if (inFlight.current.get(normalizedOffset) === request) {
            inFlight.current.delete(normalizedOffset);
          }
          if (currentGeneration === generation.current) setLoading(false);
        });
      inFlight.current.set(normalizedOffset, request);
      return request;
    },
    [bridge, sessionId],
  );

  const ensureWindow = useCallback(
    (startIndex: number, endIndexExclusive: number) => {
      const firstPage = Math.floor(Math.max(0, startIndex) / PAGE_SIZE) * PAGE_SIZE;
      const finalIndex = Math.max(startIndex, endIndexExclusive - 1);
      const lastPage = Math.floor(finalIndex / PAGE_SIZE) * PAGE_SIZE;
      for (let offset = firstPage; offset <= lastPage; offset += PAGE_SIZE) {
        void loadPage(offset);
      }
    },
    [loadPage],
  );

  const refresh = useCallback(() => {
    generation.current += 1;
    inFlight.current.clear();
    setLoading(true);
    void loadPage(0, true);
  }, [loadPage]);

  useEffect(() => {
    generation.current += 1;
    inFlight.current.clear();
    setItems(new Map());
    setTotal(0);
    setLoading(true);
    setError(null);
    void loadPage(0, true);
  }, [loadPage]);

  useEffect(() => {
    if (eventPulse > 0) refresh();
  }, [eventPulse, refresh]);

  return { total, items, loading, error, ensureWindow, refresh };
}
