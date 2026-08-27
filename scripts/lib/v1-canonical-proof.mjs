import assert from "node:assert/strict";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

export async function collectCanonicalProof(core, sessionId, { limit = 250 } = {}) {
  assert.equal(typeof sessionId, "string");
  assert.ok(sessionId.length > 0);
  assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= 250);

  const digest = expectResult(
    await core.request({ method: "canonical_digest", params: { sessionId } }),
    "canonical_digest",
  );
  assert.match(digest.digest, SHA256_DIGEST);
  assert.equal(digest.algorithm, "sha256");
  assert.ok(Array.isArray(digest.counts));

  const pages = {};
  const entities = new Set();
  for (const { entity, count } of digest.counts) {
    assert.equal(typeof entity, "string");
    assert.ok(!entities.has(entity), `duplicate canonical count for ${entity}`);
    entities.add(entity);
    assert.ok(Number.isSafeInteger(count) && count >= 0);

    pages[entity] = [];
    const cursors = new Set();
    let cursor = null;
    let observed = 0;
    do {
      const cursorKey = cursor ?? "<start>";
      assert.ok(!cursors.has(cursorKey), `${entity} repeated diagnostic cursor ${cursorKey}`);
      cursors.add(cursorKey);

      const page = expectResult(
        await core.request({
          method: "canonical_page",
          params: {
            sessionId,
            snapshotDigest: digest.digest,
            entity,
            cursor,
            limit,
          },
        }),
        "canonical_page",
      );
      assert.equal(page.snapshotDigest, digest.digest);
      assert.equal(page.entity, entity);
      assert.equal(page.total, count);
      assert.ok(Array.isArray(page.records));
      assert.ok(page.records.length <= limit);
      assert.equal(page.cursor, cursor);
      assert.ok(page.nextCursor === null || typeof page.nextCursor === "string");
      if (page.nextCursor !== null) {
        assert.ok(page.records.length > 0, `${entity} cannot advance from an empty page`);
      }
      observed += page.records.length;
      pages[entity].push(page);
      cursor = page.nextCursor;
    } while (cursor !== null);

    assert.equal(observed, count, `${entity} diagnostic pages must cover the digest count`);
  }
  return { digest, pages };
}

export function expectResult(result, expected) {
  assert.equal(result?.result, expected, `expected ${expected}, got ${result?.result}`);
  return result.value;
}
