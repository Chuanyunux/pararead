/**
 * Generates the segmenter test fixtures before the tests run. No paper text is
 * committed to the repository:
 * - tracemonkey (two columns) ships with PDF.js under Apache-2.0;
 * - "Attention Is All You Need" (single column) is downloaded from arXiv on
 *   first use. Its arXiv license does not allow redistribution, so the PDF and
 *   the extracted text only live in the git-ignored `.cache/` directory.
 * Without network access the Attention tests are skipped.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { dumpPdf } from "../tools/pdf-text.mjs";
import { ATTENTION, FIXTURE_DIR, PAPER_DIR, ROOT, TRACEMONKEY } from "./fixtures";

const ATTENTION_URL = "https://arxiv.org/pdf/1706.03762v7";

async function ensure(name: string, pdf: string, pages: number): Promise<void> {
  if (existsSync(join(FIXTURE_DIR, `${name}.p${pages}.json`))) {
    return;
  }
  await dumpPdf(pdf, FIXTURE_DIR, { name });
}

async function download(url: string, target: string): Promise<boolean> {
  if (existsSync(target)) {
    return true;
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    mkdirSync(PAPER_DIR, { recursive: true });
    writeFileSync(target, new Uint8Array(await response.arrayBuffer()));
    return true;
  } catch (error) {
    console.warn(`Could not download ${url} (${String(error)}); its tests are skipped.`);
    return false;
  }
}

export default async function setup(): Promise<void> {
  await ensure(
    TRACEMONKEY.name,
    join(ROOT, "assets/pdf.js/web/compressed.tracemonkey-pldi-09.pdf"),
    TRACEMONKEY.pages,
  );
  const attentionPdf = join(PAPER_DIR, "attention-1706.03762v7.pdf");
  if (await download(ATTENTION_URL, attentionPdf)) {
    await ensure(ATTENTION.name, attentionPdf, ATTENTION.pages);
  }
}
