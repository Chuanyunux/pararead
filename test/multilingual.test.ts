// Papers in languages other than English, tested with synthetic text: no
// paper text is committed.

import { describe, expect, it } from "vitest";

import { detectLanguage, isAlreadyInLanguage } from "../src/languages";
import { buildSystemPrompt } from "../src/translation/prompt";
import { HeuristicSegmenter } from "../src/webview/segmenter/heuristic";
import { findSentenceEnds, lineJoin } from "../src/webview/segmenter/protect";
import type { PageTextInput, TextItemInput } from "../src/webview/segmenter/types";

function split(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const end of findSentenceEnds(text)) {
    out.push(text.slice(start, end).trim());
    start = end;
  }
  return out;
}

describe("sentence splitting", () => {
  it("splits Chinese on full-width terminators, without spaces", () => {
    expect(split("本文提出了一种新模型。实验表明它更快！是否适用于其他任务？")).toEqual([
      "本文提出了一种新模型。",
      "实验表明它更快！",
      "是否适用于其他任务？",
    ]);
  });

  it("keeps closing brackets and quotes with the Chinese sentence", () => {
    expect(split("我们称之为「注意力」。（见图１。）结果如下。")).toEqual([
      "我们称之为「注意力」。",
      "（见图１。）",
      "结果如下。",
    ]);
  });

  it("does not split full-width decimals", () => {
    expect(split("准确率为９３．５％。下一句。")).toEqual(["准确率为９３．５％。", "下一句。"]);
  });

  it("splits Japanese", () => {
    expect(split("本論文では新しい手法を提案する。実験により有効性を示す。")).toEqual([
      "本論文では新しい手法を提案する。",
      "実験により有効性を示す。",
    ]);
  });

  it("splits Korean, which uses spaces and Western punctuation", () => {
    expect(split("우리는 새로운 방법을 제안한다. 실험 결과는 다음과 같다.")).toEqual([
      "우리는 새로운 방법을 제안한다.",
      "실험 결과는 다음과 같다.",
    ]);
  });

  it("splits Russian and keeps its abbreviations", () => {
    expect(split("Мы предлагаем новый метод, см. рис. 3. Он работает быстро.")).toEqual([
      "Мы предлагаем новый метод, см. рис. 3.",
      "Он работает быстро.",
    ]);
  });

  it("keeps German and French abbreviations", () => {
    expect(split("Wir nutzen z. B. Transformer, vgl. Abschnitt 2. Das Modell lernt.")).toEqual([
      "Wir nutzen z. B. Transformer, vgl. Abschnitt 2.",
      "Das Modell lernt.",
    ]);
    expect(split("Nous utilisons p. ex. des modèles. Les résultats sont bons.")).toEqual([
      "Nous utilisons p. ex. des modèles.",
      "Les résultats sont bons.",
    ]);
  });
});

describe("lineJoin", () => {
  it("joins Chinese and Japanese lines without a space", () => {
    expect(lineJoin("模", "型", "的")).toBe("join");
    expect(lineJoin("す", "る", "。")).toBe("join");
  });
});

/** One text item per line, laid out top-down like a single-column page. */
function page(lines: { str: string; size?: number; gap?: number }[]): PageTextInput {
  const items: TextItemInput[] = [];
  let y = 780;
  for (const { str, size = 10, gap = 0 } of lines) {
    y -= size * 1.5 + gap;
    items.push({
      str,
      transform: [size, 0, 0, size, 72, y],
      width: [...str].length * size,
      height: size,
      fontName: size > 10 ? "g_bold" : "g_body",
      hasEOL: true,
    });
  }
  return {
    page: 1,
    view: [0, 0, 595, 842],
    items,
    styles: { g_bold: { fontFamily: "serif" }, g_body: { fontFamily: "serif" } },
  };
}

describe("HeuristicSegmenter on Chinese text", () => {
  const blocks = new HeuristicSegmenter().segmentPage(
    page([
      { str: "1 引言", size: 14, gap: 10 },
      { str: "本文提出了一种新的注意力机制，它能够", gap: 6 },
      { str: "处理长序列。实验表明该方法在多个数据" },
      { str: "集上优于基线。" },
      { str: "图 1：模型的整体结构。", gap: 12 },
    ]),
  ).blocks;

  it("joins lines without spaces and splits sentences", () => {
    const sentences = blocks.flatMap((b) => b.sentences.map((s) => s.text));
    expect(sentences).toContain("本文提出了一种新的注意力机制，它能够处理长序列。");
    expect(sentences).toContain("实验表明该方法在多个数据集上优于基线。");
  });

  it("recognizes numbered headings and captions", () => {
    expect(blocks.find((b) => b.text === "1 引言")?.role).toBe("heading");
    expect(blocks.find((b) => b.text.startsWith("图 1"))?.role).toBe("caption");
  });
});

describe("detectLanguage", () => {
  it("tells languages apart by script", () => {
    expect(detectLanguage("本文提出了一种新的注意力机制。")).toBe("zh-CN");
    expect(detectLanguage("本文提出了一種新的注意力機制，這個方法對長序列有效。")).toBe("zh-TW");
    expect(detectLanguage("本論文では新しい手法を提案する。")).toBe("ja");
    expect(detectLanguage("우리는 새로운 방법을 제안한다.")).toBe("ko");
    expect(detectLanguage("Мы предлагаем новый метод.")).toBe("ru");
  });

  it("tells Latin-script languages apart by function words", () => {
    expect(detectLanguage("We propose a new model for the translation of papers.")).toBe("en");
    expect(
      detectLanguage("Nous proposons un nouveau modèle pour la traduction des articles."),
    ).toBe("fr");
    expect(detectLanguage("Wir schlagen ein neues Modell für die Übersetzung vor.")).toBe("de");
    expect(detectLanguage("Proponemos un modelo nuevo para la traducción de los artículos.")).toBe(
      "es",
    );
    expect(detectLanguage("Propomos um novo modelo para a tradução dos artigos.")).toBe("pt");
    expect(detectLanguage("Proponiamo un nuovo modello per la traduzione degli articoli.")).toBe(
      "it",
    );
  });

  it("is unsure about short or mixed text", () => {
    expect(detectLanguage("Table 3")).toBeUndefined();
    expect(detectLanguage("BLEU 28.4")).toBeUndefined();
    expect(detectLanguage("")).toBeUndefined();
  });
});

describe("isAlreadyInLanguage with other source languages", () => {
  it("translates between Simplified and Traditional Chinese", () => {
    expect(isAlreadyInLanguage("這個方法對長序列有效。", "zh-CN")).toBe(false);
    expect(isAlreadyInLanguage("這個方法對長序列有效。", "zh-TW")).toBe(true);
  });

  it("skips sentences already in a Latin-script target", () => {
    expect(isAlreadyInLanguage("Nous proposons un modèle pour la traduction.", "fr")).toBe(true);
    expect(isAlreadyInLanguage("Nous proposons un modèle pour la traduction.", "en")).toBe(false);
  });

  it("uses an explicit source language for undetected sentences", () => {
    expect(isAlreadyInLanguage("Table 3", "en")).toBe(false);
    expect(isAlreadyInLanguage("Table 3", "en", "en")).toBe(true);
    expect(isAlreadyInLanguage("Table 3", "en", "fr")).toBe(false);
  });
});

describe("buildSystemPrompt with a source language", () => {
  it("names the source language, or leaves it open", () => {
    expect(buildSystemPrompt({}, "en", "zh-CN")).toContain(
      "from Simplified Chinese (简体中文) into English",
    );
    expect(buildSystemPrompt({}, "en")).toContain("from its source language into English");
    expect(() => buildSystemPrompt({}, "en", "tlh")).toThrow(/Unsupported/u);
  });
});
