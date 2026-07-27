/**
 * Copies the pdf.js worker out of node_modules into /public so the app can serve
 * it from its own origin instead of a CDN. Hosting it locally keeps the worker
 * version locked to the installed pdfjs-dist and removes a slow third-party
 * request on mobile networks.
 */
const fs = require("fs");
const path = require("path");

const source = path.join(
  __dirname,
  "..",
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.js"
);
const target = path.join(__dirname, "..", "public", "pdf.worker.min.js");

try {
  fs.copyFileSync(source, target);
  console.log("[copy-pdf-worker] public/pdf.worker.min.js updated");
} catch (err) {
  // A missing worker is only fatal at runtime, so warn loudly but let the build
  // continue (the committed copy in /public is used as-is).
  console.warn("[copy-pdf-worker] could not copy worker:", err.message);
}
