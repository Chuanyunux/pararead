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
/** `sourceLanguage` setting value for per-sentence detection. */
export const AUTO_SOURCE = "auto";

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

/** Resolves the `sourceLanguage` setting: a supported code, or "auto". */
export function resolveSourceLanguage(setting: unknown): string {
  return typeof setting === "string" && languageInfo(setting) !== undefined ? setting : AUTO_SOURCE;
}

/** Frequent characters that differ between Traditional and Simplified Chinese. */
const TRADITIONAL = new Set("們這個為與說對學實體國會發點經應關時過還從間題數據結當於並產總處論圖");
const SIMPLIFIED = new Set("们这个为与说对学实体国会发点经应关时过还从间题数据结当于并产总处论图");

/** Frequent function words of the Latin-script languages. */
const STOPWORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(
    "the and of to is in that for with are this we be on by as which from it an not".split(" "),
  ),
  fr: new Set(
    "le la les des et est une dans que pour pas sur par nous du au avec sont cette qui".split(" "),
  ),
  de: new Set(
    "der die das und ist nicht mit den von zu ein eine wir auf für dem sich auch werden".split(" "),
  ),
  es: new Set(
    "el los las y es que con por una para del se como está son más este esta lo".split(" "),
  ),
  pt: new Set("o os as e é que com não uma para do da dos das em se mais são este esta".split(" ")),
  it: new Set(
    "il gli che e è di per una con del della delle degli dei sono non questo questa si nel nella alla anche".split(
      " ",
    ),
  ),
};

/** Guesses a Latin-script language from its function words; undefined when unsure. */
function detectLatinLanguage(text: string): string | undefined {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const scores = Object.entries(STOPWORDS)
    .map(([code, list]) => ({ code, hits: words.filter((w) => list.has(w)).length }))
    .toSorted((a, b) => b.hits - a.hits);
  const best = scores[0];
  const second = scores[1]?.hits ?? 0;
  if (best === undefined || best.hits <= second) {
    return undefined;
  }
  // A single hit decides only when no other language has any.
  return best.hits >= 2 || second === 0 ? best.code : undefined;
}

/**
 * Guesses the language of a sentence: by writing system for Japanese, Korean,
 * Chinese and Russian, by frequent characters for Simplified or Traditional
 * Chinese, and by function words for the Latin-script languages. Returns
 * undefined when unsure (short or mixed text).
 */
export function detectLanguage(text: string): string | undefined {
  const shares = scriptShares(text);
  if (shares.kana > 0 && shares.han + shares.kana > 0.5) {
    return "ja";
  }
  if (shares.hangul > 0.5) {
    return "ko";
  }
  if (shares.han > 0.5) {
    let traditional = 0;
    let simplified = 0;
    for (const ch of text) {
      traditional += TRADITIONAL.has(ch) ? 1 : 0;
      simplified += SIMPLIFIED.has(ch) ? 1 : 0;
    }
    return traditional > simplified ? "zh-TW" : "zh-CN";
  }
  if (shares.cyrillic > 0.5) {
    return "ru";
  }
  if (shares.latin > 0.5) {
    return detectLatinLanguage(text);
  }
  return undefined;
}

/**
 * Whether a source sentence is already in the target language, so that it
 * needs no translation (e.g. a Chinese sentence in an English paper read in
 * Chinese). Undetected sentences count as `source` when it is set explicitly
 * and written in the target's script.
 */
export function isAlreadyInLanguage(text: string, target: string, source = AUTO_SOURCE): boolean {
  const detected = detectLanguage(text);
  if (detected !== undefined) {
    return detected === target;
  }
  const info = languageInfo(target);
  return source === target && info !== undefined && scriptShares(text)[info.script] > 0.5;
}
