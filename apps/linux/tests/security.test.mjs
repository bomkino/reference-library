import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";

import {
  IPC,
  assertAssetQuery,
  assetResourceUrl,
} from "../src/bridge-contract.mjs";
import {
  isTrustedWorkspaceUrl,
  resolveBundledUiPath,
} from "../src/resource-security.mjs";

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
      projection: "contact_sheet_standard",
    }).limit,
    250,
  );
  assert.throws(
    () => assertAssetQuery({ sessionId: SESSION, offset: 0, limit: 251, projection: "contact_sheet_standard" }),
    /between 1 and 250/,
  );
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
    "canonicalDump",
    "capabilities",
    "chooseRoot",
    "closeLibrary",
    "createLibrary",
    "event",
    "openLibrary",
    "queryAssets",
    "restartCore",
    "revealLocation",
  ]);
  for (const channel of Object.values(IPC)) {
    assert.match(channel, /^reference-library:[a-z-]+$/);
  }
});
