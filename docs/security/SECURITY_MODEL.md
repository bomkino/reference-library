# Security, Privacy and Recovery

Reference Library treats local media, metadata, filenames, Library documents and renderer input as untrusted.

## Boundary

Native shells own dialogs, grants, reveal and helper supervision. Reference Core owns SQLite, domain commands, queries, indexing and authorization. Workspace is potentially compromised and receives only a frozen, versioned bridge of named operations and opaque IDs.

Prohibited renderer powers include `readFile(path)`, `writeFile(path, bytes)`, `runCommand(command)`, `querySql(sql)`, arbitrary IPC channels and arbitrary URL opening.

## T01 controls

- Electron: sandbox and context isolation enabled; Node integration and remote content disabled; restrictive CSP; custom local protocols.
- WebKit: bundled workspace; schema-validated messages; external navigation intercepted; opaque custom schemes.
- Resource requests validate grammar, session, Library, Asset, profile and limits; closed sessions cancel and deny requests; errors omit paths.
- Root authorization is explicit. Directory symlink traversal is disabled by default. Platform grant secrets remain outside neutral canonical state.
- SQL is parameterized. Migrations are bundled and sequential. One writer owns WAL and lock lifecycle. Future schema never downgrades silently.
- No analytics, crash upload, hidden update ping, external thumbnail service, AI API or automatic project-content support upload.

## Recovery

Helper exit freezes writes, retains last safe read projection, restarts core, reopens the Library and surfaces recovery state before writes resume. Corrupt Libraries are preserved and inspected read-only; caches are disposable.
