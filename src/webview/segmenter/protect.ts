/**
 * Text rules for sentence splitting: which periods end a sentence, how
 * line-end hyphens and PDF-specific characters are normalized.
 */

/** Abbreviations (lower-cased, without the final period) that never end a sentence. */
const NO_SPLIT_ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "al",
  "cf",
  "vs",
  "viz",
  "resp",
  "approx",
  "w.r.t",
  "a.k.a",
  "incl",
  "fig",
  "figs",
  "eq",
  "eqs",
  "sec",
  "secs",
  "tab",
  "ref",
  "refs",
  "ch",
  "app",
  "appx",
  "alg",
  "thm",
  "lem",
  "def",
  "prop",
  "cor",
  "no",
  "nos",
  "vol",
  "pp",
  "dr",
  "mr",
  "mrs",
  "ms",
  "prof",
  "st",
  "jr",
  "sr",
  // German
  "z.b",
  "bzw",
  "usw",
  "vgl",
  "ggf",
  "bspw",
  "d.h",
  "u.a",
  "abb",
  "nr",
  "ca",
  "evtl",
  "inkl",
  "sog",
  // French (`p. ex.`, `éq.`)
  "ex",
  "éq",
  "chap",
  "env",
  // Spanish and Portuguese (`p. ej.`, `pág.`)
  "ej",
  "pág",
  "núm",
  "aprox",
  "ud",
  "uds",
  "sra",
  // Italian (`ad es.`)
  "es",
  "ecc",
  "pag",
  "sig",
  "dott",
  "cap",
  // Russian
  "т.е",
  "т.д",
  "т.п",
  "т.к",
  "рис",
  "табл",
  "см",
  "напр",
  "гл",
  "др",
  "стр",
  "ср",
  "им",
  "гг",
]);

const CLOSING_PUNCTUATION = new Set([")", "]", '"', "'", "”", "’", "»"]);

/** Chinese and Japanese characters, and CJK punctuation (full-width forms). */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\uFF00-\uFFEF]/u;

/** Whether `ch` is written without spaces between words (Chinese, Japanese). */
export function isCjkChar(ch: string | undefined): boolean {
  return ch !== undefined && CJK.test(ch);
}

/** Whether a block of text is mainly Chinese or Japanese. */
export function isCjkText(text: string): boolean {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (isCjkChar(ch)) {
      cjk++;
    } else if (/\p{L}/u.test(ch)) {
      other++;
    }
  }
  return cjk > other;
}

const CJK_TERMINATORS = new Set(["。", "！", "？", "．", "!", "?"]);
const CJK_CLOSING = new Set(["」", "』", "”", "’", "）", ")", "】", "》", "〉", '"', "'"]);

const ROMAN_NUMERAL = /^[ivxlc]+$/iu;

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/u.test(ch);
}

export function isLowercaseLetter(ch: string | undefined): boolean {
  return ch !== undefined && /\p{Ll}/u.test(ch);
}

export function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /\p{L}/u.test(ch);
}

/** Whether a line (trimmed) ends with sentence-final punctuation. */
export function endsWithTerminal(text: string): boolean {
  return /[.!?:。！？．：]["'”’)\]」』）】》]*$/u.test(text.trimEnd());
}

/**
 * Returns sentence end offsets (exclusive) in `text`. The final offset is
 * always `text.length`. Chinese and Japanese text uses its own punctuation
 * rules; other languages the rules below.
 */
export function findSentenceEnds(text: string): number[] {
  if (isCjkText(text)) {
    return findCjkSentenceEnds(text);
  }
  const ends: number[] = [];
  let sentenceStart = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "?" && ch !== "!") {
      continue;
    }

    // Absorb ellipses and closing quotes/brackets: `...`, `.)`, `."`
    let j = i + 1;
    while (j < text.length && (text[j] === "." || CLOSING_PUNCTUATION.has(text[j] ?? ""))) {
      j++;
    }
    // A boundary needs whitespace after it: rules out decimals, versions,
    // URLs, `e.g.,` and file names.
    if (j >= text.length || !isWhitespace(text[j])) {
      i = j - 1;
      continue;
    }
    let k = j;
    while (k < text.length && isWhitespace(text[k])) {
      k++;
    }
    if (k >= text.length) {
      break;
    }
    if (isLowercaseLetter(text[k])) {
      i = j - 1;
      continue;
    }
    if (ch === "." && !isSentencePeriod(text, sentenceStart, i)) {
      i = j - 1;
      continue;
    }

    ends.push(j);
    sentenceStart = k;
    i = k - 1;
  }

  ends.push(text.length);
  return ends;
}

/** Decides whether the period at `dot` ends the sentence started at `start`. */
function isSentencePeriod(text: string, start: number, dot: number): boolean {
  const before = text.slice(start, dot);
  const token = /[\p{L}\p{N}.]+$/u.exec(before)?.[0] ?? "";
  if (token === "") {
    return true;
  }
  const lower = token.toLowerCase();
  if (NO_SPLIT_ABBREVIATIONS.has(lower)) {
    return false;
  }
  // Also catch the dotted abbreviation when only its last part is matched,
  // e.g. `al` in `et al` or `g` in `e.g`.
  const lastPart = lower.split(".").at(-1) ?? "";
  if (lower.includes(".") && NO_SPLIT_ABBREVIATIONS.has(lastPart) && lastPart.length > 1) {
    return false;
  }
  // Name initials: `A. Vaswani`, `J. R. R. Tolkien`
  if (/^\p{Lu}$/u.test(token)) {
    return false;
  }
  // Two-part abbreviations such as `z. B.`, `d. h.`, `p. ex.`, `p. ej.`. A
  // single lower-case letter alone often ends a sentence (`at position t.`).
  if (/^\p{Ll}$/u.test(token) && /^\s*\p{L}{1,3}\./u.test(text.slice(dot + 1))) {
    return false;
  }
  // Enumerators at the start of a sentence: `1.`, `(a).`, `iv.`
  if (
    before.trim() === token &&
    (/^\d+$/u.test(token) || /^[a-z]$/iu.test(token) || ROMAN_NUMERAL.test(token))
  ) {
    return false;
  }
  // Caption labels: `Figure 1. Sample program ...`
  const label = /^(\p{L}+)\s+[\d.]+$/u.exec(before.trim())?.[1]?.toLowerCase();
  if (label !== undefined && CAPTION_LABELS.has(label)) {
    return false;
  }
  return true;
}

/**
 * Sentence ends in Chinese and Japanese: after 。！？ (and ．, the full-width
 * period of some Japanese papers), including closing quotes and brackets. No
 * space is needed after them.
 */
function findCjkSentenceEnds(text: string): number[] {
  const ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (!CJK_TERMINATORS.has(ch)) {
      continue;
    }
    // Half-width ! and ? only end a sentence inside Chinese/Japanese text, and
    // ． is not a decimal point (`3．2`).
    const prev = text[i - 1];
    const next = text[i + 1];
    if ((ch === "!" || ch === "?") && !isCjkChar(prev)) {
      continue;
    }
    if (ch === "．" && /\p{Nd}/u.test(prev ?? "") && /\p{Nd}/u.test(next ?? "")) {
      continue;
    }
    let j = i + 1;
    while (
      j < text.length &&
      (CJK_TERMINATORS.has(text[j] ?? "") || CJK_CLOSING.has(text[j] ?? ""))
    ) {
      j++;
    }
    if (j < text.length) {
      ends.push(j);
    }
    i = j - 1;
  }
  ends.push(text.length);
  return ends;
}

const CAPTION_LABELS = new Set([
  "figure",
  "fig",
  "table",
  "tab",
  "algorithm",
  "listing",
  "exhibit",
]);

const SPACING_ACCENTS = new Map([
  ["¨", "̈"], // diaeresis
  ["´", "́"], // acute
  ["ˊ", "́"],
  ["ˋ", "̀"], // grave (not U+0060, which is a legitimate backtick)
  ["ˆ", "̂"], // circumflex
  ["˜", "̃"], // tilde
  ["¸", "̧"], // cedilla
  ["ˇ", "̌"], // caron
]);

/**
 * Combines a spacing accent with the following letter (`na¨ıve` → `naïve`), as
 * emitted by TeX-generated PDFs. Returns the combined character, or `null` if
 * the pair does not form an accented letter.
 */
export function combineAccent(accent: string, base: string): string | null {
  const combining = SPACING_ACCENTS.get(accent);
  if (combining === undefined || !isLetter(base)) {
    return null;
  }
  const letter = base === "ı" ? "i" : base === "ȷ" ? "j" : base;
  const composed = `${letter}${combining}`.normalize("NFC");
  return composed.length === 1 ? composed : null;
}

const LIGATURES = new Map([
  ["ﬀ", "ff"],
  ["ﬁ", "fi"],
  ["ﬂ", "fl"],
  ["ﬃ", "ffi"],
  ["ﬄ", "ffl"],
  ["ﬅ", "st"],
  ["ﬆ", "st"],
]);

/** Expands typographic ligatures; other characters are returned unchanged. */
export function expandLigature(ch: string): string {
  return LIGATURES.get(ch) ?? ch;
}

const LINE_BREAK_HYPHENS = new Set(["-", "­", "‐"]);

/**
 * How to join a line ending in `prev` + `last` with a line starting with `next`:
 * - `"merge"`: a word broken across lines (`trans-` / `former`), drop the hyphen;
 * - `"keep"`: a hyphenated name (`Trace-` / `Monkey`), keep the hyphen, no space;
 * - `"join"`: Chinese or Japanese text continues without a space;
 * - `"space"`: an ordinary line break.
 */
export function lineJoin(
  prev: string | undefined,
  last: string | undefined,
  next: string | undefined,
): "merge" | "keep" | "join" | "space" {
  if (isCjkChar(last) || isCjkChar(next)) {
    return "join";
  }
  if (last === undefined || !LINE_BREAK_HYPHENS.has(last) || !isLetter(prev) || !isLetter(next)) {
    return "space";
  }
  return isLowercaseLetter(next) ? "merge" : "keep";
}
