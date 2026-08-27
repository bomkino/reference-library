#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CoreSupervisor } from "../apps/linux/src/core-supervisor.mjs";

const PNG_HEX = "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f49444154789c63ac903bc1c0c00000069401602d1176ec0000000049454e44ae426082";
const WEBP_HEX = "524946463c000000574542505650382030000000f001009d012a0200010001402625a00274ba01f80004830000fef2eb7ffd958fa563e958fde0bff81f974e1880000000";

const coreIndex = process.argv.indexOf("--core");
const corePath = path.resolve(coreIndex >= 0 ? process.argv[coreIndex + 1] : "target/debug/reference-core");
const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-library-roundtrip-"));
const libraryPath = path.join(temporary, "Project.pitchlibrary");
const rootPath = path.join(temporary, "Source Root");

try {
  await mkdir(path.join(rootPath, "nested"), { recursive: true });
  await writeFile(path.join(rootPath, "alpha.png"), Buffer.from(PNG_HEX, "hex"));
  await writeFile(path.join(rootPath, "nested", "bravo.png"), Buffer.from(PNG_HEX, "hex"));
  await writeFile(path.join(rootPath, "charlie.webp"), Buffer.from(WEBP_HEX, "hex"));

  const electron = new CoreSupervisor({ corePath, clientName: "garuda-electron-host-neutral" });
  await electron.start();
  const opened = expectResult(
    await electron.request({
      method: "create_library",
      params: { path: libraryPath, name: "Semantic Round Trip" },
    }),
    "session_opened",
  );
  const root = expectResult(
    await electron.request({
      method: "add_root",
      params: {
        sessionId: opened.sessionId,
        authorizedPath: rootPath,
        displayName: "Source Root",
      },
    }),
    "root_added",
  );
  await waitForRootScan(electron, opened.sessionId, root.rootId, root.jobId);
  const firstPage = await waitForAssets(electron, opened.sessionId, 3);
  const electronMeaning = await canonicalMeaning(electron, opened.sessionId);
  await electron.request({ method: "close_library", params: { sessionId: opened.sessionId } });
  await electron.stop();

  const swift = new CoreSupervisor({ corePath, clientName: "swiftui-webkit-host-neutral" });
  await swift.start();
  const reopened = expectResult(
    await swift.request({ method: "open_library", params: { path: libraryPath } }),
    "session_opened",
  );
  const unboundRoot = await rootSummary(swift, reopened.sessionId, root.rootId);
  assert.equal(unboundRoot.state, "needs_permission");
  assert.equal(unboundRoot.authorized, false);
  const bound = expectResult(
    await swift.request({ method: "bind_root", params: {
      sessionId: reopened.sessionId,
      rootId: root.rootId,
      authorizedPath: rootPath,
    } }),
    "root_bound",
  ).root;
  assert.equal(bound.state, "connected");
  assert.equal(bound.authorized, true);
  const scan = expectResult(
    await swift.request({ method: "scan_root", params: {
      sessionId: reopened.sessionId,
      rootId: root.rootId,
    } }),
    "root_scan_started",
  );
  await waitForRootScan(swift, reopened.sessionId, root.rootId, scan.jobId);
  await waitForAssets(swift, reopened.sessionId, 3);
  const swiftMeaning = await canonicalMeaning(swift, reopened.sessionId);
  assert.deepEqual(swiftMeaning, electronMeaning);
  await swift.request({ method: "close_library", params: { sessionId: reopened.sessionId } });
  await swift.stop();

  process.stdout.write(`${JSON.stringify({
    protocolVersion: 1,
    firstHost: "garuda-electron-host-neutral",
    secondHost: "swiftui-webkit-host-neutral",
    assetCount: firstPage.total,
    semanticDiffCount: 0,
    libraryIdStable: opened.libraryId === reopened.libraryId,
  }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function waitForAssets(core, sessionId, expected) {
  const deadline = Date.now() + 20_000;
  let observed = "no page";
  while (Date.now() < deadline) {
    const page = expectResult(
      await core.request({
        method: "query_assets",
        params: {
          sessionId,
          offset: 0,
          limit: 100,
          projection: "contact_sheet_standard",
        },
      }),
      "asset_page",
    );
    observed = JSON.stringify(page);
    if (page.total === expected) return page;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expected} progressively discovered Assets; last page: ${observed}`);
}

async function canonicalMeaning(core, sessionId) {
  return expectResult(
    await core.request({ method: "canonical_digest", params: { sessionId } }),
    "canonical_digest",
  );
}

async function rootSummary(core, sessionId, rootId) {
  const roots = expectResult(
    await core.request({ method: "list_roots", params: { sessionId } }),
    "roots",
  ).items;
  const root = roots.find((item) => item.rootId === rootId);
  assert.ok(root, "retained Root must survive the cross-host reopen");
  return root;
}

async function waitForRootScan(core, sessionId, rootId, jobId) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const root = await rootSummary(core, sessionId, rootId);
    const jobs = expectResult(
      await core.request({ method: "query_jobs", params: {
        sessionId,
        offset: 0,
        limit: 100,
        query: { rootId, states: [] },
      } }),
      "job_page",
    ).items;
    const job = jobs.find((item) => item.jobId === jobId);
    if (job?.state === "completed" && root.state === "ready" && root.activeJobId === null) return root;
    if (job && ["cancelled", "failed", "core_restarted"].includes(job.state)) {
      throw new Error(`Root scan ${jobId} reached unexpected terminal state ${job.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for Root scan ${jobId} to settle`);
}

function expectResult(result, expected) {
  assert.equal(result?.result, expected, `expected ${expected}, got ${result?.result}`);
  return result.value;
}
