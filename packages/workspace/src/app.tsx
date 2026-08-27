import { useEffect, useMemo, useState } from "react";
import type {
  AssetSummary,
  InterfaceScale,
  ReferenceWorkspaceBridge,
  SessionOpened,
  WorkspaceEvent,
} from "@pitchdog/reference-bridge";
import { ContactSheet } from "./contact-sheet";
import { refreshSelectedAsset } from "./selection";
import { useAssetPager } from "./use-asset-pager";

const INTERFACE_SCALES: InterfaceScale[] = [0.8, 1, 1.25, 1.5];

export function App() {
  const bridge = window.referenceLibrary;
  if (!bridge || bridge.version !== 1) {
    return <FatalState message="Native Reference Library bridge is unavailable." />;
  }
  return <LibraryWorkspace bridge={bridge} />;
}

function LibraryWorkspace({ bridge }: { bridge: ReferenceWorkspaceBridge }) {
  const [session, setSession] = useState<SessionOpened | null>(null);
  const [interfaceScale, setInterfaceScale] = useState<InterfaceScale>(1);
  const [thumbnailSize, setThumbnailSize] = useState(220);
  const [selected, setSelected] = useState<AssetSummary | null>(null);
  const [preview, setPreview] = useState<AssetSummary | null>(null);
  const [rootState, setRootState] = useState("No Root authorized");
  const [eventPulse, setEventPulse] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(interfaceScale));
  }, [interfaceScale]);

  useEffect(
    () =>
      bridge.subscribe((event: WorkspaceEvent) => {
        if (event.event === "root_state_changed") setRootState(event.value.state);
        if (event.event === "assets_inserted" || event.event === "job_updated") {
          setEventPulse((value) => value + 1);
        }
        if (event.event === "core_needs_restart") {
          setShellError("Reference Core stopped. Restart it to continue writing.");
          setNeedsRestart(true);
        }
      }),
    [bridge],
  );

  const openSession = async (mode: "create" | "open") => {
    setBusy(true);
    setShellError(null);
    try {
      const opened =
        mode === "create"
          ? await bridge.createLibrary("Project Reference Library")
          : await bridge.openLibrary();
      if (opened) {
        setSession(opened);
        setSelected(null);
        setRootState("No Root authorized");
      }
    } catch (reason) {
      setShellError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <main className="document-empty">
        <section className="document-empty__card" aria-busy={busy}>
          <p className="eyebrow">Reference Library</p>
          <h1>Your project’s visual memory.</h1>
          <p>Local. Manual. One Library per project.</p>
          <div className="button-row">
            <button disabled={busy} onClick={() => void openSession("create")}>
              New Library
            </button>
            <button className="button--secondary" disabled={busy} onClick={() => void openSession("open")}>
              Open Library
            </button>
          </div>
          {busy && <p role="status">Waiting for destination…</p>}
          {shellError && <p className="error-state" role="alert">{shellError}</p>}
        </section>
      </main>
    );
  }

  return (
    <OpenWorkspace
      bridge={bridge}
      session={session}
      interfaceScale={interfaceScale}
      thumbnailSize={thumbnailSize}
      selected={selected}
      preview={preview}
      rootState={rootState}
      eventPulse={eventPulse}
      shellError={shellError}
      needsRestart={needsRestart}
      busy={busy}
      setInterfaceScale={setInterfaceScale}
      setThumbnailSize={setThumbnailSize}
      setSelected={setSelected}
      setPreview={setPreview}
      setRootState={setRootState}
      setShellError={setShellError}
      onClose={async () => {
        setBusy(true);
        setShellError(null);
        try {
          await bridge.closeLibrary(session.sessionId);
          setSession(null);
          setSelected(null);
          setPreview(null);
          setRootState("No Root authorized");
          setNeedsRestart(false);
        } catch (reason) {
          setShellError(messageFrom(reason));
        } finally {
          setBusy(false);
        }
      }}
      onRestart={async () => {
        setBusy(true);
        try {
          const reopened = await bridge.restartCore();
          setSession(reopened);
          setSelected(null);
          setNeedsRestart(false);
          setShellError(null);
        } catch (reason) {
          setShellError(messageFrom(reason));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

interface OpenWorkspaceProps {
  bridge: ReferenceWorkspaceBridge;
  session: SessionOpened;
  interfaceScale: InterfaceScale;
  thumbnailSize: number;
  selected: AssetSummary | null;
  preview: AssetSummary | null;
  rootState: string;
  eventPulse: number;
  shellError: string | null;
  needsRestart: boolean;
  busy: boolean;
  setInterfaceScale(value: InterfaceScale): void;
  setThumbnailSize(value: number): void;
  setSelected(value: AssetSummary | null): void;
  setPreview(value: AssetSummary | null): void;
  setRootState(value: string): void;
  setShellError(value: string | null): void;
  onClose(): Promise<void>;
  onRestart(): Promise<void>;
}

function OpenWorkspace(props: OpenWorkspaceProps) {
  const pager = useAssetPager(props.bridge, props.session.sessionId, props.eventPulse);
  const countLabel = useMemo(
    () => `${pager.total.toLocaleString()} ${pager.total === 1 ? "Asset" : "Assets"}`,
    [pager.total],
  );

  useEffect(() => {
    const refreshedSelection = refreshSelectedAsset(props.selected, pager.items.values());
    if (refreshedSelection !== props.selected) props.setSelected(refreshedSelection);
    const refreshedPreview = refreshSelectedAsset(props.preview, pager.items.values());
    if (refreshedPreview !== props.preview) props.setPreview(refreshedPreview);
  }, [pager.items, props.preview, props.selected, props.setPreview, props.setSelected]);

  const chooseRoot = async () => {
    props.setShellError(null);
    try {
      const root = await props.bridge.chooseRoot(props.session.sessionId);
      if (root) props.setRootState("scanning");
    } catch (reason) {
      props.setShellError(messageFrom(reason));
    }
  };

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Editorial Contact Sheet</p>
          <h1>{props.session.name}</h1>
        </div>
        <div className="topbar__controls">
          <label>
            Interface
            <select
              value={props.interfaceScale}
              onChange={(event) =>
                props.setInterfaceScale(Number(event.target.value) as InterfaceScale)
              }
            >
              {INTERFACE_SCALES.map((scale) => (
                <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>
              ))}
            </select>
          </label>
          <label>
            Thumbnail density
            <input
              aria-label="Thumbnail density"
              max="340"
              min="140"
              step="20"
              type="range"
              value={props.thumbnailSize}
              onChange={(event) => props.setThumbnailSize(Number(event.target.value))}
            />
          </label>
          <button disabled={props.busy || props.needsRestart} onClick={() => void chooseRoot()}>
            Add Root
          </button>
          <button
            className="button--secondary"
            disabled={props.busy}
            onClick={() => void props.onClose()}
          >
            Close Library
          </button>
        </div>
      </header>
      <aside className="sidebar" aria-label="Library sources">
        <div>
          <p className="eyebrow">Library</p>
          <p className="sidebar__count">{countLabel}</p>
        </div>
        <div className="source-status">
          <span aria-hidden className={`status-dot status-dot--${props.rootState}`} />
          <div>
            <strong>Source Root</strong>
            <span>{props.rootState}</span>
          </div>
        </div>
      </aside>
      <section className="workspace-main" aria-label="Assets">
        {props.shellError && (
          <div className="error-banner" role="alert">
            <span>{props.shellError}</span>
            {props.needsRestart && (
              <button onClick={() => void props.onRestart()}>Restart Core</button>
            )}
          </div>
        )}
        {pager.error ? (
          <WorkspaceState title="Library query failed" detail={pager.error} action="Retry" onAction={pager.refresh} />
        ) : pager.loading && pager.total === 0 ? (
          <WorkspaceState title="Opening contact sheet" detail="Reading the first bounded Asset window…" />
        ) : pager.total === 0 ? (
          <WorkspaceState
            title="No stills yet"
            detail="Add one Root containing JPEG, PNG or WebP images. Assets will appear progressively."
            action="Add Root"
            onAction={() => void chooseRoot()}
          />
        ) : (
          <ContactSheet
            bridge={props.bridge}
            sessionId={props.session.sessionId}
            total={pager.total}
            items={pager.items}
            thumbnailSize={props.thumbnailSize}
            selectedAssetId={props.selected?.assetId ?? null}
            ensureWindow={pager.ensureWindow}
            onSelect={props.setSelected}
            onPreview={props.setPreview}
          />
        )}
      </section>
      <aside className="inspector" aria-label="Inspector">
        <h2>Summary</h2>
        {props.selected ? (
          <>
            <p className="inspector__name">{props.selected.displayName}</p>
            <dl>
              <dt>Review</dt><dd>{props.selected.reviewState}</dd>
              <dt>Availability</dt><dd>{props.selected.availability}</dd>
              <dt>Media</dt><dd>{props.selected.mediaFamily}</dd>
            </dl>
            <button
              className="button--secondary"
              onClick={() => void props.bridge.revealLocation(
                props.session.sessionId,
                props.selected!.locationId,
              ).catch((reason) => props.setShellError(messageFrom(reason)))}
            >
              Reveal Source
            </button>
          </>
        ) : (
          <p className="muted">Select an Asset. Inspector geometry stays put.</p>
        )}
      </aside>
      <div className="selection-announcer" aria-live="polite">
        {props.selected ? `Selected ${props.selected.displayName}` : "No Asset selected"}
      </div>
      {props.preview && (
        <AssetPreview
          asset={props.preview}
          source={props.bridge.assetResourceUrl({
            sessionId: props.session.sessionId,
            assetId: props.preview.assetId,
            profile: "preview",
          })}
          onClose={() => props.setPreview(null)}
        />
      )}
    </main>
  );
}

function AssetPreview(props: { asset: AssetSummary; source: string; onClose(): void }) {
  const [failed, setFailed] = useState(false);
  const unavailable = props.asset.availability !== "present";
  return (
    <div className="preview" role="dialog" aria-modal="true" aria-label={`Preview ${props.asset.displayName}`}>
      <button className="preview__close" autoFocus onClick={props.onClose}>Close Preview</button>
      {failed || unavailable ? (
        <div className="preview__error" role="alert">
          <strong>Preview unavailable</strong>
          <span>
            {unavailable
              ? `The source is ${props.asset.availability}. Its curation remains catalogued.`
              : "The original remains catalogued. Its source was not changed."}
          </span>
        </div>
      ) : (
        <img alt={props.asset.displayName} src={props.source} onError={() => setFailed(true)} />
      )}
    </div>
  );
}

function WorkspaceState(props: {
  title: string;
  detail: string;
  action?: string;
  onAction?(): void;
}) {
  return (
    <div className="workspace-state">
      <h2>{props.title}</h2>
      <p>{props.detail}</p>
      {props.action && <button onClick={props.onAction}>{props.action}</button>}
    </div>
  );
}

function FatalState({ message }: { message: string }) {
  return <main className="document-empty"><p className="error-state" role="alert">{message}</p></main>;
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Reference Library operation failed";
}
