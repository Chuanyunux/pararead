/**
 * VS Code side of translation: settings, API key in SecretStorage, the disk
 * cache location, logging, and the commands that don't need a viewer.
 */

import { join } from "node:path";

import {
  ConfigurationTarget,
  type Disposable,
  env,
  EventEmitter,
  type ExtensionContext,
  l10n,
  type LogOutputChannel,
  window,
  workspace,
} from "vscode";

import { LANGUAGES, languageInfo, resolveTargetLanguage } from "../languages";
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
export const CHOOSE_TARGET_LANGUAGE_COMMAND = "pararead.chooseTargetLanguage";

/**
 * Share of a request's sentences shown untranslated, above which an automatic
 * target language probably matches the paper's language.
 */
const PASS_THROUGH_SHARE = 0.5;

/** globalState keys. */
const CONFIRMATIONS_KEY = "pararead.targetLanguageConfirmations";
const PASS_THROUGH_MUTED_KEY = "pararead.passThroughHintMuted";
/** How often an unanswered translation language question is asked. */
const MAX_CONFIRMATIONS = 3;

/** Whether the user never set `pararead.targetLanguage` (not even to "auto"). */
function targetLanguageUnset(): boolean {
  const inspected = workspace.getConfiguration("pararead").inspect("targetLanguage");
  return (
    inspected?.globalValue === undefined &&
    inspected?.workspaceValue === undefined &&
    inspected?.workspaceFolderValue === undefined
  );
}

function saveTargetLanguage(code: string): Thenable<void> {
  return workspace
    .getConfiguration("pararead")
    .update("targetLanguage", code, ConfigurationTarget.Global);
}

/** Supported language of a locale such as "zh-CN" or "de-AT", if any. */
function supportedLanguageOf(locale: string): string | undefined {
  const code = resolveTargetLanguage("auto", locale);
  const matches = locale.toLowerCase().startsWith(code.slice(0, 2).toLowerCase());
  return matches ? code : undefined;
}

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
  #passThroughNotified = false;
  #confirmationShown = false;

  readonly #onDidChangeSettings = new EventEmitter<void>();
  /** Fired when `pararead.*` settings change. */
  readonly onDidChangeSettings = this.#onDidChangeSettings.event;
  readonly #onDidChangeApiKey = new EventEmitter<void>();
  /** Fired when the API key is set or removed. */
  readonly onDidChangeApiKey = this.#onDidChangeApiKey.event;

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
      this.#onDidChangeApiKey,
      // Changes from other windows.
      context.secrets.onDidChange((e) => {
        if (e.key === SECRET_KEY) {
          void this.#keyChanged();
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
    const passedThrough = result.results.filter((r) => r.cacheKey === "").length;
    if (passedThrough >= 3 && passedThrough >= sentences.length * PASS_THROUGH_SHARE) {
      this.#notifyPassThrough();
    }
    return result;
  }

  /**
   * On opening a paper, while the translation language was never set: says
   * which language translations are in (derived from the VS Code display
   * language) and offers to change it. Either answer saves the setting; a
   * dismissed message comes back on a later paper, a few times at most.
   */
  async confirmTargetLanguage(): Promise<void> {
    const { globalState } = this.#context;
    const asked = globalState.get<number>(CONFIRMATIONS_KEY, 0);
    if (this.#confirmationShown || asked >= MAX_CONFIRMATIONS || !targetLanguageUnset()) {
      return;
    }
    this.#confirmationShown = true;
    await globalState.update(CONFIRMATIONS_KEY, asked + 1);
    const code = this.#config.targetLanguage;
    const name = languageInfo(code)?.nativeName ?? code;
    const keep = l10n.t("Keep {0}", name);
    const choose = l10n.t("Choose Language");
    const choice = await window.showInformationMessage(
      l10n.t("ParaRead translates papers into {0}, the VS Code display language.", name),
      keep,
      choose,
    );
    if (choice === keep) {
      await saveTargetLanguage(code);
    } else if (choice === choose) {
      await this.chooseTargetLanguage();
    }
  }

  /** Quick pick for `pararead.targetLanguage`, saved in the user settings. */
  async chooseTargetLanguage(): Promise<void> {
    const current = this.#config.targetLanguageIsAuto ? "auto" : this.#config.targetLanguage;
    // Likely choices first: the system language, then the VS Code display language.
    const suggested = new Map<string, string>();
    const system = supportedLanguageOf(Intl.DateTimeFormat().resolvedOptions().locale);
    if (system !== undefined) {
      suggested.set(system, l10n.t("System language"));
    }
    const display = supportedLanguageOf(env.language);
    if (display !== undefined && !suggested.has(display)) {
      suggested.set(display, l10n.t("VS Code display language"));
    }
    const languages = [
      ...LANGUAGES.filter((l) => suggested.has(l.code)).toSorted(
        (a, b) => [...suggested.keys()].indexOf(a.code) - [...suggested.keys()].indexOf(b.code),
      ),
      ...LANGUAGES.filter((l) => !suggested.has(l.code)),
    ];
    const items = [
      ...languages.map((l) => {
        const hint = suggested.get(l.code);
        return {
          label: l.nativeName,
          description: hint === undefined ? l.englishName : `${l.englishName} · ${hint}`,
          code: l.code,
        };
      }),
      {
        label: l10n.t("Auto"),
        description: l10n.t("Follow the VS Code display language"),
        code: "auto",
      },
    ].map((item) => (item.code === current ? { ...item, label: `$(check) ${item.label}` } : item));
    const choice = await window.showQuickPick(items, {
      title: l10n.t("ParaRead: Translation Language"),
      placeHolder: l10n.t("Language to translate papers into"),
      matchOnDescription: true,
    });
    if (choice !== undefined) {
      await saveTargetLanguage(choice.code);
    }
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
      await this.#keyChanged();
      void window.showInformationMessage(l10n.t("The API key was removed."));
      return;
    }
    await this.#context.secrets.store(SECRET_KEY, key.trim());
    this.#missingKeyNotified = false;
    // Don't rely on `secrets.onDidChange` for changes made in this window.
    await this.#keyChanged();
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

  /** Rebuilds the translator with the new key and tells the viewers to retry. */
  async #keyChanged(): Promise<void> {
    await this.#reset();
    this.#onDidChangeApiKey.fire();
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
        sourceLanguage: config.sourceLanguage,
        glossary: config.glossary,
        maxCharsPerRequest: config.maxCharsPerRequest,
      },
      (line) => this.#log.info(line),
    );
    this.#log.info(
      `Translation API ${config.baseUrl}, model ${config.model}, ${config.sourceLanguage} → ${config.targetLanguage}, cache ${this.#cache.dir}`,
    );
    return this.#translator;
  }

  /**
   * Most sentences are already in the automatic target language (e.g. an
   * English paper with an English VS Code): offer to choose another language.
   */
  #notifyPassThrough(): void {
    const { globalState } = this.#context;
    if (
      this.#passThroughNotified ||
      // The language question of this session covers it.
      this.#confirmationShown ||
      !this.#config.targetLanguageIsAuto ||
      globalState.get<boolean>(PASS_THROUGH_MUTED_KEY, false)
    ) {
      return;
    }
    this.#passThroughNotified = true;
    const language = languageInfo(this.#config.targetLanguage)?.nativeName ?? "";
    const choose = l10n.t("Choose Language");
    const mute = l10n.t("Don't Show Again");
    void window
      .showInformationMessage(
        l10n.t(
          "The paper is already in {0}, the VS Code display language, so it is shown untranslated. Choose the language to translate into?",
          language,
        ),
        choose,
        mute,
      )
      .then((choice) => {
        if (choice === choose) {
          void this.chooseTargetLanguage();
        } else if (choice === mute) {
          void globalState.update(PASS_THROUGH_MUTED_KEY, true);
        }
      });
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
