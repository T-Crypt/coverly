// Open Library: open, community-contributed book database. Both endpoints
// send Access-Control-Allow-Origin: *, so we call them straight from the
// browser with no key and no proxy.

export interface CoverResult {
  url: string; // full-size cover image URL
  thumbUrl: string;
  alt: string;
  source: string;
}

const SEARCH_URL = "https://openlibrary.org/search.json";
const FIELDS =
  "cover_i,isbn,title,author_name,first_publish_year,edition_key".split(",");
const NO_COVER_PLACEHOLDER_BYTES = 1024; // the "no cover" gif is 149 bytes

interface OlDoc {
  cover_i?: number;
  isbn?: string[];
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  edition_key?: string[];
}

interface OlEdition {
  covers?: number[];
  title?: string;
  publish_date?: string;
  publishers?: string[];
}

export class CoverSearchError extends Error {
  offline: boolean;
  constructor(message: string, offline = false) {
    super(message);
    this.offline = offline;
  }
}

function coverUrl(kind: "id" | "isbn", key: string): [string, string] {
  const base = `https://covers.openlibrary.org/b/${kind}/${key}`;
  return [`${base}-L.jpg`, `${base}-M.jpg`];
}

/** digits with an optional check X, nothing else reaches a URL */
function safeIsbn(value: string): string | null {
  const bare = value.replace(/[-\s]/g, "");
  if (/^[0-9]{10}$/.test(bare)) return bare;
  if (/^[0-9]{9}[0-9Xx]$/.test(bare)) return bare.toUpperCase();
  if (/^[0-9]{13}$/.test(bare)) return bare;
  return null;
}

function safeCoverId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1e9
    ? value
    : null;
}

/** true when the bytes look like a real image, not the no-cover stub */
async function looksLikeCover(blob: Blob): Promise<boolean> {
  return blob.size > NO_COVER_PLACEHOLDER_BYTES && blob.type.startsWith("image/");
}

async function fetchJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw new CoverSearchError("You are offline.", true);
    if (e instanceof DOMException && e.name === "TimeoutError")
      throw new CoverSearchError("Open Library took too long to answer.");
    throw new CoverSearchError("Could not reach Open Library.");
  }
  if (!res.ok) {
    if (res.status === 429)
      throw new CoverSearchError(
        "Open Library is rate-limiting right now. Try again in a minute.",
      );
    throw new CoverSearchError(`Open Library returned ${res.status}.`);
  }
  return res.json();
}

/**
 * Collect unique covers for a query from Open Library:
 * 1. the primary cover of each search hit (one call),
 * 2. every cover on the top editions — publisher scans and community
 *    uploads both live there, so the grid shows all the available art,
 * 3. an ISBN probe for hits with no indexed cover.
 * All endpoints are CORS-enabled with no key.
 */
export async function searchCovers(
  query: string,
  limit = 24,
): Promise<CoverResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const params = new URLSearchParams({
    q: trimmed,
    limit: String(limit * 3), // many editions share or miss covers
  });
  // append, not spread: URLSearchParams must repeat fields=, and
  // Object.fromEntries would collapse the duplicates to the last one
  for (const f of FIELDS) params.append("fields", f);
  const data = (await fetchJson(`${SEARCH_URL}?${params}`)) as {
    docs?: OlDoc[];
  };
  const docs = (data.docs ?? []).slice(0, limit * 3);

  const out: CoverResult[] = [];
  const seen = new Set<string>();
  const push = (coverId: number, alt: string) => {
    const id = safeCoverId(coverId);
    if (!id || out.length >= limit || seen.has(`id:${id}`)) return;
    seen.add(`id:${id}`);
    const [url, thumbUrl] = coverUrl("id", String(id));
    out.push({ url, thumbUrl, alt, source: "Open Library" });
  };

  // 1. primary cover of each search hit, no extra calls needed
  const noCover: OlDoc[] = [];
  for (const doc of docs) {
    if (doc.cover_i) {
      push(
        doc.cover_i,
        [doc.title, doc.author_name?.[0], doc.first_publish_year]
          .filter(Boolean)
          .join(" — "),
      );
    } else if (noCover.length < 3) {
      noCover.push(doc);
    }
  }

  // 2. full cover list of the top editions, fetched in parallel.
  // Search results give edition keys in two shapes: "/books/OL123M"
  // or bare "ol123m"; both must resolve under /books/.
  const editionKeys: string[] = [];
  for (const doc of docs) {
    for (const raw of (doc.edition_key ?? []).slice(0, 1)) {
      const key = raw.startsWith("/") ? raw : `/books/${raw}`;
      if (editionKeys.length >= 8) break;
      if (!editionKeys.includes(key)) editionKeys.push(key);
    }
    if (editionKeys.length >= 8) break;
  }
  const editions = await Promise.allSettled(
    editionKeys.map((key) =>
      fetchJson(`https://openlibrary.org${key}.json`),
    ),
  );
  for (const res of editions) {
    if (res.status !== "fulfilled") continue;
    const ed = res.value as OlEdition;
    const alt = [ed.title, ed.publish_date, ed.publishers?.[0]]
      .filter(Boolean)
      .join(" — ");
    for (const coverId of ed.covers ?? []) {
      if (coverId) push(coverId, alt || "Open Library edition");
    }
  }

  // 3. ISBN probe for hits whose covers are not indexed (slow path:
  // each probe downloads the image to tell real covers from the stub)
  for (const doc of noCover) {
    if (out.length >= limit) break;
    for (const isbn of (doc.isbn ?? []).slice(0, 2)) {
      const bare = safeIsbn(isbn);
      if (!bare || seen.has(`isbn:${bare}`)) continue;
      seen.add(`isbn:${bare}`);
      const [url, thumbUrl] = coverUrl("isbn", bare);
      try {
        const probe = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (probe.ok && (await looksLikeCover(await probe.blob()))) {
          out.push({
            url,
            thumbUrl,
            alt: [doc.title, doc.author_name?.[0]].filter(Boolean).join(" — "),
            source: "Open Library",
          });
          break;
        }
      } catch {
        /* this ISBN is a dead end, try the next */
      }
    }
  }
  return out;
}

/** direct cover for a known ISBN, shown before any search happens */
export async function coverForIsbn(isbn: string): Promise<CoverResult | null> {
  const bare = safeIsbn(isbn);
  if (!bare) return null;
  const [url, thumbUrl] = coverUrl("isbn", bare);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!(await looksLikeCover(blob))) return null;
    return { url, thumbUrl, alt: `ISBN ${bare}`, source: "Open Library" };
  } catch {
    return null;
  }
}

/** a decent first search string from the book's own metadata */
export function guessQuery(meta: {
  title: string;
  author: string;
}): string | null {
  const parts = [meta.title, meta.author].map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}
