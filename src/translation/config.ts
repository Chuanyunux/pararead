/** Translation settings (`pararead.*`), independent of the VS Code API. */

import {
  AUTO_SOURCE,
  DEFAULT_TARGET_LANGUAGE,
  languageInfo,
  resolveSourceLanguage,
  resolveTargetLanguage,
} from "../languages";
import type { TranslateRange } from "../messages";

export interface TranslationConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  requestTimeoutMs: number;
  maxCharsPerRequest: number;
  /** Source term → preferred rendering in the target language. */
  glossary: Record<string, string>;
  translateRange: TranslateRange;
  /** Custom cache directory; empty for the extension's global storage. */
  cacheDir: string;
  /** Extra top-level request body fields, e.g. DeepSeek's `thinking` switch. */
  extraBody: Record<string, unknown>;
  /** Resolved language code (never "auto"). */
  targetLanguage: string;
  /** Whether `targetLanguage` was derived from the VS Code display language. */
  targetLanguageIsAuto: boolean;
  /** Language code of the papers, or "auto" to detect it per sentence. */
  sourceLanguage: string;
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
  targetLanguage: DEFAULT_TARGET_LANGUAGE,
  targetLanguageIsAuto: true,
  sourceLanguage: AUTO_SOURCE,
};

type Getter = <T>(key: string, fallback: T) => T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The glossary for one target language. Flat `term: rendering` entries apply
 * to every language; entries under a language code (`{"ja": {...}}`) apply to
 * that language only and take precedence.
 */
export function glossaryFor(raw: unknown, targetLanguage: string): Record<string, string> {
  const glossary: Record<string, string> = {};
  if (!isRecord(raw)) {
    return glossary;
  }
  const add = (entries: Record<string, unknown>) => {
    for (const [term, rendering] of Object.entries(entries)) {
      if (term.trim() !== "" && typeof rendering === "string") {
        glossary[term.trim()] = rendering;
      }
    }
  };
  add(raw);
  const specific = raw[targetLanguage];
  if (isRecord(specific) && languageInfo(targetLanguage) !== undefined) {
    add(specific);
  }
  return glossary;
}

/**
 * Reads and sanitizes settings; invalid values fall back to the defaults.
 * `displayLanguage` is VS Code's UI language, used for `targetLanguage: "auto"`.
 */
export function readTranslationConfig(get: Getter, displayLanguage = "en"): TranslationConfig {
  const d = DEFAULT_CONFIG;
  const number = (key: string, fallback: number, min: number) => {
    const value = get<unknown>(key, fallback);
    return typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
  };
  const string = (key: string, fallback: string) => {
    const value = get<unknown>(key, fallback);
    return typeof value === "string" ? value.trim() : fallback;
  };

  const targetSetting = get<unknown>("targetLanguage", "auto");
  const targetLanguage = resolveTargetLanguage(targetSetting, displayLanguage);
  const glossary = glossaryFor(get<unknown>("glossary", d.glossary), targetLanguage);

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
    targetLanguage,
    targetLanguageIsAuto:
      typeof targetSetting !== "string" || languageInfo(targetSetting) === undefined,
    sourceLanguage: resolveSourceLanguage(get<unknown>("sourceLanguage", d.sourceLanguage)),
  };
}
