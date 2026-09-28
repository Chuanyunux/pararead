// Prints the segmentation of text-content fixtures, for manual inspection.
//
// Usage: node --experimental-strip-types tools/segment_fixture.ts <fixture.json>... [--sample N]

import { readFileSync } from "node:fs";

import { HeuristicSegmenter } from "../src/webview/segmenter/heuristic.ts";
import type { PageTextInput } from "../src/webview/segmenter/types.ts";

const args = process.argv.slice(2);
const sampleAt = args.indexOf("--sample");
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 0;
const files = args.filter((_, i) => sampleAt < 0 || (i !== sampleAt && i !== sampleAt + 1));

const segmenter = new HeuristicSegmenter();
const all: { id: string; text: string }[] = [];
for (const file of files) {
  const input = JSON.parse(readFileSync(file, "utf8")) as PageTextInput;
  const { blocks } = segmenter.segmentPage(input);
  for (const block of blocks) {
    if (sample === 0) {
      console.log(`\n## ${block.id} [${block.kind}]`);
      if (block.kind === "code") {
        console.log(`  ${block.text.slice(0, 100)}`);
      }
    }
    for (const s of block.sentences) {
      all.push({ id: s.id, text: s.text });
      if (sample === 0) {
        console.log(`  ${s.id}: ${s.text}`);
      }
    }
  }
}

if (sample > 0) {
  // Deterministic pseudo-random sample so that runs are reproducible.
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const picked = new Set<number>();
  while (picked.size < Math.min(sample, all.length)) {
    picked.add(Math.floor(rand() * all.length));
  }
  for (const i of [...picked].toSorted((a, b) => a - b)) {
    const s = all[i];
    if (s !== undefined) {
      console.log(`${s.id}\t${s.text}`);
    }
  }
}
