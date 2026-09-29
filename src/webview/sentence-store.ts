/**
 * Lazily segments pages into sentences (on first render of a page) and
 * answers lookups by id and by position.
 */

import type { PageSegmentation, Segmenter, Sentence, TextItemInput } from "./segmenter/types";

/** Max distance (PDF units) from a click to a sentence rectangle to count as a hit. */
const HIT_SLOP = 3;

export class SentenceStore {
  readonly #app: PdfjsApplication;
  readonly #segmenter: Segmenter;
  #pages = new Map<number, Promise<PageSegmentation>>();
  #ready = new Map<number, PageSegmentation>();
  #byId = new Map<string, Sentence>();
  #listeners = new Set<(page: PageSegmentation) => void>();
  /** Bumped on document reload so that stale results are dropped. */
  #generation = 0;

  constructor(app: PdfjsApplication, segmenter: Segmenter) {
    this.#app = app;
    this.#segmenter = segmenter;
  }

  onPageReady(listener: (page: PageSegmentation) => void): void {
    this.#listeners.add(listener);
  }

  reset(): void {
    this.#generation++;
    this.#pages.clear();
    this.#ready.clear();
    this.#byId.clear();
  }

  get(id: string): Sentence | undefined {
    return this.#byId.get(id);
  }

  /** Segments the page once; later calls return the cached result. */
  ensure(pageNumber: number): Promise<PageSegmentation> {
    let promise = this.#pages.get(pageNumber);
    if (promise === undefined) {
      promise = this.#load(pageNumber);
      this.#pages.set(pageNumber, promise);
      promise.catch(() => this.#pages.delete(pageNumber));
    }
    return promise;
  }

  /** All pages segmented so far, in page order. */
  readyPages(): PageSegmentation[] {
    return [...this.#ready.values()].toSorted((a, b) => a.page - b.page);
  }

  /** The segmentation of a page if it is already available (no loading). */
  cached(pageNumber: number): PageSegmentation | undefined {
    return this.#ready.get(pageNumber);
  }

  /** Finds the sentence under a point in PDF user space. */
  async hitTest(pageNumber: number, x: number, y: number): Promise<Sentence | undefined> {
    return hitTest(await this.ensure(pageNumber), x, y);
  }

  /** Like `hitTest`, but only on already segmented pages; starts segmenting otherwise. */
  hitTestCached(pageNumber: number, x: number, y: number): Sentence | undefined {
    const page = this.cached(pageNumber);
    if (page === undefined) {
      void this.ensure(pageNumber).catch(() => {
        // Reloaded while segmenting.
      });
      return undefined;
    }
    return hitTest(page, x, y);
  }

  async #load(pageNumber: number): Promise<PageSegmentation> {
    const generation = this.#generation;
    const doc = this.#app.pdfDocument;
    if (doc === null) {
      throw new Error("No document is loaded.");
    }
    const page = await doc.getPage(pageNumber);
    // Same parameters as the viewer's text layer, so item indices match spans.
    const content = await page.getTextContent({
      includeMarkedContent: true,
      disableNormalization: true,
    });
    const items = content.items.filter(
      (item): item is PdfjsTextItem => "str" in item,
    ) satisfies TextItemInput[];

    // Segmentation is synchronous; yield first so rendering is not delayed.
    await idle();
    const result = this.#segmenter.segmentPage({
      page: pageNumber,
      view: page.view,
      items,
      styles: content.styles,
    });
    if (generation !== this.#generation) {
      throw new Error("Document was reloaded.");
    }
    for (const block of result.blocks) {
      for (const sentence of block.sentences) {
        this.#byId.set(sentence.id, sentence);
      }
    }
    this.#ready.set(pageNumber, result);
    for (const listener of this.#listeners) {
      listener(result);
    }
    return result;
  }
}

function hitTest(page: PageSegmentation, x: number, y: number): Sentence | undefined {
  let best: Sentence | undefined;
  let bestDistance = HIT_SLOP;
  for (const block of page.blocks) {
    for (const sentence of block.sentences) {
      for (const r of sentence.rects) {
        const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
        const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
        const distance = Math.hypot(dx, dy);
        if (distance <= bestDistance) {
          best = sentence;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 500 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}
