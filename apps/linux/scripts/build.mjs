import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(applicationRoot, "../..");
const distribution = path.join(applicationRoot, "dist");

await rm(distribution, { recursive: true, force: true });
await mkdir(path.join(distribution, "workspace"), { recursive: true });
for (const source of [
  "main.mjs",
  "preload.mjs",
  "core-supervisor.mjs",
  "bridge-contract.mjs",
  "resource-response.mjs",
  "resource-security.mjs",
]) {
  await cp(path.join(applicationRoot, "src", source), path.join(distribution, source));
}
await cp(
  path.join(repositoryRoot, "packages/workspace/dist"),
  path.join(distribution, "workspace"),
  { recursive: true },
);
console.log("built hardened Electron shell and shared workspace bundle");
