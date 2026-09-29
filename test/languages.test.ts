import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isAlreadyInLanguage, LANGUAGES, resolveTargetLanguage } from "../src/languages";
import { TranslationCache } from "../src/translation/cache";
import type { ChatClient, Completion } from "../src/translation/client";
import { glossaryFor, readTranslationConfig } from "../src/translation/config";
import { parseTranslations } from "../src/translation/parse";
import { buildSystemPrompt, type ChatMessage } from "../src/translation/prompt";
import { Translator } from "../src/translation/translator";

describe("resolveTargetLanguage", () => {
  it("uses an explicit supported language", () => {
    expect(resolveTargetLanguage("ja", "zh-cn")).toBe("ja");
    expect(resolveTargetLanguage("zh-TW", "en")).toBe("zh-TW");
  });

  it("follows the VS Code display language for auto", () => {
    expect(resolveTargetLanguage("auto", "zh-cn")).toBe("zh-CN");
    expect(resolveTargetLanguage("auto", "zh-tw")).toBe("zh-TW");
    expect(resolveTargetLanguage("auto", "pt-br")).toBe("pt");
    expect(resolveTargetLanguage("auto", "de")).toBe("de");
  });

  it("falls back to English for unsupported or invalid values", () => {
    expect(resolveTargetLanguage("auto", "sv")).toBe("en");
    expect(resolveTargetLanguage("klingon", "tr")).toBe("en");
    expect(resolveTargetLanguage(42, "ko")).toBe("ko");
  });
});

describe("isAlreadyInLanguage", () => {
  it("recognizes sentences written in the target script", () => {
    expect(isAlreadyInLanguage("本文提出了一种新的注意力机制。", "zh-CN")).toBe(true);
    expect(isAlreadyInLanguage("本論文では新しい手法を提案する。", "ja")).toBe(true);
    expect(isAlreadyInLanguage("우리는 새로운 방법을 제안한다.", "ko")).toBe(true);
    expect(isAlreadyInLanguage("Мы предлагаем новый метод.", "ru")).toBe(true);
  });

  it("keeps English sentences for translation into other languages", () => {
    const english = "We propose a new attention mechanism.";
    for (const target of ["zh-CN", "ja", "ko", "ru", "fr", "de"]) {
      expect(isAlreadyInLanguage(english, target)).toBe(false);
    }
    // Japanese text is not treated as Chinese, and vice versa.
    expect(isAlreadyInLanguage("本論文では新しい手法を提案する。", "zh-CN")).toBe(false);
    // A few Chinese characters in an English sentence do not count.
    expect(isAlreadyInLanguage("The model 注意力 works well on long inputs.", "zh-CN")).toBe(false);
  });

  it("treats English as already translated when the target is English", () => {
    expect(isAlreadyInLanguage("We propose a new attention mechanism.", "en")).toBe(true);
  });
});

describe("glossaryFor", () => {
  const raw = {
    attention: "注意力",
    token: "token",
    ja: { attention: "アテンション" },
    fr: "not a section",
  };

  it("merges general entries with the target language section", () => {
    expect(glossaryFor(raw, "ja")).toEqual({
      attention: "アテンション",
      token: "token",
      fr: "not a section",
    });
    expect(glossaryFor(raw, "zh-CN")).toEqual({
      attention: "注意力",
      token: "token",
      fr: "not a section",
    });
  });

  it("is read from settings together with the resolved target language", () => {
    const values: Record<string, unknown> = { targetLanguage: "auto", glossary: raw };
    const config = readTranslationConfig(
      <T>(key: string, fallback: T) => (key in values ? values[key] : fallback) as T,
      "ja",
    );
    expect(config.targetLanguage).toBe("ja");
    expect(config.glossary["attention"]).toBe("アテンション");
  });
});

describe("buildSystemPrompt", () => {
  it("names the language pair and adds the language's register note", () => {
    const ja = buildSystemPrompt({}, "ja");
    expect(ja).toContain("from English into Japanese (日本語)");
    expect(ja).toContain("である");
    expect(buildSystemPrompt({}, "zh-TW")).toContain("Traditional Chinese characters");
    expect(buildSystemPrompt({}, "fr")).toContain("into French (Français)");
    // DeepSeek JSON mode requires the word "json" in the prompt.
    for (const { code } of LANGUAGES) {
      expect(buildSystemPrompt({}, code)).toContain("json");
    }
  });

  it("rejects unsupported languages", () => {
    expect(() => buildSystemPrompt({}, "tlh")).toThrow(/Unsupported/u);
  });
});

describe("parseTranslations", () => {
  it("accepts the language-neutral field and the legacy Chinese one", () => {
    const { found } = parseTranslations(
      '{"translations":[{"id":"a","translation":"Bonjour."},{"id":"b","zh":"你好。"}]}',
      ["a", "b"],
    );
    expect([...found]).toEqual([
      ["a", "Bonjour."],
      ["b", "你好。"],
    ]);
  });
});

class EchoClient implements ChatClient {
  calls: { system: string; texts: string[] }[] = [];

  async complete(messages: ChatMessage[]): Promise<Completion> {
    const { sentences } = JSON.parse(messages[1]?.content ?? "{}") as {
      sentences: { id: string; text: string }[];
    };
    this.calls.push({ system: messages[0]?.content ?? "", texts: sentences.map((s) => s.text) });
    return {
      content: JSON.stringify({
        translations: sentences.map((s) => ({ id: s.id, translation: `T(${s.text})` })),
      }),
    };
  }
}

describe("Translator with target languages", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pararead-lang-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const base = { model: "m", glossary: {}, maxCharsPerRequest: 3000 };
  const sentences = [
    { id: "p1-b1-s1", text: "We propose a model." },
    { id: "p1-b1-s2", text: "本文的中文摘要。" },
  ];

  it("passes sentences already in the target language through without a request", async () => {
    const client = new EchoClient();
    const translator = new Translator(client, new TranslationCache(dir), {
      ...base,
      targetLanguage: "zh-CN",
    });
    const { results } = await translator.translate(sentences);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.texts).toEqual(["We propose a model."]);
    expect(results.find((r) => r.id === "p1-b1-s2")?.translation).toBe("本文的中文摘要。");
    expect(client.calls[0]?.system).toContain("into Simplified Chinese");
  });

  it("keeps translations of different target languages apart in the cache", async () => {
    const cache = new TranslationCache(dir);
    const zh = new EchoClient();
    await new Translator(zh, cache, { ...base, targetLanguage: "zh-CN" }).translate(sentences);
    const ja = new EchoClient();
    await new Translator(ja, cache, { ...base, targetLanguage: "ja" }).translate(sentences);
    // The English sentence is translated again for Japanese; the Chinese one too.
    expect(ja.calls).toHaveLength(1);
    expect(ja.calls[0]?.texts).toEqual(["We propose a model.", "本文的中文摘要。"]);
    expect(ja.calls[0]?.system).toContain("into Japanese");
  });
});
