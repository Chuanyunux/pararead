import { describe, expect, it } from "vitest";

import { HeuristicSegmenter } from "../src/webview/segmenter/heuristic";
import { combineAccent, findSentenceEnds, lineJoin } from "../src/webview/segmenter/protect";
import type { Sentence } from "../src/webview/segmenter/types";
import { ATTENTION, hasFixture, loadFixture, TRACEMONKEY } from "./fixtures";

function split(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const end of findSentenceEnds(text)) {
    out.push(text.slice(start, end).trim());
    start = end;
  }
  return out;
}

type Paper = typeof TRACEMONKEY;

function blocksOf(paper: Paper, page: number) {
  return new HeuristicSegmenter().segmentPage(loadFixture(paper, page)).blocks;
}

function sentencesOf(paper: Paper, page: number): Sentence[] {
  return blocksOf(paper, page).flatMap((b) => b.sentences);
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
  const sentences = sentencesOf(TRACEMONKEY, 2);
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
    const code = blocksOf(TRACEMONKEY, 2).filter((b) => b.kind === "code");
    expect(code.length).toBeGreaterThan(0);
    expect(code.every((b) => b.sentences.length === 0)).toBe(true);
    expect(texts.some((t) => t.includes("primes[k] = false"))).toBe(false);
  });

  it("maps sentences back to text layer spans and rectangles", () => {
    const input = loadFixture(TRACEMONKEY, 2);
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

describe("block roles", () => {
  const find = (paper: Paper, page: number, prefix: string) =>
    blocksOf(paper, page).find((b) => b.text.startsWith(prefix));

  it("recognizes the title as a level-1 heading", () => {
    expect(find(TRACEMONKEY, 1, "Trace-based Just-in-Time")).toMatchObject({
      role: "heading",
      level: 1,
    });
  });

  it("recognizes lists, captions, figure labels, code and paragraphs", () => {
    expect(find(TRACEMONKEY, 2, "• We explain an algorithm")?.role).toBe("list");
    expect(find(TRACEMONKEY, 2, "Figure 1.")?.role).toBe("caption");
    expect(find(TRACEMONKEY, 2, "Monitor")?.role).toBe("figure");
    expect(find(TRACEMONKEY, 2, "1 for (var i")?.role).toBe("code");
    expect(find(TRACEMONKEY, 2, "Nested loops can be difficult")?.role).toBe("paragraph");
  });

  it("records one rectangle per line", () => {
    const block = find(TRACEMONKEY, 2, "Nested loops can be difficult");
    // The paragraph spans 13 lines of the left column (y 622 to 502), top to bottom.
    expect(block?.lines).toHaveLength(13);
    const ys = block?.lines.map((r) => r.y) ?? [];
    expect(ys).toEqual(ys.toSorted((a, b) => b - a));
  });
});

// "Attention Is All You Need" is downloaded on first use; skipped when offline.
describe.skipIf(!hasFixture(ATTENTION, 3))("HeuristicSegmenter on a single-column paper", () => {
  it("recognizes the title and numbered section headings", () => {
    const title = blocksOf(ATTENTION, 1).find((b) => b.text === "Attention Is All You Need");
    expect(title).toMatchObject({ role: "heading", level: 1 });
    const intro = blocksOf(ATTENTION, 2).find((b) => b.text === "1 Introduction");
    expect(intro?.role).toBe("heading");
    const subsection = blocksOf(ATTENTION, 3).find(
      (b) => b.text === "3.1 Encoder and Decoder Stacks",
    );
    expect(subsection?.role).toBe("heading");
  });

  it("splits sentences around citations and inline math", () => {
    const texts = sentencesOf(ATTENTION, 3).map((s) => s.text);
    expect(texts).toContain(
      "Encoder: The encoder is composed of a stack of N = 6 identical layers.",
    );
    expect(texts).toContain("Each layer has two sub-layers.");
    expect(texts).toContain(
      "We employ a residual connection [11] around each of the two sub-layers, followed by layer normalization [1].",
    );
  });

  it("keeps a paragraph together and drops page numbers", () => {
    const blocks = blocksOf(ATTENTION, 2);
    const paragraph = blocks.find((b) => b.text.startsWith("Recurrent models typically factor"));
    expect(paragraph?.role).toBe("paragraph");
    expect(paragraph?.sentences).toHaveLength(5);
    expect(blocks.flatMap((b) => b.sentences).map((s) => s.text)).not.toContain("2");
  });
});
