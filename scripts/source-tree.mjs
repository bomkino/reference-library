import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function inspectCleanSource(repository, expectedCommit) {
  const root = await git(repository, ["rev-parse", "--show-toplevel"]);
  if (path.resolve(root) !== path.resolve(repository)) {
    throw new Error(`source repository must be its Git root: ${repository}`);
  }
  const commit = await git(root, ["rev-parse", "HEAD"]);
  if (expectedCommit && commit !== expectedCommit) {
    throw new Error(`source commit mismatch: expected ${expectedCommit}, observed ${commit}`);
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("source commit is not a full Git SHA");
  const status = await git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) throw new Error(`source tree is not clean:\n${status}`);
  const tree = await git(root, ["rev-parse", "HEAD^{tree}"]);
  return { state: "clean", commit, tree };
}

async function git(repository, args) {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}
