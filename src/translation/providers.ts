/**
 * Presets of OpenAI-compatible translation services, and the request fields
 * a service needs by default. Independent of the VS Code API.
 */

export interface Provider {
  id: string;
  /** Brand name; not translated. */
  name: string;
  baseUrl: string;
  /** Suggested model; the user can change it (names change often). */
  model: string;
  /** Runs on this machine and needs no API key. */
  local?: boolean;
}

export const PROVIDERS: readonly Provider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
  },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  {
    id: "qwen",
    name: "Qwen (Alibaba Cloud Model Studio)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  {
    id: "kimi",
    name: "Kimi (Moonshot AI)",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-32k",
  },
  {
    id: "glm",
    name: "GLM (Zhipu AI)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
  },
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    local: true,
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    model: "",
    local: true,
  },
];

function normalize(url: string): string {
  return url.trim().replace(/\/+$/u, "").toLowerCase();
}

/** The preset whose address is `baseUrl`, if any. */
export function providerFor(baseUrl: string): Provider | undefined {
  const url = normalize(baseUrl);
  return PROVIDERS.find((p) => normalize(p.baseUrl) === url);
}

/** Local servers (Ollama and the like) usually don't need a key. */
export function needsApiKey(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return !["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
  } catch {
    return true;
  }
}

function isDeepSeek(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.deepseek.com";
  } catch {
    return false;
  }
}

/**
 * Extra request body fields: the user's `extraBody`, plus defaults of the
 * service. DeepSeek thinks before answering unless told not to, which is slow
 * and costly for translation; other services may reject that field.
 */
export function requestExtras(
  baseUrl: string,
  extraBody: Record<string, unknown>,
): Record<string, unknown> {
  if (isDeepSeek(baseUrl) && !("thinking" in extraBody)) {
    return { thinking: { type: "disabled" }, ...extraBody };
  }
  return extraBody;
}
