import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  assertDesktopAssociation,
  expectedLinuxArtifacts,
} from "../linux-artifact-contract.mjs";
import { readReleaseMetadata } from "../release-metadata.mjs";

const repository = path.resolve(import.meta.dirname, "../..");

test("Linux package names and local-file association are release-metadata bound", async () => {
  const metadata = await readReleaseMetadata(repository);
  assert.deepEqual(expectedLinuxArtifacts(metadata), [
    "reference-library-0.1.0-x64.pacman",
    "reference-library-0.1.0-x86_64.AppImage",
    "reference-library-0.1.0-x64.tar.gz",
  ]);
  const [desktop, mimePackage] = await Promise.all([
    readFile(path.join(repository, "apps/linux/packaging/io.pitchdog.ReferenceLibrary.desktop"), "utf8"),
    readFile(path.join(repository, "apps/linux/packaging/io.pitchdog.ReferenceLibrary.xml"), "utf8"),
  ]);
  assert.doesNotThrow(() => assertDesktopAssociation(desktop, mimePackage));
  assert.doesNotThrow(
    () => assertDesktopAssociation(desktop.replace("reference-library %F", "AppRun %U"), mimePackage),
  );
  assert.throws(
    () => assertDesktopAssociation(desktop.replace(" %F", ""), mimePackage),
    /local package paths or local file URLs/,
  );
  assert.throws(
    () => assertDesktopAssociation(desktop.replace("%F", "%F %U"), mimePackage),
    /exactly one file field code/,
  );
  assert.throws(
    () => assertDesktopAssociation(desktop.replace(" %F", " --no-sandbox %F"), mimePackage),
    /--no-sandbox/,
  );
});
