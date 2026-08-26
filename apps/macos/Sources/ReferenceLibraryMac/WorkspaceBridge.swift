import Foundation
import WebKit

final class WorkspaceBridge: NSObject, WKScriptMessageHandlerWithReply {
    private weak var model: AppModel?

    init(model: AppModel) {
        self.model = model
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.name == "referenceCommand",
              message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.scheme == "pitchdog-ui",
              message.frameInfo.request.url?.host == "app",
              let body = message.body as? [String: Any],
              let command = body["command"] as? String,
              let model else {
            replyHandler(nil, "Untrusted or malformed workspace command.")
            return
        }
        let payload = body["payload"] as? [String: Any] ?? [:]
        Task { @MainActor in
            do {
                let result = try await model.handleBridge(command: command, payload: payload)
                replyHandler(result, nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        }
    }

    static let bootstrap = #"""
    (() => {
      const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const profiles = new Set(['grid_standard', 'preview']);
      const projections = new Set(['contact_sheet_tiny', 'contact_sheet_standard', 'contact_sheet_detailed']);
      const listeners = new Set();
      const native = window.webkit.messageHandlers.referenceCommand;
      const call = (command, payload = {}) => native.postMessage({command, payload}).then((json) => JSON.parse(json));
      const opaque = (value, name) => {
        if (typeof value !== 'string' || !id.test(value)) throw new TypeError(`${name} must be an opaque UUID`);
        return value;
      };
      const bridge = Object.freeze({
        version: 1,
        createLibrary: (name) => call('createLibrary', {name}),
        openLibrary: () => call('openLibrary'),
        closeLibrary: (sessionId) => call('closeLibrary', {sessionId: opaque(sessionId, 'sessionId')}),
        chooseRoot: (sessionId) => call('chooseRoot', {sessionId: opaque(sessionId, 'sessionId')}),
        queryAssets: (input) => {
          opaque(input?.sessionId, 'sessionId');
          if (!Number.isSafeInteger(input?.offset) || input.offset < 0) throw new TypeError('offset must be non-negative');
          if (!Number.isSafeInteger(input?.limit) || input.limit < 1 || input.limit > 250) throw new TypeError('limit must be 1...250');
          if (!projections.has(input?.projection)) throw new TypeError('unknown projection');
          return call('queryAssets', input);
        },
        assetResourceUrl: ({sessionId, assetId, profile}) => {
          opaque(sessionId, 'sessionId'); opaque(assetId, 'assetId');
          if (!profiles.has(profile)) throw new TypeError('unsupported resource profile');
          return `pitchdog-asset://${sessionId}/${assetId}/${profile}`;
        },
        revealLocation: (sessionId, locationId) => call('revealLocation', {
          sessionId: opaque(sessionId, 'sessionId'), locationId: opaque(locationId, 'locationId')
        }),
        queryCapabilities: (sessionId) => call('queryCapabilities', sessionId ? {sessionId: opaque(sessionId, 'sessionId')} : {}),
        canonicalDump: (sessionId) => call('canonicalDump', {sessionId: opaque(sessionId, 'sessionId')}),
        restartCore: () => call('restartCore'),
        subscribe: (listener) => {
          if (typeof listener !== 'function') throw new TypeError('listener must be a function');
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      });
      Object.defineProperty(window, 'referenceLibrary', {value: bridge, configurable: false, writable: false});
      Object.defineProperty(window, '__referenceLibraryReceiveEvent', {
        value: (event) => { for (const listener of [...listeners]) listener(event); },
        configurable: false,
        writable: false
      });
    })();
    """#
}
