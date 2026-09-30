import { describe, expect, it } from "vitest";

import { needsApiKey, PROVIDERS, providerFor, requestExtras } from "../src/translation/providers";

describe("translation service presets", () => {
  it("have unique ids and valid addresses without /chat/completions", () => {
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length);
    for (const { baseUrl } of PROVIDERS) {
      expect(() => new URL(baseUrl)).not.toThrow();
      expect(baseUrl).not.toMatch(/chat\/completions|\/$/u);
    }
  });

  it("are found by address, ignoring case and trailing slashes", () => {
    expect(providerFor("https://api.deepseek.com")?.id).toBe("deepseek");
    expect(providerFor("https://API.openai.com/v1/")?.id).toBe("openai");
    expect(providerFor("https://example.com/v1")).toBeUndefined();
  });

  it("need an API key unless they run locally", () => {
    for (const provider of PROVIDERS) {
      expect(needsApiKey(provider.baseUrl)).toBe(provider.local !== true);
    }
  });
});

describe("requestExtras", () => {
  it("turns off DeepSeek's thinking mode unless set explicitly", () => {
    expect(requestExtras("https://api.deepseek.com", {})).toEqual({
      thinking: { type: "disabled" },
    });
    expect(requestExtras("https://api.deepseek.com/", { thinking: { type: "enabled" } })).toEqual({
      thinking: { type: "enabled" },
    });
    expect(requestExtras("https://api.deepseek.com", { top_p: 0.9 })).toEqual({
      thinking: { type: "disabled" },
      top_p: 0.9,
    });
  });

  it("adds nothing for other services", () => {
    expect(requestExtras("https://api.openai.com/v1", {})).toEqual({});
    expect(requestExtras("http://localhost:11434/v1", { top_p: 0.9 })).toEqual({ top_p: 0.9 });
    expect(requestExtras("not a url", {})).toEqual({});
  });
});
