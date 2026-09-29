/** Minimal OpenAI-compatible chat completion client with timeout and retries. */

import { type ErrorCode, type MessageArg, TranslationError } from "./errors";
import type { ChatMessage } from "./prompt";

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  /** DeepSeek context-cache hits (`prompt_cache_hit_tokens`), when reported. */
  promptCacheHitTokens?: number;
}

export interface Completion {
  content: string;
  usage?: Usage;
}

export interface ChatClient {
  complete(
    messages: ChatMessage[],
    options: { maxTokens: number; signal?: AbortSignal },
  ): Promise<Completion>;
}

export class ApiError extends TranslationError {
  readonly status: number | undefined;
  readonly retryable: boolean;
  /** Server-requested delay (`Retry-After`) before the next attempt. */
  readonly retryAfterMs: number | undefined;

  constructor(
    code: ErrorCode,
    args: readonly MessageArg[],
    status: number | undefined,
    retryable: boolean,
    retryAfterMs?: number,
  ) {
    super(code, args);
    this.name = "ApiError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  extraBody: Record<string, unknown>;
  /** Attempts after the first one, for rate limits, server and network errors. */
  retries?: number;
  fetch?: typeof fetch;
  /** Base delay of the exponential backoff. */
  retryDelayMs?: number;
  onRetry?: (attempt: number, error: ApiError) => void;
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

/** Specific explanations for errors that retrying cannot fix. */
const STATUS_CODES: Record<number, ErrorCode> = {
  400: "badRequest",
  401: "unauthorized",
  402: "insufficientBalance",
  404: "notFound",
  422: "invalidParams",
};

export class OpenAICompatibleClient implements ChatClient {
  readonly #options: Required<Omit<ClientOptions, "onRetry">> & Pick<ClientOptions, "onRetry">;

  constructor(options: ClientOptions) {
    this.#options = {
      retries: 3,
      fetch: globalThis.fetch.bind(globalThis),
      retryDelayMs: 1000,
      ...options,
    };
  }

  async complete(
    messages: ChatMessage[],
    { maxTokens, signal }: { maxTokens: number; signal?: AbortSignal },
  ): Promise<Completion> {
    const { retries, retryDelayMs, onRetry } = this.#options;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#request(messages, maxTokens, signal);
      } catch (error) {
        if (signal?.aborted) {
          throw signal.reason ?? error;
        }
        if (!(error instanceof ApiError) || !error.retryable || attempt >= retries) {
          throw error;
        }
        onRetry?.(attempt + 1, error);
        const backoff = retryDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
        await delay(error.retryAfterMs ?? backoff, signal);
      }
    }
  }

  async #request(
    messages: ChatMessage[],
    maxTokens: number,
    signal: AbortSignal | undefined,
  ): Promise<Completion> {
    const { baseUrl, apiKey, model, temperature, timeoutMs, extraBody, fetch } = this.#options;
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/+$/u, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey === "" ? {} : { authorization: `Bearer ${apiKey}` }),
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          stream: false,
          ...extraBody,
        }),
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      throw timeout.aborted
        ? new ApiError("timeout", [Math.round(timeoutMs / 1000)], undefined, true)
        : new ApiError("network", [String(error)], undefined, true);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const retryAfter = Number(response.headers.get("retry-after"));
      const code = STATUS_CODES[response.status];
      throw new ApiError(
        code ?? "http",
        code === undefined ? [response.status, detail.slice(0, 200)] : [],
        response.status,
        RETRYABLE_STATUS.has(response.status),
        Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : undefined,
      );
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
      };
    };
    const usage = body.usage;
    return {
      content: body.choices?.[0]?.message?.content ?? "",
      ...(usage === undefined
        ? {}
        : {
            usage: {
              promptTokens: usage.prompt_tokens ?? 0,
              completionTokens: usage.completion_tokens ?? 0,
              ...(usage.prompt_cache_hit_tokens === undefined
                ? {}
                : { promptCacheHitTokens: usage.prompt_cache_hit_tokens }),
            },
          }),
    };
  }
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
