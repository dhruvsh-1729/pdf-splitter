import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type PdfjsModule = typeof import("pdfjs-dist");

/**
 * Served from /public (see scripts/copy-pdf-worker.js) rather than a CDN so the
 * worker version always matches the bundled library and mobile users don't wait
 * on a cross-origin 1MB script.
 */
export const PDF_WORKER_SRC = "/pdf.worker.min.js";

let libPromise: Promise<PdfjsModule> | null = null;

/**
 * Loads pdf.js lazily and only in the browser. Keeping it out of the initial
 * bundle matters a lot on phones: the library is ~320KB minified and is useless
 * until the user actually picks a file.
 */
export function getPdfjs(): Promise<PdfjsModule> {
  if (!libPromise) {
    libPromise = import("pdfjs-dist").then((mod) => {
      const lib = ((mod as unknown as { default?: PdfjsModule }).default ??
        mod) as PdfjsModule;
      lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
      return lib;
    });
  }
  return libPromise;
}

/**
 * Opens a PDF from raw bytes. pdf.js takes ownership of (and detaches) the
 * buffer it is handed, so callers keep their own copy for pdf-lib exports.
 */
export async function loadPdfDocument(
  bytes: Uint8Array,
  onProgress?: (loaded: number, total: number) => void
): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({
    data: bytes.slice(0),
    // The whole file is already in memory; skip pdf.js' range/stream machinery.
    disableAutoFetch: true,
    disableStream: true,
  });
  if (onProgress) {
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) =>
      onProgress(loaded, total);
  }
  return task.promise;
}

export function isRenderCancelled(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { name?: string }).name === "RenderingCancelledException"
  );
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not encode thumbnail")),
      type,
      quality
    );
  });
}

/** Frees the backing store immediately instead of waiting for GC. */
function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Renders one page straight onto a canvas the caller owns. Used by the
 * full-screen viewer, where we want a crisp bitmap at the current size.
 */
export async function renderPageToCanvas(options: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  canvas: HTMLCanvasElement;
  boxWidth: number;
  boxHeight: number;
  rotation?: number;
  maxPixelRatio?: number;
  onTask?: (task: RenderTask) => void;
}): Promise<{ cssWidth: number; cssHeight: number }> {
  const {
    doc,
    pageNumber,
    canvas,
    boxWidth,
    boxHeight,
    rotation = 0,
    maxPixelRatio = 2,
    onTask,
  } = options;

  const page = await doc.getPage(pageNumber);
  try {
    const unrotated = page.getViewport({
      scale: 1,
      rotation: (page.rotate + rotation) % 360,
    });
    const fit = Math.min(
      boxWidth / unrotated.width,
      boxHeight / unrotated.height
    );
    const cssScale = Math.max(fit, 0.05);
    const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    const viewport = page.getViewport({
      scale: cssScale * ratio,
      rotation: (page.rotate + rotation) % 360,
    });

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const task = page.render({
      canvasContext: ctx,
      viewport,
      background: "#ffffff",
    });
    onTask?.(task);
    await task.promise;

    return {
      cssWidth: Math.floor(viewport.width / ratio),
      cssHeight: Math.floor(viewport.height / ratio),
    };
  } finally {
    page.cleanup();
  }
}

type Waiter = {
  resolve: (url: string) => void;
  reject: (err: unknown) => void;
};

/**
 * On-demand thumbnail renderer.
 *
 * The previous implementation mounted one live <canvas> per page, so a 60 page
 * PDF meant 60 simultaneous pdf.js render tasks and 60 retained bitmaps — which
 * is exactly what froze phones. Here every page is rendered at most once, at a
 * small fixed size, converted to a JPEG blob URL (cheap for the browser to hold
 * and decode on demand), and rendering is limited to a couple of pages at a
 * time, newest request first, so whatever the user just scrolled to wins.
 */
export class ThumbnailStore {
  private cache = new Map<number, string>();
  private pending = new Map<number, Promise<string>>();
  private waiters = new Map<number, Waiter>();
  private stack: number[] = [];
  private active = 0;
  private destroyed = false;

  constructor(
    private doc: PDFDocumentProxy,
    private targetWidth = 260,
    private maxConcurrent = 2
  ) {}

  /** Already-rendered thumbnail, if any — lets cards paint with no flicker. */
  peek(pageNumber: number): string | undefined {
    return this.cache.get(pageNumber);
  }

  request(pageNumber: number): Promise<string> {
    if (this.destroyed) return Promise.reject(new Error("store destroyed"));

    const cached = this.cache.get(pageNumber);
    if (cached) return Promise.resolve(cached);

    const inflight = this.pending.get(pageNumber);
    if (inflight) {
      this.promote(pageNumber);
      return inflight;
    }

    const promise = new Promise<string>((resolve, reject) => {
      this.waiters.set(pageNumber, { resolve, reject });
    });
    this.pending.set(pageNumber, promise);
    this.stack.push(pageNumber);
    this.pump();
    return promise;
  }

  /** Moves a queued page to the front so the visible viewport renders first. */
  private promote(pageNumber: number) {
    const at = this.stack.indexOf(pageNumber);
    if (at >= 0 && at !== this.stack.length - 1) {
      this.stack.splice(at, 1);
      this.stack.push(pageNumber);
    }
  }

  private pump() {
    while (
      !this.destroyed &&
      this.active < this.maxConcurrent &&
      this.stack.length
    ) {
      const pageNumber = this.stack.pop() as number;
      this.active += 1;
      this.renderOne(pageNumber)
        .then((url) => {
          if (this.destroyed) {
            URL.revokeObjectURL(url);
            return;
          }
          this.cache.set(pageNumber, url);
          this.waiters.get(pageNumber)?.resolve(url);
        })
        .catch((err) => {
          this.waiters.get(pageNumber)?.reject(err);
        })
        .finally(() => {
          this.waiters.delete(pageNumber);
          this.pending.delete(pageNumber);
          this.active -= 1;
          this.pump();
        });
    }
  }

  private async renderOne(pageNumber: number): Promise<string> {
    const page = await this.doc.getPage(pageNumber);
    try {
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min((this.targetWidth * ratio) / base.width, 3);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      try {
        await page.render({
          canvasContext: ctx,
          viewport,
          background: "#ffffff",
        }).promise;
        const blob = await canvasToBlob(canvas, "image/jpeg", 0.72);
        return URL.createObjectURL(blob);
      } finally {
        releaseCanvas(canvas);
      }
    } finally {
      page.cleanup();
    }
  }

  destroy() {
    this.destroyed = true;
    this.stack = [];
    this.waiters.forEach((waiter) =>
      waiter.reject(new Error("store destroyed"))
    );
    this.waiters.clear();
    this.pending.clear();
    this.cache.forEach((url) => URL.revokeObjectURL(url));
    this.cache.clear();
  }
}
