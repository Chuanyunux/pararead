/** Supported translation languages, shared by the extension host and the webview. */

export type Script = "latin" | "cyrillic" | "han" | "kana" | "hangul";

export interface LanguageInfo {
  /** BCP 47 code used in settings and cache keys. */
  code: string;
  /** Name used in the translation prompt. */
  englishName: string;
  nativeName: string;
  /** Main writing system. Japanese is "kana" (mixed with Han). */
  script: Script;
  /** Whether sentences are separated by spaces. */
  spaced: boolean;
  /** Extra instruction for the translation prompt. */
  promptNote?: string;
}

export const LANGUAGES: readonly LanguageInfo[] = [
  {
    code: "zh-CN",
    englishName: "Simplified Chinese",
    nativeName: "简体中文",
    script: "han",
    spaced: false,
    promptNote: "Use Simplified Chinese characters and full-width Chinese punctuation.",
  },
  {
    code: "zh-TW",
    englishName: "Traditional Chinese",
    nativeName: "繁體中文",
    script: "han",
    spaced: false,
    promptNote:
      "Use Traditional Chinese characters, Taiwan terminology and full-width punctuation.",
  },
  { code: "en", englishName: "English", nativeName: "English", script: "latin", spaced: true },
  {
    code: "ja",
    englishName: "Japanese",
    nativeName: "日本語",
    script: "kana",
    spaced: false,
    promptNote: "Use the plain (である) style of Japanese academic papers.",
  },
  {
    code: "ko",
    englishName: "Korean",
    nativeName: "한국어",
    script: "hangul",
    spaced: true,
    promptNote: "Use the formal written (-다) style of Korean academic papers.",
  },
  { code: "fr", englishName: "French", nativeName: "Français", script: "latin", spaced: true },
  { code: "de", englishName: "German", nativeName: "Deutsch", script: "latin", spaced: true },
  { code: "es", englishName: "Spanish", nativeName: "Español", script: "latin", spaced: true },
  { code: "pt", englishName: "Portuguese", nativeName: "Português", script: "latin", spaced: true },
  { code: "ru", englishName: "Russian", nativeName: "Русский", script: "cyrillic", spaced: true },
  { code: "it", englishName: "Italian", nativeName: "Italiano", script: "latin", spaced: true },
];

export const DEFAULT_TARGET_LANGUAGE = "zh-CN";
/** Used for "auto" when the VS Code display language is not supported. */
export const FALLBACK_TARGET_LANGUAGE = "en";
/** Source language of the segmenter (only English for now). */
export const SOURCE_LANGUAGE = "en";

export function languageInfo(code: string): LanguageInfo | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

/**
 * Resolves the `targetLanguage` setting. "auto" follows the VS Code display
 * language (e.g. "zh-cn", "pt-br"), falling back to English.
 */
export function resolveTargetLanguage(setting: unknown, displayLanguage: string): string {
  if (typeof setting === "string" && setting !== "auto") {
    const exact = languageInfo(setting);
    if (exact !== undefined) {
      return exact.code;
    }
  }
  const ui = displayLanguage.toLowerCase();
  if (ui === "zh-tw" || ui === "zh-hk" || ui === "zh-hant") {
    return "zh-TW";
  }
  if (ui.startsWith("zh")) {
    return "zh-CN";
  }
  const base = ui.split("-")[0] ?? "";
  return languageInfo(base)?.code ?? FALLBACK_TARGET_LANGUAGE;
}

const SCRIPT_PATTERNS: Record<Script, RegExp> = {
  latin: /\p{Script=Latin}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  han: /\p{Script=Han}/u,
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
  hangul: /\p{Script=Hangul}/u,
};

/** Share of letters in `text` written in each script. */
function scriptShares(text: string): Record<Script, number> {
  const counts: Record<Script, number> = { latin: 0, cyrillic: 0, han: 0, kana: 0, hangul: 0 };
  let letters = 0;
  for (const ch of text) {
    for (const script of Object.keys(SCRIPT_PATTERNS) as Script[]) {
      if (SCRIPT_PATTERNS[script].test(ch)) {
        counts[script]++;
        letters++;
        break;
      }
    }
  }
  if (letters === 0) {
    return counts;
  }
  for (const script of Object.keys(counts) as Script[]) {
    counts[script] /= letters;
  }
  return counts;
}

/**
 * Whether a source sentence is already in the target language, so that it
 * needs no translation (e.g. a Chinese sentence in an English paper read in
 * Chinese). Decided by writing system; Latin-script targets only match the
 * source language itself.
 */
export function isAlreadyInLanguage(
  text: string,
  target: string,
  source = SOURCE_LANGUAGE,
): boolean {
  const info = languageInfo(target);
  if (info === undefined) {
    return false;
  }
  const shares = scriptShares(text);
  switch (info.script) {
    case "han":
      return shares.han > 0.5 && shares.kana === 0;
    case "kana":
      return shares.kana > 0 && shares.han + shares.kana > 0.5;
    case "hangul":
      return shares.hangul > 0.5;
    case "cyrillic":
      return shares.cyrillic > 0.5;
    case "latin":
      // Latin languages cannot be told apart by script alone.
      return target === source && shares.latin > 0.5;
  }
}
