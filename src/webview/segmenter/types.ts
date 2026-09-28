/** A text item as produced by pdf.js `getTextContent()` (marked content removed). */
export interface TextItemInput {
  str: string;
  /** Text matrix `[a, b, c, d, e, f]` in PDF user space. */
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

export interface PageTextInput {
  /** 1-based page number. */
  page: number;
  /** Page view box `[x0, y0, x1, y1]` in PDF user space. */
  view: number[];
  /**
   * Items in content-stream order. Indices must match the text layer spans,
   * i.e. `getTextContent({ includeMarkedContent: true, disableNormalization: true })`
   * with the marked-content markers filtered out.
   */
  items: TextItemInput[];
  styles: Record<string, { fontFamily: string }>;
}

/** Axis-aligned rectangle in PDF user space; `y` is the bottom edge. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Location of a sentence in the text layer; `endChar` is exclusive. */
export interface SpanRange {
  startSpan: number;
  startChar: number;
  endSpan: number;
  endChar: number;
}

export interface Sentence {
  /** `p{page}-b{block}-s{idx}` */
  id: string;
  page: number;
  blockId: string;
  text: string;
  spanRange: SpanRange;
  /** One rectangle per line the sentence covers. */
  rects: Rect[];
}

export type BlockKind = "text" | "code";

export interface Block {
  /** `p{page}-b{block}` */
  id: string;
  page: number;
  kind: BlockKind;
  text: string;
  /** Empty for code blocks, which are not translated. */
  sentences: Sentence[];
}

export interface PageSegmentation {
  page: number;
  blocks: Block[];
}

/**
 * Splits one page of text into blocks and sentences. The heuristic
 * implementation can later be swapped for a layout-model based one (MinerU).
 */
export interface Segmenter {
  segmentPage(input: PageTextInput): PageSegmentation;
}
