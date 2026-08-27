const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_STATES = new Set(["queued", "running", "completed", "failed", "cancelled"]);
const REVIEW_STATES = new Set(["unreviewed", "keep", "maybe", "reject"]);
const AVAILABILITY = new Set(["present", "missing", "needs_permission", "offline_volume", "unreadable", "unavailable"]);
const PROFILES = new Set(["grid_standard", "preview"]);
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CANCELLATION_STATES = new Set(["cancellation_requested", "already_terminal", "unknown_job"]);

const EXPECTED_RESULTS = Object.freeze({
  hello: "hello", create_library: "session_opened", open_library: "session_opened",
  close_library: "library_closed", add_root: "root_added", list_roots: "roots",
  bind_root: "root_bound", scan_root: "root_scan_started", query_assets: "asset_page",
  query_asset_index: "asset_page", get_asset: "asset", update_asset: "asset_updated",
  update_asset_review: "asset_updated", update_asset_title: "asset_updated",
  update_asset_note: "asset_updated", query_jobs: "job_page", list_collections: "collections",
  create_collection: "collection_updated", rename_collection: "collection_updated",
  delete_collection: "collection_deleted", set_collection_membership: "collection_membership_updated",
  authorize_resource: "resource_authorized", resolve_location: "location_resolved",
  canonical_dump: "canonical_dump", canonical_digest: "canonical_digest",
  canonical_page: "canonical_page", get_capabilities: "capabilities",
  cancel_job: "job_cancellation", shutdown: "shutdown",
});

export function validateCoreResult(method, result) {
  record(result, "result");
  const expected = EXPECTED_RESULTS[method];
  if (!expected || result.result !== expected) fail("unexpected command result");
  const value = result.value;
  switch (expected) {
    case "hello":
      record(value); exact(value, ["protocolVersion", "coreVersion", "maxPageSize", "features"]);
      integer(value.protocolVersion, 1, 1); text(value.coreVersion, 120);
      integer(value.maxPageSize, 1, 250); stringArray(value.features, 64, 120); break;
    case "session_opened": session(value); break;
    case "library_closed": record(value); exact(value, ["sessionId"]); uuid(value.sessionId); break;
    case "root_added": case "root_scan_started":
      record(value); exact(value, ["rootId", "jobId"]); uuid(value.rootId); uuid(value.jobId); break;
    case "roots":
      record(value); exact(value, ["items"]); array(value.items, 10_000).forEach(rootSummary); break;
    case "root_bound": record(value); exact(value, ["root"]); rootSummary(value.root); break;
    case "asset_page": assetPage(value, method === "query_asset_index"); break;
    case "asset": assetDetail(value); break;
    case "asset_updated":
      record(value); exact(value, ["asset", "libraryRevision"]); assetDetail(value.asset); count(value.libraryRevision); break;
    case "job_page": jobPage(value); break;
    case "collections":
      record(value); exact(value, ["items"]); array(value.items, 10_000).forEach(collectionSummary); break;
    case "collection_updated":
      record(value); exact(value, ["collection", "libraryRevision"]); collectionSummary(value.collection); count(value.libraryRevision); break;
    case "collection_deleted":
      record(value); exact(value, ["collectionId", "libraryRevision"]); uuid(value.collectionId); count(value.libraryRevision); break;
    case "collection_membership_updated":
      record(value); exact(value, ["collectionId", "affected", "libraryRevision"]);
      uuid(value.collectionId); count(value.affected); count(value.libraryRevision); break;
    case "resource_authorized": resourceDescriptor(value); break;
    case "location_resolved":
      record(value); exact(value, ["locationId", "nativePathForShell"]);
      uuid(value.locationId); nativePath(value.nativePathForShell); break;
    case "canonical_dump": record(value); exact(value, ["dump"]); break;
    case "canonical_digest": canonicalDigest(value); break;
    case "canonical_page": canonicalPage(value); break;
    case "capabilities": capabilities(value); break;
    case "job_cancellation":
      record(value); exact(value, ["jobId", "state"]); uuid(value.jobId); member(value.state, CANCELLATION_STATES); break;
    case "shutdown": if (value !== undefined) fail("invalid shutdown result"); break;
    default: fail("unsupported command result");
  }
  return result;
}

export function validateCoreEvent(event) {
  record(event, "event");
  text(event.event, 80);
  const value = event.value;
  record(value, "event value");
  switch (event.event) {
    case "root_state_changed":
      exact(value, ["rootId", "state"]); uuid(value.rootId); text(value.state, 80); break;
    case "scan_progress_changed":
      // Protocol v1 originally omitted this monotonic counter. Normalize that
      // additive field so retained T01 Libraries still report honest zero.
      if (value.unsupportedCount === undefined) value.unsupportedCount = 0;
      exact(value, ["rootId", "jobId", "observedCount", "unsupportedCount", "terminal"]);
      uuid(value.rootId); uuid(value.jobId); count(value.observedCount); count(value.unsupportedCount);
      boolean(value.terminal); break;
    case "assets_inserted":
      exact(value, ["rootId", "assetIds", "libraryRevision"]); uuid(value.rootId);
      array(value.assetIds, 250).forEach(uuid); count(value.libraryRevision); break;
    case "job_updated":
      exact(value, ["jobId", "state"]); uuid(value.jobId); member(value.state, JOB_STATES); break;
    case "resource_authorization_started":
      exact(value, ["requestId", "jobId", "assetId", "profile"]);
      uuid(value.requestId); uuid(value.jobId); uuid(value.assetId); member(value.profile, PROFILES); break;
    case "asset_updated":
      exact(value, ["assetId", "revision", "libraryRevision"]); uuid(value.assetId);
      count(value.revision); count(value.libraryRevision); break;
    case "collections_changed":
      exact(value, ["collectionId", "libraryRevision"]); uuid(value.collectionId); count(value.libraryRevision); break;
    case "core_needs_restart":
      exact(value, ["reason"]); text(value.reason, 300); break;
    default: fail("unknown event");
  }
  return event;
}

export function validateProtocolError(value) {
  record(value, "protocol error");
  if (!/^[A-Za-z][A-Za-z0-9]{0,99}$/.test(value.code)) fail("invalid error code");
  text(value.message, 2_000); boolean(value.retryable);
  return value;
}

function session(value) {
  record(value); exact(value, ["sessionId", "libraryId", "schemaVersion", "name"]);
  uuid(value.sessionId); uuid(value.libraryId); integer(value.schemaVersion, 1, 1_000);
  text(value.name, 500);
}
function rootSummary(value) {
  record(value); exact(value, [
    "rootId", "displayName", "rootKind", "state", "authorized", "activeJobId", "observedCount", "unsupportedCount",
  ]);
  uuid(value.rootId); text(value.displayName, 500); text(value.rootKind, 80);
  text(value.state, 80); boolean(value.authorized); optionalUuid(value.activeJobId);
  count(value.observedCount); count(value.unsupportedCount);
}
function assetPage(value, detailed) {
  record(value); exact(value, ["offset", "limit", "total", "items", "nextOffset", "libraryRevision"]);
  count(value.offset); integer(value.limit, 1, 250); count(value.total);
  const items = array(value.items, value.limit);
  items.forEach((item) => assetSummary(item, detailed));
  optionalCount(value.nextOffset); count(value.libraryRevision);
}
function assetSummary(value, detailed) {
  record(value); exact(value, detailed
    ? ["assetId", "locationId", "displayName", "relativeDisplayPath", "mediaFamily", "availability", "reviewState", "customTitle", "revision"]
    : ["assetId", "locationId", "displayName", "mediaFamily", "availability", "reviewState"]);
  uuid(value.assetId); uuid(value.locationId); text(value.displayName, 1_000);
  text(value.mediaFamily, 80); member(value.availability, AVAILABILITY); member(value.reviewState, REVIEW_STATES);
  if (detailed) {
    text(value.relativeDisplayPath, 4_096); optionalText(value.customTitle, 500); count(value.revision);
  }
}
function assetDetail(value) {
  record(value); exact(value, [
    "assetId", "locationId", "originalDisplayName", "relativeDisplayPath", "mediaFamily", "availability",
    "reviewState", "customTitle", "note", "revision", "collectionIds",
  ]);
  uuid(value.assetId); uuid(value.locationId); text(value.originalDisplayName, 1_000);
  text(value.relativeDisplayPath, 4_096); text(value.mediaFamily, 80);
  member(value.availability, AVAILABILITY); member(value.reviewState, REVIEW_STATES);
  optionalText(value.customTitle, 500); optionalText(value.note, 5_000); count(value.revision);
  array(value.collectionIds, 10_000).forEach(uuid);
}
function jobPage(value) {
  record(value); exact(value, ["offset", "limit", "total", "items", "nextOffset"]);
  count(value.offset); integer(value.limit, 1, 100); count(value.total);
  array(value.items, value.limit).forEach((item) => {
    record(item); exact(item, [
      "jobId", "rootId", "jobKind", "state", "observedCount", "unsupportedCount", "errorCode",
      "createdAtMs", "updatedAtMs", "finishedAtMs",
    ]);
    uuid(item.jobId); optionalUuid(item.rootId); text(item.jobKind, 80); member(item.state, JOB_STATES);
    count(item.observedCount); count(item.unsupportedCount); optionalText(item.errorCode, 100);
    count(item.createdAtMs); count(item.updatedAtMs); optionalCount(item.finishedAtMs);
  });
  optionalCount(value.nextOffset);
}
function collectionSummary(value) {
  record(value); exact(value, ["collectionId", "name", "assetCount", "revision"]);
  uuid(value.collectionId); text(value.name, 200); count(value.assetCount); count(value.revision);
}
function resourceDescriptor(value) {
  record(value); exact(value, [
    "resourceToken", "sessionId", "assetId", "locationId", "profile", "mimeType", "contentLength", "nativePathForHandler",
  ]);
  uuid(value.resourceToken); uuid(value.sessionId); uuid(value.assetId); uuid(value.locationId);
  member(value.profile, PROFILES); member(value.mimeType, MIME_TYPES);
  integer(value.contentLength, 0, 512 * 1024 * 1024); nativePath(value.nativePathForHandler);
}
function canonicalDigest(value) {
  record(value); exact(value, ["format", "algorithm", "digest", "counts"]);
  text(value.format, 100); text(value.algorithm, 40); text(value.digest, 256);
  array(value.counts, 16).forEach((item) => {
    record(item); exact(item, ["entity", "count"]); text(item.entity, 80); count(item.count);
  });
}
function canonicalPage(value) {
  record(value); exact(value, ["format", "snapshotDigest", "entity", "cursor", "limit", "total", "records", "nextCursor"]);
  text(value.format, 100); text(value.snapshotDigest, 256); text(value.entity, 80);
  optionalText(value.cursor, 1_000); integer(value.limit, 1, 250); count(value.total);
  array(value.records, value.limit); optionalText(value.nextCursor, 1_000);
}
function capabilities(value) {
  record(value); exact(value, ["chooseRoot", "revealLocation", "opaqueAssetResources", "sourceMutation", "detail"]);
  boolean(value.chooseRoot); boolean(value.revealLocation); boolean(value.opaqueAssetResources);
  boolean(value.sourceMutation); array(value.detail, 100).forEach((item) => {
    record(item); exact(item, ["name", "state", "reason"]);
    text(item.name, 120); text(item.state, 120); optionalText(item.reason, 500);
  });
}
function nativePath(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096 || value.includes("\0") || !value.startsWith("/")) {
    fail("invalid privileged path");
  }
}
function record(value, label = "value") { if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`invalid ${label}`); }
function array(value, maximum) { if (!Array.isArray(value) || value.length > maximum) fail("invalid array"); return value; }
function uuid(value) { if (typeof value !== "string" || !UUID.test(value)) fail("invalid opaque identifier"); }
function optionalUuid(value) { if (value !== null && value !== undefined) uuid(value); }
function text(value, maximum) { if (typeof value !== "string" || [...value].length > maximum || value.includes("\0")) fail("invalid text"); }
function optionalText(value, maximum) { if (value !== null && value !== undefined) text(value, maximum); }
function integer(value, minimum, maximum) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail("invalid integer"); }
function count(value) { integer(value, 0, Number.MAX_SAFE_INTEGER); }
function optionalCount(value) { if (value !== null && value !== undefined) count(value); }
function boolean(value) { if (typeof value !== "boolean") fail("invalid boolean"); }
function member(value, values) { if (!values.has(value)) fail("invalid enum value"); }
function stringArray(value, maximumItems, maximumLength) { array(value, maximumItems).forEach((item) => text(item, maximumLength)); }
function exact(value, keys) {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail("unexpected event fields");
}
function fail(detail) { throw new TypeError(`Reference Core emitted an invalid ${detail}`); }
