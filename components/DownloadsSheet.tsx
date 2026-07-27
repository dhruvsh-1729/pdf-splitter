import { useEffect, useState } from "react";
import {
  Check,
  Download,
  FileText,
  Loader2,
  Package,
  Share2,
  X,
} from "lucide-react";
import { canShareFile, formatBytes, saveBlob, shareBlob } from "@/lib/download";
import type { SplitFile } from "@/lib/split";

type DownloadsSheetProps = {
  files: SplitFile[];
  zipName: string;
  onClose: () => void;
};

export function DownloadsSheet({ files, zipName, onClose }: DownloadsSheetProps) {
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [sharingAll, setSharingAll] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const markSaved = (name: string) =>
    setSaved((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });

  const handleSave = (file: SplitFile) => {
    saveBlob(file.blob, file.name);
    markSaved(file.name);
  };

  const handleShare = async (file: SplitFile) => {
    const shared = await shareBlob(file.blob, file.name);
    if (!shared) saveBlob(file.blob, file.name);
    markSaved(file.name);
  };

  const buildZip = async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    files.forEach((file) => zip.file(file.name, file.blob));
    return zip.generateAsync({ type: "blob", compression: "STORE" });
  };

  const handleZip = async () => {
    setZipping(true);
    try {
      const blob = await buildZip();
      saveBlob(blob, zipName);
    } catch (err) {
      console.error(err);
    } finally {
      setZipping(false);
    }
  };

  const handleShareAll = async () => {
    setSharingAll(true);
    try {
      const asFiles = files.map((file) => ({ blob: file.blob, name: file.name }));
      // Try sharing every PDF at once; fall back to a zip when the platform
      // refuses a multi-file share.
      if (
        typeof navigator !== "undefined" &&
        navigator.canShare &&
        asFiles.length > 1
      ) {
        try {
          const fileObjects = asFiles.map(
            (item) => new File([item.blob], item.name, { type: "application/pdf" })
          );
          if (navigator.canShare({ files: fileObjects })) {
            await navigator.share({ files: fileObjects, title: zipName });
            return;
          }
        } catch (err) {
          if ((err as { name?: string })?.name === "AbortError") return;
        }
      }
      const blob = await buildZip();
      const shared = await shareBlob(blob, zipName, "application/zip");
      if (!shared) saveBlob(blob, zipName);
    } catch (err) {
      console.error(err);
    } finally {
      setSharingAll(false);
    }
  };

  const totalSize = files.reduce((sum, file) => sum + file.blob.size, 0);
  const canShareAny = files.length > 0 && canShareFile(files[0].blob, files[0].name);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              {files.length} file{files.length === 1 ? "" : "s"} ready
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {formatBytes(totalSize)} total · save them one by one or all together
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 transition active:scale-95"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-4">
          {files.map((file) => (
            <div
              key={file.name}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-2.5"
            >
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                <FileText className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900">
                  {file.name}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {file.label} · {formatBytes(file.blob.size)}
                  {saved.has(file.name) && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 font-semibold text-emerald-600">
                      <Check className="h-3 w-3" /> saved
                    </span>
                  )}
                </p>
              </div>
              {canShareAny && (
                <button
                  type="button"
                  onClick={() => handleShare(file)}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 transition active:scale-95"
                  aria-label={`Share ${file.name}`}
                >
                  <Share2 className="h-[18px] w-[18px]" />
                </button>
              )}
              <button
                type="button"
                onClick={() => handleSave(file)}
                className="flex h-10 min-w-[44px] flex-shrink-0 items-center justify-center rounded-lg bg-zinc-900 px-3 text-white transition active:scale-95"
                aria-label={`Download ${file.name}`}
              >
                <Download className="h-[18px] w-[18px]" />
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-zinc-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {canShareAny && (
            <button
              type="button"
              onClick={handleShareAll}
              disabled={sharingAll || zipping}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
            >
              {sharingAll ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : (
                <Share2 className="h-[18px] w-[18px]" />
              )}
              Share all {files.length} files
            </button>
          )}
          <button
            type="button"
            onClick={handleZip}
            disabled={zipping || sharingAll}
            className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-60 ${
              canShareAny
                ? "border border-zinc-300 bg-white text-zinc-900"
                : "bg-zinc-900 text-white"
            }`}
          >
            {zipping ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" />
            ) : (
              <Package className="h-[18px] w-[18px]" />
            )}
            {zipping ? "Preparing ZIP…" : "Download all as ZIP"}
          </button>
        </div>
      </div>
    </div>
  );
}
