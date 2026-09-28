import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HeuristicSegmenter } from "../src/webview/segmenter/heuristic";
import { combineAccent, findSentenceEnds, lineJoin } from "../src/webview/segmenter/protect";
import type { PageTextInput, Sentence } from "../src/webview/segmenter/types";

function split(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const end of findSentenceEnds(text)) {
    out.push(text.slice(start, end).trim());
    start = end;
  }
  return out;
}

function loadFixture(name: string): PageTextInput {
  return JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"),
  ) as PageTextInput;
}

function sentencesOf(name: string): Sentence[] {
  return new HeuristicSegmenter().segmentPage(loadFixture(name)).blocks.flatMap((b) => b.sentences);
}

describe("findSentenceEnds", () => {
  it("splits on sentence-final punctuation followed by a capital", () => {
    expect(split("First one. Second one? Third!")).toEqual(["First one.", "Second one?", "Third!"]);
  });

  it("does not split protected abbreviations", () => {
    expect(
      split("Models, e.g. Transformers, work. As shown in Fig. 3 and Eq. 2, it holds."),
    ).toEqual(["Models, e.g. Transformers, work.", "As shown in Fig. 3 and Eq. 2, it holds."]);
    expect(split("Vaswani et al. [12] proposed it. See Sec. 4 vs. Sec. 5.")).toEqual([
      "Vaswani et al. [12] proposed it.",
      "See Sec. 4 vs. Sec. 5.",
    ]);
    expect(split("That is, i.e. The rest.")).toEqual(["That is, i.e. The rest."]);
  });

  it("does not split decimals, versions, URLs or citations", () => {
    expect(split("Accuracy rose to 93.5 with v1.2.3 from github.com/a/b [12]. Next.")).toEqual([
      "Accuracy rose to 93.5 with v1.2.3 from github.com/a/b [12].",
      "Next.",
    ]);
  });

  it("keeps initials, enumerators and caption labels", () => {
    expect(split("As A. Vaswani wrote. 1. First item here.")).toEqual([
      "As A. Vaswani wrote.",
      "1. First item here.",
    ]);
    expect(split("Figure 1. Sample program. It loops.")).toEqual([
      "Figure 1. Sample program.",
      "It loops.",
    ]);
  });

  it("absorbs closing quotes and brackets", () => {
    expect(split('He said "stop." Then (it ended.) Done.')).toEqual([
      'He said "stop."',
      "Then (it ended.)",
      "Done.",
    ]);
  });
});

describe("lineJoin", () => {
  it("merges words broken across lines", () => {
    expect(lineJoin("s", "-", "f")).toBe("merge");
  });
  it("keeps hyphens before capitals", () => {
    expect(lineJoin("e", "-", "M")).toBe("keep");
  });
  it("inserts a space otherwise", () => {
    expect(lineJoin("a", "b", "c")).toBe("space");
    expect(lineJoin("2", "-", "x")).toBe("space");
  });
});

describe("combineAccent", () => {
  it("combines spacing accents with dotless i", () => {
    expect(combineAccent("¨", "ı")).toBe("ï");
    expect(combineAccent("´", "e")).toBe("é");
    expect(combineAccent("¨", "1")).toBeNull();
  });
});

describe("HeuristicSegmenter on a two-column paper", () => {
  const sentences = sentencesOf("compressed.tracemonkey-pldi-09.p2.json");
  const texts = sentences.map((s) => s.text);

  it("uses p{page}-b{block}-s{idx} ids", () => {
    for (const s of sentences) {
      expect(s.id).toMatch(/^p2-b\d+-s\d+$/u);
      expect(s.id.startsWith(`${s.blockId}-`)).toBe(true);
    }
  });

  it("repairs hyphenation and accents", () => {
    expect(texts).toContain(
      "In a naïve implementation, inner loops would become hot first, and the VM would start tracing there.",
    );
    expect(texts).toContain(
      "These techniques allow a VM to dynamically translate a program to nested, type-specialized trace trees.",
    );
    expect(texts).toContain("We call the resulting tracing VM Trace-Monkey.");
  });

  it("joins a paragraph continued in the next column after a figure", () => {
    expect(texts).toContain(
      "In Section 7 we evaluate our dynamic compiler based on a set of industry benchmarks.",
    );
  });

  it("detects code listings and skips them", () => {
    const { blocks } = new HeuristicSegmenter().segmentPage(
      loadFixture("compressed.tracemonkey-pldi-09.p2.json"),
    );
    const code = blocks.filter((b) => b.kind === "code");
    expect(code.length).toBeGreaterThan(0);
    expect(code.every((b) => b.sentences.length === 0)).toBe(true);
    expect(texts.some((t) => t.includes("primes[k] = false"))).toBe(false);
  });

  it("maps sentences back to text layer spans and rectangles", () => {
    const input = loadFixture("compressed.tracemonkey-pldi-09.p2.json");
    const sentence = sentences.find((s) => s.text.startsWith("Every compiled trace contains"));
    expect(sentence).toBeDefined();
    if (sentence === undefined) {
      return;
    }
    const { startSpan, startChar, endSpan, endChar } = sentence.spanRange;
    expect(input.items[startSpan]?.str.slice(startChar)).toMatch(/^Every compiled trace/u);
    expect(input.items[endSpan]?.str.slice(0, endChar)).toMatch(/speculation\.$/u);
    // The sentence spans 2 lines of the left column.
    expect(sentence.rects).toHaveLength(2);
    for (const rect of sentence.rects) {
      expect(rect.x).toBeGreaterThanOrEqual(50);
      expect(rect.x + rect.w).toBeLessThanOrEqual(300);
    }
  });
});
