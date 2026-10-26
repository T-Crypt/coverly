// EPUB cover engine. An EPUB is a zip: META-INF/container.xml points at the
// OPF package file, the OPF manifest lists every resource, and the cover is
// one image flagged either with properties="cover-image" (EPUB 3) or with a
// <meta name="cover"> pointing at a manifest id (EPUB 2).
//
// Changing the cover means: drop the new image into the zip, point both
// conventions at it, and remove the old references so readers cannot show a
// stale cover. Everything else in the zip stays byte-identical.

import JSZip from "jszip";

export type EpubErrorKind =
  | "not-zip"
  | "not-epub"
  | "too-large"
  | "drm"
  | "no-opf"
  | "mimetype";

export class EpubError extends Error {
  kind: EpubErrorKind;
  constructor(kind: EpubErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface EpubMeta {
  title: string;
  author: string;
  isbn: string | null;
}

export interface ParsedEpub {
  zip: JSZip;
  opfPath: string;
  /** directory of the OPF inside the zip, "" for root, always ends with "/" */
  opfDir: string;
  opfDoc: Document;
  meta: EpubMeta;
  /** zip-internal path of the current cover image, if one is referenced */
  coverPath: string | null;
  /** raw bytes of the current cover image, if present in the zip */
  coverData: Uint8Array | null;
  coverMediaSubtype: string | null; // "jpeg", "png", ...
}

const OPF_NS = "http://www.idpf.org/2007/opf";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const ENCRYPTION_IDPF = "http://www.idpf.org/2007/embed/ContentStream";
const ENCRYPTION_ADOBE = "http://ns.adobe.com/BOOK/Adobe DRM/1.0/";

function parseXml(text: string, kind: EpubErrorKind): Document {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new EpubError(kind, err.textContent || "bad xml");
  return doc;
}

/** all descendant elements in a namespace, compared by localName */
function els(root: Element | Document, ns: string, local: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName("*");
  for (const el of Array.from(all)) {
    if (el.namespaceURI === ns && el.localName === local) out.push(el);
  }
  return out;
}

function text(el: Element | undefined | null): string {
  return el?.textContent?.trim() ?? "";
}

/** resolve an OPF href relative to the OPF directory, normalized, decoded */
export function resolveHref(opfDir: string, href: string): string {
  const abs = href.startsWith("/")
    ? href.slice(1)
    : opfDir + (href.split("#")[0] ?? href);
  const parts: string[] = [];
  for (const seg of abs.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    })
    .join("/");
}

function opfDirOf(opfPath: string): string {
  const i = opfPath.lastIndexOf("/");
  return i === -1 ? "" : opfPath.slice(0, i + 1);
}

function findIsbn(doc: Document): string | null {
  for (const id of els(doc, DC_NS, "identifier")) {
    const scheme =
      id.getAttribute("opf:scheme") ||
      id.getAttributeNS("http://www.idpf.org/2007/opf", "scheme") ||
      "";
    const value = text(id).replace(/[-\s]/g, "");
    if (scheme.toUpperCase() === "ISBN") return value.replace(/^isbn:?/i, "");
    if (/^(isbn:)?(97(8|9))?\d{9}[0-9x]$/i.test(value.trim()))
      return value.replace(/^isbn:?/i, "");
  }
  return null;
}

async function readText(zip: JSZip, name: string): Promise<string | null> {
  const f = zip.file(name);
  if (!f) return null;
  return f.async("string");
}

const MAX_EPUB_BYTES = 400 * 1024 * 1024; // guards the tab, not the network

function byteLength(source: File | Blob | ArrayBuffer): number {
  if (source instanceof ArrayBuffer) return source.byteLength;
  if (ArrayBuffer.isView(source)) return source.byteLength;
  return (source as Blob).size;
}

async function firstBytes(
  source: File | Blob | ArrayBuffer,
  n: number,
): Promise<Uint8Array> {
  if (ArrayBuffer.isView(source))
    return new Uint8Array(source.buffer, source.byteOffset, Math.min(n, source.byteLength));
  if (source instanceof ArrayBuffer)
    return new Uint8Array(source, 0, Math.min(n, source.byteLength));
  const buf = await (source as Blob).slice(0, n).arrayBuffer();
  return new Uint8Array(buf);
}

async function loadOpf(
  zip: JSZip,
): Promise<{ opfPath: string; opfDoc: Document }> {
  const container = await readText(zip, "META-INF/container.xml");
  if (!container)
    throw new EpubError("no-opf", "No META-INF/container.xml in this file");
  const cdoc = parseXml(container, "no-opf");
  const rootfiles = Array.from(cdoc.getElementsByTagName("*")).filter(
    (e) => e.localName === "rootfile",
  );
  const opfPath = rootfiles[0]?.getAttribute("full-path") || "";
  if (!opfPath)
    throw new EpubError("no-opf", "container.xml has no rootfile path");
  const opfText = await readText(zip, opfPath);
  if (opfText === null)
    throw new EpubError("no-opf", `${opfPath} is missing from the archive`);
  return { opfPath, opfDoc: parseXml(opfText, "no-opf") };
}

/** locate the cover image path using EPUB3, then EPUB2, then heuristics */
function findCoverPath(parsed: {
  opfPath: string;
  opfDoc: Document;
}): string | null {
  const { opfPath, opfDoc } = parsed;
  const dir = opfDirOf(opfPath);

  const items = els(opfDoc, OPF_NS, "item");

  // EPUB 3: item with properties="cover-image"
  const byProps = items.find((i) =>
    (i.getAttribute("properties") || "").split(/\s+/).includes("cover-image"),
  );
  if (byProps) return resolveHref(dir, byProps.getAttribute("href") || "");

  // EPUB 2: <meta name="cover" content="MANIFEST_ID">
  const metas = els(opfDoc, OPF_NS, "meta");
  const coverMeta = metas.find(
    (m) => (m.getAttribute("name") || "").toLowerCase() === "cover",
  );
  const coverId = coverMeta?.getAttribute("content") || "";
  if (coverId) {
    const item = items.find((i) => i.getAttribute("id") === coverId);
    if (item) return resolveHref(dir, item.getAttribute("href") || "");
  }

  // Heuristic: image item whose id or href says "cover"
  const guess = items.find((i) => {
    const mt = i.getAttribute("media-type") || "";
    const href = (i.getAttribute("href") || "").toLowerCase();
    const id = i.getAttribute("id") || "";
    if (!mt.startsWith("image/")) return false;
    if (href.endsWith(".xhtml") || href.endsWith(".html")) return false;
    return /cover/i.test(href) || /cover/i.test(id);
  });
  if (guess) return resolveHref(dir, guess.getAttribute("href") || "");
  return null;
}

/** strip every existing cover reference from the OPF document */
function clearCoverRefs(opfDoc: Document): void {
  // the manifest item the EPUB2 <meta name="cover"> points at, if any
  const coverMeta = els(opfDoc, OPF_NS, "meta").find(
    (m) => (m.getAttribute("name") || "").toLowerCase() === "cover",
  );
  const idref = coverMeta?.getAttribute("content") || "";
  for (const item of els(opfDoc, OPF_NS, "item")) {
    const props = (item.getAttribute("properties") || "").split(/\s+/);
    if (
      props.includes("cover-image") ||
      (idref && item.getAttribute("id") === idref)
    )
      item.parentNode?.removeChild(item);
  }
  for (const meta of els(opfDoc, OPF_NS, "meta")) {
    if ((meta.getAttribute("name") || "").toLowerCase() === "cover")
      meta.parentNode?.removeChild(meta);
  }
  for (const ref of els(opfDoc, OPF_NS, "reference")) {
    if ((ref.getAttribute("type") || "").toLowerCase() === "cover")
      ref.parentNode?.removeChild(ref);
  }
}

export async function parseEpub(
  source: File | Blob | ArrayBuffer,
): Promise<ParsedEpub> {
  if (byteLength(source) > MAX_EPUB_BYTES)
    throw new EpubError(
      "too-large",
      "That file is over 400 MB, too big to edit safely in a browser tab.",
    );
  // fail early and clearly when it is not a zip at all, before JSZip
  // reports "invalid" without context
  const head = await firstBytes(source, 4);
  if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b)
    throw new EpubError(
      "not-zip",
      "This file is not a readable EPUB (it is not a zip archive).",
    );
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(source);
  } catch {
    throw new EpubError(
      "not-zip",
      "This file is not a readable EPUB (it is not a zip archive).",
    );
  }

  // DRM detection: idpf content-stream encryption or Adobe DRM methods
  const encryption = await readText(zip, "META-INF/encryption.xml");
  if (encryption) {
    if (
      encryption.includes(ENCRYPTION_IDPF) ||
      encryption.includes(ENCRYPTION_ADOBE)
    )
      throw new EpubError(
        "drm",
        "This book is DRM-protected, so its contents cannot be changed.",
      );
  }

  if (!zip.file("mimetype"))
    throw new EpubError(
      "not-epub",
      "No mimetype entry: this zip is not an EPUB.",
    );

  const { opfPath, opfDoc } = await loadOpf(zip);

  const title =
    text(els(opfDoc, DC_NS, "title")[0]) || "Untitled book";
  const author = text(els(opfDoc, DC_NS, "creator")[0]);
  const isbn = findIsbn(opfDoc);

  const coverPath = findCoverPath({ opfPath, opfDoc });
  let coverData: Uint8Array | null = null;
  let coverMediaSubtype: string | null = null;
  if (coverPath) {
    const f = zip.file(coverPath);
    if (f) {
      coverData = await f.async("uint8array");
      const ext = coverPath.slice(coverPath.lastIndexOf(".") + 1).toLowerCase();
      coverMediaSubtype =
        ext === "png"
          ? "png"
          : ext === "gif"
            ? "gif"
            : ext === "webp"
              ? "webp"
              : ext === "svg"
                ? "svg+xml"
                : "jpeg";
    }
  }

  return {
    zip,
    opfPath,
    opfDir: opfDirOf(opfPath),
    opfDoc,
    meta: { title, author, isbn },
    coverPath: coverData ? coverPath : null,
    coverData,
    coverMediaSubtype,
  };
}

export interface CoverImage {
  data: Uint8Array;
  mime: string; // "image/jpeg", "image/png", ...
}

function extFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

/**
 * Write a new cover and return the rebuilt EPUB as a Blob.
 * The `mimetype` entry must end up first and STOREd or readers reject
 * the file; JSZip special-cases that, and the result is verified below.
 */
export async function setCover(
  parsed: ParsedEpub,
  cover: CoverImage,
): Promise<Blob> {
  const { zip, opfPath, opfDir, opfDoc } = parsed;

  // 1. remove the old cover: collect every path the old references point
  // at, clear the references, then delete files nothing references anymore
  const oldPaths = new Set<string>();
  if (parsed.coverPath) oldPaths.add(parsed.coverPath);
  for (const meta of els(opfDoc, OPF_NS, "meta")) {
    if ((meta.getAttribute("name") || "").toLowerCase() === "cover") {
      const idref = meta.getAttribute("content") || "";
      const item = els(opfDoc, OPF_NS, "item").find(
        (i) => i.getAttribute("id") === idref,
      );
      if (item)
        oldPaths.add(
          resolveHref(opfDir, item.getAttribute("href") || ""),
        );
    }
  }
  clearCoverRefs(opfDoc);
  for (const p of oldPaths) {
    if (!zip.file(p)) continue;
    const stillUsed = els(opfDoc, OPF_NS, "item").some(
      (i) => resolveHref(opfDir, i.getAttribute("href") || "") === p,
    );
    if (!stillUsed) zip.remove(p);
  }

  // 2. add the new image next to the OPF
  const newCoverPath = `${opfDir}cover-${Math.random().toString(36).slice(2, 8)}.${extFor(cover.mime)}`;
  zip.file(newCoverPath, cover.data as unknown as Uint8Array);

  // 3. manifest item with the EPUB3 property
  const manifest = els(opfDoc, OPF_NS, "manifest")[0];
  if (!manifest)
    throw new Error("OPF has no <manifest>; cannot add a cover");
  const itemId = `coverly-cover-${Math.random().toString(36).slice(2, 8)}`;
  const item = opfDoc.createElementNS(OPF_NS, "item");
  item.setAttribute("id", itemId);
  item.setAttribute("href", newCoverPath.slice(opfDir.length));
  item.setAttribute("media-type", cover.mime);
  item.setAttribute("properties", "cover-image");
  manifest.appendChild(item);

  // 4. the EPUB2 meta (direct child of <package>, right after <metadata>),
  // so older readers pick the cover up too
  const packageEl = opfDoc.documentElement;
  const meta = opfDoc.createElementNS(OPF_NS, "meta");
  meta.setAttribute("name", "cover");
  meta.setAttribute("content", itemId);
  packageEl.insertBefore(meta, manifest.parentNode === packageEl ? manifest : packageEl.firstChild);

  // 5. write the serialized OPF back into the zip
  const opfXml = new XMLSerializer().serializeToString(opfDoc);
  zip.file(opfPath, opfXml);

  // 6. repack. The EPUB spec requires the mimetype entry STOREd (stored
  //    uncompressed); JSZip re-compresses loaded files unless told
  //    otherwise per-file, so force it, then verify the real bytes.
  const mimetypeFile = zip.file("mimetype");
  if (mimetypeFile) mimetypeFile.options.compression = "STORE";
  const out = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });
  await verifyMimetypeFirst(out);
  // keep the parsed object honest for a second call (user re-picks a cover)
  parsed.coverPath = newCoverPath;
  parsed.coverData = cover.data;
  parsed.coverMediaSubtype =
    extFor(cover.mime) === "jpg" ? "jpeg" : extFor(cover.mime);
  return out;
}

/** read the first local file header straight from the zip bytes */
async function verifyMimetypeFirst(zipBlob: Blob): Promise<void> {
  const head = new Uint8Array(
    await zipBlob.slice(0, 64).arrayBuffer(),
  );
  const view = new DataView(head.buffer);
  const ok =
    head.length >= 30 &&
    view.getUint32(0, true) === 0x04034b50 && // local file header
    view.getUint16(8, true) === 0 && // compression method STORE
    (() => {
      const nameLen = view.getUint16(26, true);
      if (head.length < 30 + nameLen) return false;
      const name = String.fromCharCode(...head.subarray(30, 30 + nameLen));
      return name === "mimetype";
    })();
  if (!ok)
    throw new EpubError(
      "mimetype",
      "Refused to write output: mimetype is not the first STORED entry.",
    );
}

export function suggestFileName(parsed: ParsedEpub, original: string): string {
  const base = original.replace(/\.epub$/i, "");
  const { title, author } = parsed.meta;
  const clean = (s: string) =>
    s.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  const t = title === "Untitled book" ? "" : title;
  if (t && author) return `${clean(t)} - ${clean(author)}.epub`;
  if (t) return `${clean(t)}.epub`;
  return `${base} (new cover).epub`;
}
