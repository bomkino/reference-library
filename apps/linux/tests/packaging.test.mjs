import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const MIME = "application/x-pitchdog-reference-library";

test("all Linux packaging paths declare the exact .pitchlibrary association", async () => {
  const [packageSource, desktop, mime, pkgbuild] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../packaging/io.pitchdog.ReferenceLibrary.desktop", import.meta.url), "utf8"),
    readFile(new URL("../packaging/io.pitchdog.ReferenceLibrary.xml", import.meta.url), "utf8"),
    readFile(new URL("../packaging/PKGBUILD", import.meta.url), "utf8"),
  ]);
  const configuration = JSON.parse(packageSource).build;
  assert.equal(configuration.productName, "reference-library");
  assert.equal(configuration.linux.desktop.entry.Name, "Reference Library");
  assert.deepEqual(configuration.fileAssociations, [{
    ext: "pitchlibrary",
    name: "Reference Library package",
    description: "Reference Library package",
    mimeType: MIME,
    role: "Editor",
  }]);
  assert.deepEqual(configuration.appImage.executableArgs, []);
  assert.deepEqual(configuration.pacman.executableArgs, ["%F"]);
  assert.match(desktop, /^Exec=reference-library %F$/m);
  assert.match(desktop, new RegExp(`^MimeType=${MIME};$`, "m"));
  assert.doesNotMatch(desktop, /--no-sandbox/);
  assert.match(mime, /<glob pattern="\*\.pitchlibrary"\/>/);
  assert.match(mime, new RegExp(`mime-type type="${MIME}"`));
  assert.match(pkgbuild, /usr\/share\/applications\/io\.pitchdog\.ReferenceLibrary\.desktop/);
  assert.match(pkgbuild, /usr\/share\/mime\/packages\/io\.pitchdog\.ReferenceLibrary\.xml/);
});
