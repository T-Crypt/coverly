// Engine tests: parse samples, swap covers, verify the repacked zip.
// Run: npm test  (regenerates samples first via gen:samples)

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip from "jszip";

// browser globals the engine expects
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const { parseEpub, setCover } = await import("../src/lib/epub.ts");
import JSZipDefault from "jszip";
const Zip = JSZipDefault;

const SAMPLES = new URL("./samples/", import.meta.url).pathname;
const OUT_DIR = new URL("./out/", import.meta.url).pathname;
fs.mkdirSync(OUT_DIR, { recursive: true });

// a real small PNG produced by gen_samples.py
const NEW_COVER = fs.readFileSync(
  new URL("./newcover.png", import.meta.url).pathname,
);

const readSample = (name) => fs.readFileSync(path.join(SAMPLES, name));

async function opfOf(zipBuf) {
  const zip = await Zip.loadAsync(zipBuf);
  const opfPath = await (await zip.file("META-INF/container.xml").async("string"))
    .match(/full-path="([^"]+)"/)[1];
  const xml = await zip.file(opfPath).async("string");
  return { zip, opfPath, xml };
}

const entriesOf = async (blobOrBuf) => {
  const zip = await Zip.loadAsync(blobOrBuf);
  return Object.keys(zip.files).sort();
};

async function bufOf(blob) {
  return Buffer.from(await blob.arrayBuffer());
}

// python zipfile check: valid zip, mimetype first and STORED
function pythonZipCheck(filePath) {
  execFileSync(
    "python3",
    [
      "-c",
      `
import sys, zipfile
p = sys.argv[1]
z = zipfile.ZipFile(p)
assert z.testzip() is None, "corrupt member"
names = z.namelist()
assert names[0] == "mimetype", f"mimetype not first: {names[:3]}"
info = z.getinfo("mimetype")
assert info.compress_type == zipfile.ZIP_STORED, "mimetype not STORED"
assert z.read("mimetype") == b"application/epub+zip"
`  ,
      filePath,
    ],
    { stdio: "inherit" },
  );
}

test("parse: plain epub has metadata, no cover", async () => {
  const p = await parseEpub(readSample("plain.epub"));
  assert.equal(p.meta.title, "The Test Book");
  assert.equal(p.meta.author, "A. Tester");
  assert.equal(p.meta.isbn, "9781234567897");
  assert.equal(p.coverPath, null);
  assert.equal(p.coverData, null);
});

test("parse: epub3 cover found", async () => {
  const p = await parseEpub(readSample("opf3cover.epub"));
  assert.equal(p.coverPath, "OEBPS/images/old.jpg");
  assert.ok(p.coverData?.length > 100);
});

test("parse: epub2 cover found via meta", async () => {
  const p = await parseEpub(readSample("opf2cover.epub"));
  assert.equal(p.coverPath, "OEBPS/old2.jpg");
});

test("parse: uri-encoded and spaced hrefs resolve", async () => {
  const p = await parseEpub(readSample("spaced hrefs.epub"));
  assert.equal(p.coverPath, "My Book/art/old cover.jpg");
});

test("errors: DRM file rejected", async () => {
  await assert.rejects(
    () => parseEpub(readSample("drm.epub")),
    (e) => e.kind === "drm",
  );
});

test("errors: broken epub rejected", async () => {
  await assert.rejects(
    () => parseEpub(readSample("broken.epub")),
    (e) => e.kind === "no-opf",
  );
});

test("errors: non-epub zip rejected", async () => {
  await assert.rejects(
    () => parseEpub(readSample("notepub.zip")),
    (e) => e.kind === "not-epub" || e.kind === "not-zip",
  );
});

test("errors: non-zip bytes rejected before JSZip sees them", async () => {
  const blob = new Blob([Buffer.from("MZ this is not a zip, it is pretend exe")]);
  await assert.rejects(() => parseEpub(blob), (e) => e.kind === "not-zip");
});

test("setCover: adds cover to epub with none", async () => {
  const p = await parseEpub(readSample("plain.epub"));
  const out = await setCover(p, { data: new Uint8Array(NEW_COVER), mime: "image/png" });
  const buf = await bufOf(out);
  const outPath = path.join(OUT_DIR, "plain-new.epub");
  fs.writeFileSync(outPath, buf);
  pythonZipCheck(outPath);

  const { zip, xml } = await opfOf(buf);
  assert.match(xml, /properties="cover-image"/);
  assert.match(xml, /<meta name="cover" content="[^"]+"\/>/);
  const newImg = Object.keys(zip.files).find((n) => /^OEBPS\/cover-[a-z0-9]+\.png$/.test(n));
  assert.ok(newImg, "new cover image not found in zip");
  const reloaded = await parseEpub(buf);
  assert.equal(reloaded.coverPath, newImg);
  assert.ok(reloaded.coverData.length === NEW_COVER.length);
});

test("setCover: replaces epub3 cover, other files untouched", async () => {
  const src = readSample("opf3cover.epub");
  const p = await parseEpub(src);
  const out = await setCover(p, {
    data: new Uint8Array(NEW_COVER),
    mime: "image/png",
  });
  const buf = await bufOf(out);

  const srcZip = await Zip.loadAsync(src);
  const outZip = await Zip.loadAsync(buf);
  assert.ok(!outZip.file("OEBPS/images/old.jpg"), "old cover still present");

  // every other member is byte-identical
  for (const name of Object.keys(srcZip.files)) {
    if (name.endsWith("/") || name === "OEBPS/images/old.jpg") continue;
    if (name === "OEBPS/content.opf") {
      const a = await srcZip.file(name).async("string");
      const b = await outZip.file(name).async("string");
      assert.ok(a !== b, "opf should have changed");
      assert.match(b, /properties="cover-image"/);
      assert.ok(
        !/id="oldcover"/.test(b),
        "old manifest entry should be gone",
      );
      continue;
    }
    const a = await srcZip.file(name).async("uint8array");
    const b = await outZip.file(name).async("uint8array");
    assert.deepEqual(b, a, `${name} changed`);
  }
});

test("setCover: replaces epub2 meta cover and guide reference", async () => {
  const p = await parseEpub(readSample("opf2cover.epub"));
  const out = await setCover(p, {
    data: new Uint8Array(NEW_COVER),
    mime: "image/png",
  });
  const buf = await bufOf(out);
  const { zip, xml } = await opfOf(buf);
  assert.ok(!zip.file("OEBPS/old2.jpg"), "old cover file still present");
  assert.ok(!xml.includes('reference type="cover"'), "guide reference left");
  const coverMetas = xml.match(/<meta name="cover"/g) ?? [];
  assert.equal(coverMetas.length, 1, "exactly one cover meta");
  // the meta content must point at the new item's id
  const content = xml.match(/<meta name="cover" content="([^"]+)"/)[1];
  const item = new RegExp(
    `<item[^>]*id="${content}"[^>]*properties="cover-image"`,
  );
  assert.match(xml, item, "meta does not reference the cover-image item");
});

test("setCover: idempotent when called twice (re-pick)", async () => {
  const p = await parseEpub(readSample("plain.epub"));
  await setCover(p, { data: new Uint8Array(NEW_COVER), mime: "image/png" });
  const out2 = await setCover(p, {
    data: new Uint8Array(NEW_COVER),
    mime: "image/png",
  });
  const buf = await bufOf(out2);
  const { xml, zip } = await opfOf(buf);
  assert.equal((xml.match(/properties="cover-image"/g) ?? []).length, 1);
  assert.equal((xml.match(/<meta name="cover"/g) ?? []).length, 1);
  const covers = Object.keys(zip.files).filter((n) =>
    /^OEBPS\/cover-/.test(n),
  );
  assert.equal(covers.length, 1, "stale cover file left behind");
  const outPath = path.join(OUT_DIR, "repick.epub");
  fs.writeFileSync(outPath, buf);
  pythonZipCheck(outPath);
});

test("output: entries preserved and parseable after swap", async () => {
  const src = readSample("opf3cover.epub");
  const p = await parseEpub(src);
  const out = await setCover(p, {
    data: new Uint8Array(NEW_COVER),
    mime: "image/png",
  });
  const buf = await bufOf(out);
  const srcNames = await entriesOf(src);
  const got = await entriesOf(buf);
  for (const name of srcNames.filter((n) => n !== "OEBPS/images/old.jpg"))
    assert.ok(got.includes(name), `${name} lost`);
  const p2 = await parseEpub(buf);
  assert.ok(p2.coverData, "re-parsed output has no cover");
});
