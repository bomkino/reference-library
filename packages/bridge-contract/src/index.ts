export const BRIDGE_VERSION = 1 as const;
export const MAX_ASSET_PAGE_SIZE = 250 as const;

export type InterfaceScale = 0.8 | 1 | 1.25 | 1.5;
export type ResourceProfile = "grid_standard" | "preview";
export type AssetProjection =
  | "contact_sheet_tiny"
  | "contact_sheet_standard"
  | "contact_sheet_detailed";

export interface SessionOpened {
  sessionId: string;
  libraryId: string;
  schemaVersion: number;
  name: string;
}

export interface AssetSummary {
  assetId: string;
  locationId: string;
  displayName: string;
  mediaFamily: string;
  availability: "present" | "missing" | "permission_denied" | "offline_root" | "unreadable";
  reviewState: "unreviewed" | "keep" | "maybe" | "reject";
}

export interface AssetPage {
  offset: number;
  limit: number;
  total: number;
  items: AssetSummary[];
  nextOffset: number | null;
  libraryRevision: number;
}

export interface BridgeCapability {
  name: string;
  state: "required_parity" | "native_equivalent" | "intentionally_absent" | "unavailable";
  reason?: string;
}

export type WorkspaceEvent =
  | { event: "root_state_changed"; value: { rootId: string; state: string } }
  | {
      event: "scan_progress_changed";
      value: { rootId: string; jobId: string; observedCount: number; terminal: boolean };
    }
  | {
      event: "assets_inserted";
      value: { rootId: string; assetIds: string[]; libraryRevision: number };
    }
  | { event: "job_updated"; value: { jobId: string; state: string } }
  | { event: "core_needs_restart"; value: { reason: string } };

export interface ReferenceWorkspaceBridge {
  readonly version: typeof BRIDGE_VERSION;
  createLibrary(name: string): Promise<SessionOpened | null>;
  openLibrary(): Promise<SessionOpened | null>;
  closeLibrary(sessionId: string): Promise<void>;
  chooseRoot(sessionId: string): Promise<{ rootId: string; jobId: string } | null>;
  queryAssets(input: {
    sessionId: string;
    offset: number;
    limit: number;
    projection: AssetProjection;
  }): Promise<AssetPage>;
  assetResourceUrl(input: {
    sessionId: string;
    assetId: string;
    profile: ResourceProfile;
  }): string;
  revealLocation(sessionId: string, locationId: string): Promise<void>;
  queryCapabilities(sessionId?: string): Promise<BridgeCapability[]>;
  canonicalDump(sessionId: string): Promise<unknown>;
  restartCore(): Promise<SessionOpened | null>;
  subscribe(listener: (event: WorkspaceEvent) => void): () => void;
}

declare global {
  interface Window {
    referenceLibrary?: ReferenceWorkspaceBridge;
  }
}
