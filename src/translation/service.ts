/**
 * VS Code side of translation: settings, API key in SecretStorage, the disk
 * cache location, logging, and the commands that don't need a viewer.
 */

import { join } from "node:path";

import {
  type Disposable,
  env,
  EventEmitter,
  type ExtensionContext,
  l10n,
  type LogOutputChannel,
  window,
  workspace,
} from "vscode";

import type { TranslateRange } from "../messages";
import { TranslationCache } from "./cache";
import { OpenAICompatibleClient } from "./client";
import { readTranslationConfig, type TranslationConfig } from "./config";
import { ERROR_MESSAGES } from "./errors";
import type { SourceSentence } from "./prompt";
import {
  type TranslateOptions,
  type TranslationFailure,
  type TranslationResult,
  Translator,
} from "./translator";

const SECRET_KEY = "pararead.apiKey";
export const SET_API_KEY_COMMAND = "pararead.setApiKey";

function readConfig(): TranslationConfig {
  const config = workspace.getConfiguration("pararead");
  return readTranslationConfig((key, fallback) => config.get(key, fallback), env.language);
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
  /** Fired when `pararead.*` settings change. */
  readonly onDidChangeSettings = this.#onDidChangeSettings.event;

  constructor(context: ExtensionContext) {
    this.#context = context;
    this.#log = window.createOutputChannel("ParaRead", { log: true });
    this.#config = readConfig();
    this.#cache = new TranslationCache(this.#cacheDir());

    this.#disposables.push(
      this.#log,
      this.#onDidChangeSettings,
      workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("pararead")) {
          // Notify only once the new settings are read.
          void this.#reset().then(() => this.#onDidChangeSettings.fire());
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

  /** Resolved target language code (never "auto"). */
  get targetLanguage(): string {
    return this.#config.targetLanguage;
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
        failures: sentences.map(({ id }) => ({
          id,
          message: ERROR_MESSAGES.noApiKey,
          code: "noApiKey" as const,
        })),
      };
    }
    const result = await translator.translate(sentences, options);
    void translator.flush();
    return result;
  }

  async setApiKey(): Promise<void> {
    const key = await window.showInputBox({
      title: l10n.t("ParaRead: Set API Key"),
      prompt: l10n.t(
        "API key for {0}. It is kept in VS Code's secret storage.",
        this.#config.baseUrl,
      ),
      placeHolder: "sk-...",
      password: true,
      ignoreFocusOut: true,
    });
    if (key === undefined) {
      return;
    }
    if (key.trim() === "") {
      await this.#context.secrets.delete(SECRET_KEY);
      void window.showInformationMessage(l10n.t("The API key was removed."));
      return;
    }
    await this.#context.secrets.store(SECRET_KEY, key.trim());
    this.#missingKeyNotified = false;
    void window.showInformationMessage(l10n.t("The API key was saved."));
  }

  async clearCache(): Promise<void> {
    const clear = l10n.t("Clear");
    const confirm = await window.showWarningMessage(
      l10n.t("Clear all cached translations? Papers will need to be translated again."),
      { modal: true },
      clear,
    );
    if (confirm !== clear) {
      return;
    }
    await this.#cache.clear();
    this.#log.info(`Cleared the translation cache: ${this.#cache.dir}`);
    void window.showInformationMessage(l10n.t("The translation cache was cleared."));
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
      onRetry: (attempt, error) => this.#log.warn(`Retry ${attempt}: ${error.message}`),
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
      `Translation API ${config.baseUrl}, model ${config.model}, target language ${config.targetLanguage}, cache ${this.#cache.dir}`,
    );
    return this.#translator;
  }

  #notifyMissingKey(): void {
    if (this.#missingKeyNotified) {
      return;
    }
    this.#missingKeyNotified = true;
    void window
      .showWarningMessage(
        l10n.t("The API key of the translation service is not set yet."),
        l10n.t("Set API Key"),
      )
      .then((choice) => {
        if (choice !== undefined) {
          void this.setApiKey();
        }
      });
  }
}
