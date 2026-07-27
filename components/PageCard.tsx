import { memo, useEffect, useRef, useState } from "react";
import {
  Copy,
  Loader2,
  Maximize2,
  RotateCcw,
  RotateCw,
  Scissors,
  Trash2,
} from "lucide-react";
import type { ThumbnailStore } from "@/lib/pdfjs";

type PageCardProps = {
  /** 1-based page number in the source document. */
  pageNumber: number;
  /** Index of this card inside pageOrder (a page can appear more than once). */
  position: number;
  rotation: number;
  isCut: boolean;
  canCut: boolean;
  copyLabel: string | null;
  store: ThumbnailStore | null;
  onOpen: () => void;
  onRotate: (direction: "left" | "right") => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleCut: () => void;
};

const actionButton =
  "flex min-h-[44px] flex-1 items-center justify-center text-zinc-600 transition active:bg-zinc-100 active:text-zinc-900 disabled:opacity-40 sm:hover:bg-zinc-50 sm:hover:text-zinc-900";

function PageCardComponent({
  pageNumber,
  position,
  rotation,
  isCut,
  canCut,
  copyLabel,
  store,
  onOpen,
  onRotate,
  onDuplicate,
  onDelete,
  onToggleCut,
}: PageCardProps) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<string | null>(
    () => store?.peek(pageNumber) ?? null
  );
  const [failed, setFailed] = useState(false);

  // Only pages that are on (or near) the screen are ever rendered. This is what
  // keeps a 200 page document usable on a phone.
  useEffect(() => {
    const node = holderRef.current;
    if (!node || !store) return;

    const cached = store.peek(pageNumber);
    if (cached) {
      setSrc(cached);
      return;
    }

    let cancelled = false;
    let requested = false;

    const request = () => {
      if (requested || cancelled) return;
      requested = true;
      store
        .request(pageNumber)
        .then((url) => {
          if (!cancelled) setSrc(url);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };

    if (typeof IntersectionObserver === "undefined") {
      request();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          request();
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px", threshold: 0.01 }
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [pageNumber, store]);

  // Quarter turns are shown by rotating the thumbnail in CSS (instant, no
  // re-render). The image box swaps to the inverse of the 3:4 preview area so a
  // rotated page still lands exactly inside it: 4/3 = 133.333%, 3/4 = 75%.
  const quarterTurned = rotation % 180 !== 0;
  const imageBox = quarterTurned
    ? { width: "133.3333%", height: "75%", left: "-16.6667%", top: "12.5%" }
    : { width: "100%", height: "100%", left: "0%", top: "0%" };

  return (
    <div
      ref={holderRef}
      className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
      // Lets the browser skip layout/paint for off-screen cards.
      style={{ contentVisibility: "auto", containIntrinsicSize: "300px" }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-[3/4] w-full bg-zinc-100 active:bg-zinc-200"
        aria-label={`Open page ${pageNumber} full screen`}
      >
        {src ? (
          <img
            src={src}
            alt={`Page ${pageNumber}`}
            draggable={false}
            className="absolute select-none object-contain p-1.5"
            style={{ ...imageBox, transform: `rotate(${rotation}deg)` }}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center">
            {failed ? (
              <span className="px-2 text-center text-[11px] text-zinc-500">
                Preview unavailable
              </span>
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            )}
          </span>
        )}

        <span className="absolute left-1.5 top-1.5 flex h-6 min-w-[24px] items-center justify-center rounded-md bg-zinc-900/90 px-1.5 text-[11px] font-semibold text-white">
          {pageNumber}
        </span>

        <span className="absolute right-1.5 top-1.5 flex flex-col items-end gap-1">
          {rotation !== 0 && (
            <span className="rounded-md bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 shadow-sm">
              {rotation}°
            </span>
          )}
          {copyLabel && (
            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 shadow-sm">
              {copyLabel}
            </span>
          )}
        </span>

        <span className="absolute bottom-1.5 right-1.5 rounded-md bg-white/95 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 shadow-sm">
          #{position + 1}
        </span>
      </button>

      <div className="flex divide-x divide-zinc-200 border-t border-zinc-200">
        <button
          type="button"
          onClick={() => onRotate("left")}
          className={actionButton}
          aria-label={`Rotate page ${pageNumber} left`}
        >
          <RotateCcw className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => onRotate("right")}
          className={actionButton}
          aria-label={`Rotate page ${pageNumber} right`}
        >
          <RotateCw className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          className={actionButton}
          aria-label={`Duplicate page ${pageNumber}`}
        >
          <Copy className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onOpen}
          className={`${actionButton} hidden sm:flex`}
          aria-label={`Preview page ${pageNumber}`}
        >
          <Maximize2 className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={`${actionButton} text-rose-500 active:bg-rose-50 sm:hover:bg-rose-50 sm:hover:text-rose-600`}
          aria-label={`Remove page ${pageNumber}`}
        >
          <Trash2 className="h-[18px] w-[18px]" />
        </button>
      </div>

      <button
        type="button"
        onClick={onToggleCut}
        disabled={!canCut}
        className={`flex min-h-[42px] w-full items-center justify-center gap-1.5 border-t px-2 text-[11px] font-semibold transition ${
          isCut
            ? "border-zinc-900 bg-zinc-900 text-white"
            : "border-zinc-200 bg-zinc-50 text-zinc-600 active:bg-zinc-100"
        } disabled:cursor-not-allowed disabled:opacity-45`}
      >
        <Scissors className="h-3.5 w-3.5" />
        {isCut ? "Cut here" : "Cut after"}
      </button>
    </div>
  );
}

export const PageCard = memo(PageCardComponent);
