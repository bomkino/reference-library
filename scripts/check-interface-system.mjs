#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FONT_MANIFEST = Object.freeze([
  {
    file: "pd-head.woff2",
    family: "PD Head",
    style: "normal",
    weight: "265 900",
    sha256: "528dd6d9d5d79265f4e3589523a250cd652110d1380e87a0252bca9489da50e9",
  },
  {
    file: "pd-head-alt.woff2",
    family: "PD Head Alt",
    style: "normal",
    weight: "265 900",
    sha256: "bf4db03493580a52e3e01cb6aec2fe791da8e7293d6083e2c567c3bb3f0b927a",
  },
  {
    file: "pd-body-roman.woff2",
    family: "PD Body",
    style: "normal",
    weight: "100 900",
    sha256: "433a1b69a8e8a903478b978c198b879824541dc9eb62db959058ae37a250819f",
  },
  {
    file: "pd-body-italic.woff2",
    family: "PD Body",
    style: "italic",
    weight: "100 900",
    sha256: "6bd35c9ad364e585ca5667c1df74f892eebbe32237005ba926b54ffa61df8a78",
  },
  {
    file: "pd-body-alt-roman.woff2",
    family: "PD Body Alt",
    style: "normal",
    weight: "100 900",
    sha256: "4ae6044273de9010d1a9660001319c34a4a8ece764279bb7f1e0f81f01dca85b",
  },
  {
    file: "pd-body-alt-italic.woff2",
    family: "PD Body Alt",
    style: "italic",
    weight: "100 900",
    sha256: "9f59a7f058ba824e0b3e2760204c0c70b7cfb2f61956a460b730e486b1209285",
  },
  {
    file: "pd-eyebrow-site.woff2",
    family: "PD Eyebrow",
    style: "normal",
    weight: "100 900",
    sha256: "24aeaf1bfb45a874fe807c8138fc0d815b499b1834e8291c2dc46bb5fc32b7a3",
  },
]);

const APPROVED_RUNTIME_WEIGHTS = new Set(["400", "500", "600"]);
const SPACE_SCALE = Object.freeze({
  "--space-1": "0.25rem",
  "--space-2": "0.5rem",
  "--space-3": "0.75rem",
  "--space-4": "1rem",
  "--space-5": "1.5rem",
  "--space-6": "2rem",
  "--space-7": "3rem",
  "--space-8": "4rem",
});
const SPACING_PROPERTIES = /^(?:gap|row-gap|column-gap|padding(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|margin(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?)$/;
const INLINE_SPACING_PROPERTY = /\b((?:gap|rowGap|columnGap|padding(?:Top|Right|Bottom|Left|Inline|InlineStart|InlineEnd|Block|BlockStart|BlockEnd)?|margin(?:Top|Right|Bottom|Left|Inline|InlineStart|InlineEnd|Block|BlockStart|BlockEnd)?))\s*:\s*([^,\n}]+)/g;
const FLUID_REGION_SELECTORS = new Set([
  ".document-empty",
  ".document-empty__card",
  ".topbar",
  ".sidebar",
  ".inspector",
  ".workspace-main",
  ".workspace-state",
  ".preview",
  ".confirmation",
  ".compare-board",
  ".shortcut-dialog",
]);
const CONTROL_FLOOR_SELECTORS = Object.freeze([
  ".facet-chip",
  ".active-filter-chip",
  ".active-filter-strip__clear",
  ".nav-choice",
  ".review-choice",
  ".toggle-control",
  ".selection-tray__headline-actions button",
  ".compare-board__sync",
  ".compare-board__controls button",
  ".compare-card__footer button",
  ".inspector__source-actions button",
  ".inspector__save-dock button",
  ".query-commandbar input",
  ".query-commandbar select",
  ".query-commandbar button",
  ".view-switcher button",
  ".view-settings > summary",
  ".inspector__disclosure > summary",
]);
const SQUARE_TARGET_SELECTORS = Object.freeze([
  ".icon-button",
  ".token button",
  ".selection-chip__order button",
  ".selection-chip__remove",
  ".compare-card__order button",
  ".asset-card__shortlist-toggle",
]);
const TYPE_ROLES = Object.freeze({
  "--font-head": '"PD Head", Georgia, "Times New Roman", serif',
  "--font-head-alt": '"PD Head Alt", "PD Head", Georgia, serif',
  "--font-body": '"PD Body", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "--font-body-alt": '"PD Body Alt", "PD Body", system-ui, sans-serif',
  "--font-eyebrow": '"PD Eyebrow", ui-monospace, "SFMono-Regular", Consolas, monospace',
});

export async function inspectInterfaceSystem(repository) {
  const problems = [];
  const workspace = path.join(repository, "packages/workspace");
  const source = path.join(workspace, "src");
  const fontsDirectory = path.join(source, "fonts");
  const stylesheetPath = path.join(source, "styles.css");
  const documentationPath = path.join(repository, "THIRD_PARTY.md");

  await inspectFonts(fontsDirectory, documentationPath, problems);

  const stylesheet = await readText(stylesheetPath, problems);
  if (stylesheet !== null) inspectStylesheet(stylesheet, problems);

  await inspectPhosphor(repository, workspace, source, problems);
  return problems;
}

export async function verifyInterfaceSystem(repository) {
  const problems = await inspectInterfaceSystem(repository);
  if (problems.length > 0) {
    throw new Error(`interface-system contract failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
  }
  return {
    fontCount: FONT_MANIFEST.length,
    controlFloorCount: CONTROL_FLOOR_SELECTORS.length + SQUARE_TARGET_SELECTORS.length,
    phosphorVersion: "2.1.10",
  };
}

async function inspectFonts(fontsDirectory, documentationPath, problems) {
  let actualFiles = [];
  try {
    actualFiles = (await readdir(fontsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    problems.push(`cannot read local font directory: ${error.message}`);
    return;
  }

  const expectedFiles = FONT_MANIFEST.map(({ file }) => file).sort();
  if (actualFiles.join("\n") !== expectedFiles.join("\n")) {
    problems.push(`local font set must be exactly: ${expectedFiles.join(", ")}`);
  }

  const documentation = await readText(documentationPath, problems);
  for (const expected of FONT_MANIFEST) {
    let contents;
    try {
      contents = await readFile(path.join(fontsDirectory, expected.file));
    } catch (error) {
      problems.push(`cannot read local font ${expected.file}: ${error.message}`);
      continue;
    }
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest !== expected.sha256) {
      problems.push(`${expected.file} SHA-256 drift: expected ${expected.sha256}, found ${digest}`);
    }
    if (documentation !== null) {
      const documentedLine = documentation
        .split(/\r?\n/)
        .some((line) => line.includes(`\`${expected.file}\``) && line.includes(`\`${expected.sha256}\``));
      if (!documentedLine) problems.push(`THIRD_PARTY.md must document ${expected.file} with its exact SHA-256`);
    }
  }
}

function inspectStylesheet(source, problems) {
  const clean = stripComments(source);
  const rules = collectRules(clean);
  const fontFaces = rules.filter((rule) => rule.selector === "@font-face");
  if (fontFaces.length !== FONT_MANIFEST.length) {
    problems.push(`styles.css must declare exactly seven @font-face rules, found ${fontFaces.length}`);
  }

  const seenFontFiles = new Set();
  for (const face of fontFaces) {
    const declarations = declarationMap(face);
    const sourceValue = declarations.get("src")?.value ?? "";
    const urlMatch = sourceValue.match(/^url\(["']\.\/fonts\/([^"')]+)["']\)\s+format\(["']woff2["']\)$/);
    if (!urlMatch) {
      problems.push(`styles.css:${face.line} @font-face must use one local ./fonts/*.woff2 URL`);
      continue;
    }
    const file = urlMatch[1];
    seenFontFiles.add(file);
    const expected = FONT_MANIFEST.find((candidate) => candidate.file === file);
    if (!expected) {
      problems.push(`styles.css:${face.line} unexpected @font-face source ${file}`);
      continue;
    }
    const family = unquote(declarations.get("font-family")?.value ?? "");
    const style = declarations.get("font-style")?.value ?? "";
    const weight = declarations.get("font-weight")?.value ?? "";
    if (family !== expected.family || style !== expected.style || weight !== expected.weight) {
      problems.push(
        `styles.css:${face.line} ${file} face drift: expected ${expected.family}/${expected.style}/${expected.weight}`,
      );
    }
  }
  for (const expected of FONT_MANIFEST) {
    if (!seenFontFiles.has(expected.file)) problems.push(`styles.css is missing the local face for ${expected.file}`);
  }

  const roleValues = new Map();
  for (const rule of rules.filter((candidate) => splitSelectors(candidate.selector).includes(":root"))) {
    for (const declaration of parseDeclarations(rule)) {
      if (declaration.property.startsWith("--font-")) roleValues.set(declaration.property, declaration.value);
    }
  }
  for (const [role, expected] of Object.entries(TYPE_ROLES)) {
    if (roleValues.get(role) !== expected) {
      problems.push(`styles.css ${role} must be ${expected}`);
    }
  }

  const roots = rules.filter((rule) => splitSelectors(rule.selector).includes(":root"));
  for (const [property, expected] of Object.entries(SPACE_SCALE)) {
    requireCustomProperty(roots, property, new RegExp(`^${escapeRegExp(expected)}$`), problems);
  }

  for (const rule of rules.filter((candidate) => candidate.selector !== "@font-face")) {
    for (const declaration of parseDeclarations(rule)) {
      if (declaration.property === "font-weight" && !APPROVED_RUNTIME_WEIGHTS.has(declaration.value)) {
        problems.push(
          `styles.css:${declaration.line} runtime font-weight ${declaration.value} is not an approved 400/500/600 anchor`,
        );
      }
      if (declaration.property === "font-variation-settings") {
        for (const match of declaration.value.matchAll(/["']wght["']\s+([+-]?(?:\d*\.)?\d+)/g)) {
          if (!APPROVED_RUNTIME_WEIGHTS.has(match[1])) {
            problems.push(
              `styles.css:${declaration.line} runtime wght axis ${match[1]} is not an approved 400/500/600 anchor`,
            );
          }
        }
      }
      if (SPACING_PROPERTIES.test(declaration.property) && !validSpacing(rule, declaration)) {
        problems.push(
          `styles.css:${declaration.line} ${declaration.property} must use --space tokens or zero, found ${declaration.value}`,
        );
      }
      if (
        /^(?:-webkit-)?(?:mask(?:-.+)?|backdrop-filter)$/.test(declaration.property)
        || /(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i.test(declaration.value)
      ) {
        problems.push(`styles.css:${declaration.line} prohibited visual effect: ${declaration.property}: ${declaration.value}`);
      }
    }
  }

  requireCustomProperty(roots, "--control-size", /^max\(44px,\s*3\.5rem\)$/, problems);
  requireCustomProperty(roots, "--target-min", /^max\(44px,\s*2\.75rem\)$/, problems);
  if (!selectorEndsWithDeclarations(rules, ".view-settings:not([open]) > .view-settings__panel", { display: "none" })) {
    problems.push("closed view settings must explicitly hide their panel");
  }
  for (const selector of CONTROL_FLOOR_SELECTORS) {
    if (!selectorEndsWithDeclarations(rules, selector, { "min-height": "var(--control-size)" })) {
      problems.push(`${selector} must have a min-height floor of var(--control-size)`);
    }
  }
  for (const selector of SQUARE_TARGET_SELECTORS) {
    if (!selectorEndsWithDeclarations(rules, selector, {
      "min-height": "var(--target-min)",
      "min-width": "var(--target-min)",
    })) {
      problems.push(`${selector} must have min-height and min-width floors of var(--target-min)`);
    }
  }
}

function validSpacing(rule, declaration) {
  const value = declaration.value.replace(/\s*!important\s*$/, "").trim();
  const selectors = splitSelectors(rule.selector);
  if (
    declaration.property === "margin"
    && value === "-1px"
    && selectors.length === 1
    && selectors[0] === ".visually-hidden"
  ) return true;
  if (
    declaration.property === "gap"
    && value === "var(--line)"
    && selectors.length === 1
    && selectors[0] === ".asset-card__image-frame--mosaic"
  ) return true;
  if (
    declaration.property === "padding-bottom"
    && /^var\(--tray-reserve(?:-expanded)?\)$/.test(value)
    && selectors.every((selector) => selector.includes(".workspace-main") && selector.includes(".contact-sheet"))
  ) return true;
  if (value.includes("clamp(")) {
    return selectors.length > 0 && selectors.every((selector) => FLUID_REGION_SELECTORS.has(selector));
  }

  const withoutTokenCalculations = value.replace(
    /calc\(\s*0px\s*-\s*var\(--space-[1-8]\)\s*\)/g,
    "0",
  );
  const parts = withoutTokenCalculations.split(/\s+/);
  return parts.length > 0 && parts.every((part) => (
    part === "0"
    || part === "auto"
    || /^var\(--space-[1-8]\)$/.test(part)
  ));
}

async function inspectPhosphor(repository, workspace, source, problems) {
  const workspacePackage = await readJson(path.join(workspace, "package.json"), problems);
  if (workspacePackage?.dependencies?.["@phosphor-icons/react"] !== "2.1.10") {
    problems.push("packages/workspace must pin @phosphor-icons/react exactly to 2.1.10");
  }
  const lockfile = await readJson(path.join(repository, "package-lock.json"), problems);
  if (
    lockfile?.packages?.["packages/workspace"]?.dependencies?.["@phosphor-icons/react"] !== "2.1.10"
    || lockfile?.packages?.["node_modules/@phosphor-icons/react"]?.version !== "2.1.10"
  ) problems.push("package-lock.json must resolve @phosphor-icons/react exactly to 2.1.10");

  const wrapper = await readText(path.join(source, "ui-icon.tsx"), problems);
  if (wrapper !== null) {
    for (const [label, pattern] of [
      ["import the Phosphor Icon type", /import\s+type\s+\{\s*Icon\s*}\s+from\s+["']@phosphor-icons\/react["']/],
      ["render the supplied Phosphor component", /<IconComponent\b/],
      ["use the bold icon weight", /\bweight\s*=\s*["']bold["']/],
      ["size icons at 1em", /\bsize\s*=\s*["']1em["']/],
      ["hide decorative icons from accessibility APIs", /\baria-hidden\s*=\s*["']true["']/],
      ["make decorative icons unfocusable", /\bfocusable\s*=\s*["']false["']/],
    ]) {
      if (!pattern.test(wrapper)) problems.push(`UiIcon must ${label}`);
    }
  }

  let entries = [];
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch (error) {
    problems.push(`cannot inspect workspace TSX sources: ${error.message}`);
    return;
  }
  for (const entry of entries) {
    if (
      !entry.isFile()
      || !entry.name.endsWith(".tsx")
      || entry.name.endsWith(".test.tsx")
      || entry.name === "keyboard-shortcuts-dialog.tsx"
    ) continue;
    const filePath = path.join(source, entry.name);
    const contents = await readText(filePath, problems);
    if (contents === null) continue;
    const unicodeMatch = contents.match(/[×✕✖✗✓✔☑←→↑↓−]/u);
    const asciiButtonMatch = contents.match(/<button\b[^>]*>\s*([+xX-])\s*<\/button>/s);
    if (unicodeMatch || asciiButtonMatch) {
      const glyph = unicodeMatch?.[0] ?? asciiButtonMatch?.[1];
      problems.push(`${entry.name} contains utility glyph ${JSON.stringify(glyph)}; use UiIcon with Phosphor`);
    }
    inspectInlineInterfaceSource(contents, entry.name, problems);
  }
}

function inspectInlineInterfaceSource(contents, file, problems) {
  for (const match of contents.matchAll(INLINE_SPACING_PROPERTY)) {
    const value = match[2].trim();
    if (!validInlineSpacing(value)) {
      problems.push(
        `${file}:${1 + lineCount(contents.slice(0, match.index))} inline ${match[1]} must use --space tokens or zero, found ${value}`,
      );
    }
  }
  for (const match of contents.matchAll(/\bfontWeight\s*:\s*([^,\n}]+)/g)) {
    const value = match[1].trim().replace(/["']/g, "");
    if (!APPROVED_RUNTIME_WEIGHTS.has(value)) {
      problems.push(
        `${file}:${1 + lineCount(contents.slice(0, match.index))} inline fontWeight ${value} is not an approved 400/500/600 anchor`,
      );
    }
  }
  for (const match of contents.matchAll(/\bfontVariationSettings\s*:\s*([^,\n}]+)/g)) {
    for (const axis of match[1].matchAll(/["']wght["']\s+([+-]?(?:\d*\.)?\d+)/g)) {
      if (!APPROVED_RUNTIME_WEIGHTS.has(axis[1])) {
        problems.push(
          `${file}:${1 + lineCount(contents.slice(0, match.index))} inline wght axis ${axis[1]} is not an approved 400/500/600 anchor`,
        );
      }
    }
  }
}

function validInlineSpacing(value) {
  const token = `["']var\\(--space-[1-8]\\)["']`;
  return value === "0"
    || new RegExp(`^${token}$`).test(value)
    || new RegExp(`\\?\\s*${token}\\s*:\\s*${token}$`).test(value);
}

function requireCustomProperty(rules, property, expected, problems) {
  const values = rules.flatMap((rule) => parseDeclarations(rule))
    .filter((declaration) => declaration.property === property)
    .map((declaration) => declaration.value);
  if (values.length !== 1 || !expected.test(values[0])) {
    problems.push(`styles.css must define ${property} once as ${expected.source}`);
  }
}

function selectorEndsWithDeclarations(rules, expectedSelector, expectedDeclarations) {
  return Object.entries(expectedDeclarations).every(([property, expectedValue]) => {
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index];
      if (!splitSelectors(rule.selector).includes(expectedSelector)) continue;
      const declaration = declarationMap(rule).get(property);
      if (declaration) return declaration.value === expectedValue;
    }
    return false;
  });
}

function declarationMap(rule) {
  return new Map(parseDeclarations(rule).map((declaration) => [declaration.property, declaration]));
}

function parseDeclarations(rule) {
  const declarations = [];
  const pattern = /(^|;)\s*([\w-]+)\s*:\s*([^;{}]+)(?=;|$)/g;
  for (const match of rule.body.matchAll(pattern)) {
    declarations.push({
      property: match[2].toLowerCase(),
      value: match[3].trim().replace(/\s*!important\s*$/, ""),
      line: rule.bodyLine + lineCount(rule.body.slice(0, match.index + match[1].length)),
    });
  }
  return declarations;
}

function collectRules(source, offset = 0, original = source) {
  const rules = [];
  let cursor = 0;
  while (cursor < source.length) {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (cursor >= source.length) break;
    const start = cursor;
    let quote = null;
    let open = -1;
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (quote) {
        if (character === "\\") cursor += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ";") break;
      else if (character === "{") { open = cursor; break; }
    }
    if (open === -1) {
      cursor += 1;
      continue;
    }
    const selector = source.slice(start, open).trim().replace(/\s+/g, " ");
    const close = matchingBrace(source, open);
    if (close === -1) break;
    const body = source.slice(open + 1, close);
    const bodyOffset = offset + open + 1;
    if (/^@(media|supports|layer|container|scope|document)\b/.test(selector)) {
      rules.push(...collectRules(body, bodyOffset, original));
    } else {
      rules.push({
        selector,
        body,
        bodyLine: 1 + lineCount(original.slice(0, bodyOffset)),
        line: 1 + lineCount(original.slice(0, offset + start)),
      });
    }
    cursor = close + 1;
  }
  return rules;
}

function matchingBrace(source, open) {
  let depth = 0;
  let quote = null;
  for (let cursor = open; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (character === "\\") cursor += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return cursor;
  }
  return -1;
}

function splitSelectors(selector) {
  return selector.split(",").map((part) => part.trim().replace(/\s+/g, " "));
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function unquote(value) {
  return value.replace(/^["']|["']$/g, "");
}

function lineCount(value) {
  return (value.match(/\n/g) ?? []).length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readText(file, problems) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    problems.push(`cannot read ${path.relative(process.cwd(), file)}: ${error.message}`);
    return null;
  }
}

async function readJson(file, problems) {
  const source = await readText(file, problems);
  if (source === null) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    problems.push(`cannot parse ${path.relative(process.cwd(), file)}: ${error.message}`);
    return null;
  }
}

async function main() {
  const repository = path.resolve(import.meta.dirname, "..");
  try {
    const result = await verifyInterfaceSystem(repository);
    process.stdout.write(
      `interface system OK: ${result.fontCount} verified local fonts; Phosphor ${result.phosphorVersion}; ${result.controlFloorCount} compact-control floors\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
