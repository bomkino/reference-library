#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { sha256File } from "./artifact-checksums.mjs";
import { readReleaseMetadata } from "./release-metadata.mjs";

const execFileAsync = promisify(execFile);
const MIME = "application/x-pitchdog-reference-library";

export function expectedLinuxArtifacts(metadata) {
  assert.equal(metadata.targets["linux-x86_64"].os, "linux");
  assert.equal(metadata.targets["linux-x86_64"].arch, "x86_64");
  const files = metadata.targets["linux-x86_64"].artifacts;
  assert.deepEqual(files, [
    `reference-library-${metadata.version}-x64.pacman`,
    `reference-library-${metadata.version}-x86_64.AppImage`,
    `reference-library-${metadata.version}-x64.tar.gz`,
  ]);
  return files;
}

export function assertDesktopAssociation(desktop, mimePackage) {
  assert.match(desktop, /^\[Desktop Entry\]$/m);
  assert.match(desktop, /^Type=Application$/m);
  assert.doesNotMatch(desktop, /--no-sandbox|--disable-setuid-sandbox/);
  const command = desktop.match(/^Exec=(.+)$/m)?.[1] ?? "";
  assert.match(
    command,
    /^\S.*\s%[FU]$/,
    "desktop command must accept local package paths or local file URLs",
  );
  assert.equal(
    command.match(/%[fFuU]/g)?.length,
    1,
    "desktop command must contain exactly one file field code",
  );
  const mimeLine = desktop.match(/^MimeType=(.+)$/m)?.[1] ?? "";
  assert.ok(mimeLine.split(";").includes(MIME), "desktop file omits Library MIME type");
  assert.match(mimePackage, new RegExp(`type=["']${escapeRegExp(MIME)}["']`));
  assert.match(mimePackage, /pattern=["']\*\.pitchlibrary["']/);
}

export async function validateLinuxArtifactSet({ repository, releaseDirectory, extractionRoot }) {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Linux artifact validation requires Linux x86_64");
  }
  const metadata = await readReleaseMetadata(repository);
  const artifactNames = expectedLinuxArtifacts(metadata);
  const artifacts = Object.fromEntries(
    artifactNames.map((file) => [file, path.join(releaseDirectory, file)]),
  );
  await Promise.all(Object.values(artifacts).map(assertRegularFile));
  const unpacked = path.join(releaseDirectory, "linux-unpacked");
  assert.ok((await lstat(unpacked)).isDirectory(), "linux-unpacked directory is missing");
  const sourceIconSha256 = await sha256File(
    path.join(repository, "assets/branding/reference-library-icon-1024.png"),
  );

  await mkdir(extractionRoot, { recursive: false });
  const pacmanRoot = path.join(extractionRoot, "pacman");
  const tarRoot = path.join(extractionRoot, "tar");
  const appImageRoot = path.join(extractionRoot, "appimage");
  await Promise.all([pacmanRoot, tarRoot, appImageRoot].map((directory) => mkdir(directory)));
  await run("bsdtar", ["-xf", artifacts[artifactNames[0]], "-C", pacmanRoot]);
  await run("tar", ["-xzf", artifacts[artifactNames[2]], "-C", tarRoot]);
  await chmod(artifacts[artifactNames[1]], 0o755);
  await run(artifacts[artifactNames[1]], ["--appimage-extract"], { cwd: appImageRoot });

  const distributions = await Promise.all([
    validateLinuxDistribution("linux-unpacked", unpacked, sourceIconSha256),
    validateLinuxDistribution("pacman", pacmanRoot, sourceIconSha256),
    validateLinuxDistribution("AppImage", appImageRoot, sourceIconSha256),
    validateLinuxDistribution("tar.gz", tarRoot, sourceIconSha256),
  ]);
  assert.equal(
    new Set(distributions.map((item) => item.coreSha256)).size,
    1,
    "packaged Reference Core bytes differ between Linux formats",
  );
  assert.equal(
    new Set(distributions.map((item) => item.asarSha256)).size,
    1,
    "packaged application archive differs between Linux formats",
  );

  const asar = path.join(repository, "node_modules/.bin/asar");
  await access(asar);
  const asarRoot = path.join(extractionRoot, "asar");
  await mkdir(asarRoot);
  await run(asar, ["extract", distributions[0].asar, asarRoot]);
  for (const required of [
    "package.json",
    "dist/main.mjs",
    "dist/preload.mjs",
    "dist/workspace/index.html",
    "dist/legal/DEPENDENCY-LICENSES.json",
    "dist/legal/THIRD_PARTY-NOTICES.txt",
    "dist/legal/LICENSE",
    "dist/legal/NOTICE",
  ]) {
    await assertRegularFile(path.join(asarRoot, required));
  }
  await run(process.execPath, [
    path.join(repository, "scripts/legal-bundle-contract.mjs"),
    "--directory",
    path.join(asarRoot, "dist/legal"),
  ]);

  return {
    status: "packaged_linux_artifacts_verified",
    evidenceScope: "packaged_in_compatible_environment",
    releaseVersion: metadata.version,
    artifactNames,
    distributions: distributions.map(({ name, coreSha256, asarSha256 }) => ({
      name,
      coreSha256,
      asarSha256,
      packageAssociation: "pitchlibrary-local-file",
    })),
    extractedApplication: distributions[0].applicationRoot,
    extractedAsar: asarRoot,
    claimExclusions: ["installed_on_garuda", "integrated_on_garuda", "released"],
  };
}

export async function validateLinuxDistribution(name, root, sourceIconSha256) {
  const cores = await findNamed(root, "reference-core");
  const asars = await findNamed(root, "app.asar");
  assert.equal(cores.length, 1, `${name} must contain exactly one Reference Core helper`);
  assert.equal(asars.length, 1, `${name} must contain exactly one app.asar`);
  await assertExecutableRegularFile(cores[0]);
  await assertRegularFile(asars[0]);
  const applicationRoot = path.dirname(path.dirname(asars[0]));
  const executable = path.join(applicationRoot, "reference-library");
  const chromiumSandbox = path.join(applicationRoot, "chrome-sandbox");
  await assertExecutableRegularFile(executable);
  await assertExecutableRegularFile(chromiumSandbox);
  await assertElfX8664(executable, `${name} application`);
  await assertElfX8664(cores[0], `${name} Reference Core`);

  const desktops = await findExtension(root, ".desktop");
  const mimePackages = await findExtension(root, ".xml");
  let association = null;
  for (const desktopPath of desktops) {
    const desktop = await readFile(desktopPath, "utf8");
    if (!desktop.includes(MIME)) continue;
    assert.doesNotMatch(
      desktop,
      /--no-sandbox|--disable-setuid-sandbox/,
      `${name} association launches with a sandbox bypass`,
    );
    for (const mimePath of mimePackages) {
      const mimePackage = await readFile(mimePath, "utf8");
      if (!mimePackage.includes(MIME)) continue;
      try {
        assertDesktopAssociation(desktop, mimePackage);
        association = { desktopPath, mimePath };
        break;
      } catch {
        // Another packaged association may be the portable or installed form.
      }
    }
  }
  assert.ok(association, `${name} omits coherent .pitchlibrary association metadata`);
  const icons = await findNamed(root, "reference-library.png");
  assert.ok(icons.length > 0, `${name} omits the product-local icon`);
  const iconHashes = await Promise.all(icons.map(sha256File));
  assert.ok(
    iconHashes.includes(sourceIconSha256),
    `${name} does not contain the exact proposed product icon source raster`,
  );

  await run(process.execPath, [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "legal-bundle-contract.mjs"),
    "--directory",
    applicationRoot,
    "--electron-distribution",
  ]);
  return {
    name,
    applicationRoot,
    core: cores[0],
    asar: asars[0],
    coreSha256: await sha256File(cores[0]),
    asarSha256: await sha256File(asars[0]),
  };
}

async function assertElfX8664(file, label) {
  const { stdout } = await run("file", ["-b", file]);
  assert.match(stdout, /ELF 64-bit LSB.*x86-64/, `${label} is not an x86-64 ELF binary`);
}

async function assertRegularFile(file) {
  const metadata = await lstat(file);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), `not a regular file: ${file}`);
}

async function assertExecutableRegularFile(file) {
  await assertRegularFile(file);
  await access(file, 1);
}

async function findNamed(root, basename) {
  return findPaths(root, (file) => path.basename(file) === basename);
}

async function findExtension(root, extension) {
  return findPaths(root, (file) => file.endsWith(extension));
}

async function findPaths(root, predicate) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && predicate(file)) found.push(file);
    }
  }
  return found.sort();
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, { maxBuffer: 16 * 1024 * 1024, ...options });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} failed${detail ? `:\n${detail}` : ""}`, { cause: error });
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const invoked = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const { values } = parseArgs({
    options: {
      repository: { type: "string", default: "." },
      directory: { type: "string", default: "release/linux" },
      "extract-root": { type: "string" },
    },
  });
  if (!values["extract-root"]) throw new Error("--extract-root is required");
  const repository = path.resolve(values.repository);
  const result = await validateLinuxArtifactSet({
    repository,
    releaseDirectory: path.resolve(values.directory),
    extractionRoot: path.resolve(values["extract-root"]),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
