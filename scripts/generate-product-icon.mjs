#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { deflateSync, inflateSync } from "node:zlib";

const SIZE = 1024;
const SCALE = 4;
const SHAPES = Object.freeze([
  { x: 48, y: 48, width: 928, height: 928, radius: 220, fill: "#3b3933" },
  { x: 62, y: 62, width: 900, height: 900, radius: 207, fill: "#191917" },
  { x: 198, y: 238, width: 514, height: 584, radius: 72, fill: "#373732" },
  { x: 252, y: 186, width: 574, height: 652, radius: 82, fill: "#ede6d9" },
  { x: 276, y: 210, width: 526, height: 604, radius: 61, fill: "#282824" },
  { x: 318, y: 264, width: 192, height: 174, radius: 28, fill: "#ce8d5b" },
  { x: 546, y: 264, width: 214, height: 174, radius: 28, fill: "#55564f" },
  { x: 318, y: 474, width: 442, height: 242, radius: 34, fill: "#41423c" },
  { x: 318, y: 746, width: 166, height: 18, radius: 9, fill: "#77776d" },
  { x: 504, y: 746, width: 104, height: 18, radius: 9, fill: "#56574f" },
]);

export function productIconSvg() {
  const rectangles = SHAPES.map((shape) =>
    `  <rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.radius}" fill="${shape.fill}"/>`)
    .join("\n");
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    "  <!-- Proposed v1 product-local mark: bounded editorial contact sheet. -->",
    rectangles,
    "</svg>",
    "",
  ].join("\n");
}

export function productIconRgba() {
  const highSize = SIZE * SCALE;
  const high = Buffer.alloc(highSize * highSize * 4);
  for (const shape of SHAPES) paintRoundedRectangle(high, highSize, shape);
  const output = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let opaque = 0;
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const highOffset = (((y * SCALE + sy) * highSize) + x * SCALE + sx) * 4;
          if (high[highOffset + 3] === 0) continue;
          red += high[highOffset];
          green += high[highOffset + 1];
          blue += high[highOffset + 2];
          opaque += 1;
        }
      }
      const offset = (y * SIZE + x) * 4;
      if (opaque > 0) {
        output[offset] = Math.round(red / opaque);
        output[offset + 1] = Math.round(green / opaque);
        output[offset + 2] = Math.round(blue / opaque);
        output[offset + 3] = Math.round((opaque * 255) / (SCALE * SCALE));
      }
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
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
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
  const { values } = parseArgs({
    options: {
      check: { type: "boolean", default: false },
      repository: { type: "string", default: "." },
    },
  });
  const root = path.resolve(values.repository);
  const directory = path.join(root, "assets/branding");
  const svgPath = path.join(directory, "reference-library-icon.svg");
  const pngPath = path.join(directory, "reference-library-icon-1024.png");
  const svg = productIconSvg();
  const rgba = productIconRgba();
  if (values.check) {
    assert.equal(await readFile(svgPath, "utf8"), svg, "committed product icon SVG is stale");
    assert.deepEqual(
      decodeGeneratedPng(await readFile(pngPath)),
      rgba,
      "committed product icon PNG pixels are stale",
    );
    process.stdout.write("product icon source and 1024px PNG are deterministic\n");
  } else {
    await mkdir(directory, { recursive: true });
    await writeFile(svgPath, svg);
    await writeFile(pngPath, encodeRgbaPng(rgba));
    process.stdout.write(`${svgPath}\n${pngPath}\n`);
  }
}

function paintRoundedRectangle(buffer, size, shape) {
  const color = hexColor(shape.fill);
  const x0 = shape.x * SCALE;
  const y0 = shape.y * SCALE;
  const width = shape.width * SCALE;
  const height = shape.height * SCALE;
  const radius = shape.radius * SCALE;
  for (let y = y0; y < y0 + height; y += 1) {
    const centerY = y + 0.5;
    const nearestY = Math.max(y0 + radius, Math.min(centerY, y0 + height - radius));
    for (let x = x0; x < x0 + width; x += 1) {
      const centerX = x + 0.5;
      const nearestX = Math.max(x0 + radius, Math.min(centerX, x0 + width - radius));
      if ((centerX - nearestX) ** 2 + (centerY - nearestY) ** 2 > radius ** 2) continue;
      const offset = (y * size + x) * 4;
      buffer[offset] = color[0];
      buffer[offset + 1] = color[1];
      buffer[offset + 2] = color[2];
      buffer[offset + 3] = 255;
    }
  }
}

function hexColor(value) {
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

await main();
