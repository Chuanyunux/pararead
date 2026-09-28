/**
 * VS Code side of translation: settings, API key in SecretStorage, the disk
 * cache location, logging, and the commands that don't need a viewer.
 */

import { join } from "node:path";

import {
  type Disposable,
  EventEmitter,
  type ExtensionContext,
  type LogOutputChannel,
  window,
  workspace,
} from "vscode";

import type { TranslateRange } from "../messages";
import { TranslationCache } from "./cache";
import { OpenAICompatibleClient } from "./client";
import { readTranslationConfig, type TranslationConfig } from "./config";
import type { SourceSentence } from "./prompt";
import {
  type TranslateOptions,
  type TranslationFailure,
  type TranslationResult,
  Translator,
} from "./translator";

const SECRET_KEY = "pdfBilingual.apiKey";
export const SET_API_KEY_COMMAND = "pdfBilingual.setApiKey";

function readConfig(): TranslationConfig {
  const config = workspace.getConfiguration("pdfBilingual");
  return readTranslationConfig((key, fallback) => config.get(key, fallback));
}

/** Local servers (Ollama and the like) usually don't need a key. */
function needsApiKey(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return !["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
  } catch {
    return true;
  }
}

export class TranslationService implements Disposable {
  readonly #context: ExtensionContext;
  readonly #log: LogOutputChannel;
  readonly #disposables: Disposable[] = [];
  #config: TranslationConfig;
  #cache: TranslationCache;
  #translator: Translator | undefined;
  #missingKeyNotified = false;

  readonly #onDidChangeSettings = new EventEmitter<void>();
  /** Fired when `pdfBilingual.*` settings change. */
  readonly onDidChangeSettings = this.#onDidChangeSettings.event;

  constructor(context: ExtensionContext) {
    this.#context = context;
    this.#log = window.createOutputChannel("PDF Bilingual", { log: true });
    this.#config = readConfig();
    this.#cache = new TranslationCache(this.#cacheDir());

    this.#disposables.push(
      this.#log,
      this.#onDidChangeSettings,
      workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("pdfBilingual")) {
          void this.#reset();
          this.#onDidChangeSettings.fire();
        }
      }),
      context.secrets.onDidChange((e) => {
        if (e.key === SECRET_KEY) {
          void this.#reset();
        }
      }),
    );
  }

  get translateRange(): TranslateRange {
    return this.#config.translateRange;
  }

  get log(): LogOutputChannel {
    return this.#log;
  }

  async translate(
    sentences: readonly SourceSentence[],
    options: TranslateOptions,
  ): Promise<{ results: TranslationResult[]; failures: TranslationFailure[] }> {
    const translator = await this.#getTranslator();
    if (translator === undefined) {
      return {
        results: [],
        failures: sentences.map(({ id }) => ({ id, message: "未设置 API Key" })),
      };
    }
    const result = await translator.translate(sentences, options);
    void translator.flush();
    return result;
  }

  async setApiKey(): Promise<void> {
    const key = await window.showInputBox({
      title: "PDF Bilingual: 设置 API Key",
      prompt: `用于 ${this.#config.baseUrl} 的 API Key，保存在 VS Code 的安全存储中`,
      placeHolder: "sk-...",
      password: true,
      ignoreFocusOut: true,
    });
    if (key === undefined) {
      return;
    }
    if (key.trim() === "") {
      await this.#context.secrets.delete(SECRET_KEY);
      void window.showInformationMessage("已删除 API Key。");
      return;
    }
    await this.#context.secrets.store(SECRET_KEY, key.trim());
    this.#missingKeyNotified = false;
    void window.showInformationMessage("API Key 已保存。");
  }

  async clearCache(): Promise<void> {
    const confirm = await window.showWarningMessage(
      "清除所有已缓存的译文？之后再次阅读需要重新调用翻译接口。",
      { modal: true },
      "清除",
    );
    if (confirm !== "清除") {
      return;
    }
    await this.#cache.clear();
    this.#log.info(`已清除翻译缓存：${this.#cache.dir}`);
    void window.showInformationMessage("翻译缓存已清除。");
  }

  dispose(): void {
    void this.#cache.flush();
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
  }

  #cacheDir(): string {
    return this.#config.cacheDir === ""
      ? join(this.#context.globalStorageUri.fsPath, "translation-cache")
      : this.#config.cacheDir;
  }

  async #reset(): Promise<void> {
    await this.#cache.flush();
    this.#config = readConfig();
    this.#cache = new TranslationCache(this.#cacheDir());
    this.#translator = undefined;
  }

  async #getTranslator(): Promise<Translator | undefined> {
    if (this.#translator !== undefined) {
      return this.#translator;
    }
    const config = this.#config;
    const apiKey = (await this.#context.secrets.get(SECRET_KEY)) ?? "";
    if (apiKey === "" && needsApiKey(config.baseUrl)) {
      this.#notifyMissingKey();
      return undefined;
    }
    const client = new OpenAICompatibleClient({
      baseUrl: config.baseUrl,
      apiKey,
      model: config.model,
      temperature: config.temperature,
      timeoutMs: config.requestTimeoutMs,
      extraBody: config.extraBody,
      onRetry: (attempt, error) => this.#log.warn(`第 ${attempt} 次重试：${error.message}`),
    });
    this.#translator = new Translator(
      client,
      this.#cache,
      {
        model: config.model,
        targetLanguage: config.targetLanguage,
        glossary: config.glossary,
        maxCharsPerRequest: config.maxCharsPerRequest,
      },
      (line) => this.#log.info(line),
    );
    this.#log.info(
      `翻译服务：${config.baseUrl}，模型 ${config.model}，缓存目录 ${this.#cache.dir}`,
    );
    return this.#translator;
  }

  #notifyMissingKey(): void {
    if (this.#missingKeyNotified) {
      return;
    }
    this.#missingKeyNotified = true;
    void window
      .showWarningMessage("还没有设置翻译接口的 API Key。", "设置 API Key")
      .then((choice) => {
        if (choice !== undefined) {
          void this.setApiKey();
        }
      });
  }
}
