#!/usr/bin/env python3
"""Apply the Reference Library oversized editorial-brutalist interface system.

The transforms are idempotent. They change presentation and product identity
without weakening the document, bridge, security, or bounded-work contracts.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one reviewed replacement, found {count}")
    write(path, text.replace(old, new, 1))


def append_once(path: str, marker: str, content: str) -> None:
    text = read(path)
    if marker in text:
        return
    write(path, text.rstrip() + "\n\n" + content.strip() + "\n")


write(
    "packages/workspace/src/product-mark.tsx",
    '''export function ProductMark({ variant = "compact" }: { variant?: "compact" | "hero" }) {
  return (
    <svg
      className={`product-mark product-mark--${variant}`}
      data-product-mark={variant}
      viewBox="0 0 128 128"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="product-mark__frame" x="18" y="16" width="92" height="92" />
      <path className="product-mark__dog" d="M35 91V65L45 39L58 60C62 57 68 55 74 55C80 55 86 57 90 60L102 40L108 66V91C108 101 100 109 90 109H54C43 109 35 101 35 91Z" />
      <circle className="product-mark__eye" cx="58" cy="78" r="3" />
      <circle className="product-mark__eye" cx="85" cy="78" r="3" />
      <path className="product-mark__muzzle" d="M64 91C69 96 77 96 82 91" />
      <circle className="product-mark__signal" cx="103" cy="24" r="9" />
    </svg>
  );
}
''',
)

replace_once(
    "packages/workspace/src/app.tsx",
    'import { QueryToolbar } from "./query-toolbar";\n',
    'import { QueryToolbar } from "./query-toolbar";\nimport { ProductMark } from "./product-mark";\n',
)

replace_once(
    "packages/workspace/src/app.tsx",
    '''          <p className="eyebrow">Reference Library</p><h1>Your project’s visual memory.</h1><p>Local. Manual. One Library per project.</p>
          <div className="button-row">''',
    '''          <div className="document-empty__mark"><ProductMark variant="hero" /></div>
          <div className="document-empty__content">
            <p className="eyebrow">Reference Library</p>
            <h1>Your project’s visual memory.</h1>
            <p className="document-empty__lede">Local. Manual. One Library per project.</p>
          <div className="button-row">''',
)

replace_once(
    "packages/workspace/src/app.tsx",
    '''          {shellError && <p className="error-state" role="alert">{shellError}</p>}
        </section>''',
    '''          {shellError && <p className="error-state" role="alert">{shellError}</p>}
          </div>
        </section>''',
)

replace_once(
    "packages/workspace/src/app.tsx",
    '''      <header className="topbar">
        <div><p className="eyebrow">Editorial Contact Sheet</p><h1>{props.session.name}</h1></div>''',
    '''      <header className="topbar">
        <div className="topbar__identity">
          <ProductMark variant="compact" />
          <div className="topbar__title"><p className="eyebrow">Editorial Contact Sheet</p><h1>{props.session.name}</h1></div>
        </div>''',
)

replace_once(
    "packages/workspace/src/library-sidebar.tsx",
    '''<button className="icon-button" aria-label={`Rename ${collection.name}`} disabled={props.disabled} onClick={(event) => { returnFocus.current = event.currentTarget; setEditing(collection); setRename(collection.name); }}>Rename</button>''',
    '''<button className="icon-button" aria-label={`Rename ${collection.name}`} title={`Rename ${collection.name}`} disabled={props.disabled} onClick={(event) => { returnFocus.current = event.currentTarget; setEditing(collection); setRename(collection.name); }}><span className="ui-icon ui-icon--edit" aria-hidden="true" /></button>''',
)

replace_once(
    "packages/workspace/src/library-sidebar.tsx",
    '''<button className="icon-button" aria-label={`Delete ${collection.name}`} disabled={props.disabled} onClick={(event) => { returnFocus.current = event.currentTarget; setDeleting(collection); }}>Delete</button>''',
    '''<button className="icon-button" aria-label={`Delete ${collection.name}`} title={`Delete ${collection.name}`} disabled={props.disabled} onClick={(event) => { returnFocus.current = event.currentTarget; setDeleting(collection); }}><span className="ui-icon ui-icon--trash" aria-hidden="true" /></button>''',
)

write(
    "scripts/generate-product-icon.mjs",
    '''#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "..");
const outputDirectory = path.join(repository, "assets", "branding");
const svgPath = path.join(outputDirectory, "reference-library-icon.svg");
const pngPath = path.join(outputDirectory, "reference-library-icon-1024.png");
const checking = process.argv.includes("--check");

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#dfe7ff"/>
  <rect x="144" y="128" width="736" height="736" fill="none" stroke="#171717" stroke-width="52"/>
  <path d="M280 728V520L360 312L464 480C496 456 544 440 592 440C640 440 688 456 720 480L816 320L864 528V728C864 808 800 872 720 872H432C344 872 280 808 280 728Z" fill="#171717"/>
  <circle cx="464" cy="624" r="24" fill="#dfe7ff"/>
  <circle cx="680" cy="624" r="24" fill="#dfe7ff"/>
  <path d="M512 728C552 768 616 768 656 728" fill="none" stroke="#dfe7ff" stroke-width="28" stroke-linecap="square"/>
  <circle cx="824" cy="192" r="72" fill="#ff5a36"/>
</svg>
`;

const WIDTH = 1024;
const HEIGHT = 1024;
const BACKGROUND = [0xdf, 0xe7, 0xff, 0xff];
const INK = [0x17, 0x17, 0x17, 0xff];
const SIGNAL = [0xff, 0x5a, 0x36, 0xff];
const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);

function setPixel(x, y, colour) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const index = (y * WIDTH + x) * 4;
  pixels[index] = colour[0];
  pixels[index + 1] = colour[1];
  pixels[index + 2] = colour[2];
  pixels[index + 3] = colour[3];
}

function fill(colour) {
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) setPixel(x, y, colour);
  }
}

function rect(x, y, width, height, colour) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) setPixel(px, py, colour);
  }
}

function circle(cx, cy, radius, colour) {
  const radiusSquared = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radiusSquared) setPixel(x, y, colour);
    }
  }
}

function polygon(points, colour) {
  const ys = points.map((point) => point[1]);
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(...ys)));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      for (let x = Math.ceil(intersections[i]); x <= Math.floor(intersections[i + 1]); x += 1) {
        setPixel(x, y, colour);
      }
    }
  }
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.concat([typeBuffer, data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length, 0);
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(crc32(chunk), 0);
  return Buffer.concat([header, chunk, footer]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodePng() {
  const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const rowOffset = y * (WIDTH * 4 + 1);
    raw[rowOffset] = 0;
    pixels.copy(raw, rowOffset + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

fill(BACKGROUND);
rect(144, 128, 736, 52, INK);
rect(144, 812, 736, 52, INK);
rect(144, 128, 52, 736, INK);
rect(828, 128, 52, 736, INK);
polygon([[280, 728], [280, 520], [360, 312], [464, 480], [512, 452], [592, 440], [672, 456], [720, 480], [816, 320], [864, 528], [864, 728], [840, 800], [768, 856], [720, 872], [432, 872], [352, 840], [296, 776]], INK);
circle(464, 624, 24, BACKGROUND);
circle(680, 624, 24, BACKGROUND);
for (let step = 0; step <= 144; step += 1) {
  const x = 512 + step;
  const curve = Math.sin((step / 144) * Math.PI) * 28;
  circle(Math.round(x), Math.round(728 + curve), 14, BACKGROUND);
}
circle(824, 192, 72, SIGNAL);

const png = encodePng();
const expected = new Map([[svgPath, Buffer.from(SVG)], [pngPath, png]]);

if (checking) {
  let failed = false;
  for (const [target, bytes] of expected) {
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) {
      process.stderr.write(`generated product icon is stale: ${path.relative(repository, target)}\n`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
  process.stdout.write("product icon OK\n");
} else {
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [target, bytes] of expected) fs.writeFileSync(target, bytes);
  process.stdout.write("generated Reference Library product icon\n");
}
''',
)

append_once(
    "packages/workspace/src/styles.css",
    "REFERENCE_LIBRARY_BRUTALIST_UI_2026",
    r'''/* REFERENCE_LIBRARY_BRUTALIST_UI_2026
   Oversized editorial brutalism. Interface Scale changes the sizing system;
   thumbnail density and Preview zoom remain independent. */
:root {
  --paper: #f8f9f4;
  --paper-cool: #eef2ff;
  --paper-blue: #dfe7ff;
  --ink: #171717;
  --ink-muted: #5a5a55;
  --signal: #ff5a36;
  --signal-soft: #ffd8cc;
  --focus: #3157ff;
  --line: 2px;
  --line-heavy: 3px;
  --control-size: 3.5rem;
  --shadow-small: 4px 4px 0 var(--ink);
  --shadow-large: 10px 10px 0 var(--ink);
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
}

html {
  font-size: calc(15px * var(--ui-scale, 1));
  background: var(--paper);
}

body {
  min-width: 320px;
  background: var(--paper);
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 1rem;
  line-height: 1.45;
  letter-spacing: -0.012em;
}

button,
input,
select,
textarea {
  font: inherit;
}

button,
select,
input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
textarea {
  min-height: var(--control-size);
  border: var(--line) solid var(--ink);
  border-radius: 0;
  background: #fff;
  color: var(--ink);
}

button {
  min-width: var(--control-size);
  padding: 0.8rem 1.15rem;
  border: var(--line) solid var(--ink);
  border-radius: 0;
  background: var(--ink);
  color: #fff;
  font-weight: 760;
  letter-spacing: -0.015em;
  box-shadow: var(--shadow-small);
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

button:hover:not(:disabled) {
  background: var(--signal);
  color: var(--ink);
}

button:active:not(:disabled) {
  translate: 3px 3px;
  box-shadow: 1px 1px 0 var(--ink);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
  box-shadow: none;
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[tabindex]:focus-visible {
  outline: 4px solid var(--focus);
  outline-offset: 3px;
}

.button--secondary,
.button--quiet {
  background: #fff;
  color: var(--ink);
}

.button--quiet {
  box-shadow: none;
}

input,
select,
textarea {
  padding: 0.8rem 0.95rem;
  font-weight: 620;
}

textarea {
  min-height: 9rem;
  resize: vertical;
}

input[type="range"] {
  min-height: 2.25rem;
  accent-color: var(--signal);
}

input[type="checkbox"],
input[type="radio"] {
  width: 1.35rem;
  height: 1.35rem;
  accent-color: var(--signal);
}

.eyebrow {
  margin: 0 0 0.55rem;
  color: var(--ink);
  font-size: 0.78rem;
  font-weight: 850;
  letter-spacing: 0.12em;
  line-height: 1;
  text-transform: uppercase;
}

.muted {
  color: var(--ink-muted);
  font-size: 0.95rem;
  line-height: 1.55;
}

.product-mark {
  display: block;
  overflow: visible;
  color: var(--ink);
}

.product-mark__frame {
  fill: var(--paper-blue);
  stroke: currentColor;
  stroke-width: 6;
}

.product-mark__dog {
  fill: currentColor;
}

.product-mark__eye,
.product-mark__muzzle {
  fill: var(--paper-blue);
  stroke: var(--paper-blue);
  stroke-width: 3;
  stroke-linecap: square;
}

.product-mark__signal {
  fill: var(--signal);
}

.product-mark--compact {
  width: 5.25rem;
  height: 5.25rem;
  flex: 0 0 auto;
}

.product-mark--hero {
  width: clamp(11rem, 24vw, 18rem);
  height: auto;
}

.document-empty {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: clamp(1.5rem, 5vw, 5rem);
  background: var(--paper-cool);
}

.document-empty__card {
  width: min(82rem, 100%);
  min-height: min(44rem, calc(100vh - 6rem));
  display: grid;
  grid-template-columns: minmax(14rem, 0.7fr) minmax(0, 1.3fr);
  align-items: end;
  gap: clamp(2rem, 6vw, 7rem);
  padding: clamp(2rem, 5vw, 5rem);
  border: var(--line-heavy) solid var(--ink);
  background: var(--paper);
  box-shadow: var(--shadow-large);
}

.document-empty__mark {
  align-self: start;
}

.document-empty__content {
  display: grid;
  align-content: end;
  gap: 1.25rem;
}

.document-empty h1 {
  max-width: 11ch;
  margin: 0;
  font-size: clamp(3.3rem, 8vw, 7.2rem);
  font-weight: 880;
  letter-spacing: -0.075em;
  line-height: 0.86;
}

.document-empty__lede {
  max-width: 34rem;
  margin: 0;
  font-size: clamp(1.15rem, 2.1vw, 1.75rem);
  font-weight: 650;
  line-height: 1.35;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
}

.workspace-shell {
  height: 100vh;
  min-height: 38rem;
  display: grid;
  grid-template-columns: clamp(16rem, 20vw, 21rem) minmax(0, 1fr) clamp(19rem, 23vw, 25rem);
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  background: var(--paper);
}

.topbar {
  grid-column: 1 / -1;
  grid-row: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: clamp(1.5rem, 3vw, 3rem);
  padding: clamp(1.4rem, 2.5vw, 2.75rem);
  border-bottom: var(--line-heavy) solid var(--ink);
  background: var(--paper-blue);
}

.topbar__identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 1.35rem;
}

.topbar__title {
  min-width: 0;
}

.topbar h1 {
  overflow: hidden;
  margin: 0;
  font-size: clamp(2.2rem, 4.4vw, 4.4rem);
  font-weight: 880;
  letter-spacing: -0.065em;
  line-height: 0.9;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: flex-end;
  gap: 1rem;
}

.topbar__controls label,
.query-toolbar label,
.inspector label,
.collection-create label {
  display: grid;
  gap: 0.45rem;
  color: var(--ink);
  font-size: 0.78rem;
  font-weight: 830;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.query-toolbar {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(16rem, 2fr) repeat(4, minmax(9rem, 1fr));
  gap: 1rem;
  padding-top: 1.5rem;
  border-top: var(--line) solid var(--ink);
}

.sidebar,
.inspector {
  min-width: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  padding: clamp(1.35rem, 2vw, 2.2rem);
  background: var(--paper);
}

.sidebar {
  grid-column: 1;
  grid-row: 2;
  border-right: var(--line-heavy) solid var(--ink);
}

.inspector {
  grid-column: 3;
  grid-row: 2;
  border-left: var(--line-heavy) solid var(--ink);
  background: #fff;
}

.sidebar > div:first-child,
.sidebar section,
.inspector > * + * {
  margin-top: 0;
}

.sidebar section {
  padding-block: 1.6rem;
  border-top: var(--line) solid var(--ink);
}

.sidebar section:first-of-type {
  margin-top: 1.8rem;
}

.sidebar h2,
.inspector h2,
.workspace-state h2,
.confirmation h2,
.confirmation h3,
.preview h2 {
  margin: 0;
  font-size: clamp(1.45rem, 2.2vw, 2.15rem);
  font-weight: 850;
  letter-spacing: -0.045em;
  line-height: 1;
}

.sidebar__count {
  margin: 0;
  font-size: clamp(2rem, 3vw, 3.2rem);
  font-weight: 860;
  letter-spacing: -0.055em;
  line-height: 0.95;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.plain-list {
  display: grid;
  gap: 0.8rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.root-row,
.collection-row {
  padding: 0.85rem 0;
  border-bottom: var(--line) solid var(--ink);
}

.root-row strong {
  display: block;
  font-size: 1.08rem;
  font-weight: 800;
}

.root-row span {
  display: block;
  margin-top: 0.35rem;
  color: var(--ink-muted);
  line-height: 1.4;
}

.compact-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  margin-top: 0.85rem;
}

.nav-choice {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-block: 0.6rem;
  background: #fff;
  color: var(--ink);
  text-align: left;
  box-shadow: none;
}

.nav-choice--active {
  background: var(--signal);
  box-shadow: var(--shadow-small);
}

.collection-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.6rem;
}

.icon-button {
  width: var(--control-size);
  height: var(--control-size);
  display: inline-grid;
  place-items: center;
  padding: 0;
  background: #fff;
  color: var(--ink);
  box-shadow: none;
}

.ui-icon {
  width: 1.45rem;
  height: 1.45rem;
  display: block;
  background: currentColor;
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: contain;
}

.ui-icon--edit {
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 20h4l11-11-4-4L4 16v4Zm12-16 4 4 1.5-1.5a2.1 2.1 0 0 0 0-3l-1-1a2.1 2.1 0 0 0-3 0L16 4Z'/%3E%3C/svg%3E");
}

.ui-icon--trash {
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 4h10l1 2h4v2H2V6h4l1-2Zm-2 6h14l-1 11H6L5 10Zm4 2v7h2v-7H9Zm4 0v7h2v-7h-2Z'/%3E%3C/svg%3E");
}

.collection-create {
  display: grid;
  gap: 0.8rem;
  margin-top: 1.5rem;
}

.workspace-main {
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  min-height: 0;
  position: relative;
  overflow: hidden;
  padding: clamp(1.25rem, 2.5vw, 2.75rem);
  background: var(--paper-cool);
}

.workspace-main [role="grid"] {
  border: var(--line-heavy) solid var(--ink);
  background: var(--paper);
  box-shadow: 6px 6px 0 var(--ink);
}

.asset-card {
  border: 0;
  background: transparent;
  color: var(--ink);
  box-shadow: none;
}

.asset-card:hover:not(:disabled) {
  background: transparent;
}

.asset-card img,
.asset-card__media,
.asset-card__image {
  border: var(--line) solid var(--ink);
  border-radius: 0;
  background: #fff;
}

.asset-card[aria-selected="true"] {
  outline: 5px solid var(--signal);
  outline-offset: 4px;
}

.asset-card[aria-selected="true"] img,
.asset-card[aria-selected="true"] .asset-card__media {
  box-shadow: var(--shadow-small);
}

.asset-card strong,
.asset-card__title {
  font-size: 1rem;
  font-weight: 780;
  line-height: 1.25;
}

.workspace-state {
  max-width: 44rem;
  display: grid;
  gap: 1.2rem;
  margin: clamp(2rem, 8vh, 7rem) auto;
  padding: clamp(2rem, 4vw, 4rem);
  border: var(--line-heavy) solid var(--ink);
  background: #fff;
  box-shadow: var(--shadow-large);
}

.error-banner,
.error-state,
.field-error {
  border: var(--line) solid var(--ink);
  background: var(--signal-soft);
  color: var(--ink);
  font-weight: 700;
}

.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
  padding: 1rem 1.2rem;
}

.error-state,
.field-error {
  padding: 0.8rem 1rem;
}

.inspector {
  display: grid;
  align-content: start;
  gap: 1.25rem;
}

.inspector .section-heading {
  padding-bottom: 1rem;
  border-bottom: var(--line-heavy) solid var(--ink);
}

.inspector__save-row {
  padding-block: 0.5rem 1.25rem;
  border-bottom: var(--line) solid var(--ink);
}

.inspector dl {
  display: grid;
  grid-template-columns: minmax(6rem, auto) minmax(0, 1fr);
  gap: 0.7rem 1rem;
  margin: 0;
  padding: 1.1rem 0;
  border-block: var(--line) solid var(--ink);
}

.inspector dt {
  font-weight: 820;
}

.inspector dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.membership {
  display: grid;
  gap: 0.8rem;
  margin: 0;
  padding: 1.2rem;
  border: var(--line) solid var(--ink);
}

.membership legend {
  padding-inline: 0.5rem;
  font-size: 0.8rem;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.membership label {
  min-height: 2.75rem;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  font-weight: 700;
}

.preview-backdrop {
  background: rgb(23 23 23 / 0.78);
}

.preview,
.confirmation {
  border: var(--line-heavy) solid var(--ink);
  border-radius: 0;
  background: var(--paper);
  box-shadow: 12px 12px 0 var(--signal);
}

.preview {
  padding: clamp(1.25rem, 2.5vw, 2.5rem);
}

.preview__header,
.preview__controls {
  padding-block: 1rem;
  border-bottom: var(--line) solid var(--ink);
}

.preview__controls {
  border-top: var(--line) solid var(--ink);
  border-bottom: 0;
}

.preview__stage {
  background: var(--paper-cool);
}

.confirmation {
  width: min(36rem, calc(100vw - 2rem));
  padding: clamp(1.5rem, 4vw, 3rem);
}

.selection-announcer {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .workspace-shell {
    grid-template-columns: clamp(15rem, 25vw, 19rem) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) minmax(18rem, 36vh);
  }

  .sidebar {
    grid-column: 1;
    grid-row: 2 / 4;
  }

  .workspace-main {
    grid-column: 2;
    grid-row: 2;
  }

  .inspector {
    display: grid !important;
    grid-column: 2;
    grid-row: 3;
    border-top: var(--line-heavy) solid var(--ink);
    border-left: 0;
  }

  .query-toolbar {
    grid-template-columns: repeat(3, minmax(9rem, 1fr));
  }

  .query-toolbar > :first-child {
    grid-column: span 3;
  }
}

@media (max-width: 760px) {
  .document-empty__card {
    min-height: auto;
    grid-template-columns: 1fr;
    align-items: start;
  }

  .workspace-shell {
    height: auto;
    min-height: 100vh;
    display: block;
    overflow: visible;
  }

  .topbar {
    display: block;
  }

  .topbar__controls,
  .query-toolbar {
    display: grid;
    grid-template-columns: 1fr;
    margin-top: 1.5rem;
  }

  .query-toolbar > :first-child {
    grid-column: auto;
  }

  .sidebar,
  .workspace-main,
  .inspector {
    display: block !important;
    min-height: auto;
    overflow: visible;
    border: 0;
    border-bottom: var(--line-heavy) solid var(--ink);
  }

  .workspace-main {
    min-height: 62vh;
  }

  .product-mark--compact {
    width: 4.25rem;
    height: 4.25rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.001ms !important;
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
  }
}
''',
)

write(
    "docs/product/BRUTALIST_INTERFACE_SYSTEM.md",
    '''# Reference Library interface system

## Intent

Reference Library is an editorial work surface, not a dashboard. The interface uses oversized hierarchy, severe spacing, thick rules, direct language and one restrained signal colour. Brutalism here means legible structure and physical confidence—not hostility, noise or arbitrary ugliness.

## Scale model

Interface Scale changes the root sizing system. Typography, controls, spacing and panel dimensions all grow together through `--ui-scale`. Thumbnail density and Preview zoom remain independent controls because they answer different user needs.

The default system uses a 15 px base at 100% and a minimum 3.5 rem control target. At the default scale that is 52.5 px. The responsive grid keeps the Inspector present by moving it below the contact sheet before stacking all regions on narrow windows.

## Visual law

- Cool paper field; near-black ink.
- One coral signal colour for selection and decisive state.
- Three-pixel structural rules; square corners; hard offset shadows.
- Large editorial headings with compact line height.
- No gradients, glass, ambient motion, decorative charts or dashboard cards.
- Contact-sheet imagery remains the dominant content.

## Interaction law

- Every ordinary control has an oversized target.
- Pointer press feedback is immediate and physical.
- Keyboard paths remain instant; focus uses a four-pixel blue ring.
- Motion is limited to short colour feedback and disabled under reduced-motion preferences.
- Modal ownership, Preview focus, stale Inspector state and narrow-window continuity remain behavioral requirements, not visual polish.

## Product mark

The mark is a reference frame occupied by a dog that is too large for it, plus one coral registration point. It keeps the pitch.dog illustration system’s sparse ink, cool field, impossible relationship, restrained accent and memorable silhouette without turning the application into a mascot product.
''',
)

append_once(
    "AGENTS.md",
    "## Interface system",
    '''## Interface system

- Read `docs/product/BRUTALIST_INTERFACE_SYSTEM.md` before changing workspace presentation.
- Preserve independent Interface Scale, thumbnail density and Preview zoom.
- Keep ordinary targets at least `3.5rem` in the default sizing system.
- Do not hide the Inspector at supported narrow widths; reflow it.
- Use one restrained signal colour. No gradients, glass panels or dashboard-card styling.
- Frequent keyboard actions remain instant. Respect `prefers-reduced-motion`.
- Product icon output is generated by `scripts/generate-product-icon.mjs`; never hand-edit only one derivative.
''',
)

append_once(
    "docs/evidence/DECISION_EVIDENCE_LOG.md",
    "Oversized editorial-brutalist interface",
    '''## 2026-08-28 — Oversized editorial-brutalist interface

**Hypothesis:** the daily-use contact sheet can feel bold, inviting and unmistakably pitch.dog without becoming decorative, reducing information capacity, or coupling Interface Scale to thumbnail density and Preview zoom.  
**Change:** introduced a 15 px scalable root system, 3.5 rem targets, thick structural rules, severe spacing, responsive Inspector reflow, restrained interaction feedback, a deterministic frame-and-dog product mark and an explicit interface contract.  
**Fresh measurement:** source promotion requires existing keyboard and 100,000-Asset behavior tests, TypeScript and production builds, repository and legal checks, Rust public seams, Linux X11/Wayland package journeys and Apple-Silicon package validation.  
**Decision:** keep the editorial contact sheet dominant. Brutalism is structural clarity, not density, motion or decorative noise. Target-machine M1, L1, X1 and C1 remain open.
''',
)

print("brutalist interface repair applied")
