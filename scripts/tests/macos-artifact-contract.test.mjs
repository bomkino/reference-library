import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  assertMacosBundleMetadata,
  expectedMacosArtifacts,
} from "../macos-artifact-contract.mjs";
import { readReleaseMetadata } from "../release-metadata.mjs";

const repository = path.resolve(import.meta.dirname, "../..");

test("macOS archive and document registration are release-metadata bound", async () => {
  const metadata = await readReleaseMetadata(repository);
  assert.deepEqual(expectedMacosArtifacts(metadata), [
    "reference-library-0.1.0-macos-arm64.app.zip",
  ]);
  const plist = {
    CFBundleDisplayName: metadata.productName,
    CFBundleIdentifier: metadata.bundleIdentifier,
    CFBundleShortVersionString: metadata.version,
    CFBundleVersion: metadata.buildNumber,
    CFBundleExecutable: "ReferenceLibraryMac",
    CFBundleIconFile: "ReferenceLibrary",
    LSArchitecturePriority: ["arm64"],
    CFBundleDocumentTypes: [{
      CFBundleTypeRole: "Editor",
      LSItemContentTypes: [metadata.documentTypeIdentifier],
    }],
    UTImportedTypeDeclarations: [{
      UTTypeIdentifier: metadata.documentTypeIdentifier,
      UTTypeConformsTo: ["com.apple.package"],
      UTTypeTagSpecification: { "public.filename-extension": ["pitchlibrary"] },
    }],
  };
  assert.doesNotThrow(() => assertMacosBundleMetadata(plist, metadata));
  assert.throws(
    () => assertMacosBundleMetadata({ ...plist, CFBundleIdentifier: "invalid" }, metadata),
  );
});
