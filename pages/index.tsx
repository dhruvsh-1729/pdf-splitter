import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  AlertCircle,
  Download,
  FileText,
  Loader2,
  Scissors,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { PageCard } from "@/components/PageCard";
import { PageViewer } from "@/components/PageViewer";
import { DownloadsSheet } from "@/components/DownloadsSheet";
import { SplitControls } from "@/components/SplitControls";
import { ThumbnailStore, loadPdfDocument } from "@/lib/pdfjs";
import { buildSplitFiles, safeBaseName, type SplitFile } from "@/lib/split";
import { canShareFile, saveBlob, shareBlob } from "@/lib/download";

type Status = "empty" | "loading" | "ready" | "error";

/** Cut markers are positions in pageOrder; only 0..length-2 make sense. */
function normalizeCuts(cuts: Iterable<number>, length: number): Set<number> {
  const next = new Set<number>();
  for (const cut of cuts) {
    if (cut >= 0 && cut <= length - 2) next.add(cut);
  }
  return next;
}

export default function Home() {
  const [status, setStatus] = useState<Status>("empty");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [store, setStore] = useState<ThumbnailStore | null>(null);
  const [numPages, setNumPages] = useState(0);

  // pageOrder holds 0-based source page indices, including duplicates.
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const [cuts, setCuts] = useState<Set<number>>(new Set());
  const [autoSplitEnabled, setAutoSplitEnabled] = useState(false);
  const [autoSplitInterval, setAutoSplitInterval] = useState(1);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());

  const [viewerPosition, setViewerPosition] = useState<number | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(
    null
  );
  const [busySection, setBusySection] = useState<number | null>(null);
  const [results, setResults] = useState<SplitFile[] | null>(null);

  const bytesRef = useRef<Uint8Array | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const storeRef = useRef<ThumbnailStore | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const releaseDocument = useCallback(() => {
    storeRef.current?.destroy();
    storeRef.current = null;
    const current = docRef.current;
    docRef.current = null;
    if (current) void current.destroy().catch(() => undefined);
  }, []);

  useEffect(() => releaseDocument, [releaseDocument]);

  const openFile = useCallback(
    async (file: File) => {
      releaseDocument();
      setStore(null);
      setDoc(null);
      setResults(null);
      setViewerPosition(null);
      setOptionsOpen(false);
      setErrorMessage(null);
      setFileName(file.name);
      setStatus("loading");
      setPageOrder([]);
      setRotations({});
      setCuts(new Set());
      setSkipped(new Set());
      setNumPages(0);

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        bytesRef.current = bytes;
        const loaded = await loadPdfDocument(bytes);
        docRef.current = loaded;
        // A thumbnail wide enough for a 2-up phone grid and a 5-up desktop grid,
        // but small enough that hundreds of them stay cheap.
        const nextStore = new ThumbnailStore(loaded, 260, 2);
        storeRef.current = nextStore;

        setDoc(loaded);
        setStore(nextStore);
        setNumPages(loaded.numPages);
        setPageOrder(Array.from({ length: loaded.numPages }, (_, i) => i));
        setStatus("ready");
      } catch (err) {
        console.error(err);
        bytesRef.current = null;
        setStatus("error");
        setErrorMessage(
          "That file could not be opened. It may be corrupted or password protected."
        );
      }
    },
    [releaseDocument]
  );

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires a change event.
    event.target.value = "";
    if (file) void openFile(file);
  };

  const rotatePage = useCallback((sourceIndex: number, direction: "left" | "right") => {
    setRotations((prev) => {
      const current = prev[sourceIndex] || 0;
      const delta = direction === "left" ? -90 : 90;
      return { ...prev, [sourceIndex]: (current + delta + 360) % 360 };
    });
  }, []);

  const duplicateAt = useCallback(
    (position: number) => {
      if (position < 0 || position >= pageOrder.length) return;
      const nextOrder = [...pageOrder];
      nextOrder.splice(position + 1, 0, pageOrder[position]);
      // Keep the copy in the same part as its original: a cut sitting right after
      // this page moves behind the copy.
      const shifted: number[] = [];
      cuts.forEach((cut) => shifted.push(cut >= position ? cut + 1 : cut));

      setPageOrder(nextOrder);
      setCuts(normalizeCuts(shifted, nextOrder.length));
      setSkipped(new Set());
      setResults(null);
    },
    [cuts, pageOrder]
  );

  const deleteAt = useCallback(
    (position: number) => {
      if (position < 0 || position >= pageOrder.length) return;
      const nextOrder = [...pageOrder];
      nextOrder.splice(position, 1);
      // A cut that sat after the removed page now sits after its predecessor.
      const shifted: number[] = [];
      cuts.forEach((cut) => shifted.push(cut < position ? cut : cut - 1));

      setPageOrder(nextOrder);
      setCuts(normalizeCuts(shifted, nextOrder.length));
      setSkipped(new Set());
      setResults(null);
      setViewerPosition((prev) => {
        if (prev === null) return prev;
        if (!nextOrder.length) return null;
        return Math.min(prev, nextOrder.length - 1);
      });
    },
    [cuts, pageOrder]
  );

  const toggleCut = useCallback((position: number) => {
    setCuts((prev) => {
      const next = new Set(prev);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
    setSkipped(new Set());
    setResults(null);
  }, []);

  const sections = useMemo(() => {
    if (!pageOrder.length) return [] as number[][];
    if (autoSplitEnabled && autoSplitInterval > 0) {
      const chunks: number[][] = [];
      for (let i = 0; i < pageOrder.length; i += autoSplitInterval) {
        chunks.push(pageOrder.slice(i, i + autoSplitInterval));
      }
      return chunks;
    }
    const boundaries = Array.from(cuts).sort((a, b) => a - b);
    const chunks: number[][] = [];
    let start = 0;
    for (const boundary of boundaries) {
      const end = Math.min(boundary, pageOrder.length - 1);
      if (end >= start) {
        chunks.push(pageOrder.slice(start, end + 1));
        start = end + 1;
      }
    }
    if (start < pageOrder.length) chunks.push(pageOrder.slice(start));
    return chunks;
  }, [autoSplitEnabled, autoSplitInterval, cuts, pageOrder]);

  const sectionMeta = useMemo(() => {
    const meta: { start: number; end: number; length: number }[] = [];
    let cursor = 0;
    sections.forEach((section) => {
      meta.push({
        start: cursor,
        end: cursor + Math.max(section.length - 1, 0),
        length: section.length,
      });
      cursor += section.length;
    });
    return meta;
  }, [sections]);

  /** "copy 2 of 3" style badges for duplicated pages, keyed by position. */
  const copyLabels = useMemo(() => {
    const totals = new Map<number, number>();
    pageOrder.forEach((page) => totals.set(page, (totals.get(page) || 0) + 1));
    const seen = new Map<number, number>();
    return pageOrder.map((page) => {
      const total = totals.get(page) || 1;
      if (total < 2) return null;
      const occurrence = (seen.get(page) || 0) + 1;
      seen.set(page, occurrence);
      return `copy ${occurrence}/${total}`;
    });
  }, [pageOrder]);

  const sectionLabel = useCallback(
    (index: number) => {
      const meta = sectionMeta[index];
      if (!meta) return "";
      const pages = sections[index] ?? [];
      const ascending = pages.every(
        (page, i) => i === 0 || page === pages[i - 1] + 1
      );
      if (ascending && pages.length) {
        return pages.length === 1
          ? `page ${pages[0] + 1}`
          : `pages ${pages[0] + 1}–${pages[pages.length - 1] + 1}`;
      }
      return `${meta.length} page${meta.length === 1 ? "" : "s"}`;
    },
    [sectionMeta, sections]
  );

  const includedIndices = useMemo(
    () => sections.map((_, idx) => idx).filter((idx) => !skipped.has(idx)),
    [sections, skipped]
  );

  const toggleSkip = useCallback((index: number) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    setResults(null);
  }, []);

  const exportSections = useCallback(
    async (indices: number[], trackProgress = false) => {
      const bytes = bytesRef.current;
      if (!bytes || !indices.length) return null;
      return buildSplitFiles({
        bytes,
        baseName: safeBaseName(fileName),
        totalParts: sections.length,
        rotations,
        requests: indices.map((index) => ({
          partNumber: index + 1,
          pages: sections[index],
          label: sectionLabel(index),
        })),
        onProgress: trackProgress
          ? (done, total) => setExporting({ done, total })
          : undefined,
      });
    },
    [fileName, rotations, sectionLabel, sections]
  );

  const handleExportAll = useCallback(async () => {
    if (!includedIndices.length || exporting) return;
    setExporting({ done: 0, total: includedIndices.length });
    try {
      const files = await exportSections(includedIndices, true);
      if (files) {
        setResults(files);
        setOptionsOpen(false);
      }
    } catch (err) {
      console.error(err);
      setErrorMessage("Something went wrong while creating the files. Please try again.");
    } finally {
      setExporting(null);
    }
  }, [exporting, exportSections, includedIndices]);

  /** One-tap "just give me this part" — shares on mobile, downloads elsewhere. */
  const handleExportSection = useCallback(
    async (index: number) => {
      if (busySection !== null || exporting) return;
      setBusySection(index);
      try {
        const files = await exportSections([index]);
        const file = files?.[0];
        if (!file) return;
        if (canShareFile(file.blob, file.name)) {
          const shared = await shareBlob(file.blob, file.name);
          if (!shared) saveBlob(file.blob, file.name);
        } else {
          saveBlob(file.blob, file.name);
        }
      } catch (err) {
        console.error(err);
        setErrorMessage("Could not create that file. Please try again.");
      } finally {
        setBusySection(null);
      }
    },
    [busySection, exporting, exportSections]
  );

  const controls = (
    <SplitControls
      hasFile={status === "ready"}
      totalPages={pageOrder.length}
      manualCuts={cuts.size}
      autoSplitEnabled={autoSplitEnabled}
      autoSplitInterval={autoSplitInterval}
      onAutoSplitEnabledChange={(enabled) => {
        setAutoSplitEnabled(enabled);
        setSkipped(new Set());
        setResults(null);
      }}
      onAutoSplitIntervalChange={(value) => {
        setAutoSplitInterval(value);
        setSkipped(new Set());
        setResults(null);
      }}
      sections={sectionMeta}
      skipped={skipped}
      onToggleSkip={toggleSkip}
      onClearCuts={() => {
        setCuts(new Set());
        setSkipped(new Set());
        setResults(null);
      }}
      onDownloadSection={handleExportSection}
      busySection={busySection}
    />
  );

  const exportLabel = exporting
    ? `Creating ${exporting.done}/${exporting.total}…`
    : `Split & download ${includedIndices.length || ""} ${
        includedIndices.length === 1 ? "file" : "files"
      }`.trim();

  const viewerPage =
    viewerPosition !== null && viewerPosition < pageOrder.length
      ? pageOrder[viewerPosition]
      : null;

  return (
    <>
      <Head>
        <title>PDF Splitter</title>
        <meta
          name="description"
          content="Split, rotate and reorder PDF pages right on your phone."
        />
        <meta name="theme-color" content="#18181b" />
      </Head>

      <div className="min-h-[100dvh] bg-zinc-100 pb-28 lg:pb-10">
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-3 py-2.5 sm:px-5 lg:px-8">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white">
              <Scissors className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold text-zinc-900 sm:text-base">
                {status === "ready" || status === "loading"
                  ? fileName
                  : "PDF Splitter"}
              </h1>
              <p className="truncate text-[11px] text-zinc-500 sm:text-xs">
                {status === "ready"
                  ? `${pageOrder.length} page${
                      pageOrder.length === 1 ? "" : "s"
                    } · ${sections.length} part${sections.length === 1 ? "" : "s"}`
                  : status === "loading"
                  ? "Opening…"
                  : "Split any PDF, right on your phone"}
              </p>
            </div>
            <label className="relative flex h-10 flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-semibold text-white transition active:scale-95">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">
                {status === "ready" ? "Change PDF" : "Add PDF"}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileInput}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Choose a PDF file"
              />
            </label>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 lg:px-8">
          {errorMessage && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p className="flex-1">{errorMessage}</p>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="flex h-6 w-6 items-center justify-center rounded-full text-rose-500"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {status === "empty" || status === "error" ? (
            <label className="flex min-h-[60vh] cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-zinc-300 bg-white p-6 text-center transition active:bg-zinc-50">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900 text-white">
                <Upload className="h-7 w-7" />
              </span>
              <span className="space-y-1">
                <span className="block text-base font-semibold text-zinc-900">
                  Choose a PDF
                </span>
                <span className="block text-sm text-zinc-500">
                  Tap to pick a file. Everything happens on your device — nothing is
                  uploaded.
                </span>
              </span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileInput}
                className="sr-only"
              />
            </label>
          ) : status === "loading" ? (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-white">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-900" />
              <p className="text-sm font-medium text-zinc-600">Opening your PDF…</p>
            </div>
          ) : (
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
              <div className="space-y-4">
                <p className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[11px] text-zinc-500 sm:text-xs">
                  <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                  Tap a page to open it full screen. Use “Cut after” to start a new
                  file after that page.
                </p>

                {sections.map((section, sectionIdx) => {
                  const meta = sectionMeta[sectionIdx];
                  const isSkipped = skipped.has(sectionIdx);
                  return (
                    <section
                      key={`part-${sectionIdx}-${meta.start}`}
                      className={`rounded-2xl border p-2.5 transition sm:p-3 ${
                        isSkipped
                          ? "border-zinc-200 bg-zinc-200/60"
                          : "border-zinc-200 bg-white"
                      }`}
                    >
                      <div className="mb-2.5 flex items-center gap-2 px-0.5">
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-sm font-semibold ${
                              isSkipped ? "text-zinc-500" : "text-zinc-900"
                            }`}
                          >
                            Part {sectionIdx + 1}
                            {isSkipped && (
                              <span className="ml-1.5 text-xs font-medium text-zinc-500">
                                (excluded)
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[11px] text-zinc-500">
                            {meta.length} page{meta.length === 1 ? "" : "s"} ·{" "}
                            {sectionLabel(sectionIdx)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleSkip(sectionIdx)}
                          className="flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-2.5 text-[11px] font-semibold text-zinc-700 transition active:scale-95"
                        >
                          {isSkipped ? "Include" : "Exclude"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportSection(sectionIdx)}
                          disabled={isSkipped || busySection !== null}
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-white transition active:scale-95 disabled:opacity-40"
                          aria-label={`Download part ${sectionIdx + 1}`}
                        >
                          {busySection === sectionIdx ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                        {section.map((sourceIndex, offset) => {
                          const position = meta.start + offset;
                          return (
                            <PageCard
                              key={`page-${position}-${sourceIndex}`}
                              pageNumber={sourceIndex + 1}
                              position={position}
                              rotation={rotations[sourceIndex] || 0}
                              isCut={cuts.has(position)}
                              canCut={
                                !autoSplitEnabled && position < pageOrder.length - 1
                              }
                              copyLabel={copyLabels[position] ?? null}
                              store={store}
                              onOpen={() => setViewerPosition(position)}
                              onRotate={(direction) => rotatePage(sourceIndex, direction)}
                              onDuplicate={() => duplicateAt(position)}
                              onDelete={() => deleteAt(position)}
                              onToggleCut={() => toggleCut(position)}
                            />
                          );
                        })}
                      </div>
                    </section>
                  );
                })}

                {pageOrder.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center">
                    <p className="text-sm font-medium text-zinc-700">
                      Every page was removed.
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Pick the PDF again to start over.
                    </p>
                  </div>
                )}
              </div>

              <aside className="hidden lg:sticky lg:top-20 lg:block">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                  {controls}
                  <button
                    type="button"
                    onClick={handleExportAll}
                    disabled={!includedIndices.length || !!exporting}
                    className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
                  >
                    {exporting ? (
                      <Loader2 className="h-[18px] w-[18px] animate-spin" />
                    ) : (
                      <Download className="h-[18px] w-[18px]" />
                    )}
                    {exportLabel}
                  </button>
                </div>
              </aside>
            </div>
          )}
        </main>

        {/* Mobile action bar */}
        {status === "ready" && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOptionsOpen(true)}
                className="flex h-12 flex-shrink-0 items-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-800 transition active:scale-95"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Options
              </button>
              <button
                type="button"
                onClick={handleExportAll}
                disabled={!includedIndices.length || !!exporting}
                className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-3 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
              >
                {exporting ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" />
                ) : (
                  <Download className="h-[18px] w-[18px]" />
                )}
                <span className="truncate">{exportLabel}</span>
              </button>
            </div>
          </div>
        )}

        {/* Mobile options sheet */}
        {optionsOpen && (
          <div className="fixed inset-0 z-40 flex items-end lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setOptionsOpen(false)}
              aria-hidden
            />
            <div className="relative flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-zinc-50 shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-900">Split options</h2>
                <button
                  type="button"
                  onClick={() => setOptionsOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 transition active:scale-95"
                  aria-label="Close options"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {controls}
              </div>
            </div>
          </div>
        )}

        {viewerPosition !== null && viewerPage !== null && doc && (
          <PageViewer
            doc={doc}
            pageNumber={viewerPage + 1}
            position={viewerPosition}
            totalPositions={pageOrder.length}
            rotation={rotations[viewerPage] || 0}
            copyLabel={copyLabels[viewerPosition] ?? null}
            isCut={cuts.has(viewerPosition)}
            canCut={!autoSplitEnabled && viewerPosition < pageOrder.length - 1}
            onClose={() => setViewerPosition(null)}
            onPrev={() => setViewerPosition((prev) => Math.max(0, (prev ?? 0) - 1))}
            onNext={() =>
              setViewerPosition((prev) =>
                Math.min(pageOrder.length - 1, (prev ?? 0) + 1)
              )
            }
            onRotate={(direction) => rotatePage(viewerPage, direction)}
            onDuplicate={() => duplicateAt(viewerPosition)}
            onDelete={() => deleteAt(viewerPosition)}
            onToggleCut={() => toggleCut(viewerPosition)}
          />
        )}

        {results && results.length > 0 && (
          <DownloadsSheet
            files={results}
            zipName={`${safeBaseName(fileName)}_splits.zip`}
            onClose={() => setResults(null)}
          />
        )}
      </div>
    </>
  );
}
