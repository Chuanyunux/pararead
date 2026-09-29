/**
 * Serves translation requests from viewer webviews and runs whole-document
 * translation jobs with a cancellable progress notification.
 */

import { l10n, ProgressLocation, type Webview, window } from "vscode";

import { localizeError } from "./l10n";
import type { FailedItem, HostToWebview, TranslatedItem, WebviewToHost } from "./messages";
import { ERROR_MESSAGES } from "./translation/errors";
import type { TranslationService } from "./translation/service";
import type { TranslationFailure } from "./translation/translator";

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
    const start = l10n.t("Translate");
    const confirm = await window.showWarningMessage(
      l10n.t(
        "Translate the whole paper? All sentences that are not cached are sent to the translation API, which may incur costs. You can cancel at any time.",
      ),
      { modal: true },
      start,
    );
    if (confirm !== start) {
      return;
    }

    const jobId = this.#nextJobId++;
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: l10n.t("Translating the paper"),
        cancellable: true,
      },
      (progress, token) =>
        new Promise<void>((resolve) => {
          let reported = 0;
          const job: Job = {
            webview,
            abort: new AbortController(),
            onProgress: (done, total) => {
              const percent = total === 0 ? 100 : (done / total) * 100;
              progress.report({
                message: l10n.t("{0} / {1} pages", done, total),
                increment: percent - reported,
              });
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
            this.#service.log.info("Whole-paper translation cancelled");
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
        failures: sentences.map(({ id }) => ({ id, message: l10n.t(ERROR_MESSAGES.cancelled) })),
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
          onResult: ({ id, translation }) => {
            buffer.push({ id, translation });
            timer ??= setTimeout(flush, FLUSH_DELAY_MS);
          },
        },
      );
      flush();
      this.#post(webview, {
        type: "translationDone",
        requestId,
        failures: failures.map(localizeFailure),
      });
    } catch (error) {
      flush();
      const text = error instanceof Error ? error.message : String(error);
      this.#service.log.error(`Translation request failed: ${text}`);
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

function localizeFailure({ id, message, code, args }: TranslationFailure): FailedItem {
  return { id, message: localizeError(code, args, message) };
}
