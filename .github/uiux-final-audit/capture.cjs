const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const output = process.env.SCREENSHOT_DIR;
fs.mkdirSync(output, { recursive: true });

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(source);
}

async function waitFor(window, label, expression) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(window, `Boolean(${expression})`)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function clickText(window, selector, text) {
  await evaluate(window, `(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((element) => element.textContent.trim().startsWith(${JSON.stringify(text)}));
    if (!node) throw new Error("Missing ${text} in ${selector}");
    node.click();
  })()`);
  await wait(100);
}

async function capture(window, name) {
  await wait(180);
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
  console.log(`[audit] ${name} ${image.getSize().width}x${image.getSize().height}`);
}

async function assertExclusive(window, label) {
  const state = await evaluate(window, `({
    library: Boolean(document.querySelector('.sidebar--drawer-open')),
    inspector: Boolean(document.querySelector('.inspector--drawer-open')),
    backdrop: Boolean(document.querySelector('.workspace-drawer-backdrop')),
    width: window.innerWidth,
  })`);
  if (state.library && state.inspector) throw new Error(`${label}: both drawers are open`);
  return state;
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1728,
    height: 1117,
    show: true,
    backgroundColor: "#eef2ff",
    webPreferences: {
      preload: process.env.PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await window.loadFile(process.env.INDEX_HTML);
    await evaluate(window, `(() => {
      const style = document.createElement('style');
      style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }';
      document.head.appendChild(style);
    })()`);
    await waitFor(window, "first run", "document.querySelector('.document-empty')");
    await capture(window, "00-first-run");

    await clickText(window, ".document-empty button", "New Library");
    await waitFor(window, "workspace", "document.querySelector('.workspace-shell')");
    await waitFor(window, "assets", "document.querySelector('[data-asset-id=\"asset-1\"]')");
    await wait(500);
    await capture(window, "01-wide-canvas");

    await evaluate(window, `document.querySelector('[data-asset-id="asset-1"]').click()`);
    await waitFor(window, "wide inspector", "document.querySelector('.inspector--active')");
    await capture(window, "02-wide-inspector");

    for (const assetId of ["asset-1", "asset-2", "asset-3", "asset-4"]) {
      await evaluate(window, `document.querySelector('[data-asset-id="${assetId}"] [data-shortlist-toggle]').click()`);
    }
    await waitFor(window, "shortlist", "document.querySelector('.selection-tray')");
    await capture(window, "03-wide-shortlist");

    await clickText(window, ".selection-tray button", "Compare");
    await waitFor(window, "compare", "document.querySelector('.compare-board')");
    await capture(window, "04-compare");
    await clickText(window, ".compare-board button", "Close");
    await waitFor(window, "compare close", "!document.querySelector('.compare-board')");

    await evaluate(window, `document.querySelector('.workspace-menu > summary').click()`);
    await waitFor(window, "view menu", "document.querySelector('.workspace-menu[open]')");
    await capture(window, "05-view-library-menu");
    await evaluate(window, `document.querySelector('.workspace-menu > summary').click()`);

    await clickText(window, ".query-toolbar button", "Filters");
    await waitFor(window, "filter drawer", "document.querySelector('.query-drawer--open')");
    await capture(window, "06-filter-drawer");
    await clickText(window, ".query-toolbar button", "Filters");

    window.setSize(1180, 900);
    await wait(250);
    await assertExclusive(window, "medium closed");
    await capture(window, "07-medium-canvas");
    await clickText(window, ".topbar__actions button", "Library");
    await waitFor(window, "medium library", "document.querySelector('.sidebar--drawer-open')");
    await assertExclusive(window, "medium library");
    await capture(window, "08-medium-library");
    await clickText(window, ".sidebar button", "Close");
    await waitFor(window, "medium library close", "!document.querySelector('.sidebar--drawer-open')");
    await clickText(window, ".topbar__actions button", "Inspector");
    await waitFor(window, "medium inspector", "document.querySelector('.inspector--drawer-open')");
    await assertExclusive(window, "medium inspector");
    await capture(window, "09-medium-inspector");
    await clickText(window, ".inspector button", "Close");
    await waitFor(window, "medium inspector close", "!document.querySelector('.inspector--drawer-open')");

    window.setSize(720, 1100);
    await wait(250);
    await assertExclusive(window, "narrow closed");
    await capture(window, "10-narrow-canvas");
    await clickText(window, ".topbar__actions button", "Library");
    await waitFor(window, "narrow library", "document.querySelector('.sidebar--drawer-open')");
    await assertExclusive(window, "narrow library");
    await capture(window, "11-narrow-library");
    await clickText(window, ".sidebar button", "Close");
    await waitFor(window, "narrow library close", "!document.querySelector('.sidebar--drawer-open')");
    await clickText(window, ".topbar__actions button", "Inspector");
    await waitFor(window, "narrow inspector", "document.querySelector('.inspector--drawer-open')");
    await assertExclusive(window, "narrow inspector");
    await capture(window, "12-narrow-inspector");
  } catch (error) {
    console.error(error);
    try { await capture(window, "99-failure"); } catch {}
    process.exitCode = 1;
  } finally {
    await window.close();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
