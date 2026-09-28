// Extracts pdf.js getTextContent() output of a PDF as JSON page fixtures, the
// input of the segmenter. Shared by tools/dump_text_content.mjs and the test
// setup (test/global-setup.ts).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

let pdfjs;

async function loadPdfjs() {
  if (pdfjs === undefined) {
    // Text extraction does not render, so inert stand-ins for the canvas-only
    // globals are enough to load the browser build of pdf.js in Node.
    globalThis.DOMMatrix ??= class DOMMatrix {};
    globalThis.Path2D ??= class Path2D {};
    pdfjs = await import(
      pathToFileURL(join(import.meta.dirname, "../assets/pdf.js/build/pdf.mjs")).href
    );
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      join(import.meta.dirname, "../assets/pdf.js/build/pdf.worker.mjs"),
    ).href;
  }
  return pdfjs;
}

/**
 * Writes `<name>.p<n>.json` for each page of `input` into `outDir`.
 * Returns the number of pages written.
 */
export async function dumpPdf(
  input,
  outDir,
  { name = basename(input, ".pdf"), first = 1, last } = {},
) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(readFileSync(input)),
    // In Node, pdf.js reads standard fonts from the file system (a path, not a URL).
    standardFontDataUrl: `${join(import.meta.dirname, "../assets/pdf.js/web/standard_fonts")}/`,
  });
  const doc = await task.promise;
  const lastPage = Math.min(last ?? doc.numPages, doc.numPages);
  mkdirSync(outDir, { recursive: true });

  for (let n = first; n <= lastPage; n++) {
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
  await task.destroy();
  return lastPage - first + 1;
}
