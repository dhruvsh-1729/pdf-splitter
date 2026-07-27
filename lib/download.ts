export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Triggers a normal browser download for an in-memory blob. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Give the browser a moment to start the download before the URL disappears —
  // revoking synchronously breaks the download on some mobile browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function toFile(blob: Blob, filename: string, type: string): File | null {
  try {
    return new File([blob], filename, { type });
  } catch {
    return null;
  }
}

/**
 * Whether the OS share sheet can take this file. On phones sharing is usually
 * what people actually want ("save to Files", "send on WhatsApp"), so we offer
 * it alongside a plain download.
 */
export function canShareFile(
  blob: Blob,
  filename: string,
  type = "application/pdf"
): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  const file = toFile(blob, filename, type);
  if (!file) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Opens the OS share sheet. Returns false when sharing was unavailable so the
 * caller can fall back to a download; a user-cancelled share resolves true.
 */
export async function shareBlob(
  blob: Blob,
  filename: string,
  type = "application/pdf"
): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.share) return false;
  const file = toFile(blob, filename, type);
  if (!file) return false;
  try {
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") return true;
    return false;
  }
}
