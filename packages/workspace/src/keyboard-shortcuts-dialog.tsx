import { handleDialogKey } from "./dialog-keys";

export function KeyboardShortcutsDialog(props: { onClose(): void }) {
  return (
    <section className="shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcut-title" onKeyDown={(event) => handleDialogKey(event, props.onClose)}>
      <header>
        <div><p className="eyebrow">Keyboard</p><h2 id="shortcut-title">Move at research speed.</h2></div>
        <button autoFocus className="button--secondary" onClick={props.onClose}>Close</button>
      </header>
      <div className="shortcut-dialog__grid">
        <ShortcutGroup title="Browse" items={[["← ↑ ↓ →", "Move through Assets"],["Enter", "Preview or open"],["X", "Add or remove from Shortlist"],["Shift + click", "Shortlist a visible range"],["C", "Open Compare"]]} />
        <ShortcutGroup title="Decide" items={[["1", "Keep"],["2", "Maybe"],["3", "Reject"],["0", "Clear review"],["Esc", "Close the active surface"]]} />
      </div>
      <p className="shortcut-dialog__note">Shortcuts act only when an Asset or decision surface has focus. Unsaved Inspector work is protected.</p>
    </section>
  );
}

function ShortcutGroup(props: { title: string; items: string[][] }) {
  return <section><h3>{props.title}</h3><dl>{props.items.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>)}</dl></section>;
}
