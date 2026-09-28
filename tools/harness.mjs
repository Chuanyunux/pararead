// Development harness: serves the viewer webview in a plain browser, with a
// stub VS Code API that records host messages in `window.__hostMessages`.
//
// Usage: node tools/harness.mjs [port]   then open http://localhost:<port>/?pdf=papers/<file>.pdf

import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(import.meta.dirname, "..");
const port = Number(process.argv[2] ?? 5178);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ftl": "text/plain; charset=utf-8",
};

// Same rewriting as src/pdf-viewer-provider.ts, minus the CSP.
function harnessHtml(pdf) {
  const origin = `http://localhost:${port}`;
  const pdfjs = `${origin}/assets/pdf.js`;
  const config = {
    url: `${origin}/${pdf}`,
    docBaseUrl: `${origin}/${pdf}`,
    resourceRoot: `${origin}/${pdf.replace(/[^/]+$/u, "")}`,
    defaultZoomValue: "auto",
    sidebarViewOnLoad: 0,
    sandboxBundleSrc: `${pdfjs}/build/pdf.sandbox.mjs`,
    cMapUrl: `${pdfjs}/web/cmaps/`,
    iccUrl: `${pdfjs}/web/iccs/`,
    standardFontDataUrl: `${pdfjs}/web/standard_fonts/`,
    wasmUrl: `${pdfjs}/web/wasm/`,
    imageResourcesPath: `${pdfjs}/web/images/`,
    debug: true,
  };
  const attr = JSON.stringify(config).replaceAll('"', "&quot;");
  return readFileSync(join(root, "assets/pdf.js/web/viewer.html"), "utf8")
    .replace(`<link rel="resource" type="application/l10n" href="locale/locale.json" />`, "")
    .replace(`<script src="../build/pdf.mjs" type="module"></script>`, "")
    .replace(`<script src="viewer.mjs" type="module"></script>`, "")
    .replace(`<link rel="stylesheet" href="viewer.css" />`, "")
    .replace(
      "<title>PDF.js viewer</title>",
      `<meta id="pdf-view-config" data-config="${attr}">
<title>PDF.js viewer (harness)</title>
<script>
  window.__hostMessages = [];
  window.acquireVsCodeApi = () => ({
    postMessage(message) {
      window.__hostMessages.push(message);
      console.log("[to host]", message.type ?? message);
    },
    getState() {
      try { return JSON.parse(sessionStorage.getItem("vscodeState") ?? "null"); } catch { return null; }
    },
    setState(state) {
      try { sessionStorage.setItem("vscodeState", JSON.stringify(state)); } catch {}
    },
  });
</script>
<link rel="stylesheet" href="${pdfjs}/web/viewer.css">
<link rel="stylesheet" href="${origin}/assets/main.css">
<link rel="stylesheet" href="${origin}/assets/panel.css">
<script src="${pdfjs}/build/pdf.mjs" type="module"></script>
<script src="${origin}/dist/webview/main.mjs" type="module"></script>
<link rel="resource" type="application/l10n" href="${pdfjs}/web/locale/locale.json">`,
    );
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/") {
    const pdf =
      url.searchParams.get("pdf") ?? "assets/pdf.js/web/compressed.tracemonkey-pldi-09.pdf";
    res.writeHead(200, { "content-type": MIME[".html"] });
    res.end(harnessHtml(pdf));
    return;
  }
  const file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const stat = statSync(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "content-length": stat.size,
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => {
  console.log(`harness on http://localhost:${port}/`);
});
