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
]);

const CLOSING_PUNCTUATION = new Set([")", "]", '"', "'", "”", "’"]);

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
  return /[.!?:]["'”’)\]]*$/u.test(text.trimEnd());
}

/**
 * Returns sentence end offsets (exclusive) in `text`. The final offset is
 * always `text.length`.
 */
export function findSentenceEnds(text: string): number[] {
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
 * - `"space"`: an ordinary line break.
 */
export function lineJoin(
  prev: string | undefined,
  last: string | undefined,
  next: string | undefined,
): "merge" | "keep" | "space" {
  if (last === undefined || !LINE_BREAK_HYPHENS.has(last) || !isLetter(prev) || !isLetter(next)) {
    return "space";
  }
  return isLowercaseLetter(next) ? "merge" : "keep";
}
