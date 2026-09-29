/**
 * Translation panel to the right of the PDF, inside the same webview. The
 * translation is typeset like the original: headings, paragraphs (sentences
 * flow inline), lists, captions, footnotes and code, page by page.
 */

import { languageInfo } from "../languages";
import { t } from "./i18n";
import { HOVER_DWELL_MS } from "./pointer-select";
import type { Block, PageSegmentation, Sentence } from "./segmenter/types";
import type { SelectionController } from "./selection";
import type { SentenceStore } from "./sentence-store";
import type { TranslationClient, TranslationState } from "./translation-client";

const MIN_WIDTH = 240;
const MIN_VIEWER_WIDTH = 360;
const DEFAULT_WIDTH = 420;
/** Panel share of the window when it is too narrow for both minimum widths. */
const NARROW_WINDOW_RATIO = 0.4;

interface PanelState {
  open: boolean;
  width: number;
  /** Show the original paragraph under each translated one. */
  showSource: boolean;
}

export interface PanelOptions {
  store: SentenceStore;
  translations: TranslationClient;
  selection: SelectionController;
  vscode: VsCodeApi;
  hoverEnabled: () => boolean;
  /** False while a PDF annotation editor is active: selection is paused. */
  selectionEnabled: () => boolean;
  /** A sentence was clicked in the panel. */
  onActivate: (sentence: Sentence) => void;
  /** Language of the translations (BCP 47 code). */
  targetLanguage: string;
}

export class TranslationPanel {
  readonly #store: SentenceStore;
  readonly #translations: TranslationClient;
  readonly #vscode: VsCodeApi;
  readonly #root: HTMLElement;
  readonly #body: HTMLElement;
  readonly #content: HTMLElement;
  readonly #pageLabel: HTMLElement;
  readonly #toggle: HTMLButtonElement;
  readonly #sourceToggle: HTMLButtonElement;
  /** Block id → element (figure labels share one placeholder). */
  readonly #blockElements = new Map<string, HTMLElement>();
  #state: PanelState;
  #activeId: string | null = null;
  /** Whether the target language separates sentences with spaces. */
  #spaced = true;

  constructor({
    store,
    translations,
    selection,
    vscode,
    hoverEnabled,
    selectionEnabled,
    onActivate,
    targetLanguage,
  }: PanelOptions) {
    this.#store = store;
    this.#translations = translations;
    this.#vscode = vscode;
    this.#state = { open: true, width: DEFAULT_WIDTH, showSource: false, ...readState(vscode) };

    this.#root = element("aside", "bilingualPanel");
    this.#root.setAttribute("aria-label", t("panelTitle"));
    const splitter = element("div", "bilingualSplitter");
    splitter.setAttribute("role", "separator");
    splitter.setAttribute("aria-orientation", "vertical");

    const header = element("header", "bilingualHeader");
    header.append(element("span", "bilingualTitle", t("panelTitle")));
    this.#pageLabel = element("span", "bilingualPageLabel");
    this.#sourceToggle = element("button", "bilingualHeaderButton", t("sourceButton"));
    this.#sourceToggle.type = "button";
    this.#sourceToggle.title = t("sourceButtonTitle");
    this.#sourceToggle.addEventListener("click", () => {
      this.#state = { ...this.#state, showSource: !this.#state.showSource };
      this.#apply();
      this.#save();
    });
    const tools = element("span", "bilingualHeaderTools");
    tools.append(this.#pageLabel, this.#sourceToggle);
    header.append(tools);

    this.#body = element("div", "bilingualBody");
    this.#content = element("div", "bilingualContent");
    this.#content.append(element("p", "bilingualEmpty", t("emptyHint")));
    this.#body.append(this.#content);
    this.#root.append(splitter, header, this.#body);
    document.body.append(this.#root);

    this.#toggle = document.createElement("button");
    this.#toggle.className = "toolbarButton bilingualToggle";
    this.#toggle.type = "button";
    this.#toggle.title = t("togglePanel");
    this.#toggle.setAttribute("aria-label", t("togglePanel"));
    this.#toggle.append(panelIcon());
    this.#toggle.addEventListener("click", () => this.setOpen(!this.#state.open));
    document.querySelector("#toolbarViewerRight")?.prepend(this.#toggle);

    // Click pins and activates; hover previews after a short dwell.
    this.#content.addEventListener("click", (event) => {
      if (!selectionEnabled()) {
        return;
      }
      const sentence = this.#sentenceFor(event.target);
      if (sentence !== undefined) {
        selection.pin(sentence, "panel");
        onActivate(sentence);
        return;
      }
      // Empty space clears the selection (but not right after selecting text to copy).
      const selected = window.getSelection();
      if (selected === null || selected.isCollapsed) {
        selection.clear();
      }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let candidate: string | undefined;
    this.#content.addEventListener("pointermove", (event) => {
      const sentence =
        hoverEnabled() && selectionEnabled() ? this.#sentenceFor(event.target) : undefined;
      if (sentence?.id === candidate) {
        return;
      }
      candidate = sentence?.id;
      clearTimeout(timer);
      if (sentence !== undefined) {
        timer = setTimeout(() => {
          selection.preview(sentence, "panel");
          // Re-arm on the next move, e.g. after the selection was cleared.
          candidate = undefined;
        }, HOVER_DWELL_MS);
      }
    });
    this.#content.addEventListener("pointerleave", () => {
      clearTimeout(timer);
      candidate = undefined;
    });

    this.#installSplitter(splitter);
    // Only real window resizes; #apply dispatches synthetic ones for pdf.js.
    window.addEventListener("resize", (event) => {
      if (event.isTrusted) {
        this.#layout();
      }
    });
    store.onPageReady((page) => this.#renderPage(page));
    translations.onChange((id, state) => {
      const span = this.sentenceElement(id);
      const sentence = this.#store.get(id);
      if (span !== null && sentence !== undefined) {
        renderSentence(span, sentence, state, this.#spaced);
      }
    });
    selection.onChange((current) => this.#setActive(current?.sentence.id ?? null));

    this.#applyLanguage(targetLanguage);
    this.#apply();
  }

  /** Switches the translation language and re-renders the given pages. */
  setTargetLanguage(code: string, pages: readonly PageSegmentation[]): void {
    this.#applyLanguage(code);
    this.reset();
    for (const page of pages) {
      this.#renderPage(page);
    }
  }

  #applyLanguage(code: string): void {
    // Fonts, line breaking and (for Chinese/Japanese) paragraph indentation.
    this.#content.lang = code;
    this.#spaced = languageInfo(code)?.spaced ?? true;
  }

  /** The scrolling element of the panel. */
  get body(): HTMLElement {
    return this.#body;
  }

  get isOpen(): boolean {
    return this.#state.open;
  }

  setPageLabel(pageNumber: number): void {
    this.#pageLabel.textContent = t("page", pageNumber);
  }

  sentenceElement(id: string): HTMLElement | null {
    return this.#content.querySelector<HTMLElement>(
      `.bilingualSentence[data-id="${CSS.escape(id)}"]`,
    );
  }

  blockElement(id: string): HTMLElement | undefined {
    return this.#blockElements.get(id);
  }

  setOpen(open: boolean): void {
    this.#state = { ...this.#state, open };
    this.#apply();
    this.#save();
  }

  reset(): void {
    this.#activeId = null;
    this.#blockElements.clear();
    this.#content.replaceChildren();
  }

  #sentenceFor(target: EventTarget | null): Sentence | undefined {
    const id = (target as Element | null)?.closest<HTMLElement>(".bilingualSentence")?.dataset[
      "id"
    ];
    return id === undefined ? undefined : this.#store.get(id);
  }

  #apply(): void {
    document.body.classList.toggle("bilingualPanelOpen", this.#state.open);
    this.#root.classList.toggle("showSource", this.#state.showSource);
    this.#sourceToggle.setAttribute("aria-pressed", String(this.#state.showSource));
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

  #setActive(id: string | null): void {
    if (this.#activeId !== null) {
      this.sentenceElement(this.#activeId)?.classList.remove("active");
    }
    this.#activeId = id;
    if (id !== null) {
      this.sentenceElement(id)?.classList.add("active");
    }
  }

  #renderPage(page: PageSegmentation): void {
    this.#content.querySelector(".bilingualEmpty")?.remove();
    const section = element("section", "bilingualPage");
    section.dataset["page"] = String(page.page);
    section.append(element("div", "bilingualPageDivider", t("page", page.page)));

    let figure: HTMLElement | null = null;
    let code: HTMLElement | null = null;
    for (const block of page.blocks) {
      if (block.role === "figure") {
        // Consecutive diagram labels collapse into one placeholder.
        if (figure === null) {
          figure = element("div", "bilingualFigure", t("figureText"));
          section.append(figure);
        }
        figure.dataset["blocks"] = `${figure.dataset["blocks"] ?? ""} ${block.id}`.trim();
        this.#blockElements.set(block.id, figure);
        continue;
      }
      figure = null;
      if (block.role === "code") {
        // Consecutive code blocks form one listing.
        if (code === null) {
          code = element("pre", "bilingualCode", block.text);
          section.append(code);
        } else {
          code.textContent += `\n${block.text}`;
        }
        this.#blockElements.set(block.id, code);
        continue;
      }
      code = null;
      const el = this.#renderBlock(block);
      if (el !== null) {
        section.append(el);
        this.#blockElements.set(block.id, el);
      }
    }

    // Keep sections in page order regardless of render order.
    this.#content.querySelector(`section[data-page="${page.page}"]`)?.remove();
    const next = [...this.#content.querySelectorAll<HTMLElement>("section[data-page]")].find(
      (s) => Number(s.dataset["page"]) > page.page,
    );
    this.#content.insertBefore(section, next ?? null);
  }

  #renderBlock(block: Block): HTMLElement | null {
    if (block.sentences.length === 0) {
      // Page numbers and other text without sentences.
      return null;
    }
    const tag = block.role === "heading" ? "h3" : "div";
    const el = element(tag, `bilingualBlock ${block.role}`);
    el.dataset["block"] = block.id;
    if (block.role === "heading") {
      el.dataset["level"] = String(block.level ?? 3);
    }
    const target = element("div", "bilingualTarget");
    for (const sentence of block.sentences) {
      const span = element("span", "bilingualSentence");
      span.dataset["id"] = sentence.id;
      renderSentence(span, sentence, this.#translations.state(sentence.id), this.#spaced);
      if (sentence.id === this.#activeId) {
        span.classList.add("active");
      }
      target.append(span);
    }
    el.append(
      target,
      element("div", "bilingualSource", block.sentences.map((s) => s.text).join(" ")),
    );
    return el;
  }
}

/** Shows the translation, or the original (dimmed) until it is available. */
function renderSentence(
  span: HTMLElement,
  sentence: Sentence,
  state: TranslationState,
  spaced: boolean,
): void {
  span.dataset["status"] = state.status;
  // Sentences are separated by a space, except in Chinese and Japanese.
  span.textContent =
    state.status === "done" ? `${state.translation}${spaced ? " " : ""}` : `${sentence.text} `;
  span.title = state.status === "error" ? t("translationFailed", state.message) : "";
}

/** Toolbar icon: a split view with the right-hand panel highlighted. */
function panelIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("bilingualToggleIcon");
  const frame = document.createElementNS(ns, "rect");
  for (const [name, value] of Object.entries({
    x: "1.5",
    y: "2.5",
    width: "13",
    height: "11",
    rx: "1.5",
  })) {
    frame.setAttribute(name, value);
  }
  frame.classList.add("frame");
  const side = document.createElementNS(ns, "rect");
  for (const [name, value] of Object.entries({
    x: "9",
    y: "3",
    width: "5",
    height: "10",
    rx: "1",
  })) {
    side.setAttribute(name, value);
  }
  side.classList.add("side");
  svg.append(frame, side);
  return svg;
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
    ...(typeof panel.showSource === "boolean" ? { showSource: panel.showSource } : {}),
  };
}
