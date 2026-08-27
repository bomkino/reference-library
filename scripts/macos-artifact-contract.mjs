#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify, parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { readReleaseMetadata } from "./release-metadata.mjs";

const execFileAsync = promisify(execFile);

export function expectedMacosArtifacts(metadata) {
  assert.equal(metadata.targets["macos-arm64"].os, "macos");
  assert.equal(metadata.targets["macos-arm64"].arch, "arm64");
  const files = metadata.targets["macos-arm64"].artifacts;
  assert.deepEqual(files, [`reference-library-${metadata.version}-macos-arm64.app.zip`]);
  return files;
}

export function assertMacosBundleMetadata(plist, metadata) {
  assert.equal(plist.CFBundleDisplayName, metadata.productName);
  assert.equal(plist.CFBundleIdentifier, metadata.bundleIdentifier);
  assert.equal(plist.CFBundleShortVersionString, metadata.version);
  assert.equal(String(plist.CFBundleVersion), metadata.buildNumber);
  assert.equal(plist.CFBundleExecutable, "ReferenceLibraryMac");
  assert.ok(plist.LSArchitecturePriority?.includes("arm64"));
  const document = plist.CFBundleDocumentTypes?.find((item) =>
    item.LSItemContentTypes?.includes(metadata.documentTypeIdentifier));
  assert.equal(document?.CFBundleTypeRole, "Editor");
  const declaration = plist.UTImportedTypeDeclarations?.find((item) =>
    item.UTTypeIdentifier === metadata.documentTypeIdentifier);
  assert.ok(declaration?.UTTypeConformsTo?.includes("com.apple.package"));
  const extensions = declaration?.UTTypeTagSpecification?.["public.filename-extension"];
  assert.ok(extensions?.includes("pitchlibrary"));
}

export async function validateMacosArtifact({ repository, releaseDirectory, extractionRoot }) {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("macOS artifact validation requires Apple Silicon macOS");
  }
  const metadata = await readReleaseMetadata(repository);
  const [artifactName] = expectedMacosArtifacts(metadata);
  const artifact = path.join(releaseDirectory, artifactName);
  await assertRegularFile(artifact);
  await mkdir(extractionRoot, { recursive: false });
  await run("ditto", ["-x", "-k", artifact, extractionRoot]);
  const apps = (await readdir(extractionRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  assert.equal(apps.length, 1, "archive must contain exactly one top-level .app bundle");
  const application = path.join(extractionRoot, apps[0].name);
  const contents = path.join(application, "Contents");
  const plistPath = path.join(contents, "Info.plist");
  const executable = path.join(contents, "MacOS/ReferenceLibraryMac");
  const core = path.join(contents, "Resources/bin/reference-core");
  const legal = path.join(contents, "Resources/Legal");
  for (const file of [
    plistPath,
    executable,
    core,
    path.join(contents, "Resources/Workspace/index.html"),
    path.join(legal, "DEPENDENCY-LICENSES.json"),
    path.join(legal, "THIRD_PARTY-NOTICES.txt"),
    path.join(legal, "LICENSE"),
    path.join(legal, "NOTICE"),
  ]) await assertRegularFile(file);

  const plist = JSON.parse((await run("plutil", ["-convert", "json", "-o", "-", plistPath])).stdout);
  assertMacosBundleMetadata(plist, metadata);
  await assertArm64MachO(executable, "Swift application executable");
  await assertArm64MachO(core, "Reference Core helper");
  await run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", application]);
  await run("codesign", ["--verify", "--strict", "--verbose=2", core]);
  await run(process.execPath, [
    path.join(repository, "scripts/legal-bundle-contract.mjs"),
    "--directory",
    legal,
  ]);

  return {
    status: "packaged_macos_artifact_verified",
    evidenceScope: "packaged_in_compatible_environment",
    releaseVersion: metadata.version,
    artifactName,
    bundleIdentifier: metadata.bundleIdentifier,
    documentTypeIdentifier: metadata.documentTypeIdentifier,
    architecture: "arm64",
    adHocSignatureVerified: true,
    claimExclusions: ["notarized", "installed_on_apple_silicon", "target_integrated", "released"],
  };
}

async function assertArm64MachO(file, label) {
  const [architectures, kind] = await Promise.all([
    run("lipo", ["-archs", file]),
    run("file", ["-b", file]),
  ]);
  assert.equal(architectures.stdout.trim(), "arm64", `${label} is not arm64-only`);
  assert.match(kind.stdout, /Mach-O 64-bit executable arm64/, `${label} is not Mach-O arm64`);
}

async function assertRegularFile(file) {
  const metadata = await lstat(file);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), `not a regular file: ${file}`);
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} failed${detail ? `:\n${detail}` : ""}`, { cause: error });
  }
}

const invoked = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const { values } = parseArgs({
    options: {
      repository: { type: "string", default: "." },
      directory: { type: "string", default: "release/macos" },
      "extract-root": { type: "string" },
    },
  });
  if (!values["extract-root"]) throw new Error("--extract-root is required");
  const repository = path.resolve(values.repository);
  const result = await validateMacosArtifact({
    repository,
    releaseDirectory: path.resolve(values.directory),
    extractionRoot: path.resolve(values["extract-root"]),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
