// Dumps pdf.js getTextContent() output of a PDF into JSON page fixtures, for
// inspecting the segmenter with `pnpm run segment`.
//
// Usage: node tools/dump_text_content.mjs <input.pdf> <out-dir> [firstPage] [lastPage]

import { dumpPdf } from "./pdf-text.mjs";

const [input, outDir, first = "1", last] = process.argv.slice(2);
if (!input || !outDir) {
  console.error("Usage: node tools/dump_text_content.mjs <input.pdf> <out-dir> [first] [last]");
  process.exit(1);
}

const pages = await dumpPdf(input, outDir, {
  first: Number(first),
  ...(last === undefined ? {} : { last: Number(last) }),
});
console.log(`dumped ${pages} pages`);
