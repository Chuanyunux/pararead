/**
 * Draws a temporary highlight over a sentence on its page. The highlight is a
 * separate DOM layer and is never written into the PDF.
 */

import type { Sentence } from "./segmenter/types";

const LAYER_CLASS = "bilingualHighlightLayer";

export class HighlightOverlay {
  readonly #app: PdfjsApplication;
  #active: Sentence | null = null;

  constructor(app: PdfjsApplication) {
    this.#app = app;
    // Page views drop unknown child nodes when they are reset (zoom, rotation,
    // scrolled back into view); redraw when drawing starts and ends.
    const redraw = ({ pageNumber }: { pageNumber: number }) => {
      if (this.#active?.page === pageNumber) {
        this.#draw(this.#active);
      }
    };
    app.eventBus.on("pagerender", redraw);
    app.eventBus.on("pagerendered", redraw);
  }

  get active(): Sentence | null {
    return this.#active;
  }

  show(sentence: Sentence): void {
    this.clear();
    this.#active = sentence;
    this.#draw(sentence);
  }

  clear(): void {
    for (const layer of document.querySelectorAll(`.${LAYER_CLASS}`)) {
      layer.remove();
    }
    this.#active = null;
  }

  #draw(sentence: Sentence): void {
    const pageView = this.#app.pdfViewer.getPageView(sentence.page - 1);
    if (pageView === undefined) {
      return;
    }
    let layer = pageView.div.querySelector<HTMLDivElement>(`:scope > .${LAYER_CLASS}`);
    if (layer === null) {
      layer = document.createElement("div");
      layer.className = LAYER_CLASS;
      pageView.div.append(layer);
    }
    layer.replaceChildren();

    // Percentages of the page size stay valid when the page is zoomed.
    const { viewport } = pageView;
    for (const rect of sentence.rects) {
      const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(rect.x, rect.y);
      const [x2 = 0, y2 = 0] = viewport.convertToViewportPoint(rect.x + rect.w, rect.y + rect.h);
      const mark = document.createElement("div");
      mark.className = "bilingualHighlight";
      mark.style.left = `${(Math.min(x1, x2) / viewport.width) * 100}%`;
      mark.style.top = `${(Math.min(y1, y2) / viewport.height) * 100}%`;
      mark.style.width = `${(Math.abs(x2 - x1) / viewport.width) * 100}%`;
      mark.style.height = `${(Math.abs(y2 - y1) / viewport.height) * 100}%`;
      layer.append(mark);
    }
  }
}

/** Scrolls the viewer so that the sentence's first line is near the top. */
export function scrollToSentence(app: PdfjsApplication, sentence: Sentence): void {
  const first = sentence.rects[0];
  if (first === undefined) {
    return;
  }
  const top = Math.max(...sentence.rects.map((r) => r.y + r.h));
  app.pdfViewer.scrollPageIntoView({
    pageNumber: sentence.page,
    // XYZ with a null zoom keeps the current zoom level.
    destArray: [null, { name: "XYZ" }, first.x - 20, top + 40, null],
    allowNegativeOffset: true,
  });
}
