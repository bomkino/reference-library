import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { inspectCleanSource } from "../source-tree.mjs";

test("source identity requires exact HEAD and a clean worktree", async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), "reference-clean-source-"));
  try {
    git(repository, "init", "-q");
    await writeFile(path.join(repository, "tracked.txt"), "source\n");
    git(repository, "add", "tracked.txt");
    git(repository, "-c", "user.name=Codex Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "source");
    const commit = git(repository, "rev-parse", "HEAD");
    const source = await inspectCleanSource(repository, commit);
    assert.equal(source.state, "clean");
    assert.match(source.tree, /^[0-9a-f]{40}$/);
    await writeFile(path.join(repository, "untracked.txt"), "drift\n");
    await assert.rejects(inspectCleanSource(repository, commit), /source tree is not clean/);
    await assert.rejects(inspectCleanSource(repository, "f".repeat(40)), /source commit mismatch/);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

function git(repository, ...args) {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
}
