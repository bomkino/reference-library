export const BRIDGE_VERSION = 4 as const;
export const MAX_ASSET_PAGE_SIZE = 250 as const;
export const MAX_JOB_PAGE_SIZE = 100 as const;
export const MAX_SEARCH_SCALARS = 200 as const;
export const MAX_ASSET_TITLE_SCALARS = 500 as const;
export const MAX_ASSET_NOTE_SCALARS = 5_000 as const;
export const MAX_ASSET_TOKENS = 64 as const;
export const MAX_ASSET_TOKEN_SCALARS = 100 as const;
export const MAX_COLLECTION_NAME_SCALARS = 200 as const;
export const MAX_COLLECTION_MEMBERSHIP_BATCH = 250 as const;
export const MIN_THUMBNAIL_DENSITY = 140 as const;
export const MAX_THUMBNAIL_DENSITY = 340 as const;

export type InterfaceScale = 0.8 | 1 | 1.25 | 1.5;
export type ResourceProfile = "grid_standard" | "preview";
export type AssetProjection = "contact_sheet_tiny" | "contact_sheet_standard" | "contact_sheet_detailed";
export type ReviewState = "unreviewed" | "keep" | "maybe" | "reject";
export type Availability = "present" | "missing" | "needs_permission" | "offline_volume" | "unreadable" | "unavailable" | "unsupported";
export type AssetSort =
  | "created_ascending"
  | "created_descending"
  | "name_ascending"
  | "name_descending"
  | "size_ascending"
  | "size_descending"
  | "review_state";
export type JobState = "queued" | "running" | "cancelled" | "completed" | "failed";

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
  relativeDisplayPath: string;
  mediaFamily: string;
  mimeType: string;
  extension: string | null;
  byteSize: number;
  category: string;
  previewKind: "image" | "video" | "audio" | "pdf" | "font" | "text" | "none";
  availability: Availability;
  reviewState: ReviewState;
  customTitle: string | null;
  tags: string[];
  usedIn: string[];
  previewAssetIds: string[];
  createdAtMs: number;
  revision: number;
}

export interface AssetDetail {
  assetId: string;
  locationId: string;
  originalDisplayName: string;
  relativeDisplayPath: string;
  mediaFamily: string;
  mimeType: string;
  extension: string | null;
  byteSize: number;
  category: string;
  previewKind: AssetSummary["previewKind"];
  availability: Availability;
  reviewState: ReviewState;
  customTitle: string | null;
  note: string | null;
  tags: string[];
  usedIn: string[];
  revision: number;
  collectionIds: string[];
}

export interface AssetQuery {
  search: string | null;
  rootId: string | null;
  reviewStates: ReviewState[];
  availability: Availability[];
  collectionId: string | null;
  categories: string[];
  extensions: string[];
  mediaFamilies: string[];
  tags: string[];
  usedIn: string[];
  sort: AssetSort;
}

export const DEFAULT_ASSET_QUERY: Readonly<AssetQuery> = Object.freeze({
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
  sort: "created_ascending",
});

export interface FacetCount {
  value: string;
  count: number;
}

export interface AssetFacets {
  categories: FacetCount[];
  extensions: FacetCount[];
  mediaFamilies: FacetCount[];
  tags: FacetCount[];
  usedIn: FacetCount[];
}

export interface AssetPage {
  offset: number;
  limit: number;
  total: number;
  items: AssetSummary[];
  nextOffset: number | null;
  libraryRevision: number;
  facets: AssetFacets;
}

export interface RootSummary {
  rootId: string;
  displayName: string;
  rootKind: string;
  state: string;
  authorized: boolean;
  activeJobId: string | null;
  observedCount: number;
  unsupportedCount: number;
}

export interface JobSummary {
  jobId: string;
  rootId: string | null;
  jobKind: string;
  state: JobState;
  observedCount: number;
  unsupportedCount: number;
  errorCode?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  finishedAtMs?: number | null;
}

export interface JobPage {
  offset: number;
  limit: number;
  total: number;
  items: JobSummary[];
  nextOffset: number | null;
}

export interface CollectionSummary {
  collectionId: string;
  name: string;
  assetCount: number;
  revision: number;
}

export type AssetViewMode = "grid" | "compact" | "list";

export interface WorkspacePreferences {
  interfaceScale: InterfaceScale;
  thumbnailDensity: number;
  previewZoom: number;
  viewMode: AssetViewMode;
  multiThumbnailPreviews: boolean;
  autoRescan: boolean;
}

export type TextPatch = { action: "unchanged" } | { action: "clear" } | { action: "set"; value: string };

export type StringListPatch = { action: "unchanged" } | { action: "set"; value: string[] };

export interface AssetPatch {
  customTitle: TextPatch;
  reviewState?: ReviewState;
  note: TextPatch;
  tags: StringListPatch;
  usedIn: StringListPatch;
}

export interface BridgeCapability {
  name: string;
  state: "required_parity" | "native_equivalent" | "intentionally_absent" | "unavailable";
  reason?: string;
}

export type WorkspaceEvent =
  | { event: "library_opened"; value: SessionOpened }
  | { event: "library_open_requested"; value: { intentId: string; displayName: string } }
  | { event: "library_closed"; value: { sessionId: string } }
  | { event: "root_state_changed"; value: { rootId: string; state: string } }
  | { event: "scan_progress_changed"; value: { rootId: string; jobId: string; observedCount: number; unsupportedCount: number; terminal: boolean } }
  | { event: "assets_inserted"; value: { rootId: string; assetIds: string[]; libraryRevision: number } }
  | { event: "asset_updated"; value: { assetId: string; libraryRevision: number } }
  | { event: "collections_changed"; value: { libraryRevision: number } }
  | { event: "job_updated"; value: { jobId: string; state: JobState } }
  | { event: "resource_authorization_started"; value: { requestId: string; jobId: string; assetId: string; profile: ResourceProfile } }
  | { event: "core_needs_restart"; value: { reason: string } };

export interface ReferenceWorkspaceBridge {
  readonly version: typeof BRIDGE_VERSION;
  createLibrary(name: string): Promise<SessionOpened | null>;
  openLibrary(): Promise<SessionOpened | null>;
  completeOpenIntent(intentId: string, decision: "save" | "discard" | "cancel"): Promise<SessionOpened | null>;
  readPreferences(): Promise<WorkspacePreferences>;
  writePreferences(patch: Partial<WorkspacePreferences>): Promise<WorkspacePreferences>;
  closeLibrary(sessionId: string): Promise<void>;
  chooseRoot(sessionId: string): Promise<{ session: SessionOpened; rootId: string; jobId: string } | null>;
  listRoots(sessionId: string): Promise<RootSummary[]>;
  reauthorizeRoot(sessionId: string, rootId: string): Promise<{ session: SessionOpened; root: RootSummary } | null>;
  scanRoot(sessionId: string, rootId: string): Promise<{ rootId: string; jobId: string }>;
  cancelJob(sessionId: string, jobId: string): Promise<void>;
  queryJobs(input: { sessionId: string; offset: number; limit: number; query: { rootId?: string; states: JobState[] } }): Promise<JobPage>;
  queryAssets(input: { sessionId: string; offset: number; limit: number; projection: AssetProjection; query: AssetQuery; expectedLibraryRevision?: number | null }): Promise<AssetPage>;
  getAsset(sessionId: string, assetId: string): Promise<AssetDetail>;
  updateAsset(input: { sessionId: string; assetId: string; expectedRevision: number; patch: AssetPatch }): Promise<{ asset: AssetDetail; libraryRevision: number }>;
  listCollections(sessionId: string): Promise<CollectionSummary[]>;
  createCollection(sessionId: string, name: string): Promise<CollectionSummary>;
  renameCollection(sessionId: string, collectionId: string, expectedRevision: number, name: string): Promise<CollectionSummary>;
  deleteCollection(sessionId: string, collectionId: string): Promise<void>;
  setCollectionMembership(input: { sessionId: string; collectionId: string; assetIds: string[]; member: boolean }): Promise<{ collectionId: string; affected: number; libraryRevision: number }>;
  assetResourceUrl(input: { sessionId: string; assetId: string; profile: ResourceProfile }): string;
  revealLocation(sessionId: string, locationId: string): Promise<void>;
  openLocation(sessionId: string, locationId: string): Promise<void>;
  copyLocationPath(sessionId: string, locationId: string): Promise<void>;
  queryCapabilities(sessionId?: string): Promise<BridgeCapability[]>;
  restartCore(): Promise<SessionOpened | null>;
  subscribe(listener: (event: WorkspaceEvent) => void): () => void;
}

export function unicodeScalarLength(value: string): number {
  return [...value].length;
}

declare global {
  interface Window {
    referenceLibrary?: ReferenceWorkspaceBridge;
  }
}
