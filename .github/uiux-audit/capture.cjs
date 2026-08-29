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
    return await window.webContents.executeJavaScript(source);
  } catch (error) {
    console.error(`[audit] ${label} failed`, error);
    throw error;
  }
}

async function waitFor(window, label, expression, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(window, `${label} probe`, `Boolean(${expression})`)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function capture(window, name) {
  await wait(300);
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(screenshotDirectory, `${name}.png`), image.toPNG());
  console.log(`[audit] captured ${name}`);
}

async function clickText(window, selector, text) {
  return evaluate(window, `click ${text}`, `(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((element) => element.textContent.trim().startsWith(${JSON.stringify(text)}));
    if (!node) throw new Error(${JSON.stringify(`Missing ${text} in ${selector}`)});
    node.click();
    return true;
  })()`);
}

async function setInput(window, selector, value) {
  return evaluate(window, `set ${selector}`, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error(${JSON.stringify(`Missing ${selector}`)});
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor.set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input.value;
  })()`);
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

  try {
    await window.loadFile(process.env.INDEX_HTML);
    await waitFor(window, "first-run screen", "document.querySelector('[aria-label=\"Library name\"]')");
    await capture(window, "00-first-run");

    await setInput(window, '[aria-label="Library name"]', "A Very Motherly Christmas");
    await clickText(window, ".document-empty button", "Create a Library");
    await waitFor(window, "workspace", "document.querySelector('.workspace-shell')");
    await waitFor(window, "first asset", "document.querySelector('[data-asset-id=\"asset-1\"]')");
    await capture(window, "01-wide-canvas");

    await evaluate(window, "select first asset", `document.querySelector('[data-asset-id="asset-1"]').click()`);
    await waitFor(window, "active inspector", "document.querySelector('.inspector--active')");
    await capture(window, "02-wide-inspector");

    for (const assetId of ["asset-1", "asset-2", "asset-3", "asset-4"]) {
      await evaluate(window, `shortlist ${assetId}`, `(() => {
        const toggle = document.querySelector('[data-asset-id="${assetId}"] [data-shortlist-toggle]');
        if (!toggle) throw new Error('Missing shortlist toggle for ${assetId}');
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      })()`);
      await wait(80);
    }
    await waitFor(window, "shortlist tray", "document.querySelector('.selection-tray')");
    await capture(window, "03-wide-shortlist");

    await clickText(window, ".selection-tray button", "Compare");
    await waitFor(window, "compare board", "document.querySelector('.compare-board')");
    await capture(window, "04-compare-board");
    await clickText(window, ".compare-board button", "Close");
    await waitFor(window, "compare board close", "!document.querySelector('.compare-board')");

    await evaluate(window, "open view settings", `document.querySelector('.view-settings > summary').click()`);
    await waitFor(window, "view settings panel", "document.querySelector('.view-settings[open]')");
    await capture(window, "05-view-and-sync");
    await evaluate(window, "close view settings", `document.querySelector('.view-settings > summary').click()`);

    await clickText(window, ".query-commandbar button", "Filters");
    await waitFor(window, "filter panel", "document.querySelector('.query-surface--filters-open') || document.querySelector('.filter-panel:not([hidden])')");
    await capture(window, "06-filter-drawer");
    await clickText(window, ".query-commandbar button", "Filters");

    window.setSize(1180, 900);
    await wait(700);
    await capture(window, "07-medium-canvas");

    window.setSize(720, 1100);
    await wait(700);
    await capture(window, "08-narrow-canvas");

    await clickText(window, ".topbar__primary-actions button", "Library");
    await waitFor(window, "Library drawer", "document.querySelector('.sidebar--drawer-open')");
    await capture(window, "09-narrow-library");
    await clickText(window, ".sidebar button", "Close");
    await waitFor(window, "Library drawer close", "!document.querySelector('.sidebar--drawer-open')");

    await clickText(window, ".topbar__primary-actions button", "Selected Reference");
    await waitFor(window, "Inspector drawer", "document.querySelector('.inspector--drawer-open')");
    await capture(window, "10-narrow-inspector");
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
