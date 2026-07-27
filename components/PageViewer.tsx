import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  RotateCcw,
  RotateCw,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { isRenderCancelled, renderPageToCanvas } from "@/lib/pdfjs";

type PageViewerProps = {
  doc: PDFDocumentProxy;
  pageNumber: number;
  position: number;
  totalPositions: number;
  rotation: number;
  copyLabel: string | null;
  isCut: boolean;
  canCut: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRotate: (direction: "left" | "right") => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleCut: () => void;
};

const toolButton =
  "flex min-h-[48px] flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-zinc-800 text-[11px] font-medium text-zinc-200 transition active:scale-95 active:bg-zinc-700 disabled:opacity-40";

export function PageViewer({
  doc,
  pageNumber,
  position,
  totalPositions,
  rotation,
  copyLabel,
  isCut,
  canCut,
  onClose,
  onPrev,
  onNext,
  onRotate,
  onDuplicate,
  onDelete,
  onToggleCut,
}: PageViewerProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lock the page behind the overlay so the phone doesn't scroll the grid while
  // the viewer is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Track the available stage size, including orientation changes.
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      setBox({
        width: Math.max(120, Math.floor(rect.width) - 16),
        height: Math.max(160, Math.floor(rect.height) - 16),
      });
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box) return;

    let cancelled = false;
    setRendering(true);
    setError(null);
    taskRef.current?.cancel();

    renderPageToCanvas({
      doc,
      pageNumber,
      canvas,
      boxWidth: box.width,
      boxHeight: box.height,
      rotation,
      onTask: (task) => {
        taskRef.current = task;
      },
    })
      .then(({ cssWidth, cssHeight }) => {
        if (cancelled) return;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        setRendering(false);
      })
      .catch((err) => {
        if (cancelled || isRenderCancelled(err)) return;
        console.error(err);
        setError("This page could not be rendered.");
        setRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [box, doc, pageNumber, rotation]);

  useEffect(() => () => taskRef.current?.cancel(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onPrev();
      if (event.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNext, onPrev]);

  // Swipe between pages — the expected gesture on a phone.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }, []);
  const handleTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onNext();
      else onPrev();
    },
    [onNext, onPrev]
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            Page {pageNumber}
            {copyLabel && (
              <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
                {copyLabel}
              </span>
            )}
          </p>
          <p className="text-xs text-zinc-400">
            {position + 1} of {totalPositions} in your order · {rotation}° rotation
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-zinc-800 text-white transition active:scale-95"
          aria-label="Close preview"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <canvas
          ref={canvasRef}
          className="max-h-full max-w-full rounded-lg bg-white shadow-2xl"
        />
        {rendering && (
          <span className="absolute inset-0 flex items-center justify-center bg-zinc-950/60">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-300" />
          </span>
        )}
        {error && (
          <span className="absolute inset-x-4 bottom-4 rounded-lg bg-rose-500/15 px-3 py-2 text-center text-sm text-rose-200">
            {error}
          </span>
        )}

        <button
          type="button"
          onClick={onPrev}
          disabled={position === 0}
          className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-800/80 text-white transition active:scale-95 disabled:opacity-30 sm:flex"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={position >= totalPositions - 1}
          className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-800/80 text-white transition active:scale-95 disabled:opacity-30 sm:flex"
          aria-label="Next page"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-2 border-t border-zinc-800 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex gap-2">
          <button type="button" onClick={() => onRotate("left")} className={toolButton}>
            <RotateCcw className="h-[18px] w-[18px]" />
            Left
          </button>
          <button type="button" onClick={() => onRotate("right")} className={toolButton}>
            <RotateCw className="h-[18px] w-[18px]" />
            Right
          </button>
          <button type="button" onClick={onDuplicate} className={toolButton}>
            <Copy className="h-[18px] w-[18px]" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={onToggleCut}
            disabled={!canCut}
            className={`${toolButton} ${
              isCut ? "bg-white text-zinc-900 active:bg-zinc-200" : ""
            }`}
          >
            <Scissors className="h-[18px] w-[18px]" />
            {isCut ? "Cut set" : "Cut after"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className={`${toolButton} text-rose-300`}
          >
            <Trash2 className="h-[18px] w-[18px]" />
            Remove
          </button>
        </div>
        <div className="flex gap-2 sm:hidden">
          <button
            type="button"
            onClick={onPrev}
            disabled={position === 0}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-800 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={position >= totalPositions - 1}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-800 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
