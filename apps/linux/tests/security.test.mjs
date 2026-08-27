import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";

import {
  IPC,
  assertAssetQuery,
  assetResourceUrl,
  unwrapAssetQueryIpcResult,
} from "../src/bridge-contract.mjs";
import { validateCoreResult } from "../src/core-wire-validation.mjs";
import {
  isTrustedWorkspaceUrl,
  resolveBundledUiPath,
} from "../src/resource-security.mjs";
import { denyAllSessionPermissions, disableSessionDownloads } from "../src/permission-policy.mjs";
import { AwaitedShutdown } from "../src/runtime-hardening.mjs";

const SESSION = "b4c27ebf-1dd5-4a03-9b8b-4eebd43947a0";
const ASSET = "45c16e93-f8e4-4fb9-970f-783ae9d34c18";

test("opaque Asset URLs reject raw paths and unknown profiles", () => {
  assert.equal(
    assetResourceUrl({ sessionId: SESSION, assetId: ASSET, profile: "preview" }),
    `pitchdog-asset://${SESSION}/${ASSET}/preview`,
  );
  assert.throws(
    () => assetResourceUrl({ sessionId: SESSION, assetId: "../../etc/passwd", profile: "preview" }),
    /opaque UUID/,
  );
  assert.throws(
    () => assetResourceUrl({ sessionId: SESSION, assetId: ASSET, profile: "file" }),
    /Unsupported resource profile/,
  );
});

test("query contract caps pages and names projections", () => {
  assert.equal(
    assertAssetQuery({
      sessionId: SESSION,
      offset: 100,
      limit: 250,
      expectedLibraryRevision: 42,
      projection: "contact_sheet_standard",
      query: {
        search: null,
        rootId: null,
        reviewStates: [],
        availability: ["offline_volume", "unreadable", "unsupported"],
        collectionId: null,
        sort: "created_ascending",
      },
    }).limit,
    250,
  );
  assert.throws(
    () => assertAssetQuery({
      sessionId: SESSION,
      offset: 0,
      limit: 251,
      projection: "contact_sheet_standard",
      query: { search: null, rootId: null, reviewStates: [], availability: [], collectionId: null, sort: "created_ascending" },
    }),
    /between 1 and 250/,
  );
  assert.throws(
    () => assertAssetQuery({
      sessionId: SESSION,
      offset: 0,
      limit: 100,
      expectedLibraryRevision: -1,
      projection: "contact_sheet_standard",
      query: { search: null, rootId: null, reviewStates: [], availability: [], collectionId: null, sort: "created_ascending" },
    }),
    /expectedLibraryRevision/,
  );
});

test("Asset query IPC preserves typed snapshot changes without exposing Core detail", () => {
  const page = { offset: 0, limit: 100, total: 0, items: [], nextOffset: null, libraryRevision: 9 };
  assert.equal(unwrapAssetQueryIpcResult({ kind: "asset_page", page }), page);
  assert.throws(
    () => unwrapAssetQueryIpcResult({ kind: "query_snapshot_changed" }),
    (error) => error.code === "QuerySnapshotChanged" && error.message === "QuerySnapshotChanged",
  );
  assert.throws(() => unwrapAssetQueryIpcResult({ kind: "query_snapshot_changed", privatePath: "/tmp/private" }), /Invalid Asset query response/);
});

test("Core wire accepts unsupported catalogue-only Assets as a bounded availability", () => {
  const result = validateCoreResult("query_asset_index", { result: "asset_page", value: {
    offset: 0,
    limit: 1,
    total: 1,
    items: [{
      assetId: ASSET,
      locationId: "55c16e93-f8e4-4fb9-970f-783ae9d34c18",
      displayName: "Animated.gif",
      relativeDisplayPath: "Stills/Animated.gif",
      mediaFamily: "still",
      availability: "unsupported",
      reviewState: "unreviewed",
      customTitle: null,
      revision: 1,
    }],
    nextOffset: null,
    libraryRevision: 9,
  } });
  assert.equal(result.value.items[0].availability, "unsupported");
});

test("workspace resources and senders stay inside named origin", () => {
  const root = path.resolve("/app/workspace");
  assert.equal(resolveBundledUiPath(root, "/assets/app.js"), path.join(root, "assets/app.js"));
  assert.throws(() => resolveBundledUiPath(root, "/../secret"), /traversal denied/);
  assert.equal(isTrustedWorkspaceUrl("pitchdog-ui://app/index.html"), true);
  assert.equal(isTrustedWorkspaceUrl("file:///tmp/index.html"), false);
  assert.equal(isTrustedWorkspaceUrl("https://example.com"), false);
});

test("preload exposes only fixed named IPC channels", () => {
  assert.deepEqual(Object.keys(IPC).sort(), [
    "cancelJob",
    "capabilities",
    "chooseRoot",
    "closeLibrary",
    "completeOpenIntent",
    "createCollection",
    "createLibrary",
    "deleteCollection",
    "event",
    "getAsset",
    "listCollections",
    "listRoots",
    "openLibrary",
    "queryAssets",
    "queryJobs",
    "readPreferences",
    "reauthorizeRoot",
    "renameCollection",
    "restartCore",
    "revealLocation",
    "scanRoot",
    "setCollectionMembership",
    "updateAsset",
    "writePreferences",
  ]);
  for (const channel of Object.values(IPC)) {
    assert.match(channel, /^reference-library:[a-z-]+$/);
  }
});

test("renderer bridge omits the unbounded canonical dump diagnostic", async () => {
  const [sharedContract, preload, main] = await Promise.all([
    readFile(new URL("../../../packages/bridge-contract/src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main.mjs", import.meta.url), "utf8"),
  ]);
  for (const rendererBoundary of [sharedContract, preload, main]) {
    assert.doesNotMatch(rendererBoundary, /canonicalDump|canonical-dump|canonical_dump/);
  }
});

test("Root authority operations return an explicit replacement-session envelope", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(main, /return \{ session: publicSession\(recovery\.activeSession\), \.\.\.result \}/);
  assert.match(main, /return \{ session: publicSession\(recovery\.activeSession\), root \}/);
});

test("session permissions and downloads are denied before destination authority", () => {
  const handlers = new Map();
  let requestHandler;
  let checkHandler;
  const session = {
    on: (name, handler) => handlers.set(name, handler),
    setPermissionRequestHandler: (handler) => { requestHandler = handler; },
    setPermissionCheckHandler: (handler) => { checkHandler = handler; },
  };
  denyAllSessionPermissions(session);
  disableSessionDownloads(session);
  disableSessionDownloads(session);
  let permission;
  requestHandler(null, "camera", (value) => { permission = value; });
  assert.equal(permission, false);
  assert.equal(checkHandler(), false);
  let prevented = 0;
  let cancelled = 0;
  handlers.get("will-download")(
    { preventDefault: () => { prevented += 1; } },
    { cancel: () => { cancelled += 1; } },
  );
  assert.equal(prevented, 1);
  assert.equal(cancelled, 1);
  assert.equal([...handlers.keys()].filter((name) => name === "will-download").length, 1);
});

test("quit is prevented until one bounded Core shutdown completes", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let stops = 0;
  let finishes = 0;
  const shutdown = new AwaitedShutdown({
    stop: async () => { stops += 1; await gate; },
    finish: () => { finishes += 1; },
  });
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; } };
  const first = shutdown.request(event);
  const second = shutdown.request(event);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stops, 1);
  assert.equal(finishes, 0);
  assert.equal(prevented, 2);
  release();
  await Promise.all([first, second]);
  assert.equal(finishes, 1);
  await shutdown.request(event);
  assert.equal(prevented, 2);
});
