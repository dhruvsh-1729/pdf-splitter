import { useState, useCallback, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { PDFDocument, degrees } from "pdf-lib";
import {
  FileText,
  Upload,
  RotateCcw,
  RotateCw,
  Copy,
  Eye,
  Trash2,
  Scissors,
  Download,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
} from "lucide-react";

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
  // splitIndices contains positions (in pageOrder) after which to split the PDF.
  const [splitIndices, setSplitIndices] = useState<Set<number>>(new Set());
  const [autoSplitEnabled, setAutoSplitEnabled] = useState(false);
  const [autoSplitInterval, setAutoSplitInterval] = useState(1);
  const [skippedSections, setSkippedSections] = useState<Set<number>>(new Set());
  const [previewPosition, setPreviewPosition] = useState<number | null>(null);

  /**
   * Called when a PDF is successfully loaded. Updates number of pages and initializes pageOrder.
   */
  const onDocumentLoadSuccess = useCallback(({ numPages: nextNumPages }: { numPages: number }) => {
    setNumPages(nextNumPages);
    // initialize page order sequentially when loading a new document
    setPageOrder(Array.from(Array(nextNumPages).keys()));
    setRotations({});
    setSplitIndices(new Set());
    setSkippedSections(new Set());
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
    setSkippedSections(new Set());
  };

  /**
   * Delete a single occurrence of a page at the given position.
   * Keeps the original page if duplicates exist elsewhere.
   */
  const deletePageAt = (position: number, logicalIndex: number) => {
    setPageOrder((prev) => {
      if (position < 0 || position >= prev.length) return prev;
      const next = [...prev];
      next.splice(position, 1);
      // Shift split markers after the deleted position
      setSplitIndices((prevSplits) => {
        const updated = new Set<number>();
        const maxPos = Math.max(0, next.length - 1);
        prevSplits.forEach((pos) => {
          if (pos < position && pos <= maxPos) {
            updated.add(pos);
          } else if (pos > position && pos - 1 <= maxPos) {
            updated.add(pos - 1);
          }
        });
        return updated;
      });
      return next;
    });
    setSkippedSections(new Set());
  };

  /**
   * Toggle a split marker after a page. If marker exists, remove it; otherwise add it.
   */
  const toggleSplit = (position: number) => {
    setSplitIndices((prev) => {
      const newSet = new Set(Array.from(prev));
      if (newSet.has(position)) {
        newSet.delete(position);
      } else {
        newSet.add(position);
      }
      return newSet;
    });
    setSkippedSections(new Set());
  };

  /**
   * Compute sections based on auto-split or manual markers.
   */
  const buildSections = () => {
    if (!pageOrder.length) return [] as number[][];
    if (autoSplitEnabled && autoSplitInterval > 0) {
      const sections: number[][] = [];
      for (let i = 0; i < pageOrder.length; i += autoSplitInterval) {
        sections.push(pageOrder.slice(i, i + autoSplitInterval));
      }
      return sections;
    }
    const sortedPositions = Array.from(splitIndices).sort((a, b) => a - b);
    const sections: number[][] = [];
    let start = 0;
    for (const pos of sortedPositions) {
      const end = Math.min(pos, pageOrder.length - 1);
      if (end >= start) {
        sections.push(pageOrder.slice(start, end + 1));
        start = end + 1;
      }
    }
    sections.push(pageOrder.slice(start));
    return sections;
  };

  const sections = buildSections();
  const sectionMeta = (() => {
    const meta: { start: number; end: number; length: number }[] = [];
    let cursor = 0;
    sections.forEach((section) => {
      const start = cursor;
      const length = section.length;
      const end = cursor + Math.max(length - 1, 0);
      meta.push({ start, end, length });
      cursor += length;
    });
    return meta;
  })();

  const resetSkips = () => setSkippedSections(new Set());

  const previewContext =
    previewPosition !== null &&
    previewPosition >= 0 &&
    previewPosition < pageOrder.length &&
    file
      ? (() => {
          const logicalIndex = pageOrder[previewPosition];
          const occurrence =
            pageOrder.slice(0, previewPosition + 1).filter((idx) => idx === logicalIndex).length;
          const totalOccurrences = pageOrder.filter((idx) => idx === logicalIndex).length;
          return { logicalIndex, occurrence, totalOccurrences };
        })()
      : null;

  /**
   * Close the preview when the underlying page order changes such that the
   * current preview position is no longer valid, or when no file is loaded.
   */
  useEffect(() => {
    if (previewPosition === null) return;
    if (!file || previewPosition < 0 || previewPosition >= pageOrder.length) {
      setPreviewPosition(null);
    }
  }, [file, pageOrder, previewPosition]);

  /**
   * Generate split PDFs based on the current state. Uses pdf-lib to copy pages,
   * apply rotations, and produce separate documents. Each document is downloaded
   * sequentially.
   */
  const generateAndDownloadSplits = async () => {
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const originalPdf = await PDFDocument.load(arrayBuffer);

      const sectionsToDownload = sections.filter((_, idx) => !skippedSections.has(idx));
      for (let i = 0; i < sectionsToDownload.length; i++) {
        const indices = sectionsToDownload[i];
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

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto w-full space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {/* PDF Pages Grid or placeholder */}
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
              {file ? (
                <Document
                  file={file}
                  onLoadSuccess={(data) => {
                    setSkippedSections(new Set());
                    onDocumentLoadSuccess(data);
                  }}
                  loading={
                    <div className="flex flex-col items-center justify-center gap-4 p-12">
                      <Loader2 className="h-10 w-10 animate-spin text-zinc-900" />
                      <p className="text-sm font-medium text-zinc-600">Loading your PDF...</p>
                    </div>
                  }
                  className="w-full"
                >
                  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {pageOrder.map((pageIndex, logicalPosition) => {
                      const rotation = rotations[pageIndex] || 0;
                      const isSplit = splitIndices.has(logicalPosition);
                      const isLast = logicalPosition === pageOrder.length - 1;
                      return (
                        <div
                          key={`${pageIndex}-${logicalPosition}`}
                          className="group relative overflow-visible"
                        >
                          <div className="relative overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-md">
                            {/* Page Preview Area */}
                            <div className="relative flex h-[280px] items-center justify-center overflow-hidden bg-zinc-50 p-4">
                              <div className="rounded border border-zinc-200 bg-white p-2 shadow-sm">
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
                              
                              {/* Action Buttons */}
                              <div className="absolute inset-x-0 top-0 flex justify-center gap-2 p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                                <div className="flex gap-1 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg">
                                  <button
                                    onClick={() => rotatePage(pageIndex, "left")}
                                    className="flex h-8 w-8 items-center justify-center rounded border border-zinc-200 bg-white text-base text-zinc-700 transition-all hover:bg-zinc-50 active:scale-95"
                                    title="Rotate left (90°)"
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => rotatePage(pageIndex, "right")}
                                    className="flex h-8 w-8 items-center justify-center rounded border border-zinc-200 bg-white text-base text-zinc-700 transition-all hover:bg-zinc-50 active:scale-95"
                                    title="Rotate right (90°)"
                                  >
                                    <RotateCw className="h-4 w-4" />
                                  </button>
                                  <div className="mx-0.5 w-px bg-zinc-200" />
                                  <button
                                    onClick={() => duplicatePage(pageIndex)}
                                    className="flex h-8 w-8 items-center justify-center rounded border border-zinc-200 bg-white text-base text-zinc-700 transition-all hover:bg-zinc-50 active:scale-95"
                                    title="Duplicate page"
                                  >
                                    <Copy className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => setPreviewPosition(logicalPosition)}
                                    className="flex h-8 w-8 items-center justify-center rounded border border-zinc-200 bg-white text-base text-zinc-700 transition-all hover:bg-zinc-50 active:scale-95"
                                    title="Preview full size"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => deletePageAt(logicalPosition, pageIndex)}
                                    className="flex h-8 w-8 items-center justify-center rounded border border-zinc-200 bg-white text-base text-zinc-700 transition-all hover:bg-zinc-50 active:scale-95"
                                    title="Delete page"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Rotation indicator */}
                              {rotation !== 0 && (
                                <div className="absolute bottom-3 right-3 rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs font-semibold text-zinc-700 shadow-sm">
                                  {rotation}°
                                </div>
                              )}
                            </div>

                            {/* Page Info Footer */}
                            <div className="border-t border-zinc-200 bg-zinc-50 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  <FileText className="h-4 w-4 flex-shrink-0 text-zinc-400" />
                                  <span className="truncate rounded bg-red-100 px-2 py-1 text-xs font-normal text-red-600">
                                    {file.name}
                                  </span>
                                </div>
                                <span className="flex h-6 min-w-[24px] flex-shrink-0 items-center justify-center rounded bg-zinc-900 px-2 text-xs font-semibold text-white">
                                  {pageIndex + 1}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Split Button */}
                          {!isLast && (
                            <div className="absolute -right-4 top-1/2 z-10 -translate-y-1/2">
                              <button
                                onClick={() => toggleSplit(logicalPosition)}
                                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-lg shadow-sm transition-all duration-200 hover:scale-110 active:scale-95 ${
                                  isSplit
                                    ? "border-zinc-900 bg-zinc-900 text-white shadow-md"
                                    : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50"
                                }`}
                                title={isSplit ? "Remove split" : "Split after this page"}
                              >
                                <Scissors className="h-5 w-5" />
                              </button>
                              {isSplit && (
                                <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded border border-zinc-900 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white shadow-sm">
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
              ) : (
                <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 text-center text-zinc-500">
                  <Plus className="h-10 w-10 text-zinc-400" />
                  <p className="text-sm font-medium">Upload a PDF from the sidebar to begin.</p>
                </div>
              )}
            </div>
          </div>

            {/* Sidebar */}
            <aside className="flex h-fit flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm lg:sticky lg:top-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-zinc-900">Split Controls</h3>
                <span className="text-xs text-zinc-500">{sections.length} files</span>
              </div>
              <label className="group relative inline-flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-white">
                <span className="flex items-center gap-1.5 rounded bg-zinc-900 px-2 py-1 text-xs uppercase tracking-wide text-white">
                  <Upload className="h-3 w-3" />
                  Add PDF
                </span>
                <span className="max-w-[160px] truncate text-zinc-700">
                  {file ? file.name : "Choose PDF"}
                </span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    resetSkips();
                    handleFileChange(e);
                  }}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                  <input
                    type="checkbox"
                    checked={autoSplitEnabled}
                    onChange={(e) => {
                      setAutoSplitEnabled(e.target.checked);
                      resetSkips();
                    }}
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-800"
                  />
                  Split every
                </label>
                <input
                  type="number"
                  min={1}
                  value={autoSplitInterval}
                  onChange={(e) => {
                    const val = Math.max(1, Number(e.target.value) || 1);
                    setAutoSplitInterval(val);
                    resetSkips();
                  }}
                  className="w-16 rounded border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                />
                <span className="text-sm text-zinc-600">pages</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                <span className="text-zinc-700">Manual splits</span>
                <span className="text-zinc-500">{autoSplitEnabled ? "Disabled" : `${splitIndices.size} cuts`}</span>
              </div>
              <div className="max-h-[320px] space-y-2 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                {sections.map((section, idx) => {
                  const meta = sectionMeta[idx];
                  const isSkipped = skippedSections.has(idx);
                  return (
                    <div
                      key={`section-${idx}`}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
                        isSkipped
                          ? "border-rose-200 bg-rose-50/80 text-rose-700"
                          : "border-zinc-200 bg-white text-zinc-800"
                      }`}
                    >
                      <div>
                        <p className="font-semibold">Split {idx + 1}</p>
                        <p className="text-xs text-zinc-500">
                          Pages {meta.start + 1} - {meta.end + 1} ({meta.length})
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setSkippedSections((prev) => {
                            const next = new Set(prev);
                            if (next.has(idx)) {
                              next.delete(idx);
                            } else {
                              next.add(idx);
                            }
                            return next;
                          });
                        }}
                        className={`rounded px-3 py-1 text-xs font-semibold transition ${
                          isSkipped
                            ? "bg-rose-600 text-white hover:bg-rose-500"
                            : "bg-zinc-900 text-white hover:bg-zinc-800"
                        }`}
                      >
                        {isSkipped ? "Restore" : "Remove"}
                      </button>
                    </div>
                  );
                })}
                {sections.length === 0 && (
                  <p className="text-center text-xs text-zinc-500">No splits defined</p>
                )}
              </div>
              <button
                onClick={generateAndDownloadSplits}
                disabled={!file || sections.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-900 bg-zinc-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-zinc-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-5 w-5" />
                <span>Download Split PDFs</span>
              </button>
            </aside>
          </div>
      </div>

      {previewPosition !== null && previewContext && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-6"
          onClick={() => setPreviewPosition(null)}
        >
          <div 
            className="relative flex max-h-[95vh] w-full max-w-7xl flex-col rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-100">
                  <Eye className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Page Preview</h3>
                  <p className="text-sm text-zinc-400">
                    Page {previewContext.logicalIndex + 1} of {numPages}
                    {previewContext.totalOccurrences > 1 && (
                      <span className="ml-2 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">
                        Copy {previewContext.occurrence} of {previewContext.totalOccurrences}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPreviewPosition(null)}
                className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-zinc-700 active:scale-95"
              >
                <X className="h-4 w-4" />
                <span className="hidden sm:inline">Close</span>
              </button>
            </div>

            {/* Preview Content */}
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-xl bg-zinc-950 p-4 sm:p-6">
              <div className="flex items-center justify-center">
                <div className="rounded-lg bg-white p-3 shadow-xl sm:p-4">
                  <Document file={file}>
                    <Page
                      pageNumber={previewContext.logicalIndex + 1}
                      renderMode="canvas"
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                      width={(() => {
                        if (typeof window === 'undefined') return 600;
                        const maxWidth = Math.min(window.innerWidth - 100, 1200);
                        const maxHeight = window.innerHeight - 300;
                        // Calculate based on typical A4 ratio (1.414)
                        const widthFromHeight = maxHeight / 1.414;
                        return Math.min(maxWidth, widthFromHeight);
                      })()}
                      rotate={rotations[previewContext.logicalIndex] || 0}
                      loading={
                        <div className="flex h-[600px] w-[424px] items-center justify-center">
                          <Loader2 className="h-10 w-10 animate-spin text-zinc-900" />
                        </div>
                      }
                    />
                  </Document>
                </div>
              </div>
            </div>

            {/* Navigation Footer */}
            <div className="flex flex-shrink-0 items-center justify-between border-t border-zinc-800 p-4 sm:p-6">
              <button
                onClick={() => {
                  if (previewPosition !== null && previewPosition > 0) {
                    setPreviewPosition(previewPosition - 1);
                  }
                }}
                disabled={previewPosition === null || previewPosition === 0}
                className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-white transition-all hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95 sm:px-4"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Previous</span>
              </button>
              
              <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-800/50 px-3 py-2 sm:px-4">
                <span className="text-xs text-zinc-400 sm:text-sm">Rotation:</span>
                <span className="text-sm font-semibold text-white sm:text-base">
                  {rotations[previewContext.logicalIndex] || 0}°
                </span>
              </div>

              <button
                onClick={() => {
                  if (previewPosition !== null && previewPosition < pageOrder.length - 1) {
                    setPreviewPosition(previewPosition + 1);
                  }
                }}
                disabled={previewPosition === null || previewPosition === pageOrder.length - 1}
                className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-white transition-all hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95 sm:px-4"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
