import assert from "node:assert/strict";
import test from "node:test";

import { collectCanonicalProof } from "../lib/v1-canonical-proof.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;

test("bounded canonical proof binds every diagnostic page to the requested digest", async () => {
  const calls = [];
  const core = {
    async request(command) {
      calls.push(command);
      if (command.method === "canonical_digest") {
        return {
          result: "canonical_digest",
          value: {
            algorithm: "sha256",
            digest: DIGEST,
            counts: [
              { entity: "assets", count: 3 },
              { entity: "collections", count: 0 },
            ],
          },
        };
      }
      const { entity, cursor, snapshotDigest } = command.params;
      assert.equal(snapshotDigest, DIGEST);
      if (entity === "assets" && cursor === null) {
        return page(entity, cursor, 3, [{ id: "asset-1" }, { id: "asset-2" }], "asset-2");
      }
      if (entity === "assets" && cursor === "asset-2") {
        return page(entity, cursor, 3, [{ id: "asset-3" }], null);
      }
      if (entity === "collections" && cursor === null) {
        return page(entity, cursor, 0, [], null);
      }
      throw new Error(`unexpected fake request ${JSON.stringify(command)}`);
    },
  };

  const proof = await collectCanonicalProof(core, "session-1", { limit: 2 });
  assert.equal(proof.digest.digest, DIGEST);
  assert.equal(proof.pages.assets.length, 2);
  assert.equal(proof.pages.collections.length, 1);
  assert.equal(calls.filter(({ method }) => method === "canonical_page").length, 3);
});

test("bounded canonical proof rejects a page from another snapshot", async () => {
  const core = {
    async request(command) {
      if (command.method === "canonical_digest") {
        return {
          result: "canonical_digest",
          value: {
            algorithm: "sha256",
            digest: DIGEST,
            counts: [{ entity: "assets", count: 1 }],
          },
        };
      }
      return page(
        "assets",
        null,
        1,
        [{ id: "asset-1" }],
        null,
        `sha256:${"b".repeat(64)}`,
      );
    },
  };

  await assert.rejects(
    collectCanonicalProof(core, "session-1"),
    /Expected values to be strictly equal/,
  );
});

test("bounded canonical proof rejects an empty page that claims another cursor", async () => {
  const core = {
    async request(command) {
      if (command.method === "canonical_digest") {
        return {
          result: "canonical_digest",
          value: {
            algorithm: "sha256",
            digest: DIGEST,
            counts: [{ entity: "assets", count: 1 }],
          },
        };
      }
      return page("assets", null, 1, [], "asset-1");
    },
  };

  await assert.rejects(
    collectCanonicalProof(core, "session-1"),
    /cannot advance from an empty page/,
  );
});

function page(entity, cursor, total, records, nextCursor, snapshotDigest = DIGEST) {
  return {
    result: "canonical_page",
    value: {
      snapshotDigest,
      entity,
      cursor,
      total,
      records,
      nextCursor,
    },
  };
}
