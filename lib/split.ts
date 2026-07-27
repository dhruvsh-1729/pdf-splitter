export type SplitFile = {
  name: string;
  blob: Blob;
  pageCount: number;
  label: string;
};

export type SplitRequest = {
  /** Part number shown in the UI (1-based, stable even if parts are excluded). */
  partNumber: number;
  /** 0-based page indices in the source document, in output order. */
  pages: number[];
  label: string;
};

type BuildOptions = {
  bytes: Uint8Array;
  baseName: string;
  requests: SplitRequest[];
  /** Extra rotation in degrees per 0-based source page index. */
  rotations: Record<number, number>;
  totalParts: number;
  onProgress?: (done: number, total: number) => void;
};

/** Lets the browser paint between parts so the UI never looks frozen. */
function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

export function safeBaseName(fileName: string): string {
  const stripped = fileName.replace(/\.pdf$/i, "").trim();
  const cleaned = stripped.replace(/[\\/:*?"<>|]+/g, "_");
  return cleaned || "document";
}

/**
 * Builds one PDF per requested part. pdf-lib is imported on demand — it is only
 * needed once the user actually exports, and keeping it out of the first paint
 * is worth a lot on a phone.
 */
export async function buildSplitFiles({
  bytes,
  baseName,
  requests,
  rotations,
  totalParts,
  onProgress,
}: BuildOptions): Promise<SplitFile[]> {
  const { PDFDocument, degrees } = await import("pdf-lib");
  const source = await PDFDocument.load(bytes.slice(0));
  const pad = String(totalParts).length;
  const results: SplitFile[] = [];

  for (let i = 0; i < requests.length; i += 1) {
    const request = requests[i];
    const output = await PDFDocument.create();
    const copied = await output.copyPages(source, request.pages);

    copied.forEach((page, pageIdx) => {
      const extra = rotations[request.pages[pageIdx]] || 0;
      if (extra) {
        // Rotations are relative to how the page is displayed, which already
        // includes the PDF's own /Rotate value.
        const base = page.getRotation().angle;
        page.setRotation(degrees((base + extra) % 360));
      }
      output.addPage(page);
    });

    const pdfBytes = await output.save();
    results.push({
      name: `${baseName}_part_${String(request.partNumber).padStart(pad, "0")}.pdf`,
      // Cast because TS models Uint8Array over ArrayBufferLike, not BlobPart.
      blob: new Blob([pdfBytes as unknown as BlobPart], {
        type: "application/pdf",
      }),
      pageCount: request.pages.length,
      label: request.label,
    });

    onProgress?.(i + 1, requests.length);
    if (i < requests.length - 1) await yieldToBrowser();
  }

  return results;
}
