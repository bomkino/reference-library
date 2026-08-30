const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("force-device-scale-factor", "1");

const repositoryRoot = path.resolve(__dirname, "../..");
const indexHtml = process.env.VISUAL_AUDIT_INDEX
  ? path.resolve(process.env.VISUAL_AUDIT_INDEX)
  : path.join(repositoryRoot, "packages/workspace/dist/index.html");
const outputDirectory = process.env.VISUAL_AUDIT_DIR
  ? path.resolve(process.env.VISUAL_AUDIT_DIR)
  : path.join(repositoryRoot, "release/visual-audit");
const preload = path.join(__dirname, "preload.cjs");
const reportPath = path.join(outputDirectory, "report.json");

const states = [];
const journeyViolations = [];
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

fs.mkdirSync(outputDirectory, { recursive: true });

function relativeToRepository(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join("/");
}

async function evaluate(window, label, source) {
  try {
    return await window.webContents.executeJavaScript(source);
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function waitFor(window, label, expression, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(window, `${label} probe`, `Boolean(${expression})`)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForViewport(window, width, height) {
  window.setContentSize(width, height);
  await waitFor(
    window,
    `${width}x${height} viewport`,
    `window.innerWidth === ${width} && window.innerHeight === ${height}`,
  );
}

async function waitForFonts(window) {
  return evaluate(window, "Pitchdog fonts", `(async () => {
    const requests = [
      { family: "PD Body", spec: '400 16px "PD Body"' },
      { family: "PD Head", spec: '600 16px "PD Head"' },
      { family: "PD Eyebrow", spec: '600 16px "PD Eyebrow"' },
    ];
    await document.fonts.ready;
    await Promise.all(requests.map(({ spec }) => document.fonts.load(spec)));
    return Object.fromEntries(requests.map(({ family, spec }) => {
      const matches = [...document.fonts].filter((face) => face.family.replaceAll('"', '') === family);
      return [family, {
        check: document.fonts.check(spec),
        faceCount: matches.length,
        loadedFaceCount: matches.filter((face) => face.status === "loaded").length,
      }];
    }));
  })()`);
}

async function collectMetrics(window, fonts) {
  return evaluate(window, "layout metrics", `(() => {
    const tolerance = 1;
    const minimumTarget = 43.5;
    const interactiveSelector = [
      'button:not([hidden])',
      'summary',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'a[href]',
      '[role="button"]',
    ].join(',');

    const describe = (node) => ({
      tag: node.tagName.toLowerCase(),
      className: typeof node.className === "string" ? node.className : "",
      label: (node.getAttribute("aria-label") || node.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 80),
    });
    const bounds = (rect) => ({
      left: Math.round(rect.left * 10) / 10,
      top: Math.round(rect.top * 10) / 10,
      right: Math.round(rect.right * 10) / 10,
      bottom: Math.round(rect.bottom * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    });
    const intersection = (left, top, right, bottom, rect, clipX, clipY) => ({
      left: clipX ? Math.max(left, rect.left) : left,
      top: clipY ? Math.max(top, rect.top) : top,
      right: clipX ? Math.min(right, rect.right) : right,
      bottom: clipY ? Math.min(bottom, rect.bottom) : bottom,
    });
    const rendered = (node) => {
      if (!node.getClientRects().length) return false;
      for (let current = node; current instanceof Element; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const visibleBounds = (node) => {
      const rect = node.getBoundingClientRect();
      let clipped = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      const causes = [];
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const overflowX = style.overflowX;
        const overflowY = style.overflowY;
        const clipsX = overflowX !== "visible";
        const clipsY = overflowY !== "visible";
        if (!clipsX && !clipsY) continue;
        const ancestorRect = ancestor.getBoundingClientRect();
        const clientRect = {
          left: ancestorRect.left + ancestor.clientLeft,
          top: ancestorRect.top + ancestor.clientTop,
          right: ancestorRect.left + ancestor.clientLeft + ancestor.clientWidth,
          bottom: ancestorRect.top + ancestor.clientTop + ancestor.clientHeight,
        };
        const before = clipped;
        clipped = intersection(clipped.left, clipped.top, clipped.right, clipped.bottom, clientRect, clipsX, clipsY);
        if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) return null;
        const scrollX = overflowX === "auto" || overflowX === "scroll";
        const scrollY = overflowY === "auto" || overflowY === "scroll";
        if (clipsX && !scrollX && (before.left < clientRect.left - tolerance || before.right > clientRect.right + tolerance)) {
          causes.push({ axis: "horizontal", ancestor: ancestor.tagName.toLowerCase(), overflow: overflowX });
        }
        if (clipsY && !scrollY && (before.top < clientRect.top - tolerance || before.bottom > clientRect.bottom + tolerance)) {
          causes.push({ axis: "vertical", ancestor: ancestor.tagName.toLowerCase(), overflow: overflowY });
        }
      }
      const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      if (clipped.right <= viewport.left || clipped.left >= viewport.right || clipped.bottom <= viewport.top || clipped.top >= viewport.bottom) return null;
      if (clipped.left < viewport.left - tolerance || clipped.right > viewport.right + tolerance) {
        causes.push({ axis: "horizontal", ancestor: "viewport", overflow: "clip" });
      }
      return { rect, clipped, causes };
    };

    const targets = [...document.querySelectorAll(interactiveSelector)].filter(rendered);
    const clippedTargets = [];
    const smallTargets = [];
    for (const node of targets) {
      const visible = visibleBounds(node);
      if (!visible) continue;
      if (visible.causes.length) {
        clippedTargets.push({ ...describe(node), bounds: bounds(visible.rect), causes: visible.causes });
      }
      if (node.matches('button:not([hidden]), summary')) {
        const rect = visible.rect;
        if (rect.width < minimumTarget || rect.height < minimumTarget) {
          smallTargets.push({ ...describe(node), bounds: bounds(rect) });
        }
      }
    }

    const scrollingElement = document.scrollingElement || document.documentElement;
    return {
      viewport: {
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio,
      },
      body: {
        scrollWidth: document.body.scrollWidth,
        clientWidth: document.body.clientWidth,
        documentScrollWidth: scrollingElement.scrollWidth,
        documentClientWidth: scrollingElement.clientWidth,
        horizontalOverflow:
          document.body.scrollWidth > document.body.clientWidth + tolerance ||
          scrollingElement.scrollWidth > scrollingElement.clientWidth + tolerance,
      },
      fonts: ${JSON.stringify(fonts)},
      interactiveTargetCount: targets.length,
      clippedTargets,
      smallTargets,
    };
  })()`);
}

function violationsFor(name, metrics) {
  const violations = [];
  if (metrics.body.horizontalOverflow) {
    violations.push({
      type: "body-horizontal-overflow",
      state: name,
      detail: metrics.body,
    });
  }
  for (const [family, result] of Object.entries(metrics.fonts)) {
    if (!result.check || result.faceCount < 1 || result.loadedFaceCount < 1) {
      violations.push({ type: "font-not-loaded", state: name, family, detail: result });
    }
  }
  if (metrics.clippedTargets.length) {
    violations.push({ type: "clipped-interactive-targets", state: name, targets: metrics.clippedTargets });
  }
  if (metrics.smallTargets.length) {
    violations.push({ type: "small-button-or-summary", state: name, targets: metrics.smallTargets });
  }
  return violations;
}

async function capture(window, name, settle = 500) {
  await wait(settle);
  await evaluate(window, "visible image readiness", `Promise.all(
    [...document.images]
      .filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
      })
      .map((image) => image.complete ? true : new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      }))
  ).then(() => true)`);
  const fonts = await waitForFonts(window);
  const metrics = await collectMetrics(window, fonts);
  const screenshotName = `${name}.png`;
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDirectory, screenshotName), image.toPNG());
  const violations = violationsFor(name, metrics);
  states.push({ name, screenshot: screenshotName, metrics, violations });
  console.log(`[visual-audit] ${name}: ${metrics.viewport.width}x${metrics.viewport.height}; ${violations.length} violation(s)`);
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

async function setSelect(window, selector, value) {
  return evaluate(window, `set ${selector}`, `(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    if (!select) throw new Error(${JSON.stringify(`Missing ${selector}`)});
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    descriptor.set.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value;
  })()`);
}

function writeReport() {
  const stateViolations = states.flatMap((state) => state.violations);
  const violations = [...stateViolations, ...journeyViolations];
  const report = {
    schemaVersion: 1,
    sourceSha: process.env.GITHUB_SHA || null,
    indexHtml: relativeToRepository(indexHtml),
    minimumButtonAndSummarySizeCssPixels: 44,
    passed: violations.length === 0,
    summary: {
      statesCaptured: states.length,
      screenshotsWritten: states.length,
      violationCount: violations.length,
    },
    violations,
    states,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

app.whenReady().then(async () => {
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`Workspace build is missing: ${indexHtml}`);
  }

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    useContentSize: true,
    show: false,
    backgroundColor: "#eef2ff",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.on("console-message", (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });

  try {
    await window.loadFile(indexHtml);
    await window.webContents.insertCSS("*, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: 0.001ms !important; }");
    await waitForViewport(window, 1440, 920);
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
    await capture(window, "05-view-settings");
    await setSelect(window, '.view-settings__panel select[aria-label="Interface"]', "0.8");
    await capture(window, "05a-view-settings-80-percent");
    await setSelect(window, '.view-settings__panel select[aria-label="Interface"]', "1.5");
    await capture(window, "05b-view-settings-150-percent");
    await setSelect(window, '.view-settings__panel select[aria-label="Interface"]', "1");
    await evaluate(window, "close view settings", `document.querySelector('.view-settings > summary').click()`);

    await clickText(window, ".query-commandbar button", "Filters");
    await waitFor(window, "filter panel", "document.querySelector('.query-commandbar__filters[aria-expanded=\"true\"]') && document.querySelector('.filter-panel')");
    await capture(window, "06-filter-drawer");
    await clickText(window, ".query-commandbar button", "Filters");

    await waitForViewport(window, 1024, 768);
    await capture(window, "07-medium-canvas");

    await waitForViewport(window, 760, 900);
    await capture(window, "08-narrow-canvas");

    await evaluate(window, "open Library drawer", `document.querySelector('.topbar__library-toggle').click()`);
    await waitFor(window, "Library drawer", "document.querySelector('.sidebar--drawer-open')");
    await evaluate(window, "reset Library drawer scroll", `document.querySelector('.sidebar').scrollTop = 0`);
    await capture(window, "09-narrow-library");
    await evaluate(window, "close Library drawer", `document.querySelector('.sidebar__close').click()`);
    await waitFor(window, "Library drawer close", "!document.querySelector('.sidebar--drawer-open')");

    await evaluate(window, "open Inspector drawer", `document.querySelector('.topbar__inspector-toggle').click()`);
    await waitFor(window, "Inspector drawer", "document.querySelector('.inspector--drawer-open')");
    await evaluate(window, "reset Inspector drawer scroll", `document.querySelector('.inspector').scrollTop = 0`);
    await capture(window, "10-narrow-inspector");
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    journeyViolations.push({ type: "journey-error", detail });
    console.error(`[visual-audit] journey failed\n${detail}`);
    try {
      await capture(window, "99-failure-state", 100);
    } catch (captureError) {
      console.error(`[visual-audit] failure-state capture failed: ${captureError}`);
    }
  } finally {
    window.close();
    const report = writeReport();
    if (!report.passed) {
      console.error(JSON.stringify(report.violations, null, 2));
      console.error(`[visual-audit] failed with ${report.summary.violationCount} violation(s); see ${reportPath}`);
    } else {
      console.log(`[visual-audit] passed; report: ${reportPath}`);
    }
    app.exit(report.passed ? 0 : 1);
  }
}).catch((error) => {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  journeyViolations.push({ type: "startup-error", detail });
  const report = writeReport();
  console.error(`[visual-audit] startup failed\n${detail}\n[visual-audit] report: ${reportPath}`);
  app.exit(report.passed ? 0 : 1);
});
