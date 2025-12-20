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
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
                  <svg className="h-7 w-7 text-zinc-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Professional Tool</p>
                  <h1 className="text-3xl font-bold tracking-tight text-zinc-900">PDF Splitter</h1>
                </div>
              </div>
              <p className="text-sm text-zinc-600">
                Arrange, split, rotate, duplicate, and preview PDF pages
              </p>
            </div>
            <label className="group relative inline-flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-300 bg-white px-5 py-3 shadow-sm transition-all duration-200 hover:border-zinc-400 hover:shadow-md">
              <svg className="h-5 w-5 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <div className="flex flex-col items-start">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {file ? "Change File" : "Upload PDF"}
                </span>
                <span className="max-w-[200px] truncate text-sm font-semibold text-zinc-900">
                  {file ? file.name : "Click to browse"}
                </span>
              </div>
              <input
                type="file"
                accept="application/pdf"
                onChange={handleFileChange}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          </div>
        </header>

        {file && (
          <div className="space-y-6">
            {/* Instructions Card */}
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-900">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 space-y-3">
                  <h3 className="text-base font-semibold text-zinc-900">Quick Guide</h3>
                  <div className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">↺↻</span>
                      <span>Rotate pages</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base">⧉</span>
                      <span>Duplicate pages</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base">🗑</span>
                      <span>Delete pages</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base">👁</span>
                      <span>Preview full size</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base">✂</span>
                      <span>Mark split points</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* PDF Pages Grid */}
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
              <Document
                file={file}
                onLoadSuccess={onDocumentLoadSuccess}
                loading={
                  <div className="flex flex-col items-center justify-center gap-4 p-12">
                    <div className="h-10 w-10 animate-spin rounded-full border-3 border-zinc-200 border-t-zinc-900" />
                    <p className="text-sm font-medium text-zinc-600">Loading your PDF...</p>
                  </div>
                }
                className="w-full"
              >
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {pageOrder.map((pageIndex, logicalPosition) => {
                    const rotation = rotations[pageIndex] || 0;
                    const isSplit = splitIndices.has(pageIndex);
                    const isLast = logicalPosition === pageOrder.length - 1;
                    return (
                      <div
                        key={`${pageIndex}-${logicalPosition}`}
                        className="group relative overflow-visible"
                      >
                        <div className="relative overflow-hidden rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-lg transition-all duration-300 hover:-translate-y-2 hover:border-indigo-300 hover:shadow-2xl">
                          {/* Page Preview Area */}
                          <div className="relative flex h-[280px] items-center justify-center overflow-hidden bg-slate-100 p-4">
                            <div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100" />
                            <div className="relative rounded-lg bg-white p-2 shadow-md">
                              <Page
                                key={`page_${pageIndex}_${logicalPosition}`}
                                pageNumber={pageIndex + 1}
                                renderMode="canvas"
                                renderAnnotationLayer={false}
                                renderTextLayer={false}
                                height={220}
                                rotate={rotation}
                                className="pointer-events-none select-none"
                              />
                            </div>
                            
                            {/* Action Buttons - Always visible on hover */}
                            <div className="absolute inset-x-0 top-0 flex justify-center gap-2 p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                              <div className="flex gap-1.5 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm">
                                <button
                                  onClick={() => rotatePage(pageIndex, "left")}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-gradient-to-br from-blue-50 to-blue-100 text-lg text-blue-700 shadow-sm transition-all hover:scale-110 hover:border-blue-300 hover:shadow-md active:scale-95"
                                  title="Rotate left (90°)"
                                >
                                  ↺
                                </button>
                                <button
                                  onClick={() => rotatePage(pageIndex, "right")}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-gradient-to-br from-blue-50 to-blue-100 text-lg text-blue-700 shadow-sm transition-all hover:scale-110 hover:border-blue-300 hover:shadow-md active:scale-95"
                                  title="Rotate right (90°)"
                                >
                                  ↻
                                </button>
                                <div className="mx-1 w-px bg-slate-200" />
                                <button
                                  onClick={() => duplicatePage(pageIndex)}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 text-lg text-emerald-700 shadow-sm transition-all hover:scale-110 hover:border-emerald-300 hover:shadow-md active:scale-95"
                                  title="Duplicate page"
                                >
                                  ⧉
                                </button>
                                <button
                                  onClick={() => setPreviewPage(pageIndex)}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50 to-indigo-100 text-lg text-indigo-700 shadow-sm transition-all hover:scale-110 hover:border-indigo-300 hover:shadow-md active:scale-95"
                                  title="Preview full size"
                                >
                                  �
                                </button>
                                <button
                                  onClick={() => deletePage(pageIndex)}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 bg-gradient-to-br from-rose-50 to-rose-100 text-lg text-rose-700 shadow-sm transition-all hover:scale-110 hover:border-rose-300 hover:shadow-md active:scale-95"
                                  title="Delete page"
                                >
                                  �
                                </button>
                              </div>
                            </div>

                            {/* Rotation indicator */}
                            {rotation !== 0 && (
                              <div className="absolute bottom-3 right-3 rounded-full bg-blue-500 px-2.5 py-1 text-xs font-semibold text-white shadow-lg">
                                {rotation}°
                              </div>
                            )}
                          </div>

                          {/* Page Info Footer */}
                          <div className="border-t-2 border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <svg className="h-4 w-4 flex-shrink-0 text-rose-500" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                                </svg>
                                <span className="truncate text-xs font-medium text-slate-600">{file.name}</span>
                              </div>
                              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white shadow-md">
                                {pageIndex + 1}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Split Button */}
                        {!isLast && (
                          <div className="absolute -right-4 top-1/2 z-10 -translate-y-1/2">
                            <button
                              onClick={() => toggleSplit(pageIndex)}
                              className={`group/split flex h-12 w-12 items-center justify-center rounded-full border-2 text-xl shadow-lg transition-all duration-200 hover:scale-110 active:scale-95 ${
                                isSplit
                                  ? "border-amber-400 bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-amber-300"
                                  : "border-slate-300 bg-white text-slate-500 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600"
                              }`}
                              title={isSplit ? "Remove split" : "Split after this page"}
                            >
                              <span className="transition-transform group-hover/split:scale-110">✂</span>
                            </button>
                            {isSplit && (
                              <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                                Split here
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Document>
            </div>

            {numPages > 0 && (
              <div className="sticky bottom-6 z-20 rounded-3xl border-2 border-indigo-200 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 p-6 shadow-2xl">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2 backdrop-blur-sm">
                      <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm font-bold text-white">{numPages} pages</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2 backdrop-blur-sm">
                      <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      <span className="text-sm font-bold text-white">{pageOrder.length} in sequence</span>
                    </div>
                    {splitIndices.size > 0 && (
                      <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-400/20 px-4 py-2 backdrop-blur-sm">
                        <span className="text-lg">✂</span>
                        <span className="text-sm font-bold text-white">{splitIndices.size + 1} files</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={generateAndDownloadSplits}
                    className="group relative inline-flex items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-white bg-white px-6 py-3.5 text-base font-bold shadow-xl transition-all duration-300 hover:scale-105 hover:shadow-2xl active:scale-95"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-0 transition-opacity group-hover:opacity-10" />
                    <svg className="h-5 w-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                      Download Split PDFs
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {previewPage !== null && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          onClick={() => setPreviewPage(null)}
        >
          <div 
            className="relative w-full max-w-6xl rounded-3xl border-2 border-slate-700 bg-gradient-to-br from-slate-900 to-slate-800 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-lg">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Page Preview</h3>
                  <p className="text-sm text-slate-400">Page {(previewPage ?? 0) + 1} of {numPages}</p>
                </div>
              </div>
              <button
                onClick={() => setPreviewPage(null)}
                className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow-lg transition-all hover:border-slate-500 hover:bg-slate-700 active:scale-95"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Close
              </button>
            </div>

            {/* Preview Content */}
            <div className="flex justify-center overflow-auto rounded-2xl bg-slate-950/50 p-6">
              <div className="rounded-xl bg-white p-4 shadow-2xl">
                <Document file={file}>
                  <Page
                    pageNumber={(previewPage ?? 0) + 1}
                    renderMode="canvas"
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                    width={Math.min(900, window.innerWidth - 200)}
                    rotate={rotations[previewPage] || 0}
                  />
                </Document>
              </div>
            </div>

            {/* Navigation Footer */}
            <div className="mt-4 flex items-center justify-between border-t border-slate-700 pt-4">
              <button
                onClick={() => {
                  const currentPos = pageOrder.indexOf(previewPage ?? 0);
                  if (currentPos > 0) {
                    setPreviewPage(pageOrder[currentPos - 1]);
                  }
                }}
                disabled={pageOrder.indexOf(previewPage ?? 0) === 0}
                className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition-all hover:border-slate-500 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous
              </button>
              
              <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2">
                <span className="text-sm text-slate-400">Rotation:</span>
                <span className="font-bold text-white">{rotations[previewPage ?? 0] || 0}°</span>
              </div>

              <button
                onClick={() => {
                  const currentPos = pageOrder.indexOf(previewPage ?? 0);
                  if (currentPos < pageOrder.length - 1) {
                    setPreviewPage(pageOrder[currentPos + 1]);
                  }
                }}
                disabled={pageOrder.indexOf(previewPage ?? 0) === pageOrder.length - 1}
                className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition-all hover:border-slate-500 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              >
                Next
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
