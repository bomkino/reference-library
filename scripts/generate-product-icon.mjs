#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { deflateSync, inflateSync } from "node:zlib";

const SIZE = 1024;
const SCALE = 4;
const FIELD = "#eef2ff";
const INK = "#171717";
const SIGNAL = "#ff5a36";
const DOG = [
  [352, 488], [416, 440], [600, 448], [672, 408], [784, 416],
  [848, 472], [904, 488], [888, 552], [808, 568], [784, 624],
  [728, 624], [704, 560], [632, 576], [608, 728], [544, 728],
  [544, 592], [440, 592], [424, 728], [360, 728], [368, 576],
  [320, 544],
];
const EAR = [[672, 416], [752, 440], [728, 536], [672, 488]];
const TAIL = [[368, 536], [304, 504], [264, 448], [248, 392], [208, 368]];

export function productIconSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    `  <rect width="1024" height="1024" fill="${FIELD}"/>`,
    `  <rect x="168" y="152" width="608" height="656" fill="none" stroke="${INK}" stroke-width="44"/>`,
    `  <path d="M368 536C304 512 264 448 248 392C240 376 224 368 208 368" fill="none" stroke="${INK}" stroke-width="48" stroke-linecap="square" stroke-linejoin="miter"/>`,
    `  <path d="${polygonPath(DOG)}" fill="${INK}"/>`,
    `  <path d="${polygonPath(EAR)}" fill="${INK}"/>`,
    `  <circle cx="800" cy="472" r="18" fill="${FIELD}"/>`,
    `  <circle cx="184" cy="176" r="56" fill="${SIGNAL}"/>`,
    "</svg>",
    "",
  ].join("\n");
}

export function productIconRgba() {
  const highSize = SIZE * SCALE;
  const high = Buffer.alloc(highSize * highSize * 4);
  paintRectangle(high, highSize, 0, 0, SIZE, SIZE, FIELD);
  paintRectangle(high, highSize, 168, 152, 608, 44, INK);
  paintRectangle(high, highSize, 168, 764, 608, 44, INK);
  paintRectangle(high, highSize, 168, 152, 44, 656, INK);
  paintRectangle(high, highSize, 732, 152, 44, 656, INK);
  paintPolyline(high, highSize, TAIL, 48, INK);
  paintPolygon(high, highSize, DOG, INK);
  paintPolygon(high, highSize, EAR, INK);
  paintCircle(high, highSize, 800, 472, 18, FIELD);
  paintCircle(high, highSize, 184, 176, 56, SIGNAL);

  const output = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const highOffset = (((y * SCALE + sy) * highSize) + x * SCALE + sx) * 4;
          for (let channel = 0; channel < 4; channel += 1) totals[channel] += high[highOffset + channel];
        }
      }
      const offset = (y * SIZE + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[offset + channel] = Math.round(totals[channel] / 16);
    }
  }
  return output;
}

export function encodeRgbaPng(rgba) {
  assert.equal(rgba.length, SIZE * SIZE * 4);
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (SIZE * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function decodeGeneratedPng(png) {
  assert.deepEqual(png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
  const compressed = [];
  let offset = 8;
  let width;
  let height;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 6);
    } else if (type === "IDAT") compressed.push(data);
    offset += length + 12;
  }
  assert.equal(width, SIZE);
  assert.equal(height, SIZE);
  const raw = inflateSync(Buffer.concat(compressed));
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (SIZE * 4 + 1);
    assert.equal(raw[row], 0, "generated icon uses an unsupported PNG row filter");
    raw.copy(rgba, y * SIZE * 4, row + 1, row + 1 + SIZE * 4);
  }
  return rgba;
}

async function main() {
  const { values } = parseArgs({ options: {
    check: { type: "boolean", default: false },
    repository: { type: "string", default: "." },
  } });
  const root = path.resolve(values.repository);
  const directory = path.join(root, "assets", "branding");
  const svgPath = path.join(directory, "reference-library-icon.svg");
  const pngPath = path.join(directory, "reference-library-icon-1024.png");
  const svg = productIconSvg();
  const rgba = productIconRgba();
  if (values.check) {
    assert.equal(await readFile(svgPath, "utf8"), svg, "committed product icon SVG is stale");
    assert.deepEqual(decodeGeneratedPng(await readFile(pngPath)), rgba, "committed product icon PNG pixels are stale");
    process.stdout.write("product icon source and 1024px PNG are deterministic\n");
  } else {
    await mkdir(directory, { recursive: true });
    await writeFile(svgPath, svg);
    await writeFile(pngPath, encodeRgbaPng(rgba));
    process.stdout.write(`${svgPath}\n${pngPath}\n`);
  }
}

function polygonPath(points) {
  return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ")}Z`;
}

function paintRectangle(buffer, size, x, y, width, height, colorValue) {
  const color = hexColor(colorValue);
  for (let py = y * SCALE; py < (y + height) * SCALE; py += 1) {
    for (let px = x * SCALE; px < (x + width) * SCALE; px += 1) setPixel(buffer, size, px, py, color);
  }
}

function paintCircle(buffer, size, cx, cy, radius, colorValue) {
  const color = hexColor(colorValue);
  const centerX = cx * SCALE;
  const centerY = cy * SCALE;
  const scaledRadius = radius * SCALE;
  for (let y = Math.floor(centerY - scaledRadius); y <= Math.ceil(centerY + scaledRadius); y += 1) {
    for (let x = Math.floor(centerX - scaledRadius); x <= Math.ceil(centerX + scaledRadius); x += 1) {
      if ((x + 0.5 - centerX) ** 2 + (y + 0.5 - centerY) ** 2 <= scaledRadius ** 2) setPixel(buffer, size, x, y, color);
    }
  }
}

function paintPolygon(buffer, size, points, colorValue) {
  const color = hexColor(colorValue);
  const scaled = points.map(([x, y]) => [x * SCALE, y * SCALE]);
  const xs = scaled.map(([x]) => x);
  const ys = scaled.map(([, y]) => y);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y += 1) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, scaled)) setPixel(buffer, size, x, y, color);
    }
  }
}

function paintPolyline(buffer, size, points, width, colorValue) {
  const color = hexColor(colorValue);
  const scaled = points.map(([x, y]) => [x * SCALE, y * SCALE]);
  const radius = width * SCALE / 2;
  for (let index = 0; index < scaled.length - 1; index += 1) {
    const [x1, y1] = scaled[index];
    const [x2, y2] = scaled[index + 1];
    for (let y = Math.floor(Math.min(y1, y2) - radius); y <= Math.ceil(Math.max(y1, y2) + radius); y += 1) {
      for (let x = Math.floor(Math.min(x1, x2) - radius); x <= Math.ceil(Math.max(x1, x2) + radius); x += 1) {
        if (distanceToSegment(x + 0.5, y + 0.5, x1, y1, x2, y2) <= radius) setPixel(buffer, size, x, y, color);
      }
    }
  }
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function setPixel(buffer, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 4;
  buffer[offset] = color[0]; buffer[offset + 1] = color[1]; buffer[offset + 2] = color[2]; buffer[offset + 3] = 255;
}

function hexColor(value) {
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); name.copy(chunk, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

await main();
