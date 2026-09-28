/** Translation settings (`pararead.*`), independent of the VS Code API. */

import type { TranslateRange } from "../messages";

export interface TranslationConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  requestTimeoutMs: number;
  maxCharsPerRequest: number;
  /** English term → preferred Chinese rendering. */
  glossary: Record<string, string>;
  translateRange: TranslateRange;
  /** Custom cache directory; empty for the extension's global storage. */
  cacheDir: string;
  /** Extra top-level request body fields, e.g. DeepSeek's `thinking` switch. */
  extraBody: Record<string, unknown>;
  targetLanguage: string;
}

export const DEFAULT_CONFIG: TranslationConfig = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  temperature: 0.7,
  requestTimeoutMs: 60_000,
  maxCharsPerRequest: 3000,
  glossary: {},
  translateRange: "nearby",
  cacheDir: "",
  extraBody: { thinking: { type: "disabled" } },
  targetLanguage: "zh-CN",
};

type Getter = <T>(key: string, fallback: T) => T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads and sanitizes settings; invalid values fall back to the defaults. */
export function readTranslationConfig(get: Getter): TranslationConfig {
  const d = DEFAULT_CONFIG;
  const number = (key: string, fallback: number, min: number) => {
    const value = get<unknown>(key, fallback);
    return typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
  };
  const string = (key: string, fallback: string) => {
    const value = get<unknown>(key, fallback);
    return typeof value === "string" ? value.trim() : fallback;
  };

  const glossary: Record<string, string> = {};
  const rawGlossary = get<unknown>("glossary", d.glossary);
  if (isRecord(rawGlossary)) {
    for (const [term, rendering] of Object.entries(rawGlossary)) {
      if (term.trim() !== "" && typeof rendering === "string") {
        glossary[term.trim()] = rendering;
      }
    }
  }

  const range = get<unknown>("translateRange", d.translateRange);
  const extraBody = get<unknown>("extraBody", d.extraBody);

  return {
    baseUrl: string("baseUrl", d.baseUrl) || d.baseUrl,
    model: string("model", d.model) || d.model,
    temperature: Math.min(number("temperature", d.temperature, 0), 2),
    requestTimeoutMs: number("requestTimeout", d.requestTimeoutMs, 1000),
    maxCharsPerRequest: number("maxCharsPerRequest", d.maxCharsPerRequest, 200),
    glossary,
    translateRange:
      range === "page" || range === "nearby" || range === "manual" ? range : d.translateRange,
    cacheDir: string("cacheDir", d.cacheDir),
    extraBody: isRecord(extraBody) ? extraBody : d.extraBody,
    targetLanguage: d.targetLanguage,
  };
}
