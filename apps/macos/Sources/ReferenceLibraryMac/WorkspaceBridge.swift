import Foundation
import WebKit

final class WorkspaceBridge: NSObject, WKScriptMessageHandlerWithReply {
    private weak var model: AppModel?
    init(model: AppModel) { self.model = model }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.name == "referenceCommand", message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.scheme == "pitchdog-ui",
              message.frameInfo.request.url?.host == "app",
              let body = message.body as? [String: Any],
              let command = body["command"] as? String, let model else {
            replyHandler(nil, "Untrusted or malformed workspace command."); return
        }
        let payload = body["payload"] as? [String: Any] ?? [:]
        Task { @MainActor in
            do { replyHandler(try await model.handleBridge(command: command, payload: payload), nil) }
            catch { replyHandler(nil, model.rendererMessage(for: error)) }
        }
    }

    static let bootstrap = #"""
    (() => {
      const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const profiles = new Set(['grid_standard', 'preview']);
      const projections = new Set(['contact_sheet_tiny', 'contact_sheet_standard', 'contact_sheet_detailed']);
      const listeners = new Set();
      const pendingEvents = [];
      const native = window.webkit.messageHandlers.referenceCommand;
      const call = (command, payload = {}) => native.postMessage({command, payload}).then((json) => JSON.parse(json));
      const opaque = (value, name) => {
        if (typeof value !== 'string' || !id.test(value)) throw new TypeError(`${name} must be an opaque UUID`);
        return value;
      };
      const bridge = Object.freeze({
        version: 3,
        createLibrary: (name) => call('createLibrary', {name}),
        openLibrary: () => call('openLibrary'),
        completeOpenIntent: (intentId, decision) => call('completeOpenIntent', {
          intentId: opaque(intentId, 'intentId'), decision
        }),
        closeLibrary: (sessionId) => call('closeLibrary', {sessionId: opaque(sessionId, 'sessionId')}),
        chooseRoot: (sessionId) => call('chooseRoot', {sessionId: opaque(sessionId, 'sessionId')}),
        listRoots: (sessionId) => call('listRoots', {sessionId: opaque(sessionId, 'sessionId')}),
        reauthorizeRoot: (sessionId, rootId) => call('reauthorizeRoot', {
          sessionId: opaque(sessionId, 'sessionId'), rootId: opaque(rootId, 'rootId')
        }),
        scanRoot: (sessionId, rootId) => call('scanRoot', {
          sessionId: opaque(sessionId, 'sessionId'), rootId: opaque(rootId, 'rootId')
        }),
        cancelJob: (sessionId, jobId) => call('cancelJob', {
          sessionId: opaque(sessionId, 'sessionId'), jobId: opaque(jobId, 'jobId')
        }),
        queryJobs: (input) => call('queryJobs', input),
        queryAssets: (input) => {
          opaque(input?.sessionId, 'sessionId');
          if (!Number.isSafeInteger(input?.offset) || input.offset < 0) throw new TypeError('offset must be non-negative');
          if (!Number.isSafeInteger(input?.limit) || input.limit < 1 || input.limit > 250) throw new TypeError('limit must be 1...250');
          if (!projections.has(input?.projection)) throw new TypeError('unknown projection');
          if (input?.expectedLibraryRevision !== undefined && input.expectedLibraryRevision !== null &&
              (!Number.isSafeInteger(input.expectedLibraryRevision) || input.expectedLibraryRevision < 0)) {
            throw new TypeError('expectedLibraryRevision must be a non-negative safe integer or null');
          }
          return call('queryAssets', input).then((value) => {
            if (value && Object.keys(value).length === 1 && value.kind === 'query_snapshot_changed') {
              throw Object.assign(new Error('QuerySnapshotChanged'), {code: 'QuerySnapshotChanged'});
            }
            return value;
          });
        },
        getAsset: (sessionId, assetId) => call('getAsset', {
          sessionId: opaque(sessionId, 'sessionId'), assetId: opaque(assetId, 'assetId')
        }),
        updateAsset: (input) => call('updateAsset', input),
        listCollections: (sessionId) => call('listCollections', {sessionId: opaque(sessionId, 'sessionId')}),
        createCollection: (sessionId, name) => call('createCollection', {
          sessionId: opaque(sessionId, 'sessionId'), name
        }),
        renameCollection: (sessionId, collectionId, expectedRevision, name) => call('renameCollection', {
          sessionId: opaque(sessionId, 'sessionId'), collectionId: opaque(collectionId, 'collectionId'), expectedRevision, name
        }),
        deleteCollection: (sessionId, collectionId) => call('deleteCollection', {
          sessionId: opaque(sessionId, 'sessionId'), collectionId: opaque(collectionId, 'collectionId')
        }),
        setCollectionMembership: (input) => call('setCollectionMembership', input),
        assetResourceUrl: ({sessionId, assetId, profile}) => {
          opaque(sessionId, 'sessionId'); opaque(assetId, 'assetId');
          if (!profiles.has(profile)) throw new TypeError('unsupported resource profile');
          return `pitchdog-asset://${sessionId}/${assetId}/${profile}`;
        },
        revealLocation: (sessionId, locationId) => call('revealLocation', {
          sessionId: opaque(sessionId, 'sessionId'), locationId: opaque(locationId, 'locationId')
        }),
        readPreferences: () => call('readPreferences'),
        writePreferences: (patch) => call('writePreferences', {patch}),
        queryCapabilities: (sessionId) => call('queryCapabilities', sessionId ? {sessionId: opaque(sessionId, 'sessionId')} : {}),
        restartCore: () => call('restartCore'),
        subscribe: (listener) => {
          if (typeof listener !== 'function') throw new TypeError('listener must be a function');
          listeners.add(listener);
          for (const event of pendingEvents.splice(0)) listener(event);
          return () => listeners.delete(listener);
        }
      });
      Object.defineProperty(window, 'referenceLibrary', {value: bridge, configurable: false, writable: false});
      Object.defineProperty(window, '__referenceLibraryReceiveEvent', {
        value: (event) => {
          if (listeners.size === 0) {
            pendingEvents.push(event);
            if (pendingEvents.length > 100) pendingEvents.shift();
          } else { for (const listener of [...listeners]) listener(event); }
        },
        configurable: false,
        writable: false
      });
    })();
    """#
}
