import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const repository = path.resolve(import.meta.dirname, "../..");

test("committed legal bundle equals exact locked production graphs", () => {
  const checked = spawnSync("python3", ["scripts/generate_dependency_licenses.py", "--check"], {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});

test("inventory separates shipped targets and retains Electron legal scope", async () => {
  const inventory = JSON.parse(
    await readFile(path.join(repository, "DEPENDENCY-LICENSES.json"), "utf8"),
  );
  assert.equal(inventory.schemaVersion, 2);
  assert.ok(inventory.scope.cargo.packageCounts["linux-x86_64"] > 0);
  assert.ok(inventory.scope.cargo.packageCounts["macos-arm64"] > 0);
  assert.ok(inventory.scope.npm.packageCounts["npm-production"] > 0);
  assert.ok(inventory.scope.npm.packageCounts["electron-runtime"] > 0);
  const electron = inventory.packages.find(
    (item) => item.ecosystem === "npm" && item.name === "electron",
  );
  assert.deepEqual(electron.shippedIn, ["electron-runtime"]);
  const phosphor = inventory.packages.find(
    (item) => item.ecosystem === "npm" && item.name === "@phosphor-icons/react",
  );
  assert.deepEqual(phosphor, {
    ecosystem: "npm",
    name: "@phosphor-icons/react",
    version: "2.1.10",
    license: "MIT",
    source: "https://registry.npmjs.org/@phosphor-icons/react/-/react-2.1.10.tgz",
    shippedIn: ["npm-production"],
  });
});
