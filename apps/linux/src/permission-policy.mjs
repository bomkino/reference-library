const downloadDisabledSessions = new WeakSet();

export function denyAllSessionPermissions(session) {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}

export function disableSessionDownloads(session) {
  if (downloadDisabledSessions.has(session)) return;
  downloadDisabledSessions.add(session);
  session.on("will-download", (event, item) => {
    event.preventDefault();
    item.cancel();
  });
}
