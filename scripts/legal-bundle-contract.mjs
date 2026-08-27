#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    directory: { type: "string", default: "." },
    "electron-distribution": { type: "boolean", default: false },
  },
});
const directory = path.resolve(values.directory);
const required = ["DEPENDENCY-LICENSES.json", "THIRD_PARTY-NOTICES.txt", "LICENSE", "NOTICE"];
if (values["electron-distribution"]) {
  required.push("LICENSE.electron.txt", "LICENSES.chromium.html");
}
await Promise.all(required.map((file) => access(path.join(directory, file))));

const inventory = JSON.parse(
  await readFile(path.join(directory, "DEPENDENCY-LICENSES.json"), "utf8"),
);
assert.equal(inventory.schemaVersion, 2);
assert.equal(inventory.generated, true);
assert.deepEqual(Object.keys(inventory.scope.cargo.targets).sort(), [
  "linux-x86_64",
  "macos-arm64",
]);
assert.ok(inventory.packages.some((item) =>
  item.ecosystem === "npm" &&
  item.name === "electron" &&
  item.shippedIn.includes("electron-runtime")));
assert.ok(inventory.packages.some((item) =>
  item.ecosystem === "cargo" &&
  item.shippedIn.includes("linux-x86_64") &&
  item.shippedIn.includes("macos-arm64")));
assert.ok(inventory.packages.every((item) => item.license && item.shippedIn.length > 0));
process.stdout.write(
  `legal bundle OK: ${inventory.packages.length} shipped packages in ${directory}\n`,
);
