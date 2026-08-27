export class LibraryRecoveryCoordinator {
  #activeSession = null; #target = null; #writesFrozen = true; #failureEpoch = 0;
  get activeSession() { return this.#activeSession; }
  get writesFrozen() { return this.#writesFrozen; }
  get retainedRootCount() { return this.#target?.roots.size ?? 0; }
  snapshot() {
    if (!this.#activeSession || !this.#target) return null;
    return {
      session: { ...this.#activeSession },
      path: this.#target.path,
      roots: new Map(this.#target.roots),
    };
  }
  markCoreReady() {
    if (this.#target) throw new Error("A Library recovery is still required");
    this.#writesFrozen = false;
  }
  adoptSession(opened, libraryPath, roots = new Map()) {
    this.#activeSession = { ...opened, path: libraryPath };
    this.#target = { path: libraryPath, roots: new Map(roots) };
  }
  rememberRoot(rootId, authorizedPath) {
    if (!this.#activeSession || !this.#target) throw new Error("Cannot retain a Root without an active Library");
    this.#target.roots.set(rootId, authorizedPath);
  }
  clearLibrary() { this.#activeSession = null; this.#target = null; }
  markCoreFailure() { this.#failureEpoch += 1; this.#writesFrozen = true; this.#activeSession = null; }
  async recover({ restartCore, openLibrary, bindRoot, closeLibrary }) {
    this.markCoreFailure();
    const epoch = this.#failureEpoch;
    let provisional = null;
    try {
      await restartCore(); this.#assertCurrent(epoch);
      if (!this.#target) { this.#writesFrozen = false; return null; }
      provisional = await openLibrary(this.#target.path); this.#assertCurrent(epoch);
      for (const [rootId, authorizedPath] of this.#target.roots) {
        await bindRoot(provisional.sessionId, rootId, authorizedPath); this.#assertCurrent(epoch);
      }
      this.#activeSession = { ...provisional, path: this.#target.path };
      this.#writesFrozen = false;
      return provisional;
    } catch (error) {
      this.#activeSession = null; this.#writesFrozen = true;
      if (provisional?.sessionId && closeLibrary) try { await closeLibrary(provisional.sessionId); } catch {}
      throw error;
    }
  }
  #assertCurrent(epoch) { if (this.#failureEpoch !== epoch) throw new Error("Reference Core failed again during recovery"); }
}
