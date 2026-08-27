const FORBIDDEN_SANDBOX_SWITCHES = Object.freeze([
  "--no-sandbox",
  "--disable-setuid-sandbox",
]);

export function forbiddenSandboxArgument(argv) {
  if (!Array.isArray(argv)) throw new TypeError("argv must be an array");
  return argv.find((argument) => FORBIDDEN_SANDBOX_SWITCHES.some(
    (value) => argument === value || argument.startsWith(`${value}=`),
  )) ?? null;
}

export function installNavigationGuards(webContents, isTrustedWorkspaceUrl) {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event, url) => {
    if (!isTrustedWorkspaceUrl(url)) event.preventDefault();
  });
  webContents.on("will-attach-webview", (event) => event.preventDefault());
}
