/**
 * Translates sentences: cache lookup, batching by character budget, bounded
 * concurrency, validation, and per-sentence retries for missing ids. Only
 * successful translations are cached.
 */

import { AUTO_SOURCE, detectLanguage, isAlreadyInLanguage, languageInfo } from "../languages";
import { cacheKey, type TranslationCache } from "./cache";
import { ApiError, type ChatClient } from "./client";
import { type ErrorCode, errorDetails, type MessageArg, TranslationError } from "./errors";
import { parseTranslations } from "./parse";
import {
  buildMessages,
  buildSystemPrompt,
  glossaryHash,
  PROMPT_VERSION,
  type SourceSentence,
} from "./prompt";

export interface TranslationResult {
  id: string;
  translation: string;
  cacheKey: string;
}

export interface TranslationFailure {
  id: string;
  /** English message. */
  message: string;
  /** For localized display, when the error is a known one. */
  code?: ErrorCode;
  args?: readonly MessageArg[];
}

export interface TranslatorOptions {
  model: string;
  targetLanguage: string;
  /** Language code, or "auto" to detect it per request. */
  sourceLanguage?: string;
  glossary: Record<string, string>;
  maxCharsPerRequest: number;
  /** Parallel API requests. */
  concurrency?: number;
  /** Upper bound on sentences per request, to keep replies small. */
  maxSentencesPerRequest?: number;
}

export interface TranslatorStats {
  apiCalls: number;
  cacheHits: number;
  translated: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
  promptCacheHitTokens: number;
}

export interface TranslateOptions {
  signal?: AbortSignal;
  /** Called as soon as each translation is available (cache or API). */
  onResult?: (result: TranslationResult) => void;
}

interface Pending {
  key: string;
  text: string;
  group: string | undefined;
  resolve: (translation: string) => void;
  reject: (error: Error) => void;
}

export class Translator {
  readonly #client: ChatClient;
  readonly #cache: TranslationCache;
  readonly #options: Required<TranslatorOptions>;
  /** System prompts by source language, built on first use. */
  readonly #systemPrompts = new Map<string, string>();
  readonly #glossaryHash: string;
  readonly #inflight = new Map<string, Promise<string>>();
  readonly #slots: Semaphore;
  readonly #log: (line: string) => void;
  readonly stats: TranslatorStats = {
    apiCalls: 0,
    cacheHits: 0,
    translated: 0,
    failed: 0,
    promptTokens: 0,
    completionTokens: 0,
    promptCacheHitTokens: 0,
  };

  constructor(
    client: ChatClient,
    cache: TranslationCache,
    options: TranslatorOptions,
    log: (line: string) => void = () => {},
  ) {
    this.#client = client;
    this.#cache = cache;
    this.#options = {
      concurrency: 2,
      maxSentencesPerRequest: 40,
      sourceLanguage: AUTO_SOURCE,
      ...options,
    };
    // Fails early on an unsupported target language.
    this.#systemPromptFor(this.#options.sourceLanguage);
    this.#glossaryHash = glossaryHash(options.glossary);
    this.#slots = new Semaphore(this.#options.concurrency);
    this.#log = log;
  }

  /** Writes pending cache entries to disk. */
  flush(): Promise<void> {
    return this.#cache.flush();
  }

  keyFor(text: string): string {
    return cacheKey({
      text,
      model: this.#options.model,
      targetLanguage: this.#options.targetLanguage,
      promptVersion: PROMPT_VERSION,
      glossaryHash: this.#glossaryHash,
    });
  }

  async translate(
    sentences: readonly SourceSentence[],
    { signal, onResult }: TranslateOptions = {},
  ): Promise<{ results: TranslationResult[]; failures: TranslationFailure[] }> {
    // Sentences already in the target language are shown as they are.
    const results: TranslationResult[] = [];
    const toTranslate: SourceSentence[] = [];
    for (const sentence of sentences) {
      const { targetLanguage, sourceLanguage } = this.#options;
      if (isAlreadyInLanguage(sentence.text, targetLanguage, sourceLanguage)) {
        const result = { id: sentence.id, translation: sentence.text, cacheKey: "" };
        results.push(result);
        onResult?.(result);
      } else {
        toTranslate.push(sentence);
      }
    }

    // Identical sentences (same cache key) are translated once.
    const idsByKey = new Map<string, { text: string; group: string | undefined; ids: string[] }>();
    for (const { id, text, group } of toTranslate) {
      const key = this.keyFor(text);
      const entry = idsByKey.get(key);
      if (entry === undefined) {
        idsByKey.set(key, { text, group, ids: [id] });
      } else {
        entry.ids.push(id);
      }
    }

    const pending: Pending[] = [];
    const waits: Promise<void>[] = [];
    const failures: TranslationFailure[] = [];
    let cacheHits = 0;

    const settle = (key: string, ids: string[], promise: Promise<string>) =>
      promise.then(
        (translation) => {
          for (const id of ids) {
            const result = { id, translation, cacheKey: key };
            results.push(result);
            onResult?.(result);
          }
        },
        (error: unknown) => {
          for (const id of ids) {
            failures.push({ id, ...errorDetails(error) });
          }
        },
      );

    // Register every new key as in flight synchronously, before any await, so
    // that a concurrent call for the same sentence waits instead of requesting.
    const owned: Pending[] = [];
    for (const [key, { text, group, ids }] of idsByKey) {
      const inflight = this.#inflight.get(key);
      if (inflight !== undefined) {
        waits.push(settle(key, ids, inflight));
        continue;
      }
      let entry!: Pending;
      const promise = new Promise<string>((resolve, reject) => {
        entry = { key, text, group, resolve, reject };
      });
      this.#inflight.set(key, promise);
      void promise
        .finally(() => this.#inflight.delete(key))
        .catch(() => {
          // Failures are reported through `settle`.
        });
      owned.push(entry);
      waits.push(settle(key, ids, promise));
    }

    for (const entry of owned) {
      const cached = await this.#cache.get(entry.key);
      if (cached === undefined) {
        pending.push(entry);
      } else {
        cacheHits++;
        entry.resolve(cached);
      }
    }

    this.stats.cacheHits += cacheHits;
    if (pending.length > 0 || cacheHits > 0) {
      this.#log(`Cache: ${cacheHits} hit, ${pending.length} to translate`);
    }
    await Promise.all(this.#batches(pending).map((batch) => this.#runBatch(batch, signal)));
    await Promise.all(waits);
    return { results, failures };
  }

  /**
   * Packs sentences into requests by character budget, keeping each paragraph
   * in one request unless the paragraph alone exceeds the budget.
   */
  #batches(pending: Pending[]): Pending[][] {
    const { maxCharsPerRequest, maxSentencesPerRequest } = this.#options;
    const groups: Pending[][] = [];
    for (const entry of pending) {
      const last = groups.at(-1);
      if (last !== undefined && entry.group !== undefined && last[0]?.group === entry.group) {
        last.push(entry);
      } else {
        groups.push([entry]);
      }
    }

    const batches: Pending[][] = [];
    let batch: Pending[] = [];
    let chars = 0;
    const flush = () => {
      if (batch.length > 0) {
        batches.push(batch);
        batch = [];
        chars = 0;
      }
    };
    for (const group of groups) {
      const groupChars = group.reduce((sum, e) => sum + e.text.length, 0);
      if (
        chars + groupChars > maxCharsPerRequest ||
        batch.length + group.length > maxSentencesPerRequest
      ) {
        flush();
      }
      for (const entry of group) {
        // An oversized paragraph is split across requests.
        if (
          batch.length > 0 &&
          (chars + entry.text.length > maxCharsPerRequest || batch.length >= maxSentencesPerRequest)
        ) {
          flush();
        }
        batch.push(entry);
        chars += entry.text.length;
      }
    }
    flush();
    return batches;
  }

  async #runBatch(batch: Pending[], signal: AbortSignal | undefined): Promise<void> {
    // Batch-local ids keep requests independent of page ids and let
    // identical sentences from different pages share one request.
    const sentences = batch.map((entry, i) => ({ id: `s${i + 1}`, text: entry.text }));
    const source = this.#sourceOf(sentences);
    let found: Map<string, string>;
    try {
      const completion = await this.#slots.run(() => {
        signal?.throwIfAborted();
        this.stats.apiCalls++;
        return this.#client.complete(buildMessages(this.#systemPromptFor(source), sentences), {
          maxTokens: maxTokensFor(sentences, source),
          ...(signal === undefined ? {} : { signal }),
        });
      });
      this.#recordUsage(completion.usage);
      found = parseTranslations(
        completion.content,
        sentences.map((s) => s.id),
      ).found;
    } catch (error) {
      const fatal =
        signal?.aborted === true ||
        (error instanceof ApiError && !error.retryable) ||
        batch.length === 1;
      if (fatal) {
        this.#fail(batch, error);
        return;
      }
      // A transient failure of a multi-sentence request: retry one by one.
      this.#log(
        `Batch request failed (${String(error)}); retrying ${batch.length} sentences one by one`,
      );
      await Promise.all(batch.map((entry) => this.#runBatch([entry], signal)));
      return;
    }

    const missing: Pending[] = [];
    for (const [i, entry] of batch.entries()) {
      const translation = found.get(`s${i + 1}`);
      if (translation === undefined) {
        missing.push(entry);
        continue;
      }
      await this.#cache.set(entry.key, translation);
      this.stats.translated++;
      entry.resolve(translation);
    }

    if (missing.length === 0) {
      return;
    }
    if (batch.length === 1) {
      this.#fail(missing, new TranslationError("noTranslation"));
      return;
    }
    this.#log(`Reply is missing ${missing.length} sentences; retrying them one by one`);
    await Promise.all(missing.map((entry) => this.#runBatch([entry], signal)));
  }

  /**
   * Source language of a request: the setting, or else detected from the
   * request's text as a whole; "auto" when unsure.
   */
  #sourceOf(sentences: readonly SourceSentence[]): string {
    const { sourceLanguage } = this.#options;
    if (sourceLanguage !== AUTO_SOURCE) {
      return sourceLanguage;
    }
    return detectLanguage(sentences.map((s) => s.text).join(" ")) ?? AUTO_SOURCE;
  }

  #systemPromptFor(source: string): string {
    let prompt = this.#systemPrompts.get(source);
    if (prompt === undefined) {
      prompt = buildSystemPrompt(this.#options.glossary, this.#options.targetLanguage, source);
      this.#systemPrompts.set(source, prompt);
    }
    return prompt;
  }

  #fail(entries: Pending[], error: unknown): void {
    const reason = error instanceof Error ? error : new Error(String(error));
    this.stats.failed += entries.length;
    this.#log(`Failed to translate ${entries.length} sentences: ${reason.message}`);
    for (const entry of entries) {
      entry.reject(reason);
    }
  }

  #recordUsage(
    usage:
      | { promptTokens: number; completionTokens: number; promptCacheHitTokens?: number }
      | undefined,
  ) {
    if (usage === undefined) {
      return;
    }
    this.stats.promptTokens += usage.promptTokens;
    this.stats.completionTokens += usage.completionTokens;
    this.stats.promptCacheHitTokens += usage.promptCacheHitTokens ?? 0;
    this.#log(
      `API call: ${usage.promptTokens} input tokens (${usage.promptCacheHitTokens ?? 0} from context cache), ${usage.completionTokens} output tokens`,
    );
  }
}

/**
 * Output budget: translation plus JSON overhead, with headroom against
 * truncation. A character of Chinese, Japanese or Korean carries more meaning
 * than a letter, so their translations need more tokens per source character.
 */
function maxTokensFor(sentences: SourceSentence[], source: string): number {
  const chars = sentences.reduce((sum, s) => sum + s.text.length, 0);
  const script = languageInfo(source)?.script;
  const perChar = script === "han" || script === "kana" || script === "hangul" ? 1.5 : 0.8;
  return Math.min(8192, Math.ceil(chars * perChar) + 30 * sentences.length + 256);
}

class Semaphore {
  #available: number;
  readonly #queue: (() => void)[] = [];

  constructor(count: number) {
    this.#available = Math.max(1, count);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#available > 0) {
      this.#available--;
    } else {
      await new Promise<void>((resolve) => {
        this.#queue.push(resolve);
      });
    }
    try {
      return await task();
    } finally {
      const next = this.#queue.shift();
      if (next === undefined) {
        this.#available++;
      } else {
        next();
      }
    }
  }
}
