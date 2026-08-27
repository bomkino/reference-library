import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { CoreSupervisor } from "../src/core-supervisor.mjs";

const corePath = fileURLToPath(
  new URL("../../../target/debug/reference-core", import.meta.url),
);
const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f49444154789c63ac903bc1c0c00000069401602d1176ec0000000049454e44ae426082",
  "hex",
);

test("Electron supervisor exercises the framed T01 lifecycle and restart seam", { timeout: 20_000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-library-electron-seam-"));
  const libraryPath = path.join(temporary, "Project.pitchlibrary");
  const rootPath = path.join(temporary, "stills");
  const events = [];
  const core = new CoreSupervisor({ corePath, enableTestCommands: true });
  core.on("event", (event) => events.push(event));

  try {
    await mkdir(rootPath);
    await writeFile(path.join(rootPath, "frame.png"), png);
    await core.start();

    const created = expectResult(
      await core.request({
        method: "create_library",
        params: { path: libraryPath, name: "Project" },
      }),
      "session_opened",
    );
    const added = expectResult(
      await core.request({
        method: "add_root",
        params: {
          sessionId: created.sessionId,
          authorizedPath: rootPath,
          displayName: "stills",
        },
      }),
      "root_added",
    );
    assert.match(added.rootId, /^[0-9a-f-]{36}$/);

    const page = await waitForAsset(core, created.sessionId);
    const asset = page.items[0];
    const descriptor = expectResult(
      await core.authorizeResource({
        sessionId: created.sessionId,
        assetId: asset.assetId,
        profile: "preview",
      }),
      "resource_authorized",
    );
    assert.equal(descriptor.assetId, asset.assetId);
    assert.equal(descriptor.contentLength, png.length);

    const firstMeaning = expectResult(
      await core.request({
        method: "canonical_digest",
        params: { sessionId: created.sessionId },
      }),
      "canonical_digest",
    );
    expectResult(
      await core.request({
        method: "close_library",
        params: { sessionId: created.sessionId },
      }),
      "library_closed",
    );
    await assert.rejects(
      core.authorizeResource({
        sessionId: created.sessionId,
        assetId: asset.assetId,
        profile: "preview",
      }),
      (error) => error.code === "SessionClosed" && !error.message.includes(temporary),
    );

    const reopened = expectResult(
      await core.request({ method: "open_library", params: { path: libraryPath } }),
      "session_opened",
    );
    const reopenedRoot = await rootSummary(core, reopened.sessionId, added.rootId);
    assert.equal(reopenedRoot.state, "needs_permission");
    assert.equal(reopenedRoot.authorized, false);
    assert.equal(reopenedRoot.activeJobId, null);
    await assert.rejects(core.request({ method: "test_crash" }), /stopped/i);
    await waitFor(() => events.some((event) => event.event === "core_needs_restart"));

    await core.restart();
    const recovered = expectResult(
      await core.request({ method: "open_library", params: { path: libraryPath } }),
      "session_opened",
    );
    assert.notEqual(recovered.sessionId, reopened.sessionId);
    const unboundRoot = await rootSummary(core, recovered.sessionId, added.rootId);
    assert.equal(unboundRoot.state, "needs_permission");
    assert.equal(unboundRoot.authorized, false);

    const bound = expectResult(
      await core.request({ method: "bind_root", params: {
        sessionId: recovered.sessionId,
        rootId: added.rootId,
        authorizedPath: rootPath,
      } }),
      "root_bound",
    ).root;
    assert.equal(bound.rootId, added.rootId);
    assert.equal(bound.state, "connected");
    assert.equal(bound.authorized, true);
    const scan = expectResult(
      await core.request({ method: "scan_root", params: {
        sessionId: recovered.sessionId,
        rootId: added.rootId,
      } }),
      "root_scan_started",
    );
    const settled = await waitForRootScan(core, recovered.sessionId, added.rootId, scan.jobId);
    assert.equal(settled.state, "ready");
    assert.equal(settled.authorized, true);
    assert.equal(settled.activeJobId, null);
    assert.equal(settled.observedCount, 1);
    await waitFor(() => events.some((event) =>
      event.event === "scan_progress_changed" &&
      event.value.jobId === scan.jobId && event.value.terminal === true));

    const recoveredMeaning = expectResult(
      await core.request({
        method: "canonical_digest",
        params: { sessionId: recovered.sessionId },
      }),
      "canonical_digest",
    );
    assert.deepEqual(recoveredMeaning, firstMeaning);
    expectResult(
      await core.request({
        method: "close_library",
        params: { sessionId: recovered.sessionId },
      }),
      "library_closed",
    );
  } finally {
    await core.stop();
    await rm(temporary, { recursive: true, force: true });
  }
});

async function waitForAsset(core, sessionId) {
  let page;
  await waitFor(async () => {
    page = expectResult(
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
    return page.total === 1;
  });
  return page;
}

async function rootSummary(core, sessionId, rootId) {
  const roots = expectResult(
    await core.request({ method: "list_roots", params: { sessionId } }),
    "roots",
  ).items;
  const root = roots.find((item) => item.rootId === rootId);
  assert.ok(root, "retained Root must remain in the reopened Library");
  return root;
}

async function waitForRootScan(core, sessionId, rootId, jobId) {
  let settled;
  await waitFor(async () => {
    settled = await rootSummary(core, sessionId, rootId);
    const jobs = expectResult(
      await core.request({ method: "query_jobs", params: {
        sessionId,
        offset: 0,
        limit: 100,
        query: { rootId, states: ["completed"] },
      } }),
      "job_page",
    ).items;
    return settled.state === "ready" && settled.activeJobId === null &&
      jobs.some((job) => job.jobId === jobId);
  });
  return settled;
}

function expectResult(result, expected) {
  assert.equal(result?.result, expected);
  return result.value;
}

async function waitFor(predicate, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for public-seam state");
}
