const { app, BrowserWindow } = require("electron");
const fs = require("fs");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(source);
}

async function waitFor(window, expression) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(window, `Boolean(${expression})`)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function clickText(window, selector, text) {
  await evaluate(window, `(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((element) => element.textContent.trim().startsWith(${JSON.stringify(text)}));
    if (!node) throw new Error("Missing ${text}");
    node.click();
  })()`);
  await wait(250);
}

async function measure(window, label) {
  const result = await evaluate(window, `(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const value = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        className: node.className,
        x: value.x, y: value.y, width: value.width, height: value.height,
        left: style.left, right: style.right, position: style.position,
        transform: style.transform, display: style.display, visibility: style.visibility,
      };
    };
    return {
      label: ${JSON.stringify(label)},
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      viewport: document.documentElement.getBoundingClientRect().toJSON(),
      media: {
        max760: matchMedia('(max-width: 760px)').matches,
        max900: matchMedia('(max-width: 900px)').matches,
        max1180: matchMedia('(max-width: 1180px)').matches,
        max1320: matchMedia('(max-width: 1320px)').matches,
        min1321: matchMedia('(min-width: 1321px)').matches,
      },
      shell: rect('.workspace-shell'),
      main: rect('.workspace-main'),
      sidebar: rect('.sidebar'),
      inspector: rect('.inspector'),
      backdrop: rect('.workspace-drawer-backdrop'),
      expanded: [...document.querySelectorAll('[aria-expanded]')].map((node) => ({ text: node.textContent.trim(), value: node.getAttribute('aria-expanded') })),
    };
  })()`);
  console.log(JSON.stringify(result));
  return result;
}

app.whenReady().then(async () => {
  const output = [];
  const window = new BrowserWindow({
    width: 1728,
    height: 1117,
    show: false,
    webPreferences: {
      preload: process.env.PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await window.loadFile(process.env.INDEX_HTML);
    await waitFor(window, "document.querySelector('.document-empty')");
    await clickText(window, ".document-empty button", "New Library");
    await waitFor(window, "document.querySelector('[data-asset-id=\"asset-1\"]')");
    await evaluate(window, `document.querySelector('[data-asset-id="asset-1"]').click()`);
    await waitFor(window, "document.querySelector('.inspector--active')");

    output.push(await measure(window, "wide-closed"));

    window.setSize(1180, 900);
    await wait(500);
    output.push(await measure(window, "medium-closed"));
    await clickText(window, ".topbar__actions button", "Library");
    output.push(await measure(window, "medium-library-open"));
    await clickText(window, ".sidebar button", "Close");
    output.push(await measure(window, "medium-library-closed"));
    await clickText(window, ".topbar__actions button", "Inspector");
    output.push(await measure(window, "medium-inspector-open"));
    await clickText(window, ".inspector button", "Close");
    output.push(await measure(window, "medium-inspector-closed"));

    window.setSize(720, 1100);
    await wait(500);
    output.push(await measure(window, "narrow-closed"));
    await clickText(window, ".topbar__actions button", "Library");
    output.push(await measure(window, "narrow-library-open"));
    await clickText(window, ".sidebar button", "Close");
    output.push(await measure(window, "narrow-library-closed"));
    await clickText(window, ".topbar__actions button", "Inspector");
    output.push(await measure(window, "narrow-inspector-open"));
    await clickText(window, ".inspector button", "Close");
    output.push(await measure(window, "narrow-inspector-closed"));

    fs.writeFileSync(process.env.DIAGNOSTIC_FILE, JSON.stringify(output, null, 2));
  } finally {
    await window.close();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
