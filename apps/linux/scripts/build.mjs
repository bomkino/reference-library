import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(applicationRoot, "../..");
const distribution = path.join(applicationRoot, "dist");

export async function buildLinuxShell() {
  await rm(distribution, { recursive: true, force: true });
  await mkdir(path.join(distribution, "workspace"), { recursive: true });
  const modules = (await readdir(path.join(applicationRoot, "src")))
    .filter((entry) => entry.endsWith(".mjs"))
    .sort();
  for (const source of modules) {
    await cp(path.join(applicationRoot, "src", source), path.join(distribution, source));
  }
  await assertRuntimeImportClosure(distribution);
  for (const moduleName of modules.filter((entry) => !["main.mjs", "preload.mjs"].includes(entry))) {
    await import(`${pathToFileURL(path.join(distribution, moduleName)).href}?build-smoke=${Date.now()}`);
  }
  await cp(
    path.join(repositoryRoot, "packages/workspace/dist"),
    path.join(distribution, "workspace"),
    { recursive: true },
  );
  await mkdir(path.join(distribution, "legal"), { recursive: true });
  for (const source of ["DEPENDENCY-LICENSES.json", "THIRD_PARTY-NOTICES.txt", "LICENSE", "NOTICE"]) {
    await cp(path.join(repositoryRoot, source), path.join(distribution, "legal", source));
  }
  console.log(`built hardened Electron shell (${modules.length} runtime modules) and shared workspace bundle`);
}

export async function assertRuntimeImportClosure(directory) {
  const modules = (await readdir(directory)).filter((entry) => entry.endsWith(".mjs"));
  const moduleSet = new Set(modules);
  for (const moduleName of modules) {
    const source = await readFile(path.join(directory, moduleName), "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*)["'](\.\/[^"']+)["']/g)) {
      const imported = path.basename(match[1]);
      if (!moduleSet.has(imported)) {
        throw new Error(`Packaged runtime import is missing: ${moduleName} -> ${imported}`);
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildLinuxShell();
}
