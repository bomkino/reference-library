export const BRIDGE_VERSION = 3;
export const IPC = Object.freeze({
  createLibrary: "reference-library:create",
  openLibrary: "reference-library:open",
  completeOpenIntent: "reference-library:complete-open-intent",
  closeLibrary: "reference-library:close",
  chooseRoot: "reference-library:choose-root",
  listRoots: "reference-library:list-roots",
  reauthorizeRoot: "reference-library:reauthorize-root",
  scanRoot: "reference-library:scan-root",
  cancelJob: "reference-library:cancel-job",
  queryJobs: "reference-library:query-jobs",
  queryAssets: "reference-library:query-assets",
  getAsset: "reference-library:get-asset",
  updateAsset: "reference-library:update-asset",
  listCollections: "reference-library:list-collections",
  createCollection: "reference-library:create-collection",
  renameCollection: "reference-library:rename-collection",
  deleteCollection: "reference-library:delete-collection",
  setCollectionMembership: "reference-library:set-collection-membership",
  revealLocation: "reference-library:reveal-location",
  readPreferences: "reference-library:read-preferences",
  writePreferences: "reference-library:write-preferences",
  capabilities: "reference-library:capabilities",
  canonicalDump: "reference-library:canonical-dump",
  restartCore: "reference-library:restart-core",
  event: "reference-library:event",
});

const REVIEW_STATES = Object.freeze(["unreviewed", "keep", "maybe", "reject"]);
const AVAILABILITY = Object.freeze(["present", "missing", "needs_permission", "offline_volume", "unreadable", "unavailable"]);
const SORTS = Object.freeze(["created_ascending", "created_descending", "name_ascending", "name_descending", "review_state"]);
const JOB_STATES = Object.freeze(["queued", "running", "cancellation_requested", "cancelled", "completed", "failed"]);

export function assertUuid(value, label) {
  if (typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError(`${label} must be an opaque UUID`);
  }
  return value;
}

export function assertSession(activeSession, sessionId) {
  assertUuid(sessionId, "sessionId");
  if (!activeSession || activeSession.sessionId !== sessionId) throw coreLikeError("SessionClosed");
}

export function assetResourceUrl({ sessionId, assetId, profile }) {
  assertUuid(sessionId, "sessionId");
  assertUuid(assetId, "assetId");
  if (profile !== "grid_standard" && profile !== "preview") throw new TypeError("Unsupported resource profile");
  return `pitchdog-asset://${sessionId}/${assetId}/${profile}`;
}

export function assertAssetQuery(input) {
  assertPage(input, 250);
  assertProjection(input?.projection);
  const query = input?.query;
  if (!query || typeof query !== "object") throw new TypeError("query must be an object");
  if (query.search !== null && (typeof query.search !== "string" || scalarLength(query.search) > 200)) {
    throw new TypeError("search must be null or at most 200 Unicode scalars");
  }
  if (query.rootId !== null) assertUuid(query.rootId, "rootId");
  if (query.collectionId !== null) assertUuid(query.collectionId, "collectionId");
  assertStringSet(query.reviewStates, REVIEW_STATES, "reviewStates");
  assertStringSet(query.availability, AVAILABILITY, "availability");
  if (!SORTS.includes(query.sort)) throw new TypeError("Unknown Asset sort");
  return input;
}

export function assertJobQuery(input) {
  assertPage(input, 100);
  const query = input?.query;
  if (!query || typeof query !== "object") throw new TypeError("query must be an object");
  if (query.rootId !== undefined && query.rootId !== null) assertUuid(query.rootId, "rootId");
  assertStringSet(query.states, JOB_STATES, "states");
  return input;
}

export function assertAssetUpdate(input) {
  assertUuid(input?.sessionId, "sessionId");
  assertUuid(input?.assetId, "assetId");
  if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 0) throw new TypeError("Invalid revision");
  assertTextPatch(input?.patch?.customTitle, "customTitle", 500);
  assertTextPatch(input?.patch?.note, "note", 5_000);
  if (input?.patch?.reviewState !== undefined && !REVIEW_STATES.includes(input.patch.reviewState)) {
    throw new TypeError("Unknown reviewState");
  }
  return input;
}

export function assertCollectionName(name) {
  if (typeof name !== "string") throw new TypeError("Collection name must be text");
  const value = name.trim();
  if (!value || scalarLength(value) > 200) throw new TypeError("Collection name must be between 1 and 200 Unicode scalars");
  return value;
}

export function assertCollectionRename(sessionId, collectionId, expectedRevision, name) {
  assertUuid(sessionId, "sessionId");
  assertUuid(collectionId, "collectionId");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("Invalid revision");
  return { sessionId, collectionId, expectedRevision, name: assertCollectionName(name) };
}

export function assertMembership(input) {
  assertUuid(input?.sessionId, "sessionId");
  assertUuid(input?.collectionId, "collectionId");
  if (!Array.isArray(input?.assetIds) || input.assetIds.length < 1 || input.assetIds.length > 250 ||
      new Set(input.assetIds).size !== input.assetIds.length) throw new TypeError("assetIds must contain 1 to 250 unique IDs");
  input.assetIds.forEach((assetId) => assertUuid(assetId, "assetId"));
  if (typeof input.member !== "boolean") throw new TypeError("member must be boolean");
  return input;
}

export function assertOpenDecision(decision) {
  if (!["save", "discard", "cancel"].includes(decision)) throw new TypeError("Unknown Library open decision");
  return decision;
}

export function assertWorkspacePreferences(preferences) {
  if (!preferences || ![0.8, 1, 1.25, 1.5].includes(preferences.interfaceScale)) throw new TypeError("Unsupported Interface Scale");
  if (!Number.isSafeInteger(preferences.thumbnailDensity) || preferences.thumbnailDensity < 140 || preferences.thumbnailDensity > 340) {
    throw new TypeError("thumbnailDensity must be between 140 and 340");
  }
  if (!Number.isFinite(preferences.previewZoom) || preferences.previewZoom < 0.25 || preferences.previewZoom > 4) {
    throw new TypeError("previewZoom must be between 0.25 and 4");
  }
  return {
    interfaceScale: preferences.interfaceScale,
    thumbnailDensity: preferences.thumbnailDensity,
    previewZoom: preferences.previewZoom,
  };
}

export function assertWorkspacePreferencesPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("Preferences patch must be an object");
  const allowed = new Set(["interfaceScale", "thumbnailDensity", "previewZoom"]);
  if (Object.keys(patch).some((key) => !allowed.has(key))) throw new TypeError("Unknown Preferences field");
  if (patch.interfaceScale !== undefined && ![0.8, 1, 1.25, 1.5].includes(patch.interfaceScale)) {
    throw new TypeError("Unsupported Interface Scale");
  }
  if (patch.thumbnailDensity !== undefined &&
      (!Number.isSafeInteger(patch.thumbnailDensity) || patch.thumbnailDensity < 140 || patch.thumbnailDensity > 340)) {
    throw new TypeError("thumbnailDensity must be between 140 and 340");
  }
  if (patch.previewZoom !== undefined &&
      (!Number.isFinite(patch.previewZoom) || patch.previewZoom < 0.25 || patch.previewZoom > 4)) {
    throw new TypeError("previewZoom must be between 0.25 and 4");
  }
  return { ...patch };
}

function assertPage(input, maximum) {
  assertUuid(input?.sessionId, "sessionId");
  if (!Number.isSafeInteger(input?.offset) || input.offset < 0) throw new TypeError("offset must be a non-negative integer");
  if (!Number.isSafeInteger(input?.limit) || input.limit < 1 || input.limit > maximum) {
    throw new TypeError(`limit must be between 1 and ${maximum}`);
  }
}
function assertProjection(projection) {
  if (!["contact_sheet_tiny", "contact_sheet_standard", "contact_sheet_detailed"].includes(projection)) {
    throw new TypeError("Unknown Asset projection");
  }
}
function assertStringSet(value, allowed, label) {
  if (!Array.isArray(value) || value.length > allowed.length || new Set(value).size !== value.length) {
    throw new TypeError(`${label} must be a set`);
  }
  if (value.some((item) => !allowed.includes(item))) throw new TypeError(`Unknown ${label} value`);
}
function assertTextPatch(value, label, maximum) {
  if (!value || !["unchanged", "clear", "set"].includes(value.action)) throw new TypeError(`${label} patch is invalid`);
  if (value.action === "set") {
    if (typeof value.value !== "string" || scalarLength(value.value) > maximum) throw new TypeError(`${label} patch is invalid`);
  } else if (Object.hasOwn(value, "value")) throw new TypeError(`${label} patch is invalid`);
}
function scalarLength(value) { return [...value].length; }
function coreLikeError(code) { const error = new Error(code); error.code = code; return error; }
