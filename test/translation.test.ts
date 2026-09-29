import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cacheKey, normalizeSource, TranslationCache } from "../src/translation/cache";
import {
  ApiError,
  type ChatClient,
  type Completion,
  OpenAICompatibleClient,
} from "../src/translation/client";
import { readTranslationConfig } from "../src/translation/config";
import { parseTranslations } from "../src/translation/parse";
import { buildSystemPrompt, type ChatMessage, glossaryHash } from "../src/translation/prompt";
import { Translator } from "../src/translation/translator";

/** Fake model: translates each sentence to `ZH(<text>)`, with scripted misbehaviour. */
class FakeClient implements ChatClient {
  calls: { sentences: { id: string; text: string }[] }[] = [];
  /** Per call index: drop these batch-local ids from the reply. */
  drop = new Map<number, string[]>();
  /** Per call index: reply with this raw content instead. */
  raw = new Map<number, string>();
  /** Per call index: throw this error. */
  errors = new Map<number, Error>();

  async complete(messages: ChatMessage[]): Promise<Completion> {
    const index = this.calls.length;
    const { sentences } = JSON.parse(messages[1]?.content ?? "{}") as {
      sentences: { id: string; text: string }[];
    };
    this.calls.push({ sentences });
    const error = this.errors.get(index);
    if (error !== undefined) {
      throw error;
    }
    const raw = this.raw.get(index);
    if (raw !== undefined) {
      return { content: raw };
    }
    const dropped = new Set(this.drop.get(index) ?? []);
    return {
      content: JSON.stringify({
        translations: [
          ...sentences
            .filter((s) => !dropped.has(s.id))
            .map((s) => ({ id: s.id, translation: `ZH(${s.text})` })),
          { id: "unexpected", translation: "ignored" },
        ],
      }),
      usage: { promptTokens: 100, completionTokens: 50, promptCacheHitTokens: 80 },
    };
  }
}

const options = {
  model: "deepseek-flash",
  targetLanguage: "zh-CN",
  glossary: {},
  maxCharsPerRequest: 3000,
};

const sentences = [
  { id: "p1-b1-s1", text: "We propose a model.", group: "p1-b1" },
  { id: "p1-b1-s2", text: "It works well.", group: "p1-b1" },
  { id: "p1-b2-s1", text: "Results follow.", group: "p1-b2" },
];

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pdf-bilingual-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseTranslations", () => {
  it("returns found ids, missing ids, and ignores unknown ids", () => {
    const { found, missing } = parseTranslations(
      '{"translations":[{"id":"a","zh":"甲"},{"id":"x","zh":"?"},{"id":"b","zh":"  "}]}',
      ["a", "b", "c"],
    );
    expect([...found]).toEqual([["a", "甲"]]);
    expect(missing).toEqual(["b", "c"]);
  });

  it("tolerates code fences and treats invalid JSON as all missing", () => {
    expect(
      parseTranslations('```json\n{"translations":[{"id":"a","zh":"甲"}]}\n```', ["a"]).missing,
    ).toEqual([]);
    expect(parseTranslations("not json", ["a"]).missing).toEqual(["a"]);
    expect(parseTranslations("", ["a"]).missing).toEqual(["a"]);
  });
});

describe("cache keys", () => {
  const parts = {
    text: "A  model.\n",
    model: "m",
    targetLanguage: "zh-CN",
    promptVersion: "1",
    glossaryHash: "g",
  };

  it("ignore layout whitespace but depend on model, prompt and glossary", () => {
    expect(normalizeSource(" A \n model. ")).toBe("A model.");
    expect(cacheKey(parts)).toBe(cacheKey({ ...parts, text: "A model." }));
    expect(cacheKey(parts)).not.toBe(cacheKey({ ...parts, model: "other" }));
    expect(cacheKey(parts)).not.toBe(cacheKey({ ...parts, promptVersion: "2" }));
    expect(cacheKey(parts)).not.toBe(cacheKey({ ...parts, glossaryHash: "h" }));
  });

  it("hash glossaries independently of key order", () => {
    expect(glossaryHash({ a: "1", b: "2" })).toBe(glossaryHash({ b: "2", a: "1" }));
    expect(glossaryHash({ a: "1" })).not.toBe(glossaryHash({ a: "2" }));
  });
});

describe("Translator", () => {
  it("translates, then serves a reopened document from the disk cache without API calls", async () => {
    const client = new FakeClient();
    const first = new Translator(client, new TranslationCache(dir), options);
    const streamed: string[] = [];
    const { results, failures } = await first.translate(sentences, {
      onResult: (r) => streamed.push(r.id),
    });
    expect(failures).toEqual([]);
    expect(results.find((r) => r.id === "p1-b1-s2")?.translation).toBe("ZH(It works well.)");
    expect(streamed.toSorted()).toEqual(sentences.map((s) => s.id).toSorted());
    expect(client.calls).toHaveLength(1);
    await first.flush();

    // A fresh cache instance simulates reopening VS Code.
    const again = new FakeClient();
    const second = new Translator(again, new TranslationCache(dir), options);
    const reopened = await second.translate(sentences);
    expect(again.calls).toHaveLength(0);
    expect(second.stats.cacheHits).toBe(3);
    expect(reopened.results.map((r) => r.translation)).toContain("ZH(We propose a model.)");
  });

  it("retries missing ids one by one and never caches failures", async () => {
    const client = new FakeClient();
    client.drop.set(0, ["s2"]); // first batch omits the 2nd sentence
    client.raw.set(1, "{}"); // its single retry returns nothing usable
    const cache = new TranslationCache(dir);
    const translator = new Translator(client, cache, options);
    const { results, failures } = await translator.translate(sentences);

    expect(results.map((r) => r.id).toSorted()).toEqual(["p1-b1-s1", "p1-b2-s1"]);
    expect(failures).toEqual([
      {
        id: "p1-b1-s2",
        message: "The model returned no valid translation.",
        code: "noTranslation",
        args: [],
      },
    ]);
    expect(client.calls[1]?.sentences).toEqual([{ id: "s1", text: "It works well." }]);
    expect(await cache.get(translator.keyFor("It works well."))).toBeUndefined();

    // The failed sentence is requested again next time; the others come from cache.
    const retry = await translator.translate(sentences);
    expect(retry.failures).toEqual([]);
    expect(client.calls).toHaveLength(3);
    expect(client.calls[2]?.sentences).toEqual([{ id: "s1", text: "It works well." }]);
  });

  it("falls back to single requests after a transient batch error", async () => {
    const client = new FakeClient();
    client.errors.set(0, new ApiError("http", [503, "overloaded"], 503, true));
    const translator = new Translator(client, new TranslationCache(dir), options);
    const { failures } = await translator.translate(sentences);
    expect(failures).toEqual([]);
    expect(client.calls.map((c) => c.sentences.length)).toEqual([3, 1, 1, 1]);
  });

  it("does not retry fatal errors such as an invalid key", async () => {
    const client = new FakeClient();
    client.errors.set(0, new ApiError("unauthorized", [], 401, false));
    const translator = new Translator(client, new TranslationCache(dir), options);
    const { failures } = await translator.translate(sentences);
    expect(failures).toHaveLength(3);
    expect(client.calls).toHaveLength(1);
  });

  it("keeps paragraphs together and respects the character budget", async () => {
    const client = new FakeClient();
    const translator = new Translator(client, new TranslationCache(dir), {
      ...options,
      maxCharsPerRequest: 40,
    });
    await translator.translate(sentences);
    // "We propose a model." + "It works well." (33 chars) fit; the next paragraph does not.
    expect(client.calls.map((c) => c.sentences.map((s) => s.text))).toEqual([
      ["We propose a model.", "It works well."],
      ["Results follow."],
    ]);
  });

  it("translates duplicate sentences once and deduplicates concurrent requests", async () => {
    const client = new FakeClient();
    const translator = new Translator(client, new TranslationCache(dir), options);
    const dup = [
      { id: "p1-b1-s1", text: "Same." },
      { id: "p2-b1-s1", text: "Same." },
    ];
    const [a, b] = await Promise.all([translator.translate(dup), translator.translate(dup)]);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sentences).toHaveLength(1);
    expect(a.results).toHaveLength(2);
    expect(b.results).toHaveLength(2);
  });

  it("writes cache shards to its own directory only", async () => {
    const translator = new Translator(new FakeClient(), new TranslationCache(dir), options);
    await translator.translate(sentences);
    await translator.flush();
    const files = await readdir(dir);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => /^[0-9a-f]{2}\.json$/u.test(f))).toBe(true);
  });
});

describe("OpenAICompatibleClient", () => {
  function fakeFetch(responses: (() => Response)[]) {
    const requests: {
      url: string;
      body: Record<string, unknown>;
      headers: Record<string, string>;
    }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      requests.push({
        url,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
        headers: init.headers as Record<string, string>,
      });
      const next = responses.shift();
      if (next === undefined) {
        throw new Error("no more responses");
      }
      return next();
    }) as typeof globalThis.fetch;
    return { fetch, requests };
  }

  const clientOptions = {
    baseUrl: "https://api.deepseek.com/",
    apiKey: "sk-test",
    model: "deepseek-flash",
    temperature: 0.7,
    timeoutMs: 5000,
    extraBody: { thinking: { type: "disabled" } },
    retryDelayMs: 1,
  };

  it("sends a JSON-mode request with thinking disabled and reads usage", async () => {
    const { fetch, requests } = fakeFetch([
      () =>
        Response.json({
          choices: [{ message: { content: '{"translations":[]}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 8 },
        }),
    ]);
    const client = new OpenAICompatibleClient({ ...clientOptions, fetch });
    const result = await client.complete([{ role: "user", content: "json" }], { maxTokens: 100 });

    expect(requests[0]?.url).toBe("https://api.deepseek.com/chat/completions");
    expect(requests[0]?.headers["authorization"]).toBe("Bearer sk-test");
    expect(requests[0]?.body).toMatchObject({
      model: "deepseek-flash",
      temperature: 0.7,
      max_tokens: 100,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
    expect(result).toEqual({
      content: '{"translations":[]}',
      usage: { promptTokens: 10, completionTokens: 5, promptCacheHitTokens: 8 },
    });
  });

  it("retries 429 and 503, but not 401", async () => {
    const ok = () => Response.json({ choices: [{ message: { content: "{}" } }] });
    const { fetch, requests } = fakeFetch([
      () => new Response("busy", { status: 429 }),
      () => new Response("overloaded", { status: 503 }),
      ok,
    ]);
    const retried: number[] = [];
    const client = new OpenAICompatibleClient({
      ...clientOptions,
      fetch,
      onRetry: (attempt) => retried.push(attempt),
    });
    await expect(client.complete([], { maxTokens: 10 })).resolves.toEqual({ content: "{}" });
    expect(requests).toHaveLength(3);
    expect(retried).toEqual([1, 2]);

    const unauthorized = fakeFetch([() => new Response("bad key", { status: 401 })]);
    const failing = new OpenAICompatibleClient({ ...clientOptions, fetch: unauthorized.fetch });
    await expect(failing.complete([], { maxTokens: 10 })).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
      retryable: false,
    });
    expect(unauthorized.requests).toHaveLength(1);
  });

  it("omits the authorization header without a key (e.g. Ollama)", async () => {
    const { fetch, requests } = fakeFetch([
      () => Response.json({ choices: [{ message: { content: "{}" } }] }),
    ]);
    const client = new OpenAICompatibleClient({ ...clientOptions, apiKey: "", fetch });
    await client.complete([], { maxTokens: 10 });
    expect(requests[0]?.headers["authorization"]).toBeUndefined();
  });
});

describe("prompt and config", () => {
  it("adds the glossary to the system prompt deterministically", () => {
    const prompt = buildSystemPrompt({ token: "token", attention: "注意力" }, "zh-CN");
    // DeepSeek JSON mode requires the word "json" in the prompt.
    expect(prompt).toContain("json");
    expect(prompt.indexOf("- attention → 注意力")).toBeLessThan(prompt.indexOf("- token → token"));
    expect(buildSystemPrompt({ attention: "注意力", token: "token" }, "zh-CN")).toBe(prompt);
  });

  it("sanitizes settings", () => {
    const values: Record<string, unknown> = {
      temperature: 9,
      maxCharsPerRequest: -1,
      translateRange: "everything",
      glossary: { attention: "注意力", bad: 3 },
      extraBody: "nope",
    };
    const config = readTranslationConfig(
      <T>(key: string, fallback: T) => (key in values ? values[key] : fallback) as T,
    );
    expect(config.temperature).toBe(2);
    expect(config.maxCharsPerRequest).toBe(3000);
    expect(config.translateRange).toBe("nearby");
    expect(config.glossary).toEqual({ attention: "注意力" });
    expect(config.extraBody).toEqual({ thinking: { type: "disabled" } });
    expect(config.model).toBe("deepseek-flash");
  });
});
