export class LibraryRecoveryCoordinator {
  #activeSession = null; #target = null; #writesFrozen = true; #failureEpoch = 0;
  #inFlight = null; #unavailableRootIds = new Set();
  get activeSession() { return this.#activeSession; }
  get writesFrozen() { return this.#writesFrozen; }
  get retainedRootCount() { return this.#target?.roots.size ?? 0; }
  get unavailableRootIds() { return [...this.#unavailableRootIds]; }
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
    this.#unavailableRootIds.clear();
  }
  rememberRoot(rootId, authorizedPath) {
    if (!this.#activeSession || !this.#target) throw new Error("Cannot retain a Root without an active Library");
    this.#target.roots.set(rootId, authorizedPath);
    this.#unavailableRootIds.delete(rootId);
  }
  clearLibrary() { this.#activeSession = null; this.#target = null; this.#unavailableRootIds.clear(); }
  markCoreFailure() { this.#failureEpoch += 1; this.#writesFrozen = true; this.#activeSession = null; }
  recover({ restartCore, openLibrary, bindRoot, closeLibrary, runTransition = (operation) => operation() }) {
    if (this.#inFlight) return this.#inFlight;
    const operation = Promise.resolve().then(() => runTransition(() =>
      this.#recoverOnce({ restartCore, openLibrary, bindRoot, closeLibrary })));
    const tracked = operation.finally(() => { if (this.#inFlight === tracked) this.#inFlight = null; });
    this.#inFlight = tracked;
    return tracked;
  }
  async #recoverOnce({ restartCore, openLibrary, bindRoot, closeLibrary }) {
    if (!this.#writesFrozen) this.markCoreFailure();
    const epoch = this.#failureEpoch;
    let provisional = null;
    const unavailable = new Set();
    try {
      await restartCore(); this.#assertCurrent(epoch);
      if (!this.#target) { this.#writesFrozen = false; return null; }
      provisional = await openLibrary(this.#target.path); this.#assertCurrent(epoch);
      for (const [rootId, authorizedPath] of this.#target.roots) {
        try { await bindRoot(provisional.sessionId, rootId, authorizedPath); }
        catch { this.#assertCurrent(epoch); unavailable.add(rootId); }
        this.#assertCurrent(epoch);
      }
      this.#activeSession = { ...provisional, path: this.#target.path };
      this.#unavailableRootIds = unavailable;
      this.#writesFrozen = false;
      return provisional;
    } catch (error) {
      this.#activeSession = null; this.#writesFrozen = true;
      this.#unavailableRootIds.clear();
      if (provisional?.sessionId && closeLibrary) try { await closeLibrary(provisional.sessionId); } catch {}
      throw error;
    }
  }
  #assertCurrent(epoch) { if (this.#failureEpoch !== epoch) throw new Error("Reference Core failed again during recovery"); }
}
