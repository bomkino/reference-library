const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const screenshotDirectory = process.env.SCREENSHOT_DIR;
fs.mkdirSync(screenshotDirectory, { recursive: true });

async function evaluate(window, label, source) {
  try {
    const value = await window.webContents.executeJavaScript(source);
    console.log(`[audit] ${label}: ok`, value ?? "");
    return value;
  } catch (error) {
    console.error(`[audit] ${label}: failed`, error);
    throw error;
  }
}

async function waitFor(window, label, expression, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(window, `${label} probe ${attempt + 1}`, `Boolean(${expression})`)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function capture(window, name) {
  await wait(250);
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(screenshotDirectory, `${name}.png`), image.toPNG());
  console.log(`[audit] captured ${name}`);
}

async function clickText(window, selector, text) {
  return evaluate(
    window,
    `click ${text}`,
    `(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((element) => element.textContent.trim().startsWith(${JSON.stringify(text)}));
      if (!node) throw new Error("Missing ${text} in ${selector}");
      node.click();
      return node.textContent.trim();
    })()`,
  );
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1728,
    height: 1117,
    show: false,
    backgroundColor: "#eef2ff",
    webPreferences: {
      preload: process.env.PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.on("console-message", (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer gone]", details);
  });

  try {
    await window.loadFile(process.env.INDEX_HTML);
    await waitFor(window, "first-run actions", "document.querySelectorAll('.document-empty button').length >= 2");
    await capture(window, "00-first-run");

    await clickText(window, ".document-empty button", "New Library");
    await waitFor(window, "workspace", "document.querySelector('.workspace-shell')");
    await waitFor(window, "first asset", "document.querySelector('[data-asset-id=\"asset-1\"]')");
    await capture(window, "01-workspace-grid");

    await evaluate(window, "select first asset", `document.querySelector('[data-asset-id="asset-1"]').click()`);
    await waitFor(window, "inspector fields", "document.querySelector('.inspector input')");
    await capture(window, "02-selected-inspector");

    for (const assetId of ["asset-1", "asset-2", "asset-3", "asset-4"]) {
      await evaluate(
        window,
        `shortlist ${assetId}`,
        `(() => {
          const toggle = document.querySelector('[data-asset-id="${assetId}"] [data-shortlist-toggle]');
          if (!toggle) throw new Error('Missing shortlist toggle for ${assetId}');
          toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        })()`,
      );
      await wait(100);
    }
    await waitFor(window, "shortlist tray", "document.querySelector('.selection-tray')");
    await capture(window, "03-shortlist");

    await clickText(window, ".selection-tray button", "Compare");
    await waitFor(window, "compare board", "document.querySelector('.compare-board')");
    await capture(window, "04-compare-board");

    await clickText(window, ".compare-board button", "Close");
    await waitFor(window, "compare close", "!document.querySelector('.compare-board')");

    await evaluate(window, "list view", `document.querySelector('.view-switcher button[aria-pressed="false"]:last-child').click()`);
    await wait(400);
    await capture(window, "05-list-view");

    await evaluate(window, "grid view", `document.querySelector('.view-switcher button:first-child').click()`);
    await evaluate(window, "multiple thumbnails", `document.querySelector('.toggle-control input').click()`);
    await wait(500);
    await capture(window, "06-mosaic-view");

    await evaluate(window, "preview asset", `document.querySelector('[data-asset-id="asset-2"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await waitFor(window, "preview", "document.querySelector('.preview')");
    await capture(window, "07-preview");
    await clickText(window, ".preview button", "Close");

    window.setSize(1180, 900);
    await wait(700);
    await capture(window, "08-compact-window");

    window.setSize(720, 1100);
    await wait(700);
    await capture(window, "09-narrow-window");
  } catch (error) {
    console.error("[audit] journey failed", error);
    try { await capture(window, "99-failure-state"); } catch (captureError) { console.error(captureError); }
    process.exitCode = 1;
  } finally {
    await window.close();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
