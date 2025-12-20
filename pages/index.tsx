"use client";

import { useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { PDFDocument, degrees } from "pdf-lib";

// Configure pdfjs worker. Using CDN since Next.js cannot bundle the worker automatically.
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.js`;

interface RotationMap {
  [index: number]: number;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  // pageOrder maintains the logical order of pages including duplicates/deleted pages.
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  // rotations stores the rotation angle (in degrees) for each logical page index.
  const [rotations, setRotations] = useState<RotationMap>({});
  // splitIndices contains indexes after which to split the PDF.
  const [splitIndices, setSplitIndices] = useState<Set<number>>(new Set());
  const [previewPage, setPreviewPage] = useState<number | null>(null);

  /**
   * Called when a PDF is successfully loaded. Updates number of pages and initializes pageOrder.
   */
  const onDocumentLoadSuccess = useCallback(({ numPages: nextNumPages }: { numPages: number }) => {
    setNumPages(nextNumPages);
    // initialize page order sequentially when loading a new document
    setPageOrder(Array.from(Array(nextNumPages).keys()));
    setRotations({});
    setSplitIndices(new Set());
  }, []);

  /**
   * Handle file input change. Sets the selected file.
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    if (selected) {
      setFile(selected);
    }
  };

  /**
   * Rotate a page by 90 degrees in either direction. Maintains rotation state per page index.
   */
  const rotatePage = (logicalIndex: number, direction: "left" | "right") => {
    setRotations((prev) => {
      const current = prev[logicalIndex] || 0;
      const delta = direction === "left" ? -90 : 90;
      const updated = ((current + delta + 360) % 360) as number;
      return { ...prev, [logicalIndex]: updated };
    });
  };

  /**
   * Duplicate a page. Copies the logical index into pageOrder.
   */
  const duplicatePage = (logicalIndex: number) => {
    setPageOrder((prev) => {
      const insertIndex = prev.indexOf(logicalIndex) + 1;
      const newOrder = [...prev];
      newOrder.splice(insertIndex, 0, logicalIndex);
      return newOrder;
    });
  };

  /**
   * Delete a page. Removes the logical index from pageOrder.
   */
  const deletePage = (logicalIndex: number) => {
    setPageOrder((prev) => prev.filter((idx) => idx !== logicalIndex));
    // remove any split marker associated with this page
    setSplitIndices((prev) => {
      const newSet = new Set(Array.from(prev));
      newSet.delete(logicalIndex);
      return newSet;
    });
  };

  /**
   * Toggle a split marker after a page. If marker exists, remove it; otherwise add it.
   */
  const toggleSplit = (logicalIndex: number) => {
    setSplitIndices((prev) => {
      const newSet = new Set(Array.from(prev));
      if (newSet.has(logicalIndex)) {
        newSet.delete(logicalIndex);
      } else {
        newSet.add(logicalIndex);
      }
      return newSet;
    });
  };

  /**
   * Generate split PDFs based on the current state. Uses pdf-lib to copy pages,
   * apply rotations, and produce separate documents. Each document is downloaded
   * sequentially.
   */
  const generateAndDownloadSplits = async () => {
    if (!file) return;
    try {
      // Load the original document
      const arrayBuffer = await file.arrayBuffer();
      const originalPdf = await PDFDocument.load(arrayBuffer);
      // Determine sections based on splitIndices
      const sortedIndices = Array.from(splitIndices).sort((a, b) => a - b);
      const sections: number[][] = [];
      let start = 0;
      for (const splitAfter of sortedIndices) {
        const end = pageOrder.findIndex((idx) => idx === splitAfter);
        if (end >= start) {
          sections.push(pageOrder.slice(start, end + 1));
          start = end + 1;
        }
      }
      // push remaining pages
      sections.push(pageOrder.slice(start));
      // create and download each section
      for (let i = 0; i < sections.length; i++) {
        const indices = sections[i];
        const newPdf = await PDFDocument.create();
        for (const logicalIdx of indices) {
          const [copiedPage] = await newPdf.copyPages(originalPdf, [logicalIdx]);
          // apply rotation if specified
          const rotation = rotations[logicalIdx] || 0;
          if (rotation) {
            copiedPage.setRotation(degrees(rotation));
          }
          newPdf.addPage(copiedPage);
        }
        const pdfBytes = await newPdf.save();
        const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `split_${i + 1}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error(err);
      alert("There was an error generating the split PDFs. Please try again.");
    }
  };

  const fileLabel = file ? file.name : "Choose PDF";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto w-full space-y-6 px-4 py-8">
        <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Workspace</p>
            <h1 className="text-3xl font-semibold text-slate-900">PDF Splitter</h1>
            <p className="text-sm text-slate-500">Arrange, split, rotate, duplicate, and preview pages—fast.</p>
          </div>
          <label className="group relative inline-flex cursor-pointer items-center gap-3 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-white">
            <span className="rounded-full bg-slate-900 px-2 py-1 text-xs uppercase tracking-wide text-white">
              Upload
            </span>
            <span className="max-w-[240px] truncate text-slate-700">{fileLabel}</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </header>

        {file && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
              <Document
                file={file}
                onLoadSuccess={onDocumentLoadSuccess}
                loading={<div className="p-6 text-center text-slate-500">Loading PDF...</div>}
                className="w-full"
              >
                <div className="grid grid-cols-4">
                  {pageOrder.map((pageIndex, logicalPosition) => {
                    const rotation = rotations[pageIndex] || 0;
                    const isSplit = splitIndices.has(pageIndex);
                    const isLast = logicalPosition === pageOrder.length - 1;
                    return (
                      <div
                        key={`${pageIndex}-${logicalPosition}`}
                        className="group relative isolate overflow-visible rounded-xl border border-slate-200 bg-slate-50 shadow-sm transition hover:-translate-y-1 hover:border-slate-300"
                      >
                        <div className="absolute inset-0 rounded-[12px] bg-gradient-to-br from-white to-slate-50" />
                        <div className="relative flex h-[240px] items-center justify-center overflow-hidden rounded-t-xl bg-white">
                          <Page
                            key={`page_${pageIndex}_${logicalPosition}`}
                            pageNumber={pageIndex + 1}
                            renderMode="canvas"
                            renderAnnotationLayer={false}
                            renderTextLayer={false}
                            height={210}
                            rotate={rotation}
                            className="pointer-events-none select-none"
                          />
                          <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                            <button
                              onClick={() => rotatePage(pageIndex, "left")}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-sm text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                              title="Rotate left"
                            >
                              ↺
                            </button>
                            <button
                              onClick={() => rotatePage(pageIndex, "right")}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-sm text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                              title="Rotate right"
                            >
                              ↻
                            </button>
                            <button
                              onClick={() => duplicatePage(pageIndex)}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 text-sm text-emerald-700 shadow-sm transition hover:border-emerald-200 hover:bg-white"
                              title="Duplicate page"
                            >
                              ⧉
                            </button>
                            <button
                              onClick={() => deletePage(pageIndex)}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-rose-100 bg-rose-50 text-sm text-rose-700 shadow-sm transition hover:border-rose-200 hover:bg-white"
                              title="Delete page"
                            >
                              🗑
                            </button>
                            <button
                              onClick={() => setPreviewPage(pageIndex)}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-indigo-100 bg-indigo-50 text-sm text-indigo-700 shadow-sm transition hover:border-indigo-200 hover:bg-white"
                              title="Preview page"
                            >
                              👁
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 rounded-b-xl border-t border-slate-200 bg-slate-100/80 px-3 py-2">
                          <span className="flex-1 truncate rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700">
                            {file.name}
                          </span>
                          <span className="text-xs font-semibold text-slate-600">{pageIndex + 1}</span>
                        </div>

                        {!isLast && (
                          <div className="absolute inset-y-0 -right-5 flex items-center">
                            <div className="h-full border-l border-dashed border-slate-300" />
                            <button
                              onClick={() => toggleSplit(pageIndex)}
                              className={`ml-[-14px] flex h-9 w-9 items-center justify-center rounded-full border text-sm shadow-sm transition ${
                                isSplit
                                  ? "border-amber-300 bg-amber-50 text-amber-700"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                              }`}
                              title="Split after this page"
                            >
                              ✂
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Document>
            </div>

            {numPages > 0 && (
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="inline-flex h-8 items-center rounded-full bg-slate-100 px-3 text-sm font-semibold text-slate-800">
                    Total pages: {numPages}
                  </span>
                  <span className="text-slate-500">Use scissors to define splits, then download.</span>
                </div>
                <button
                  onClick={generateAndDownloadSplits}
                  className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-400 hover:shadow"
                >
                  <span>Download Split PDFs</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {previewPage !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-[92vw] max-w-5xl rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl shadow-black/50">
            <button
              onClick={() => setPreviewPage(null)}
              className="absolute right-3 top-3 rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-slate-100 shadow hover:bg-slate-700"
            >
              Close
            </button>
            <div className="flex justify-center py-6">
              <Document file={file}>
                <Page
                  pageNumber={(previewPage ?? 0) + 1}
                  renderMode="canvas"
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  width={900}
                  rotate={rotations[previewPage] || 0}
                />
              </Document>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
