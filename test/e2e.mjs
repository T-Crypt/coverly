// Browser end-to-end: load the built app, run a real EPUB through the UI,
// pick a cover by upload and by Open Library search, download, and verify
// the downloaded file with the engine + python's zipfile.
//
// Run: NODE_PATH=$HOME/.local/share/web-shot/node_modules node test/e2e.mjs [url]
// App must be served at http://127.0.0.1:8899 (or pass a url).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

// playwright-core lives in the web-shot tool's install, not here
const { chromium } = await import(
  pathToFileURL(
    `${process.env.HOME}/.local/share/web-shot/node_modules/playwright-core/index.mjs`,
  ).href
);

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const { parseEpub } = await import("../src/lib/epub.ts");

const URL_APP = process.argv[2] ?? "http://127.0.0.1:8899";
const SAMPLE = path.resolve("test/samples/plain.epub");
const COVER_PNG = path.resolve("test/newcover.png");
const OUT = path.resolve("test/out/e2e-out.epub");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const browser = await chromium.launch({
  executablePath: path.join(
    process.env.HOME,
    ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
  ),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
page.on("requestfailed", (r) =>
  errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`),
);

await page.goto(URL_APP, { waitUntil: "networkidle" });

// 1. drop an EPUB via the hidden file input
await page.setInputFiles('input[type=file]', SAMPLE);
await page.getByText("The Test Book").waitFor({ timeout: 10000 });
console.log("parsed book shown: The Test Book");

// give the Open Library search a chance to settle
const grid = page.locator('[aria-label="Pick a cover"] li button');
await page.waitForTimeout(6000);
const tileCount = await grid.count();
console.log(`open library search tiles: ${tileCount}`);
await page.screenshot({ path: "/tmp/opencode/coverly-ready.png" });

// 2. pick a cover: prefer a real search result, else upload our own PNG
if (tileCount > 0) {
  await grid.first().click();
  console.log("picked a search-result cover");
} else {
  await page.getByRole("tab", { name: /upload/i }).click();
  const imgInput = page.locator(
    '[aria-label="Pick a cover"] input[type=file]',
  );
  await imgInput.setInputFiles(COVER_PNG);
  console.log("picked an uploaded cover");
}
await page.getByText("New cover", { exact: true }).waitFor({ timeout: 5000 });

// 3. download and capture the file
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 30000 }),
  page.getByRole("button", { name: /download epub/i }).click(),
]);
await download.saveAs(OUT);
const suggested = download.suggestedFilename();
console.log(`downloaded: ${suggested}`);
await page.screenshot({ path: "/tmp/opencode/coverly-done.png" });

// 4. verify the downloaded EPUB with the engine + python
const buf = fs.readFileSync(OUT);
const parsed = await parseEpub(buf);
assert.equal(parsed.meta.title, "The Test Book", "title lost");
assert.ok(parsed.coverData?.length > 0, "no cover in output");
assert.ok(/\.epub$/.test(suggested) && suggested.includes("Test Book"));
execFileSync(
  "python3",
  [
    "-c",
    `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
assert z.namelist()[0] == "mimetype"
assert z.getinfo("mimetype").compress_type == 0
print("python zip check on download: ok")
`,
    OUT,
  ],
  { stdio: "inherit" },
);

// 5. service worker + manifest present (installability basics).
// Over plain http to a LAN IP browsers disable service workers entirely,
// so treat "no serviceWorker API" as an environment fact, not a failure.
const swSupported = await page.evaluate(
  () => "serviceWorker" in navigator,
);
if (swSupported) {
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active?.scriptURL ?? null;
  });
  console.log(`service worker active: ${sw}`);
  assert.ok(sw, "service worker did not activate");
} else {
  console.log("service worker: not available in this context (http LAN ip)");
}
const manifestOk = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return false;
  const res = await fetch(link.href);
  return res.ok && (await res.json()).name?.includes("Coverly");
});
console.log(`manifest served: ${manifestOk}`);
assert.ok(manifestOk, "manifest not served");

// 6. dark mode + mobile screenshots
await page.getByRole("button", { name: /switch to dark/i }).click();
await page.screenshot({ path: "/tmp/opencode/coverly-dark.png" });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "/tmp/opencode/coverly-mobile.png",
  fullPage: true,
});

// service-worker-driven OL fetches must not pollute the error list;
// the COOP notice is Chromium explaining that the header is inert on
// insecure origins — expected on the http LAN deployment
const noise = (e) =>
  e.includes("favicon") ||
  e.includes("Cross-Origin-Opener-Policy header has been ignored");
const realErrors = errors.filter((e) => !noise(e));
await browser.close();
if (realErrors.length) {
  console.error("browser errors:");
  realErrors.forEach((e) => console.error(" ", e));
  process.exit(1);
}
console.log("e2e: all checks passed");
