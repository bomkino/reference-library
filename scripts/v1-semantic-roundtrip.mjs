#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CoreSupervisor } from "../apps/linux/src/core-supervisor.mjs";
import { collectCanonicalProof, expectResult } from "./lib/v1-canonical-proof.mjs";

const PNG_HEX = "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f49444154789c63ac903bc1c0c00000069401602d1176ec0000000049454e44ae426082";
const WEBP_HEX = "524946463c000000574542505650382030000000f001009d012a0200010001402625a00274ba01f80004830000fef2eb7ffd958fa563e958fde0bff81f974e1880000000";

const coreIndex = process.argv.indexOf("--core");
const corePath = path.resolve(coreIndex >= 0 ? process.argv[coreIndex + 1] : "target/debug/reference-core");
const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-library-v1-roundtrip-"));
const libraryPath = path.join(temporary, "Project.pitchlibrary");
const rootPath = path.join(temporary, "Source Root");
const supervisors = [];

try {
  await mkdir(path.join(rootPath, "nested"), { recursive: true });
  await writeFile(path.join(rootPath, "alpha.png"), Buffer.from(PNG_HEX, "hex"));
  await writeFile(path.join(rootPath, "nested", "bravo.png"), Buffer.from(PNG_HEX, "hex"));
  await writeFile(path.join(rootPath, "charlie.webp"), Buffer.from(WEBP_HEX, "hex"));

  const electron = supervisor("garuda-electron-host-neutral");
  await electron.start();
  const opened = expectResult(
    await electron.request({
      method: "create_library",
      params: { path: libraryPath, name: "V1 Semantic Round Trip" },
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
  await waitForTerminalJob(electron, opened.sessionId, root.jobId, "completed");
  const firstPage = await queryAssets(electron, opened.sessionId, 3);
  const [alpha, bravo, charlie] = [...firstPage.items].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
  assert.ok(alpha && bravo && charlie);

  await updateAsset(electron, opened.sessionId, alpha.assetId, {
    customTitle: { action: "set", value: "Opening reference" },
    reviewState: "keep",
    note: { action: "set", value: "Chosen on the Electron-labelled host." },
  });
  const collection = expectResult(
    await electron.request({
      method: "create_collection",
      params: { sessionId: opened.sessionId, name: "Shared selects" },
    }),
    "collection_updated",
  ).collection;
  await setMembership(electron, opened.sessionId, collection.collectionId, [
    alpha.assetId,
    bravo.assetId,
  ]);
  const electronProof = await collectCanonicalProof(electron, opened.sessionId);
  await assertEditorialState(electron, opened.sessionId, {
    collectionId: collection.collectionId,
    members: [alpha.assetId, bravo.assetId],
    curated: [curatedAlpha(alpha.assetId)],
  });
  await close(electron, opened.sessionId);

  const swift = supervisor("swiftui-webkit-host-neutral");
  await swift.start();
  const reopened = expectResult(
    await swift.request({ method: "open_library", params: { path: libraryPath } }),
    "session_opened",
  );
  const swiftProof = await collectCanonicalProof(swift, reopened.sessionId);
  assert.deepEqual(swiftProof, electronProof);
  await assertEditorialState(swift, reopened.sessionId, {
    collectionId: collection.collectionId,
    members: [alpha.assetId, bravo.assetId],
    curated: [curatedAlpha(alpha.assetId)],
  });
  await updateAsset(swift, reopened.sessionId, charlie.assetId, {
    customTitle: { action: "set", value: "Counterpoint" },
    reviewState: "maybe",
    note: { action: "set", value: "Curated on the Swift-labelled host." },
  });
  await setMembership(swift, reopened.sessionId, collection.collectionId, [charlie.assetId]);
  const swiftFinalProof = await collectCanonicalProof(swift, reopened.sessionId);
  await close(swift, reopened.sessionId);

  const returnedHost = supervisor("garuda-electron-host-neutral-return");
  await returnedHost.start();
  const returned = expectResult(
    await returnedHost.request({ method: "open_library", params: { path: libraryPath } }),
    "session_opened",
  );
  const returnedProof = await collectCanonicalProof(returnedHost, returned.sessionId);
  assert.deepEqual(returnedProof, swiftFinalProof);
  await assertEditorialState(returnedHost, returned.sessionId, {
    collectionId: collection.collectionId,
    members: [alpha.assetId, bravo.assetId, charlie.assetId],
    curated: [
      curatedAlpha(alpha.assetId),
      {
        assetId: charlie.assetId,
        customTitle: "Counterpoint",
        reviewState: "maybe",
        note: "Curated on the Swift-labelled host.",
      },
    ],
  });
  await close(returnedHost, returned.sessionId);

  process.stdout.write(`${JSON.stringify({
    protocolVersion: 1,
    firstHost: "garuda-electron-host-neutral",
    secondHost: "swiftui-webkit-host-neutral",
    returnHost: "garuda-electron-host-neutral-return",
    assetCount: firstPage.total,
    curatedAssetCount: 2,
    collectionCount: 1,
    collectionMembershipCount: 3,
    semanticDiffCount: 0,
    canonicalDigest: swiftFinalProof.digest.digest,
    libraryIdStable:
      opened.libraryId === reopened.libraryId && reopened.libraryId === returned.libraryId,
  }, null, 2)}\n`);
} finally {
  await Promise.allSettled(supervisors.map((core) => core.stop()));
  await rm(temporary, { recursive: true, force: true });
}

function supervisor(clientName) {
  const core = new CoreSupervisor({ corePath, clientName });
  supervisors.push(core);
  return core;
}

async function close(core, sessionId) {
  expectResult(
    await core.request({ method: "close_library", params: { sessionId } }),
    "library_closed",
  );
  await core.stop();
}

async function queryAssets(core, sessionId, expected) {
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
  assert.equal(page.total, expected);
  return page;
}

async function waitForTerminalJob(core, sessionId, jobId, expectedState) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const page = expectResult(
      await core.request({
        method: "query_jobs",
        params: {
          sessionId,
          offset: 0,
          limit: 100,
          query: { rootId: null, states: [] },
        },
      }),
      "job_page",
    );
    const job = page.items.find((item) => item.jobId === jobId);
    if (job?.state === expectedState) return;
    if (job && ["cancelled", "failed", "core_restarted"].includes(job.state)) {
      throw new Error(`job ${jobId} reached unexpected terminal state ${job.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for job ${jobId} to become ${expectedState}`);
}

async function updateAsset(core, sessionId, assetId, patch) {
  const current = expectResult(
    await core.request({ method: "get_asset", params: { sessionId, assetId } }),
    "asset",
  );
  return expectResult(
    await core.request({
      method: "update_asset",
      params: { sessionId, assetId, expectedRevision: current.revision, patch },
    }),
    "asset_updated",
  ).asset;
}

async function setMembership(core, sessionId, collectionId, assetIds) {
  expectResult(
    await core.request({
      method: "set_collection_membership",
      params: { sessionId, collectionId, assetIds, member: true },
    }),
    "collection_membership_updated",
  );
}

async function assertEditorialState(core, sessionId, expected) {
  const collections = expectResult(
    await core.request({ method: "list_collections", params: { sessionId } }),
    "collections",
  ).items;
  assert.deepEqual(
    collections.map(({ collectionId, name, assetCount }) => ({ collectionId, name, assetCount })),
    [{
      collectionId: expected.collectionId,
      name: "Shared selects",
      assetCount: expected.members.length,
    }],
  );
  for (const assetId of expected.members) {
    const asset = expectResult(
      await core.request({ method: "get_asset", params: { sessionId, assetId } }),
      "asset",
    );
    assert.ok(asset.collectionIds.includes(expected.collectionId));
  }
  for (const curated of expected.curated) {
    const asset = expectResult(
      await core.request({
        method: "get_asset",
        params: { sessionId, assetId: curated.assetId },
      }),
      "asset",
    );
    assert.equal(asset.customTitle, curated.customTitle);
    assert.equal(asset.reviewState, curated.reviewState);
    assert.equal(asset.note, curated.note);
  }
}

function curatedAlpha(assetId) {
  return {
    assetId,
    customTitle: "Opening reference",
    reviewState: "keep",
    note: "Chosen on the Electron-labelled host.",
  };
}
