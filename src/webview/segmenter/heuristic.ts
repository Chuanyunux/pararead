/**
 * Heuristic segmenter: text items → lines → blocks (paragraphs) → sentences.
 *
 * Relies on the content-stream order of text items, which for TeX and most
 * other producers is reading order (column by column), and uses geometry only
 * to find line and paragraph breaks.
 */

import {
  combineAccent,
  endsWithTerminal,
  expandLigature,
  findSentenceEnds,
  isLetter,
  isCjkChar,
  isLowercaseLetter,
  lineJoin,
} from "./protect";
import type {
  Block,
  BlockRole,
  PageSegmentation,
  PageTextInput,
  Rect,
  Segmenter,
  Sentence,
  TextItemInput,
} from "./types";

interface Fragment {
  /** Index of the text item (== text layer span index). */
  index: number;
  str: string;
  x: number;
  /** Baseline. */
  y: number;
  w: number;
  size: number;
  mono: boolean;
  blank: boolean;
}

interface Line {
  frags: Fragment[];
  x0: number;
  x1: number;
  y: number;
  size: number;
  mono: boolean;
  text: string;
}

interface Glyph {
  ch: string;
  /** Text item index, or -1 for synthesized separators. */
  item: number;
  /** Character offset inside the item. */
  off: number;
  /** Index of the line inside the block. */
  line: number;
}

/** Relative tolerances, in units of font size. */
const SAME_LINE_BASELINE = 0.5;
const WORD_GAP = 0.15;
const MAX_INLINE_GAP = 2.5;
const PARAGRAPH_GAP_NO_PITCH = 1.55;
const PARAGRAPH_GAP_OVER_PITCH = 0.4;
const INDENT = 0.6;
const SHORT_LINE = 2.5;
const SIZE_CHANGE = 0.15;
const CODE_LINE_MONO_RATIO = 0.8;

export class HeuristicSegmenter implements Segmenter {
  segmentPage(input: PageTextInput): PageSegmentation {
    const frags = toFragments(input);
    const lines = groupLines(frags);
    const blockLines = groupBlocks(lines);
    const bodySize = dominantSize(lines);

    const blocks: Block[] = [];
    for (const [i, group] of blockLines.entries()) {
      const id = `p${input.page}-b${i + 1}`;
      const mono = group.filter((l) => l.mono).length * 2 > group.length;
      const glyphs = buildGlyphs(group);
      const { text, starts } = glyphText(glyphs);
      const lineRects = group.map(lineRect);
      if (mono) {
        blocks.push({
          id,
          page: input.page,
          kind: "code",
          role: "code",
          // Code keeps its line breaks.
          text: group.map((line) => glyphText(buildGlyphs([line])).text).join("\n"),
          sentences: [],
          lines: lineRects,
        });
        continue;
      }
      const sentences = splitSentences(input, id, group, glyphs, text, starts);
      const { role, level } = classify(group, text, bodySize);
      blocks.push({
        id,
        page: input.page,
        kind: "text",
        role,
        ...(level === undefined ? {} : { level }),
        text,
        sentences,
        lines: lineRects,
      });
    }
    return { page: input.page, blocks };
  }
}

function lineRect(line: Line): Rect {
  return { x: line.x0, y: line.y - 0.25 * line.size, w: line.x1 - line.x0, h: 1.2 * line.size };
}

/** Font size carrying the most characters on the page: the body text size. */
function dominantSize(lines: Line[]): number {
  const chars = new Map<number, number>();
  for (const line of lines) {
    if (!line.mono) {
      const size = Math.round(line.size * 2) / 2;
      chars.set(size, (chars.get(size) ?? 0) + line.text.length);
    }
  }
  let best = 0;
  let bestChars = -1;
  for (const [size, count] of chars) {
    if (count > bestChars) {
      best = size;
      bestChars = count;
    }
  }
  return best || 10;
}

const LIST_MARKER =
  /^(?:(?:[•◦▪‣∙·∗*–—-]|\(?\d{1,2}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}[.)])\s|[①-⑳・]|（\d{1,2}）|[一二三四五六七八九十]+、)/u;
/** `3.1 Method`, `A.2 Proofs`, `1 引言`, `第2章`. */
const SECTION_NUMBER =
  /^(?:(?:\d+(?:\.\d+)*\.?|[A-Z](?:\.\d+)*\.?)(?:\s+\p{Lu}|\s*\p{Lo})|第[\d一二三四五六七八九十]+[章节節])/u;
const HEADING_MAX_CHARS = 90;
const FIGURE_MAX_CHARS = 60;

/** Assigns a layout role from font size, line count, punctuation and markers. */
function classify(
  lines: Line[],
  text: string,
  bodySize: number,
): { role: BlockRole; level?: number } {
  const size = lines[0]?.size ?? bodySize;
  const first = lines[0]?.text ?? "";
  const small = size < bodySize * 0.88;
  const large = size > bodySize * (1 + SIZE_CHANGE);

  if (CAPTION.test(first)) {
    return { role: "caption" };
  }
  // Short small text, or tiny text of any length (footnotes are ~80% of the
  // body size, diagram labels much smaller).
  if (small && (text.length <= FIGURE_MAX_CHARS || size < bodySize * 0.7)) {
    return { role: "figure" };
  }
  const headingLike =
    lines.length <= 2 &&
    text.length <= HEADING_MAX_CHARS &&
    !/[.,;!?。，；！？．]["'”’)\]」』）]*$/u.test(text) &&
    // Upper case, digits, or scripts without case (Chinese, Japanese, Korean).
    /^[\p{Lu}\p{Lo}\d]/u.test(text);
  if (headingLike && (large || SECTION_NUMBER.test(text) || lines.length === 1)) {
    const level = size >= bodySize * 1.35 ? 1 : large ? 2 : 3;
    return { role: "heading", level };
  }
  if (LIST_MARKER.test(first)) {
    return { role: "list" };
  }
  if (small) {
    return { role: "note" };
  }
  return { role: "paragraph" };
}

function toFragments({ items, styles, view }: PageTextInput): Fragment[] {
  const [vx0 = 0, vy0 = 0, vx1 = Infinity, vy1 = Infinity] = view;
  const frags: Fragment[] = [];
  for (const [index, item] of items.entries()) {
    if (item.str === "" || !isHorizontal(item)) {
      continue;
    }
    const [, , c = 0, d = 0, x = 0, y = 0] = item.transform;
    if (x < vx0 - 1 || x > vx1 + 1 || y < vy0 - 1 || y > vy1 + 1) {
      continue;
    }
    frags.push({
      index,
      str: item.str,
      x,
      y,
      w: item.width,
      size: Math.hypot(c, d) || item.height || 1,
      mono: styles[item.fontName]?.fontFamily === "monospace",
      blank: item.str.trim() === "",
    });
  }
  return frags;
}

function isHorizontal(item: TextItemInput): boolean {
  const [a = 0, b = 0, c = 0] = item.transform;
  // Rotated text (e.g. the arXiv side stamp) is not part of the body text.
  return a > 0 && Math.abs(b) <= 1e-3 * a && Math.abs(c) <= 1e-3 * a;
}

function groupLines(frags: Fragment[]): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;

  for (const frag of frags) {
    if (current !== null && continuesLine(current, frag)) {
      current.frags.push(frag);
      if (!frag.blank) {
        current.x1 = Math.max(current.x1, frag.x + frag.w);
        // Keep the baseline of the largest text so that a leading superscript
        // does not define the line.
        if (frag.size > current.size * (1 + SIZE_CHANGE)) {
          current.y = frag.y;
          current.size = frag.size;
        }
      }
      continue;
    }
    if (frag.blank) {
      continue;
    }
    current = {
      frags: [frag],
      x0: frag.x,
      x1: frag.x + frag.w,
      y: frag.y,
      size: frag.size,
      mono: false,
      text: "",
    };
    lines.push(current);
  }

  for (const line of lines) {
    let monoChars = 0;
    let chars = 0;
    for (const frag of line.frags) {
      if (!frag.blank) {
        chars += frag.str.length;
        monoChars += frag.mono ? frag.str.length : 0;
      }
    }
    // Mostly-monospace lines only: prose lines often contain inline code.
    line.mono = monoChars >= CODE_LINE_MONO_RATIO * chars;
    line.text = line.frags
      .map((f) => f.str)
      .join("")
      .trim();
  }
  return lines;
}

function continuesLine(line: Line, frag: Fragment): boolean {
  const size = Math.max(line.size, frag.size);
  if (Math.abs(frag.y - line.y) > SAME_LINE_BASELINE * size) {
    return false;
  }
  // Going backwards means a new line or column; a large forward gap means a
  // separate column or table cell.
  return frag.x >= line.x1 - size && frag.x - line.x1 <= MAX_INLINE_GAP * size;
}

interface BlockState {
  lines: Line[];
  size: number;
  mono: boolean;
  /** Left edge of the body lines (second line onward). */
  left: number;
  right: number;
  pitch: number | null;
}

function groupBlocks(lines: Line[]): Line[][] {
  const groups: Line[][] = [];
  let block: BlockState | null = null;

  for (const line of lines) {
    if (block !== null && continuesBlock(block, line)) {
      const prev = block.lines.at(-1);
      if (prev !== undefined && block.pitch === null && prev.y > line.y) {
        block.pitch = prev.y - line.y;
      }
      if (block.lines.length === 1) {
        block.left = line.x0;
      }
      block.lines.push(line);
      block.right = Math.max(block.right, line.x1);
      continue;
    }
    block = {
      lines: [line],
      size: line.size,
      mono: line.mono,
      left: line.x0,
      right: line.x1,
      pitch: null,
    };
    groups.push(block.lines);
  }
  return mergeAcrossFloats(groups);
}

/** How many blocks ahead to look for the continuation of a paragraph. */
const FLOAT_LOOKAHEAD = 30;

const CAPTION =
  /^(?:Figure|Fig\.|Table|Algorithm|Listing|Abbildung|Abb\.|Tabelle|Tableau|Figura|Tabla|Tabela|Tabella|Рис\.|Рисунок|Таблица|图|表|図|그림|표)\s*\d/u;

/** Whether a line can continue a sentence from a previous line or column. */
function continuesSentence(first: string | undefined): boolean {
  return isLowercaseLetter(first) || isCjkChar(first);
}

/**
 * Re-joins a paragraph that was interrupted by a float (figure, table, code
 * listing) placed between its two halves in the content stream.
 */
function mergeAcrossFloats(groups: Line[][]): Line[][] {
  const width = (group: Line[]) => Math.max(...group.map((l) => l.x1 - l.x0));
  // Body text: multi-line, same font size and about as wide as the paragraph
  // being continued (figure labels are narrow).
  const isBody = (group: Line[], size: number, minWidth: number) =>
    group.length >= 2 &&
    !group[0]?.mono &&
    Math.abs((group[0]?.size ?? 0) - size) <= SIZE_CHANGE * size &&
    width(group) >= minWidth;

  for (let i = 0; i < groups.length; i++) {
    const head = groups[i];
    const last = head?.at(-1);
    if (head === undefined || last === undefined || endsWithTerminal(last.text)) {
      continue;
    }
    const minWidth = 0.7 * width(head);
    if (!isBody(head, last.size, minWidth)) {
      continue;
    }
    for (let j = i + 1; j < Math.min(groups.length, i + 1 + FLOAT_LOOKAHEAD); j++) {
      const candidate = groups[j];
      if (
        candidate === undefined ||
        !isBody(candidate, last.size, minWidth) ||
        CAPTION.test(candidate[0]?.text ?? "")
      ) {
        continue;
      }
      if (continuesSentence(candidate[0]?.text[0])) {
        head.push(...candidate);
        groups.splice(j, 1);
      }
      // Either merged or another body paragraph intervenes: stop looking.
      break;
    }
  }
  return groups;
}

function continuesBlock(block: BlockState, line: Line): boolean {
  const prev = block.lines.at(-1);
  if (prev === undefined) {
    return false;
  }
  const size = block.size;

  if (line.mono !== block.mono) {
    return false;
  }
  if (Math.abs(line.size - size) > SIZE_CHANGE * size) {
    return false;
  }

  const dy = prev.y - line.y;
  const newColumn = dy < -SAME_LINE_BASELINE * size || line.x0 > prev.x1 + size;
  if (newColumn) {
    // A paragraph continued at the top of the next column.
    return !endsWithTerminal(prev.text) && continuesSentence(line.text[0]);
  }

  const maxGap =
    block.pitch === null
      ? PARAGRAPH_GAP_NO_PITCH * size
      : block.pitch + PARAGRAPH_GAP_OVER_PITCH * size;
  if (dy > maxGap) {
    return false;
  }

  if (block.lines.length >= 2) {
    // Indented first line of a new paragraph, or an outdented new list item.
    if (Math.abs(line.x0 - block.left) > INDENT * size) {
      return false;
    }
    // A short previous line ending a sentence closes the paragraph.
    if (prev.x1 < block.right - SHORT_LINE * size && endsWithTerminal(prev.text)) {
      return false;
    }
  }
  return true;
}

/** Flattens the lines of a block into glyphs, joining lines and fixing PDF artifacts. */
function buildGlyphs(lines: Line[]): Glyph[] {
  const glyphs: Glyph[] = [];
  const push = (glyph: Glyph) => {
    if (/\s/u.test(glyph.ch)) {
      const last = glyphs.at(-1);
      if (last === undefined || /\s/u.test(last.ch)) {
        return;
      }
      glyphs.push({ ...glyph, ch: " " });
      return;
    }
    glyphs.push(glyph);
  };

  for (const [lineIndex, line] of lines.entries()) {
    if (lineIndex > 0) {
      joinLines(glyphs, line, lineIndex);
    }
    let prev: Fragment | null = null;
    for (const frag of line.frags) {
      if (prev !== null && !prev.blank && !frag.blank) {
        const gap = frag.x - (prev.x + prev.w);
        // Chinese and Japanese characters are not separated by spaces.
        const cjk = isCjkChar(prev.str.at(-1)) && isCjkChar(frag.str[0]);
        if (!cjk && gap > WORD_GAP * Math.max(prev.size, frag.size)) {
          push({ ch: " ", item: -1, off: 0, line: lineIndex });
        }
      }
      for (let off = 0; off < frag.str.length; off++) {
        push({ ch: frag.str[off] ?? "", item: frag.index, off, line: lineIndex });
      }
      prev = frag;
    }
  }

  while (glyphs.length > 0 && glyphs.at(-1)?.ch === " ") {
    glyphs.pop();
  }
  combineAccents(glyphs);
  for (const glyph of glyphs) {
    glyph.ch = expandLigature(glyph.ch);
  }
  return glyphs;
}

/** Inserts the separator between the glyphs so far and `next` line. */
function joinLines(glyphs: Glyph[], next: Line, lineIndex: number): void {
  while (glyphs.length > 0 && glyphs.at(-1)?.ch === " ") {
    glyphs.pop();
  }
  switch (lineJoin(glyphs.at(-2)?.ch, glyphs.at(-1)?.ch, next.text[0])) {
    case "merge":
      glyphs.pop();
      return;
    case "keep":
    case "join":
      return;
    case "space":
      glyphs.push({ ch: " ", item: -1, off: 0, line: lineIndex });
  }
}

function combineAccents(glyphs: Glyph[]): void {
  for (let i = 0; i < glyphs.length - 1; i++) {
    const accent = glyphs[i];
    let j = i + 1;
    if (glyphs[j]?.ch === " ") {
      j++;
    }
    const base = glyphs[j];
    if (accent === undefined || base === undefined) {
      continue;
    }
    const prev = glyphs[i - 1];
    if (prev !== undefined && !isLetter(prev.ch) && prev.ch !== " ") {
      continue;
    }
    const combined = combineAccent(accent.ch, base.ch);
    if (combined !== null) {
      base.ch = combined;
      glyphs.splice(i, j - i);
    }
  }
}

function glyphText(glyphs: Glyph[]): { text: string; starts: number[] } {
  const starts: number[] = [];
  let text = "";
  for (const glyph of glyphs) {
    starts.push(text.length);
    text += glyph.ch;
  }
  return { text, starts };
}

/** Index of the glyph containing text offset `pos`. */
function glyphAt(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= pos) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

function splitSentences(
  input: PageTextInput,
  blockId: string,
  lines: Line[],
  glyphs: Glyph[],
  text: string,
  starts: number[],
): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  for (const end of findSentenceEnds(text)) {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const sentenceText = raw.trim();
    const s = start + lead;
    start = end;
    // Page numbers, stray symbols and text in fonts without a usable encoding
    // (chart labels often come out as `?>9@AJ.D<F@`) are not sentences.
    if (!/\p{L}/u.test(sentenceText) || isGarbled(sentenceText)) {
      continue;
    }
    const g0 = glyphAt(starts, s);
    const g1 = glyphAt(starts, s + sentenceText.length - 1);
    const range = glyphs.slice(g0, g1 + 1).filter((g) => g.item >= 0);
    const first = range[0];
    const last = range.at(-1);
    if (first === undefined || last === undefined) {
      continue;
    }
    sentences.push({
      id: `${blockId}-s${sentences.length + 1}`,
      page: input.page,
      blockId,
      text: sentenceText,
      spanRange: {
        startSpan: first.item,
        startChar: first.off,
        endSpan: last.item,
        endChar: last.off + 1,
      },
      rects: rectsFor(input.items, lines, range),
    });
  }
  return sentences;
}

function isGarbled(text: string): boolean {
  const wordish = text.match(/[\p{L}\s]/gu)?.length ?? 0;
  return wordish < 0.5 * text.length;
}

/** One rectangle per line, using proportional character positions inside items. */
function rectsFor(items: TextItemInput[], lines: Line[], glyphs: Glyph[]): Rect[] {
  const byLine = new Map<number, { x0: number; x1: number }>();
  for (const glyph of glyphs) {
    const item = items[glyph.item];
    if (item === undefined || item.str.length === 0) {
      continue;
    }
    const x = item.transform[4] ?? 0;
    const charWidth = item.width / item.str.length;
    const gx0 = x + charWidth * glyph.off;
    const gx1 = gx0 + charWidth;
    const span = byLine.get(glyph.line);
    if (span === undefined) {
      byLine.set(glyph.line, { x0: gx0, x1: gx1 });
    } else {
      span.x0 = Math.min(span.x0, gx0);
      span.x1 = Math.max(span.x1, gx1);
    }
  }

  const rects: Rect[] = [];
  for (const [lineIndex, span] of [...byLine.entries()].toSorted(([a], [b]) => a - b)) {
    const line = lines[lineIndex];
    if (line === undefined) {
      continue;
    }
    rects.push({
      x: span.x0,
      y: line.y - 0.25 * line.size,
      w: span.x1 - span.x0,
      h: 1.2 * line.size,
    });
  }
  return rects;
}
