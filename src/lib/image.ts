// Turns any source image into the bytes we write into the EPUB.
// "fill" crops to a 2:3.2 ebook ratio, "fit" letterboxes onto white.
// Images smaller than the 1600px cap are never upscaled.

export type RenderMode = "fit" | "fill";

const MAX_WIDTH = 1600;
const RATIO = 1.6; // height / width, the usual ebook cover shape

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  // remote cover CDNs need this or the canvas becomes tainted and
  // toBlob() throws; for blob: URLs the attribute is ignored
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = src;
  });
  return img;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode image."))),
      "image/jpeg",
      0.9,
    ),
  );
}

/**
 * Render a cover image in the given mode. Returns JPEG bytes.
 * Sources must be same-origin object URLs or CORS-clean fetches so the
 * canvas stays untainted.
 */
export async function renderCover(
  src: string,
  mode: RenderMode,
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(src);
  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  if (!natW || !natH) throw new Error("That image has no size.");

  let width: number;
  let height: number;
  if (mode === "fill") {
    width = Math.min(natW, MAX_WIDTH);
    height = Math.round(width * RATIO);
  } else {
    const baseW = Math.min(MAX_WIDTH, Math.max(natW, natH / RATIO));
    width = Math.round(baseW);
    height = Math.round(width * RATIO);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";

  const scale =
    mode === "fill"
      ? Math.max(width / natW, height / natH) // cover: overflow, crop
      : Math.min(width / natW, height / natH, 1); // fit: inside, pad
  const drawW = natW * scale;
  const drawH = natH * scale;
  ctx.drawImage(
    img,
    (width - drawW) / 2,
    (height - drawH) / 2,
    drawW,
    drawH,
  );

  const blob = await canvasToBlob(canvas);
  return { blob, width, height };
}

/** object URL for an EPUB cover's existing bytes */
export function urlForBytes(
  bytes: Uint8Array,
  subtype: string | null,
): string {
  const mime =
    !subtype || subtype === "jpeg"
      ? "image/jpeg"
      : `image/${subtype}`;
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
}

/** load a File/Blob image and return an object URL safe for canvas use */
export async function urlForFile(file: File | Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  await loadImage(url); // fail early with a friendly message
  return url;
}
