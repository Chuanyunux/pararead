/**
 * Webview side of translation: tracks the state of every sentence, requests
 * translations from the extension host according to the translate range, and
 * drives whole-document jobs.
 */

import type { HostToWebview, TranslateRange, WebviewToHost } from "../messages";
import type { Block, PageSegmentation, Sentence } from "./segmenter/types";
import type { SentenceStore } from "./sentence-store";

export type TranslationState =
  | { status: "none" }
  | { status: "pending" }
  | { status: "done"; translation: string }
  | { status: "error"; message: string };

const NONE: TranslationState = { status: "none" };

export interface TranslationClientOptions {
  app: PdfjsApplication;
  store: SentenceStore;
  post: (message: WebviewToHost) => void;
  range: TranslateRange;
}

export class TranslationClient {
  readonly #app: PdfjsApplication;
  readonly #store: SentenceStore;
  readonly #post: (message: WebviewToHost) => void;
  readonly #states = new Map<string, TranslationState>();
  readonly #requests = new Map<number, () => void>();
  readonly #listeners = new Set<(id: string, state: TranslationState) => void>();
  readonly #cancelledJobs = new Set<number>();
  #range: TranslateRange;
  #nextRequestId = 1;
  /** Bumped on document reload so that stale work stops. */
  #generation = 0;

  constructor({ app, store, post, range }: TranslationClientOptions) {
    this.#app = app;
    this.#store = store;
    this.#post = post;
    this.#range = range;

    store.onPageReady((page) => {
      if (this.#pagesInRange(this.#app.pdfViewer.currentPageNumber).includes(page.page)) {
        void this.#request(textSentences(page), { retryErrors: false });
      }
    });
    app.eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
      this.#applyRange(pageNumber);
    });
  }

  state(id: string): TranslationState {
    return this.#states.get(id) ?? NONE;
  }

  onChange(listener: (id: string, state: TranslationState) => void): void {
    this.#listeners.add(listener);
  }

  reset(): void {
    this.#generation++;
    this.#states.clear();
    for (const done of this.#requests.values()) {
      done();
    }
    this.#requests.clear();
  }

  /** Handles host messages; returns whether the message was consumed. */
  handle(message: HostToWebview): boolean {
    switch (message.type) {
      case "translations":
        if (this.#requests.has(message.requestId)) {
          for (const { id, translation } of message.items) {
            this.#set(id, { status: "done", translation });
          }
        }
        return true;
      case "translationDone":
        if (this.#requests.has(message.requestId)) {
          for (const { id, message: text } of message.failures) {
            this.#set(id, { status: "error", message: text });
          }
          this.#requests.get(message.requestId)?.();
          this.#requests.delete(message.requestId);
        }
        return true;
      case "translateCurrentPage":
        void this.translatePage(this.#app.pdfViewer.currentPageNumber);
        return true;
      case "translateAll":
        void this.#translateAll(message.jobId);
        return true;
      case "cancelTranslateAll":
        this.#cancelledJobs.add(message.jobId);
        return true;
      case "settings":
        this.#range = message.translateRange;
        this.#applyRange(this.#app.pdfViewer.currentPageNumber);
        return true;
      case "retryFailed":
        // Clear stale errors (e.g. "API key not set"), then translate the range again.
        for (const [id, state] of this.#states) {
          if (state.status === "error") {
            this.#set(id, NONE);
          }
        }
        this.#applyRange(this.#app.pdfViewer.currentPageNumber);
        return true;
      default:
        return false;
    }
  }

  /** Applies the translate range to the current page, e.g. after a document loads. */
  refresh(): void {
    this.#applyRange(this.#app.pdfViewer.currentPageNumber);
  }

  /** Translates the paragraph containing `sentence` (explicit user action). */
  async translateBlockOf(sentence: Sentence): Promise<void> {
    const page = await this.#store.ensure(sentence.page);
    const block = page.blocks.find((b) => b.id === sentence.blockId);
    if (block !== undefined) {
      await this.#request(block.sentences, { retryErrors: true });
    }
  }

  async translatePage(pageNumber: number): Promise<void> {
    const page = await this.#store.ensure(pageNumber);
    await this.#request(textSentences(page), { retryErrors: true });
  }

  #pagesInRange(current: number): number[] {
    const count = this.#app.pdfViewer.pagesCount;
    const pages =
      this.#range === "page"
        ? [current]
        : this.#range === "nearby"
          ? [current, current + 1, current - 1]
          : [];
    return pages.filter((n) => n >= 1 && n <= count);
  }

  #applyRange(current: number): void {
    for (const n of this.#pagesInRange(current)) {
      void this.#store
        .ensure(n)
        .then((page) => this.#request(textSentences(page), { retryErrors: false }))
        .catch(() => {
          // Reloaded while segmenting.
        });
    }
  }

  async #translateAll(jobId: number): Promise<void> {
    const generation = this.#generation;
    const total = this.#app.pdfViewer.pagesCount;
    try {
      for (let n = 1; n <= total; n++) {
        if (this.#cancelledJobs.has(jobId) || generation !== this.#generation) {
          break;
        }
        const page = await this.#store.ensure(n);
        await this.#request(textSentences(page), { retryErrors: true, jobId });
        this.#post({ type: "translateAllProgress", jobId, done: n, total });
      }
    } finally {
      this.#cancelledJobs.delete(jobId);
      this.#post({ type: "translateAllDone", jobId });
    }
  }

  /** Requests sentences that are not translated or pending yet. */
  #request(
    sentences: readonly Sentence[],
    { retryErrors, jobId }: { retryErrors: boolean; jobId?: number },
  ): Promise<void> {
    const todo = sentences.filter((s) => {
      const { status } = this.state(s.id);
      return status === "none" || (retryErrors && status === "error");
    });
    if (todo.length === 0) {
      return Promise.resolve();
    }
    for (const s of todo) {
      this.#set(s.id, { status: "pending" });
    }
    const requestId = this.#nextRequestId++;
    return new Promise<void>((resolve) => {
      this.#requests.set(requestId, resolve);
      this.#post({
        type: "translate",
        requestId,
        sentences: todo.map(({ id, text, blockId }) => ({ id, text, group: blockId })),
        ...(jobId === undefined ? {} : { jobId }),
      });
    });
  }

  #set(id: string, state: TranslationState): void {
    this.#states.set(id, state);
    for (const listener of this.#listeners) {
      listener(id, state);
    }
  }
}

function textSentences(page: PageSegmentation): Sentence[] {
  return page.blocks.filter((b: Block) => b.kind === "text").flatMap((b) => b.sentences);
}
