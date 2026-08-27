const MAXIMUM_SESSION_RESOURCE_LEASES = 64;

export class SessionResourceAuthority {
  #active = null;
  #generation = 0;
  #leases = new Map();
  #sequence = 0;

  get activeLeaseCount() { return this.#leases.size; }

  adopt(sessionId) {
    assertSessionId(sessionId);
    if (this.#active?.sessionId === sessionId) return this.#active.generation;
    if (this.#leases.size > 0) throw namedError("ResourceAuthorityTransitionIncomplete");
    this.#generation += 1;
    this.#active = Object.freeze({ sessionId, generation: this.#generation });
    return this.#active.generation;
  }

  acquire(sessionId, requestSignal) {
    assertSessionId(sessionId);
    const active = this.#active;
    if (!active || active.sessionId !== sessionId) throw namedError("SessionClosed");
    if (this.#leases.size >= MAXIMUM_SESSION_RESOURCE_LEASES) {
      throw namedError("ResourceStreamCapacityExceeded");
    }

    const token = ++this.#sequence;
    const controller = new AbortController();
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const onRequestAbort = () => controller.abort(requestSignal?.reason);
    requestSignal?.addEventListener("abort", onRequestAbort, { once: true });
    if (requestSignal?.aborted) onRequestAbort();

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      requestSignal?.removeEventListener("abort", onRequestAbort);
      this.#leases.delete(token);
      resolveDone();
    };
    const lease = {
      token,
      sessionId,
      generation: active.generation,
      controller,
      signal: controller.signal,
      done,
      release,
    };
    this.#leases.set(token, lease);
    return Object.freeze({
      sessionId,
      generation: active.generation,
      signal: controller.signal,
      done,
      release,
    });
  }

  async revoke(sessionId) {
    assertSessionId(sessionId);
    if (this.#active?.sessionId === sessionId) {
      this.#active = null;
      this.#generation += 1;
    }
    await this.#abortAndDrain((lease) => lease.sessionId === sessionId);
  }

  async revokeAll() {
    this.#active = null;
    this.#generation += 1;
    await this.#abortAndDrain(() => true);
  }

  async #abortAndDrain(matches) {
    const leases = [...this.#leases.values()].filter(matches);
    for (const lease of leases) lease.controller.abort(namedError("SessionClosed"));
    await Promise.all(leases.map((lease) => lease.done));
  }
}

function assertSessionId(sessionId) {
  if (typeof sessionId !== "string" || !sessionId) throw new TypeError("sessionId must be an opaque identifier");
}

function namedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export const sessionResourceLimits = Object.freeze({
  maximumSessionResourceLeases: MAXIMUM_SESSION_RESOURCE_LEASES,
});
