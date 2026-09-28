// Dumps pdf.js getTextContent() output of a PDF into JSON fixtures used by
// the segmenter tests.
//
// Usage: node tools/dump_text_content.mjs <input.pdf> <out-dir> [firstPage] [lastPage]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const [input, outDir, first = "1", last] = process.argv.slice(2);
if (!input || !outDir) {
  console.error("Usage: node tools/dump_text_content.mjs <input.pdf> <out-dir> [first] [last]");
  process.exit(1);
}

// Text extraction does not render, so inert stand-ins for the canvas-only
// globals are enough to load the browser build of pdf.js in Node.
globalThis.DOMMatrix ??= class DOMMatrix {};
globalThis.Path2D ??= class Path2D {};

const pdfjs = await import(
  pathToFileURL(join(import.meta.dirname, "../assets/pdf.js/build/pdf.mjs")).href
);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  join(import.meta.dirname, "../assets/pdf.js/build/pdf.worker.mjs"),
).href;

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(input)) }).promise;
const lastPage = Math.min(Number(last ?? doc.numPages), doc.numPages);
const name = basename(input, ".pdf");
mkdirSync(outDir, { recursive: true });

for (let n = Number(first); n <= lastPage; n++) {
  const page = await doc.getPage(n);
  // Same parameters as the viewer's TextLayerBuilder, so that item indices
  // (after dropping marked-content markers) match the text layer spans.
  const content = await page.getTextContent({
    includeMarkedContent: true,
    disableNormalization: true,
  });
  const [x0, y0, x1, y1] = page.view;
  const fixture = {
    source: basename(input),
    page: n,
    view: [x0, y0, x1, y1],
    styles: Object.fromEntries(
      Object.entries(content.styles).map(([k, s]) => [k, { fontFamily: s.fontFamily }]),
    ),
    items: content.items
      .filter((item) => item.str !== undefined)
      .map((item) => ({
        str: item.str,
        transform: item.transform.map((v) => Math.round(v * 1000) / 1000),
        width: Math.round(item.width * 1000) / 1000,
        height: Math.round(item.height * 1000) / 1000,
        fontName: item.fontName,
        hasEOL: item.hasEOL,
      })),
  };
  writeFileSync(join(outDir, `${name}.p${n}.json`), `${JSON.stringify(fixture)}\n`);
}
console.log(`dumped pages ${first}-${lastPage} of ${doc.numPages}`);
await doc.destroy();
