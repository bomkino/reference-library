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
const MAX_ARCHIVE_ENTRIES = 100_000;
const MAX_ARCHIVE_PATH_BYTES = 4_096;

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

  await preflightLinuxArtifacts({
    pacman: artifacts[artifactNames[0]],
    appImage: artifacts[artifactNames[1]],
    tar: artifacts[artifactNames[2]],
  });
  await mkdir(extractionRoot, { recursive: false });
  const pacmanRoot = path.join(extractionRoot, "pacman");
  const tarRoot = path.join(extractionRoot, "tar");
  const appImageRoot = path.join(extractionRoot, "appimage");
  await Promise.all([pacmanRoot, tarRoot, appImageRoot].map((directory) => mkdir(directory)));
  await run("bsdtar", ["-xf", artifacts[artifactNames[0]], "-C", pacmanRoot]);
  await run("tar", ["-xzf", artifacts[artifactNames[2]], "-C", tarRoot]);
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

export async function preflightLinuxArtifacts(
  { pacman, appImage, tar },
  { inspectTar = preflightTarArchive, inspectAppImage = preflightAppImage } = {},
) {
  await inspectTar(pacman, "pacman");
  await inspectTar(tar, "tar.gz");
  await inspectAppImage(appImage, "AppImage");
}

export function assertSafeArchiveListing({ entries, verboseLines, label = "archive" }) {
  assert.ok(Array.isArray(entries) && entries.length > 0, `${label} archive listing is empty`);
  assert.ok(entries.length <= MAX_ARCHIVE_ENTRIES, `${label} archive has too many entries`);
  assert.equal(verboseLines.length, entries.length, `${label} archive listing is structurally ambiguous`);
  const normalized = new Map();
  for (const entry of entries) {
    const safe = normalizeArchivePath(entry, label);
    assert.ok(!normalized.has(safe), `${label} archive contains a duplicate path`);
    normalized.set(safe, entry);
  }
  const entriesByLength = [...entries].sort((left, right) => right.length - left.length);
  for (const line of verboseLines) {
    assert.match(line, /^[bcdhlps-][rwxStT-]{9}\s/, `${label} archive has an ambiguous metadata line`);
    if (line.startsWith("l")) {
      const marker = " -> ";
      const split = line.lastIndexOf(marker);
      assert.ok(split > 0, `${label} symbolic link target is missing`);
      const entry = listedEntryAtEnd(line.slice(0, split), entriesByLength, label);
      assertSafeLinkTarget(normalized.get(normalizeArchivePath(entry, label)), line.slice(split + marker.length), label, false);
    } else if (line.includes(" link to ")) {
      const marker = " link to ";
      const split = line.lastIndexOf(marker);
      const entry = listedEntryAtEnd(line.slice(0, split), entriesByLength, label);
      normalizeArchivePath(entry, label);
      normalizeArchivePath(line.slice(split + marker.length), label);
    }
  }
  return { entryCount: entries.length };
}

async function preflightTarArchive(archive, label) {
  const options = { env: { ...process.env, LC_ALL: "C" } };
  const [{ stdout: listed }, { stdout: verbose }] = await Promise.all([
    run("bsdtar", ["-tf", archive], options),
    run("bsdtar", ["-tvf", archive], options),
  ]);
  return assertSafeArchiveListing({
    entries: outputLines(listed, label),
    verboseLines: outputLines(verbose, label),
    label,
  });
}

async function preflightAppImage(archive, label) {
  await chmod(archive, 0o755);
  const { stdout } = await run(archive, ["--appimage-offset"]);
  const offset = stdout.trim();
  assert.match(offset, /^[1-9][0-9]{0,15}$/, `${label} filesystem offset is invalid`);
  const options = { env: { ...process.env, LC_ALL: "C" } };
  const [{ stdout: listed }, { stdout: verbose }] = await Promise.all([
    run("unsquashfs", ["-l", "-o", offset, archive], options),
    run("unsquashfs", ["-ll", "-o", offset, archive], options),
  ]);
  const entries = outputLines(listed, label).filter((line) => line.startsWith("squashfs-root"));
  const verboseLines = outputLines(verbose, label).filter((line) =>
    /^[bcdhlps-][rwxStT-]{9}\s/.test(line) && line.includes("squashfs-root"));
  return assertSafeArchiveListing({ entries, verboseLines, label });
}

function outputLines(output, label) {
  assert.ok(Buffer.byteLength(output, "utf8") <= 16 * 1024 * 1024, `${label} archive listing is too large`);
  const lines = output.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  assert.ok(lines.every((line) => line.length > 0), `${label} archive contains a control character`);
  return lines;
}

function normalizeArchivePath(value, label) {
  assert.equal(typeof value, "string", `${label} archive path must be text`);
  assert.ok(Buffer.byteLength(value, "utf8") <= MAX_ARCHIVE_PATH_BYTES, `${label} archive path is too long`);
  assert.doesNotMatch(value, /[\0-\x1f\x7f\\]/, `${label} archive path contains an unsafe character`);
  assert.doesNotMatch(value, / -> | link to /, `${label} archive path is ambiguous`);
  assert.ok(!path.posix.isAbsolute(value) && !/^[A-Za-z]:/.test(value), `${label} archive path is absolute`);
  let candidate = value;
  while (candidate.startsWith("./")) candidate = candidate.slice(2);
  if (candidate === "." || candidate === "") return ".";
  const components = candidate.split("/").filter((component, index, values) =>
    !(component === "" && index === values.length - 1));
  assert.ok(components.every((component) => component && component !== "." && component !== ".."),
    `${label} archive path traverses its extraction root`);
  const normalized = path.posix.normalize(components.join("/"));
  assert.ok(normalized !== ".." && !normalized.startsWith("../") && !path.posix.isAbsolute(normalized),
    `${label} archive path escapes its extraction root`);
  return normalized;
}

function listedEntryAtEnd(metadata, entries, label) {
  const matches = entries.filter((entry) => metadata === entry || metadata.endsWith(` ${entry}`));
  assert.equal(matches.length, 1, `${label} archive link metadata is ambiguous`);
  return matches[0];
}

function assertSafeLinkTarget(entry, target, label) {
  assert.doesNotMatch(target, /[\0-\x1f\x7f\\]/, `${label} archive link target contains an unsafe character`);
  assert.ok(!path.posix.isAbsolute(target) && !/^[A-Za-z]:/.test(target), `${label} archive link target is absolute`);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry), target));
  assert.ok(resolved !== ".." && !resolved.startsWith("../") && !path.posix.isAbsolute(resolved),
    `${label} archive link escapes its extraction root`);
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
