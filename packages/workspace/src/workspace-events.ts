import type { WorkspaceEvent } from "@pitchdog/reference-bridge";

export const EVENT_QUIET_WINDOW_MS = 80;
export const EVENT_MAX_WAIT_MS = 400;

export interface InvalidationBatch {
  assets: boolean;
  roots: boolean;
  collections: boolean;
  detailAssetIds: readonly string[] | null | undefined;
}

export interface WorkspaceInvalidations {
  assets: number;
  roots: number;
  collections: number;
  detail: {
    revision: number;
    assetIds: readonly string[] | null;
  };
}

export function initialWorkspaceInvalidations(): WorkspaceInvalidations {
  return {
    assets: 0,
    roots: 0,
    collections: 0,
    detail: { revision: 0, assetIds: [] },
  };
}

export function applyInvalidationBatch(
  current: WorkspaceInvalidations,
  batch: InvalidationBatch,
): WorkspaceInvalidations {
  return {
    assets: current.assets + Number(batch.assets),
    roots: current.roots + Number(batch.roots),
    collections: current.collections + Number(batch.collections),
    detail: batch.detailAssetIds === undefined
      ? current.detail
      : {
          revision: current.detail.revision + 1,
          assetIds: batch.detailAssetIds,
        },
  };
}

export class WorkspaceEventInvalidator {
  private pendingAssets = false;
  private pendingRoots = false;
  private pendingCollections = false;
  private pendingAllDetails = false;
  private pendingDetailAssetIds = new Set<string>();
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private maximumTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly publish: (batch: InvalidationBatch) => void,
    private readonly quietWindowMs = EVENT_QUIET_WINDOW_MS,
    private readonly maximumWaitMs = EVENT_MAX_WAIT_MS,
  ) {}

  accept(event: WorkspaceEvent): void {
    let urgent = false;
    switch (event.event) {
      case "assets_inserted":
        this.pendingAssets = true;
        break;
      case "scan_progress_changed":
        this.pendingRoots = true;
        if (event.value.terminal) {
          this.pendingAssets = true;
          urgent = true;
        }
        break;
      case "root_state_changed":
        this.pendingRoots = true;
        urgent = event.value.state !== "scanning";
        break;
      case "job_updated":
        this.pendingRoots = true;
        if (["cancelled", "completed", "failed"].includes(event.value.state)) {
          this.pendingAssets = true;
          urgent = true;
        }
        break;
      case "asset_updated":
        this.pendingAssets = true;
        this.pendingDetailAssetIds.add(event.value.assetId);
        urgent = true;
        break;
      case "collections_changed":
        this.pendingAssets = true;
        this.pendingCollections = true;
        this.pendingAllDetails = true;
        urgent = true;
        break;
      default:
        return;
    }

    if (urgent) this.flush();
    else this.schedule();
  }

  reset(): void {
    this.clearTimers();
    this.pendingAssets = false;
    this.pendingRoots = false;
    this.pendingCollections = false;
    this.pendingAllDetails = false;
    this.pendingDetailAssetIds.clear();
  }

  dispose(): void {
    this.reset();
  }

  private schedule(): void {
    if (this.quietTimer !== null) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => this.flush(), this.quietWindowMs);
    if (this.maximumTimer === null) {
      this.maximumTimer = setTimeout(() => this.flush(), this.maximumWaitMs);
    }
  }

  private flush(): void {
    if (!this.hasPending()) return;
    this.clearTimers();
    const detailAssetIds = this.pendingAllDetails
      ? null
      : this.pendingDetailAssetIds.size > 0
        ? [...this.pendingDetailAssetIds].sort()
        : undefined;
    const batch: InvalidationBatch = {
      assets: this.pendingAssets,
      roots: this.pendingRoots,
      collections: this.pendingCollections,
      detailAssetIds,
    };
    this.pendingAssets = false;
    this.pendingRoots = false;
    this.pendingCollections = false;
    this.pendingAllDetails = false;
    this.pendingDetailAssetIds.clear();
    this.publish(batch);
  }

  private hasPending(): boolean {
    return this.pendingAssets || this.pendingRoots || this.pendingCollections ||
      this.pendingAllDetails || this.pendingDetailAssetIds.size > 0;
  }

  private clearTimers(): void {
    if (this.quietTimer !== null) clearTimeout(this.quietTimer);
    if (this.maximumTimer !== null) clearTimeout(this.maximumTimer);
    this.quietTimer = null;
    this.maximumTimer = null;
  }
}
