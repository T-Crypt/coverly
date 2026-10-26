/** the cover the user picked, ready to preview and apply */
export interface CoverChoice {
  /** display URL (object URL or CORS-clean remote) */
  url: string;
  alt: string;
  /** original bytes when we have them locally (upload, "as is" fetch) */
  original?: Blob;
}

export type SizeMode = "asis" | "fit" | "fill";
