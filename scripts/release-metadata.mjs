import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readReleaseMetadata(repository) {
  const file = path.join(repository, "release-metadata.json");
  const metadata = JSON.parse(await readFile(file, "utf8"));
  assert.equal(metadata.schemaVersion, 1, "unsupported release metadata schema");
  assert.match(metadata.version, /^\d+\.\d+\.\d+$/);
  assert.match(metadata.buildNumber, /^\d+$/);
  assert.match(metadata.bundleIdentifier, /^[A-Za-z0-9.-]+$/);
  assert.deepEqual(Object.keys(metadata.targets).sort(), ["linux-x86_64", "macos-arm64"]);
  for (const target of Object.values(metadata.targets)) {
    assert.ok(target.artifacts.length > 0);
    assert.equal(new Set(target.artifacts).size, target.artifacts.length);
    assert.ok(target.artifacts.every((fileName) => path.basename(fileName) === fileName));
  }
  return metadata;
}

export async function verifyReleaseMetadata(repository) {
  const metadata = await readReleaseMetadata(repository);
  const jsonFiles = [
    "package.json",
    "apps/linux/package.json",
    "packages/bridge-contract/package.json",
    "packages/workspace/package.json",
  ];
  const packages = await Promise.all(
    jsonFiles.map(async (file) => [
      file,
      JSON.parse(await readFile(path.join(repository, file), "utf8")),
    ]),
  );
  for (const [file, packageJson] of packages) {
    assert.equal(packageJson.version, metadata.version, `${file} version drift`);
  }
  const linuxPackage = packages.find(([file]) => file === "apps/linux/package.json")[1];
  assert.equal(linuxPackage.build.appId, metadata.bundleIdentifier);
  assert.equal(linuxPackage.build.productName, metadata.productName);
  assert.equal(
    linuxPackage.build.linux.icon,
    "../../assets/branding/reference-library-icon-1024.png",
  );
  assert.equal(linuxPackage.build.linux.executableArgs, undefined);
  assert.deepEqual(linuxPackage.build.appImage.executableArgs, []);
  assert.deepEqual(linuxPackage.build.pacman.executableArgs, ["%F"]);
  assert.deepEqual(linuxPackage.build.fileAssociations, [{
    ext: "pitchlibrary",
    name: "Reference Library package",
    description: "Reference Library package",
    mimeType: "application/x-pitchdog-reference-library",
    role: "Editor",
  }]);
  const desktop = await readFile(
    path.join(repository, "apps/linux/packaging/io.pitchdog.ReferenceLibrary.desktop"),
    "utf8",
  );
  assert.match(desktop, /^Exec=reference-library %F$/m, "Linux desktop Exec drift");
  assert.match(
    desktop,
    /^MimeType=application\/x-pitchdog-reference-library;$/m,
    "Linux desktop MIME drift",
  );
  const mimePackage = await readFile(
    path.join(repository, "apps/linux/packaging/io.pitchdog.ReferenceLibrary.xml"),
    "utf8",
  );
  assert.match(mimePackage, /type="application\/x-pitchdog-reference-library"/);
  assert.match(mimePackage, /pattern="\*\.pitchlibrary"/);

  const packageLock = JSON.parse(await readFile(path.join(repository, "package-lock.json"), "utf8"));
  for (const packagePath of ["", "apps/linux", "packages/bridge-contract", "packages/workspace"]) {
    assert.equal(
      packageLock.packages[packagePath].version,
      metadata.version,
      `package-lock.json ${packagePath || "root"} version drift`,
    );
  }

  const cargo = await readFile(path.join(repository, "Cargo.toml"), "utf8");
  assert.match(cargo, new RegExp(`\\[workspace\\.package\\][\\s\\S]*?version = "${escapeRegExp(metadata.version)}"`));
  const pkgbuild = await readFile(path.join(repository, "apps/linux/packaging/PKGBUILD"), "utf8");
  assert.match(pkgbuild, new RegExp(`^pkgver=${escapeRegExp(metadata.version)}$`, "m"));

  const plist = await readFile(path.join(repository, "apps/macos/Info.plist"), "utf8");
  assertPlistString(plist, "CFBundleDisplayName", metadata.productName);
  assertPlistString(plist, "CFBundleIdentifier", metadata.bundleIdentifier);
  assertPlistString(plist, "CFBundleIconFile", "ReferenceLibrary");
  assertPlistString(plist, "CFBundleShortVersionString", metadata.version);
  assertPlistString(plist, "CFBundleVersion", metadata.buildNumber);
  assertPlistString(plist, "UTTypeIdentifier", metadata.documentTypeIdentifier);
  const appEntitlements = await readFile(
    path.join(repository, "apps/macos/ReferenceLibrary.entitlements"),
    "utf8",
  );
  assertPlistTrue(appEntitlements, "com.apple.security.app-sandbox");
  assertPlistTrue(appEntitlements, "com.apple.security.files.user-selected.read-write");
  assertPlistTrue(appEntitlements, "com.apple.security.files.bookmarks.app-scope");
  assertExactSecurityEntitlements(appEntitlements, [
    "com.apple.security.app-sandbox",
    "com.apple.security.files.bookmarks.app-scope",
    "com.apple.security.files.user-selected.read-write",
  ]);
  const helperEntitlements = await readFile(
    path.join(repository, "apps/macos/ReferenceCore.entitlements"),
    "utf8",
  );
  assertPlistTrue(helperEntitlements, "com.apple.security.app-sandbox");
  assertPlistTrue(helperEntitlements, "com.apple.security.inherit");
  assertExactSecurityEntitlements(helperEntitlements, [
    "com.apple.security.app-sandbox",
    "com.apple.security.inherit",
  ]);

  const expected = {
    "linux-x86_64": [
      `reference-library-${metadata.version}-x64.pacman`,
      `reference-library-${metadata.version}-x86_64.AppImage`,
      `reference-library-${metadata.version}-x64.tar.gz`,
    ],
    "macos-arm64": [`reference-library-${metadata.version}-macos-arm64.app.zip`],
  };
  for (const [targetName, artifacts] of Object.entries(expected)) {
    assert.deepEqual(metadata.targets[targetName].artifacts, artifacts);
  }
  return metadata;
}

function assertPlistString(plist, key, expected) {
  const expression = new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<string>${escapeRegExp(expected)}</string>`);
  assert.match(plist, expression, `Info.plist ${key} drift`);
}

function assertPlistTrue(plist, key) {
  const expression = new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<true\\s*\\/>`);
  assert.match(plist, expression, `${key} entitlement drift`);
}

function assertExactSecurityEntitlements(plist, expected) {
  const observed = [...plist.matchAll(/<key>(com\.apple\.security\.[^<]+)<\/key>/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(observed, [...expected].sort(), "unexpected macOS security entitlement");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
