import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { verifyReleaseMetadata } from "../release-metadata.mjs";

const repository = path.resolve(import.meta.dirname, "../..");

test("release metadata agrees with every source version surface", async () => {
  const metadata = await verifyReleaseMetadata(repository);
  assert.equal(metadata.version, "0.3.0");
  assert.equal(metadata.targets["macos-arm64"].arch, "arm64");
});

test("release metadata rejects a stale native bundle version", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-release-metadata-"));
  try {
    for (const file of [
      "release-metadata.json",
      "package.json",
      "package-lock.json",
      "Cargo.toml",
      "apps/linux/package.json",
      "apps/linux/packaging/PKGBUILD",
      "apps/linux/packaging/io.pitchdog.ReferenceLibrary.desktop",
      "apps/linux/packaging/io.pitchdog.ReferenceLibrary.xml",
      "apps/macos/Info.plist",
      "apps/macos/ReferenceLibrary.entitlements",
      "apps/macos/ReferenceCore.entitlements",
      "packages/bridge-contract/package.json",
      "packages/workspace/package.json",
    ]) {
      const destination = path.join(temporary, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(repository, file), destination, { recursive: true });
    }
    const plistPath = path.join(temporary, "apps/macos/Info.plist");
    const plist = await readFile(plistPath, "utf8");
    await writeFile(plistPath, plist.replace("<string>0.3.0</string>", "<string>9.9.9</string>"));
    await assert.rejects(verifyReleaseMetadata(temporary), /Info\.plist CFBundleShortVersionString drift/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
