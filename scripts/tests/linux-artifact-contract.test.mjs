import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  assertSafeArchiveListing,
  assertDesktopAssociation,
  expectedLinuxArtifacts,
  preflightLinuxArtifacts,
  squashfsOffsets,
} from "../linux-artifact-contract.mjs";
import { readReleaseMetadata } from "../release-metadata.mjs";

const repository = path.resolve(import.meta.dirname, "../..");

test("Linux package names and local-file association are release-metadata bound", async () => {
  const metadata = await readReleaseMetadata(repository);
  assert.deepEqual(expectedLinuxArtifacts(metadata), [
    "reference-library-0.2.0-x64.pacman",
    "reference-library-0.2.0-x86_64.AppImage",
    "reference-library-0.2.0-x64.tar.gz",
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

test("archive preflight rejects paths and links that could escape before extraction", async () => {
  const safe = {
    entries: ["./", "reference-library", "./opt/Reference Library/app.asar", "./usr/bin/reference-library"],
    verboseLines: [
      "drwxr-xr-x  0 root root 0 Aug 27 00:00 ./",
      "-rw-r--r--  0 root root 1 Aug 27 00:00 reference-library",
      "-rw-r--r--  0 root root 1 Aug 27 00:00 ./opt/Reference Library/app.asar",
      "lrwxrwxrwx  0 root root 0 Aug 27 00:00 ./usr/bin/reference-library -> ../../opt/Reference Library/reference-library",
    ],
    label: "fixture",
  };
  assert.deepEqual(assertSafeArchiveListing(safe), { entryCount: 4 });
  for (const entries of [
    ["/etc/passwd"],
    ["../../outside"],
    ["safe/../outside"],
    ["C:/outside"],
    ["safe\\..\\outside"],
    ["safe\u0000outside"],
  ]) {
    assert.throws(() => assertSafeArchiveListing({
      entries,
      verboseLines: ["-rw-r--r--  0 root root 1 Aug 27 00:00 fixture"],
      label: "fixture",
    }), /archive/);
  }
  assert.throws(() => assertSafeArchiveListing({
    entries: ["safe/link"],
    verboseLines: ["lrwxrwxrwx  0 root root 0 Aug 27 00:00 safe/link -> ../../outside"],
    label: "fixture",
  }), /escapes its extraction root/);

  const calls = [];
  await preflightLinuxArtifacts(
    { pacman: "a.pacman", tar: "a.tar.gz", appImage: "a.AppImage" },
    {
      inspectTar: async (file, label) => { calls.push(["archive", file, label]); },
      inspectAppImage: async (file, label) => { calls.push(["appimage", file, label]); },
    },
  );
  assert.deepEqual(calls, [
    ["archive", "a.pacman", "pacman"],
    ["archive", "a.tar.gz", "tar.gz"],
    ["appimage", "a.AppImage", "AppImage"],
  ]);
});

test("AppImage preflight locates SquashFS bytes without executing the artifact", () => {
  assert.deepEqual(squashfsOffsets(Buffer.from("ELF\0hsqsdatahsqs", "binary")), [4, 12]);
  assert.deepEqual(squashfsOffsets(Buffer.from("not-an-appimage")), []);
});
