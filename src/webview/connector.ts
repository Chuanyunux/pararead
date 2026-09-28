/**
 * Draws an arrow from the selected sentence in the PDF to its translation in
 * the panel. Both live in the same webview, so one SVG layer spans the two.
 * Redrawn on scroll, resize, re-render and selection changes.
 * When the translation is scrolled out of the panel, the arrow points at the
 * panel edge (dashed).
 */

import { intersects, pdfRectToClient } from "./geometry";
import type { TranslationPanel } from "./panel";
import type { SelectionController } from "./selection";

const SVG = "http://www.w3.org/2000/svg";
const EDGE_MARGIN = 8;

export class Connector {
  readonly #app: PdfjsApplication;
  readonly #panel: TranslationPanel;
  readonly #selection: SelectionController;
  readonly #svg: SVGSVGElement;
  readonly #path: SVGPathElement;
  #frame = 0;
  #last = "";

  constructor(app: PdfjsApplication, panel: TranslationPanel, selection: SelectionController) {
    this.#app = app;
    this.#panel = panel;
    this.#selection = selection;

    this.#svg = document.createElementNS(SVG, "svg");
    this.#svg.classList.add("bilingualConnector");
    this.#svg.setAttribute("aria-hidden", "true");
    const defs = document.createElementNS(SVG, "defs");
    const marker = document.createElementNS(SVG, "marker");
    marker.id = "bilingualArrowHead";
    for (const [name, value] of Object.entries({
      viewBox: "0 0 10 10",
      refX: "9",
      refY: "5",
      markerWidth: "7",
      markerHeight: "7",
      orient: "auto-start-reverse",
    })) {
      marker.setAttribute(name, value);
    }
    const head = document.createElementNS(SVG, "path");
    head.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    marker.append(head);
    defs.append(marker);
    this.#path = document.createElementNS(SVG, "path");
    this.#path.setAttribute("marker-end", "url(#bilingualArrowHead)");
    this.#svg.append(defs, this.#path);
    document.body.append(this.#svg);

    const schedule = () => this.schedule();
    selection.onChange(schedule);
    app.pdfViewer.container.addEventListener("scroll", schedule, { passive: true });
    panel.body.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    app.eventBus.on("pagerendered", schedule);
    this.#svg.style.display = "none";
  }

  /** Redraws on the next frame (call when either side may have moved). */
  schedule(): void {
    if (this.#frame !== 0) {
      return;
    }
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#update();
    });
  }

  #update(): void {
    const current = this.#selection.current;
    if (current === null) {
      this.#hide();
      return;
    }
    const { sentence } = current;
    const viewerBox = this.#app.pdfViewer.container.getBoundingClientRect();
    const source = sentence.rects
      .map((r) => pdfRectToClient(this.#app, sentence.page, r))
      .find((r): r is DOMRect => r !== null && intersects(r, viewerBox));
    const target = this.#panel.sentenceElement(sentence.id)?.getClientRects()[0];
    if (!this.#panel.isOpen || source === undefined || target === undefined) {
      this.#hide();
      return;
    }

    const bodyBox = this.#panel.body.getBoundingClientRect();
    const sx = Math.min(source.right, viewerBox.right) + 2;
    const sy = source.top + source.height / 2;
    const tx = target.left - 3;
    const rawTy = target.top + target.height / 2;
    const ty = Math.min(Math.max(rawTy, bodyBox.top + EDGE_MARGIN), bodyBox.bottom - EDGE_MARGIN);
    const bend = Math.max(24, (tx - sx) / 2);
    const d = `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
    const offscreen = ty !== rawTy;

    const key = `${d}|${offscreen}|${current.pinned}`;
    if (key !== this.#last) {
      this.#last = key;
      this.#path.setAttribute("d", d);
      this.#svg.classList.toggle("offscreen", offscreen);
      this.#svg.classList.toggle("pinned", current.pinned);
      this.#svg.style.display = "";
    }
  }

  #hide(): void {
    this.#last = "";
    this.#svg.style.display = "none";
  }
}
