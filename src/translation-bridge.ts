/**
 * Serves translation requests from viewer webviews and runs whole-document
 * translation jobs with a cancellable progress notification.
 */

import { ProgressLocation, type Webview, window } from "vscode";

import type { HostToWebview, TranslatedItem, WebviewToHost } from "./messages";
import type { TranslationService } from "./translation/service";

/** Results are sent to the webview in small bursts rather than one by one. */
const FLUSH_DELAY_MS = 30;

interface Job {
  webview: Webview;
  abort: AbortController;
  onProgress: (done: number, total: number) => void;
  finish: () => void;
}

export class TranslationBridge {
  readonly #service: TranslationService;
  readonly #jobs = new Map<number, Job>();
  /** Aborts outstanding requests per webview when its panel closes. */
  readonly #aborts = new Map<Webview, AbortController>();
  #nextJobId = 1;

  constructor(service: TranslationService) {
    this.#service = service;
  }

  /** Handles translation messages; returns whether the message was consumed. */
  handle(webview: Webview, message: WebviewToHost): boolean {
    switch (message.type) {
      case "translate":
        void this.#translate(webview, message);
        return true;
      case "translateAllProgress":
        this.#jobs.get(message.jobId)?.onProgress(message.done, message.total);
        return true;
      case "translateAllDone":
        this.#jobs.get(message.jobId)?.finish();
        return true;
      default:
        return false;
    }
  }

  /** Called when a viewer panel is closed. */
  release(webview: Webview): void {
    this.#aborts.get(webview)?.abort();
    this.#aborts.delete(webview);
    for (const [jobId, job] of this.#jobs) {
      if (job.webview === webview) {
        job.abort.abort();
        job.finish();
        this.#jobs.delete(jobId);
      }
    }
  }

  async translateDocument(webview: Webview): Promise<void> {
    const confirm = await window.showWarningMessage(
      "翻译整篇论文？所有未缓存的句子都会发送到翻译接口，可能产生费用。翻译过程中可以随时取消。",
      { modal: true },
      "开始翻译",
    );
    if (confirm !== "开始翻译") {
      return;
    }

    const jobId = this.#nextJobId++;
    await window.withProgress(
      { location: ProgressLocation.Notification, title: "翻译整篇论文", cancellable: true },
      (progress, token) =>
        new Promise<void>((resolve) => {
          let reported = 0;
          const job: Job = {
            webview,
            abort: new AbortController(),
            onProgress: (done, total) => {
              const percent = total === 0 ? 100 : (done / total) * 100;
              progress.report({ message: `${done} / ${total} 页`, increment: percent - reported });
              reported = percent;
            },
            finish: () => {
              this.#jobs.delete(jobId);
              resolve();
            },
          };
          this.#jobs.set(jobId, job);
          token.onCancellationRequested(() => {
            job.abort.abort();
            this.#post(webview, { type: "cancelTranslateAll", jobId });
            this.#service.log.info("已取消整篇翻译");
            job.finish();
          });
          this.#post(webview, { type: "translateAll", jobId });
        }),
    );
  }

  async #translate(webview: Webview, message: Extract<WebviewToHost, { type: "translate" }>) {
    const { requestId, sentences, jobId } = message;
    const signal =
      jobId === undefined ? this.#abortFor(webview).signal : this.#jobs.get(jobId)?.abort.signal;
    if (signal === undefined || signal.aborted) {
      this.#post(webview, {
        type: "translationDone",
        requestId,
        failures: sentences.map(({ id }) => ({ id, message: "已取消" })),
      });
      return;
    }

    let buffer: TranslatedItem[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (buffer.length > 0) {
        this.#post(webview, { type: "translations", requestId, items: buffer });
        buffer = [];
      }
    };

    try {
      const { failures } = await this.#service.translate(
        sentences.map(({ id, text, group }) => ({ id, text, group })),
        {
          signal,
          onResult: ({ id, zh }) => {
            buffer.push({ id, zh });
            timer ??= setTimeout(flush, FLUSH_DELAY_MS);
          },
        },
      );
      flush();
      this.#post(webview, { type: "translationDone", requestId, failures });
    } catch (error) {
      flush();
      const text = error instanceof Error ? error.message : String(error);
      this.#service.log.error(`翻译请求失败：${text}`);
      this.#post(webview, {
        type: "translationDone",
        requestId,
        failures: sentences.map(({ id }) => ({ id, message: text })),
      });
    }
  }

  #abortFor(webview: Webview): AbortController {
    let controller = this.#aborts.get(webview);
    if (controller === undefined) {
      controller = new AbortController();
      this.#aborts.set(webview, controller);
    }
    return controller;
  }

  #post(webview: Webview, message: HostToWebview) {
    void webview.postMessage(message);
  }
}
