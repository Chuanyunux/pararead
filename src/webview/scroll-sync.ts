/**
 * Keeps the panel in step with the PDF (one way: the PDF leads).
 * - With a selected sentence visible in the PDF, its translation is scrolled
 *   to the same height as the original.
 * - Otherwise the paragraph and line at the reading position (30% from the top
 *   of the viewer) are aligned, interpolating inside the paragraph.
 * Scrolling the panel by hand pauses synchronization briefly.
 */

import { intersects, pdfPointAt, pdfRectToClient } from "./geometry";
import type { TranslationPanel } from "./panel";
import type { Block, Rect } from "./segmenter/types";
import type { SelectionController } from "./selection";
import type { SentenceStore } from "./sentence-store";

/** Reading position, as a fraction of the viewer height from its top. */
const ANCHOR = 0.3;
/** Pause after the user scrolls the panel by hand. */
const USER_SCROLL_PAUSE_MS = 1500;

export interface ScrollSyncOptions {
  app: PdfjsApplication;
  store: SentenceStore;
  panel: TranslationPanel;
  selection: SelectionController;
}

export class ScrollSync {
  readonly #app: PdfjsApplication;
  readonly #store: SentenceStore;
  readonly #panel: TranslationPanel;
  readonly #selection: SelectionController;
  #frame = 0;
  #pausedUntil = 0;
  /** Last pointer x over the PDF: tells which column the reader is in. */
  #pointerX: number | null = null;

  constructor({ app, store, panel, selection }: ScrollSyncOptions) {
    this.#app = app;
    this.#store = store;
    this.#panel = panel;
    this.#selection = selection;

    const viewer = app.pdfViewer.container;
    viewer.addEventListener("scroll", () => this.schedule(), { passive: true });
    viewer.addEventListener("pointermove", (event) => {
      this.#pointerX = event.clientX;
    });
    viewer.addEventListener("pointerleave", () => {
      this.#pointerX = null;
    });

    const pause = () => {
      this.#pausedUntil = Date.now() + USER_SCROLL_PAUSE_MS;
    };
    const body = panel.body;
    body.addEventListener("wheel", pause, { passive: true });
    body.addEventListener("touchstart", pause, { passive: true });
    body.addEventListener("keydown", pause);
    body.addEventListener("pointerdown", (event) => {
      // Dragging the scrollbar (clicks on content are selections, not scrolling).
      if (event.target === body) {
        pause();
      }
    });

    selection.onChange((current) => {
      if (current !== null && (current.source === "pdf" || current.pinned)) {
        // A deliberate selection resumes synchronization.
        this.#pausedUntil = 0;
        this.schedule();
      }
    });
    app.eventBus.on("pagerendered", () => this.schedule());
    store.onPageReady(() => this.schedule());
  }

  schedule(): void {
    if (this.#frame !== 0) {
      return;
    }
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#sync();
    });
  }

  #sync(): void {
    if (!this.#panel.isOpen || Date.now() < this.#pausedUntil) {
      return;
    }
    const current = this.#selection.current;
    if (
      current !== null &&
      (current.source === "pdf" || current.pinned) &&
      this.#alignSentence(current.sentence.id)
    ) {
      return;
    }
    this.#alignReadingPosition();
  }

  /** Puts the translation of a sentence level with the original; false if not possible. */
  #alignSentence(id: string): boolean {
    const sentence = this.#store.get(id);
    const span = this.#panel.sentenceElement(id);
    if (sentence === undefined || span === null) {
      return false;
    }
    const viewerBox = this.#app.pdfViewer.container.getBoundingClientRect();
    const source = sentence.rects
      .map((r) => pdfRectToClient(this.#app, sentence.page, r))
      .find((r): r is DOMRect => r !== null && intersects(r, viewerBox));
    const target = span.getClientRects()[0];
    if (source === undefined || target === undefined) {
      return false;
    }
    this.#scrollBy(target.top - source.top);
    return true;
  }

  #alignReadingPosition(): void {
    const viewerBox = this.#app.pdfViewer.container.getBoundingClientRect();
    const anchorY = viewerBox.top + viewerBox.height * ANCHOR;
    const probeX = this.#pointerX ?? viewerBox.left + viewerBox.width / 2;
    const point = pdfPointAt(this.#app, probeX, anchorY);
    if (point === null) {
      return;
    }
    this.#panel.setPageLabel(point.pageNumber);
    const page = this.#store.cached(point.pageNumber);
    if (page === undefined) {
      return;
    }
    const hit = this.#lineAt(page.blocks, point.x, point.y, this.#pointerX !== null);
    const el = hit === null ? undefined : this.#panel.blockElement(hit.block.id);
    if (hit === null || el === undefined) {
      return;
    }
    const box = el.getBoundingClientRect();
    const fraction = (hit.line + hit.within) / hit.block.lines.length;
    this.#scrollBy(box.top + fraction * box.height - anchorY);
  }

  /**
   * The block line at a PDF-space point. Among lines at that height (several
   * columns), prefer the column under the pointer, else reading order.
   */
  #lineAt(
    blocks: Block[],
    x: number,
    y: number,
    useX: boolean,
  ): { block: Block; line: number; within: number } | null {
    let best: { block: Block; line: number; within: number; score: number } | null = null;
    for (const block of blocks) {
      if (this.#panel.blockElement(block.id) === undefined) {
        continue;
      }
      for (const [i, r] of block.lines.entries()) {
        // Vertical distance from the line (0 inside), plus column distance.
        const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
        const dx = useX ? Math.max(r.x - x, 0, x - (r.x + r.w)) : 0;
        const score = dy * 4 + dx;
        if (best === null || score < best.score) {
          best = { block, line: i, within: withinLine(r, y), score };
        }
      }
    }
    return best;
  }

  #scrollBy(delta: number): void {
    if (Math.abs(delta) >= 1) {
      this.#panel.body.scrollTop += delta;
    }
  }
}

/** Position of y inside a line rectangle, 0 at its top and 1 at its bottom. */
function withinLine(r: Rect, y: number): number {
  return Math.min(1, Math.max(0, (r.y + r.h - y) / r.h));
}
