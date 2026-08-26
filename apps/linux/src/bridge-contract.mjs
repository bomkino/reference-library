export const IPC = Object.freeze({
  createLibrary: "reference-library:create",
  openLibrary: "reference-library:open",
  closeLibrary: "reference-library:close",
  chooseRoot: "reference-library:choose-root",
  queryAssets: "reference-library:query-assets",
  revealLocation: "reference-library:reveal-location",
  capabilities: "reference-library:capabilities",
  canonicalDump: "reference-library:canonical-dump",
  restartCore: "reference-library:restart-core",
  event: "reference-library:event",
});

export function assertUuid(value, label) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new TypeError(`${label} must be an opaque UUID`);
  }
  return value;
}

export function assertSession(activeSession, sessionId) {
  assertUuid(sessionId, "sessionId");
  if (!activeSession || activeSession.sessionId !== sessionId) {
    throw new Error("SessionClosed");
  }
}

export function assetResourceUrl({ sessionId, assetId, profile }) {
  assertUuid(sessionId, "sessionId");
  assertUuid(assetId, "assetId");
  if (profile !== "grid_standard" && profile !== "preview") {
    throw new TypeError("Unsupported resource profile");
  }
  return `pitchdog-asset://${sessionId}/${assetId}/${profile}`;
}

export function assertAssetQuery(input) {
  assertUuid(input?.sessionId, "sessionId");
  if (!Number.isSafeInteger(input?.offset) || input.offset < 0) {
    throw new TypeError("offset must be a non-negative integer");
  }
  if (!Number.isSafeInteger(input?.limit) || input.limit < 1 || input.limit > 250) {
    throw new TypeError("limit must be between 1 and 250");
  }
  if (
    !["contact_sheet_tiny", "contact_sheet_standard", "contact_sheet_detailed"].includes(
      input?.projection,
    )
  ) {
    throw new TypeError("Unknown Asset projection");
  }
  return input;
}
