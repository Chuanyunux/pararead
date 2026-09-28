/**
 * Translation panel to the right of the PDF, inside the same webview. Lists
 * the sentences of rendered pages grouped by page and paragraph.
 */

import type { PageSegmentation, Sentence } from "./segmenter/types";
import type { SentenceStore } from "./sentence-store";

const MIN_WIDTH = 240;
const MIN_VIEWER_WIDTH = 360;
const DEFAULT_WIDTH = 420;
/** Panel share of the window when it is too narrow for both minimum widths. */
const NARROW_WINDOW_RATIO = 0.4;
/** After a selection, don't let page-following scroll the panel away. */
const FOLLOW_PAUSE_MS = 1500;

interface PanelState {
  open: boolean;
  width: number;
}

export interface PanelOptions {
  app: PdfjsApplication;
  store: SentenceStore;
  vscode: VsCodeApi;
  /** A sentence was clicked in the panel. */
  onSelect: (sentence: Sentence) => void;
}

export class TranslationPanel {
  readonly #app: PdfjsApplication;
  readonly #store: SentenceStore;
  readonly #vscode: VsCodeApi;
  readonly #root: HTMLElement;
  readonly #body: HTMLElement;
  readonly #pageLabel: HTMLElement;
  readonly #toggle: HTMLButtonElement;
  #state: PanelState;
  #activeId: string | null = null;
  #followPausedUntil = 0;

  constructor({ app, store, vscode, onSelect }: PanelOptions) {
    this.#app = app;
    this.#store = store;
    this.#vscode = vscode;
    this.#state = { open: true, width: DEFAULT_WIDTH, ...readState(vscode) };

    this.#root = element("aside", "bilingualPanel");
    this.#root.setAttribute("aria-label", "译文");
    const splitter = element("div", "bilingualSplitter");
    splitter.setAttribute("role", "separator");
    splitter.setAttribute("aria-orientation", "vertical");
    const header = element("header", "bilingualHeader");
    header.append(element("span", "bilingualTitle", "译文"));
    this.#pageLabel = element("span", "bilingualPageLabel");
    header.append(this.#pageLabel);
    this.#body = element("div", "bilingualBody");
    this.#body.append(element("p", "bilingualEmpty", "滚动或 Alt+点击 PDF 中的句子以显示译文。"));
    this.#root.append(splitter, header, this.#body);
    document.body.append(this.#root);

    this.#toggle = document.createElement("button");
    this.#toggle.className = "toolbarButton bilingualToggle";
    this.#toggle.type = "button";
    this.#toggle.title = "显示/隐藏译文面板";
    this.#toggle.textContent = "译";
    this.#toggle.addEventListener("click", () => this.setOpen(!this.#state.open));
    document.querySelector("#toolbarViewerRight")?.prepend(this.#toggle);

    this.#body.addEventListener("click", (event) => {
      const row = (event.target as Element).closest<HTMLElement>(".bilingualSentence");
      const sentence =
        row?.dataset["id"] === undefined ? undefined : this.#store.get(row.dataset["id"]);
      if (sentence !== undefined) {
        this.#setActive(sentence.id);
        onSelect(sentence);
      }
    });

    this.#installSplitter(splitter);
    // Only real window resizes; #apply dispatches synthetic ones for pdf.js.
    window.addEventListener("resize", (event) => {
      if (event.isTrusted) {
        this.#layout();
      }
    });
    store.onPageReady((page) => this.#renderPage(page));
    app.eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) =>
      this.#follow(pageNumber),
    );

    this.#apply();
  }

  /** Shows a sentence selected in the PDF. */
  reveal(sentence: Sentence): void {
    if (!this.#state.open) {
      this.setOpen(true);
    }
    this.#setActive(sentence.id);
    void this.#store.ensure(sentence.page).then(() => {
      this.#rowFor(sentence.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  setOpen(open: boolean): void {
    this.#state = { ...this.#state, open };
    this.#apply();
    this.#save();
  }

  reset(): void {
    this.#activeId = null;
    this.#body.replaceChildren();
  }

  #apply(): void {
    document.body.classList.toggle("bilingualPanelOpen", this.#state.open);
    this.#toggle.setAttribute("aria-pressed", String(this.#state.open));
    this.#toggle.classList.toggle("toggled", this.#state.open);
    this.#layout();
    // Let pdf.js recompute "auto"/"page-width" zoom for the new viewer width.
    window.dispatchEvent(new Event("resize"));
  }

  /** Applies the panel width, clamped so that the PDF always keeps some room. */
  #layout(): void {
    const available = window.innerWidth - MIN_VIEWER_WIDTH;
    const width =
      available >= MIN_WIDTH
        ? Math.min(this.#state.width, available)
        : Math.round(window.innerWidth * NARROW_WINDOW_RATIO);
    document.documentElement.style.setProperty("--bilingual-panel-width", `${width}px`);
  }

  #save(): void {
    this.#vscode.setState({
      ...(this.#vscode.getState() as object | undefined),
      panel: this.#state,
    });
  }

  #installSplitter(splitter: HTMLElement): void {
    let dragging = false;
    let frame = 0;
    splitter.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      dragging = true;
      try {
        splitter.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners below still track the drag.
      }
      document.body.classList.add("bilingualResizing");
    });
    window.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }
      const max = Math.max(MIN_WIDTH, window.innerWidth - MIN_VIEWER_WIDTH);
      const width = Math.round(
        Math.min(max, Math.max(MIN_WIDTH, window.innerWidth - event.clientX)),
      );
      this.#state = { ...this.#state, width };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this.#apply());
    });
    const end = () => {
      if (!dragging) {
        return;
      }
      dragging = false;
      cancelAnimationFrame(frame);
      this.#apply();
      document.body.classList.remove("bilingualResizing");
      this.#save();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  #follow(pageNumber: number): void {
    this.#pageLabel.textContent = `第 ${pageNumber} 页`;
    // Segment the current page and its neighbours ahead of time.
    for (const n of [pageNumber, pageNumber + 1, pageNumber - 1]) {
      if (n >= 1 && n <= this.#app.pdfViewer.pagesCount) {
        void this.#store.ensure(n).catch(() => {
          // Reloaded while segmenting; the new document segments again.
        });
      }
    }
    if (!this.#state.open || Date.now() < this.#followPausedUntil || this.#root.matches(":hover")) {
      return;
    }
    void this.#store.ensure(pageNumber).then(() => {
      this.#sectionFor(pageNumber)?.scrollIntoView({ block: "start" });
    });
  }

  #setActive(id: string): void {
    this.#followPausedUntil = Date.now() + FOLLOW_PAUSE_MS;
    this.#activeId = id;
    for (const row of this.#body.querySelectorAll(".bilingualSentence.active")) {
      row.classList.remove("active");
    }
    this.#rowFor(id)?.classList.add("active");
  }

  #rowFor(id: string): HTMLElement | null {
    return this.#body.querySelector<HTMLElement>(`.bilingualSentence[data-id="${CSS.escape(id)}"]`);
  }

  #sectionFor(pageNumber: number): HTMLElement | null {
    return this.#body.querySelector<HTMLElement>(`section[data-page="${pageNumber}"]`);
  }

  #renderPage(page: PageSegmentation): void {
    this.#body.querySelector(".bilingualEmpty")?.remove();
    const section = element("section", "bilingualPage");
    section.dataset["page"] = String(page.page);
    section.append(element("h2", "bilingualPageHeading", `第 ${page.page} 页`));

    for (const block of page.blocks) {
      if (block.kind !== "text" || block.sentences.length === 0) {
        continue;
      }
      const paragraph = element("div", "bilingualBlock");
      paragraph.dataset["block"] = block.id;
      for (const sentence of block.sentences) {
        const row = element("div", "bilingualSentence");
        row.dataset["id"] = sentence.id;
        row.tabIndex = 0;
        row.append(element("div", "bilingualSource", sentence.text));
        // M1: placeholder until the translation service lands in M2.
        row.append(element("div", "bilingualTarget", `〔占位译文〕${sentence.text}`));
        if (sentence.id === this.#activeId) {
          row.classList.add("active");
        }
        paragraph.append(row);
      }
      section.append(paragraph);
    }

    // Keep sections in page order regardless of render order.
    this.#sectionFor(page.page)?.remove();
    const next = [...this.#body.querySelectorAll<HTMLElement>("section[data-page]")].find(
      (s) => Number(s.dataset["page"]) > page.page,
    );
    this.#body.insertBefore(section, next ?? null);
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}

function readState(vscode: VsCodeApi): Partial<PanelState> {
  const state = vscode.getState();
  if (typeof state !== "object" || state === null || !("panel" in state)) {
    return {};
  }
  const panel = state.panel as Partial<PanelState>;
  return {
    ...(typeof panel.open === "boolean" ? { open: panel.open } : {}),
    ...(typeof panel.width === "number" ? { width: panel.width } : {}),
  };
}
