import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = (name) => readFile(new URL(`../Sources/ReferenceLibraryMac/${name}`, import.meta.url), "utf8");

test("release Core and workspace resolution ignore development overrides", async () => {
  const core = await source("CoreSupervisor.swift");
  const scheme = await source("WorkspaceSchemeHandler.swift");
  assert.match(core, /#if DEBUG[\s\S]*REFERENCE_CORE_PATH[\s\S]*#else[\s\S]*environment: URL\? = nil[\s\S]*#endif/);
  assert.match(scheme, /#if DEBUG[\s\S]*REFERENCE_WORKSPACE_PATH[\s\S]*#endif[\s\S]*Bundle\.main\.resourceURL/);
});

test("Finder package-open routes through opaque serialized intent acknowledgement", async () => {
  const delegate = await source("ApplicationDelegate.swift");
  const model = await source("AppModel.swift");
  const queue = await source("LibraryOpenQueue.swift");
  assert.match(delegate, /application\(_ application: NSApplication, open urls: \[URL\]\)/);
  assert.match(model, /case "completeOpenIntent"/);
  assert.match(model, /LibraryTransitionGate/);
  assert.match(model, /library_open_requested/);
  assert.doesNotMatch(queue, /\["[^\"]*path/);
  assert.match(delegate, /applicationShouldTerminate[\s\S]*await model\.stop\(\)[\s\S]*terminateLater/);
});

test("v3 bridge includes the daily-use seam and excludes prohibited Root removal", async () => {
  const bridge = await source("WorkspaceBridge.swift");
  for (const operation of [
    "completeOpenIntent", "listRoots", "reauthorizeRoot", "scanRoot", "cancelJob",
    "queryJobs", "queryAssets", "getAsset", "updateAsset", "listCollections",
    "createCollection", "renameCollection", "deleteCollection", "setCollectionMembership",
    "readPreferences", "writePreferences",
  ]) assert.match(bridge, new RegExp(operation));
  assert.match(bridge, /version: 3/);
  assert.doesNotMatch(bridge, /removeRoot|unbindRoot/);
});

test("resource delivery opens once without following links and streams bounded chunks", async () => {
  const stream = await source("ResourceFileStreamer.swift");
  const handler = await source("WorkspaceSchemeHandler.swift");
  assert.match(stream, /O_RDONLY \| O_NOFOLLOW \| O_CLOEXEC/);
  assert.match(stream, /pitchdog-reference-cache[\s\S]*reference-library-v1/);
  assert.match(stream, /descendantComponents[\s\S]*openat/);
  assert.match(stream, /fstat\(descriptor/);
  assert.match(stream, /st_uid[\s\S]*0o022[\s\S]*st_nlink == 1/);
  assert.match(stream, /pread\(descriptor/);
  assert.match(stream, /chunkBytes = 64 \* 1_024/);
  assert.doesNotMatch(handler, /resourceValues\(forKeys: \[\.fileSizeKey/);
  assert.match(handler, /stream\.cancel\(\)/);
  assert.match(handler, /ResourceFileStreamer\.stream\([\s\S]*afterValidation:[\s\S]*didReceive\(response\)/);
});

test("supervision is lazy, generation-bound, fail-all, and resource-correlated", async () => {
  const core = await source("CoreSupervisor.swift");
  const model = await source("AppModel.swift");
  assert.doesNotMatch(model.match(/func start\(\) async \{[\s\S]*?\n    \}/)?.[0] ?? "", /core\.start\(/);
  assert.match(model, /func startCoreAfterAuthority\(\) async throws/);
  assert.match(core, /resource_authorization_started/);
  assert.match(core, /RenditionQueueFull/);
  assert.match(core, /cancelAuthorization/);
  assert.match(core, /guard self\.generation == generation/);
  assert.match(core, /for item in pending\.values/);
  assert.match(core, /maximumPendingRequests = 128/);
  assert.match(core, /maximumAuthorizations = 32/);
  assert.match(core, /BoundedRegistry<String, Pending>/);
  assert.match(core, /BoundedRegistry<String, Authorization>/);
  assert.match(core, /Darwin\.kill\(process\.processIdentifier, SIGKILL\)/);
  assert.match(core, /sequence\.uint64Value > lastEventSequence/);
});

test("integrity errors remain fixed, preserved, and path-free", async () => {
  const errors = await source("RendererErrorPolicy.swift");
  const bridge = await source("WorkspaceBridge.swift");
  assert.match(errors, /LibraryIntegrityFailedPreserved/);
  assert.match(errors, /LibraryDatabaseIntegrityInvalid/);
  assert.match(errors, /LibraryMigrationLedgerInvalid/);
  assert.match(errors, /preserved unchanged/);
  assert.doesNotMatch(errors, /\/Users\//);
  assert.match(bridge, /model\.rendererMessage\(for: error\)/);
  assert.doesNotMatch(bridge, /error\.localizedDescription/);
});

test("Core results are structurally rebuilt before renderer delivery", async () => {
  const model = await source("AppModel.swift");
  const validator = await source("CoreResultValidator.swift");
  const core = await source("CoreSupervisor.swift");
  for (const seam of [
    "assetPage", "assetUpdated", "jobPage", "roots", "collections",
    "capabilities", "resourceDescriptor", "location",
  ]) assert.match(model, new RegExp(`CoreResultValidator\\.${seam}`));
  assert.doesNotMatch(await source("WorkspaceBridge.swift"), /canonicalDump/);
  assert.match(validator, /Set\(value\.keys\) == keys/);
  assert.match(validator, /relativePath[\s\S]*!value\.hasPrefix\("\/"\)/);
  assert.match(core, /Set\(payload\.keys\) == \["code", "message", "retryable"\]/);
  assert.match(model, /CoreSupervisor\.Failure\.capacityExceeded[\s\S]*requestCapacityExceeded/);
});
