// The extension host's translation path (service + bridge) against a fake
// VS Code API and a fake DeepSeek endpoint.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostToWebview } from "../src/messages";

type Listener<T> = (event: T) => void;

/** User settings of the fake VS Code (`pararead.*` keys without prefix). */
const settings = vi.hoisted(() => new Map<string, unknown>());
const settingUpdate = vi.hoisted(() =>
  vi.fn(async (key: string, value: unknown) => {
    settings.set(key, value);
  }),
);

vi.mock("vscode", () => {
  class EventEmitter<T> {
    readonly #listeners = new Set<Listener<T>>();
    event = (listener: Listener<T>) => {
      this.#listeners.add(listener);
      return { dispose: () => this.#listeners.delete(listener) };
    };
    fire(event: T) {
      for (const listener of this.#listeners) {
        listener(event);
      }
    }
    dispose() {
      this.#listeners.clear();
    }
  }
  const format = (text: string, ...args: unknown[]) =>
    text.replaceAll(/\{(\d+)\}/gu, (_, i: string) => String(args[Number(i)]));
  return {
    ConfigurationTarget: { Global: 1 },
    EventEmitter,
    env: { language: "zh-cn" },
    l10n: { t: format },
    ProgressLocation: { Notification: 15 },
    window: {
      showQuickPick: vi.fn(async () => undefined),
      createOutputChannel: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        dispose: vi.fn(),
      }),
      showInputBox: vi.fn(async () => "sk-test"),
      showInformationMessage: vi.fn(async () => undefined),
      showWarningMessage: vi.fn(async () => undefined),
    },
    workspace: {
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) => (settings.has(key) ? settings.get(key) : fallback),
        inspect: (key: string) => ({ key, globalValue: settings.get(key) }),
        update: settingUpdate,
      }),
      onDidChangeConfiguration: () => ({ dispose: vi.fn() }),
    },
  };
});

const { TranslationService } = await import("../src/translation/service");
const { TranslationBridge } = await import("../src/translation-bridge");
const vscode = await import("vscode");
const { EventEmitter } = vscode;

type Context = ConstructorParameters<typeof TranslationService>[0];

function fakeContext(secrets: ReturnType<typeof fakeSecrets>, storage: string): Context {
  const state = new Map<string, unknown>();
  return {
    secrets,
    globalStorageUri: { fsPath: storage },
    globalState: {
      get: (key: string, fallback?: unknown) => (state.has(key) ? state.get(key) : fallback),
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
    },
    subscriptions: [],
  } as unknown as Context;
}

/** SecretStorage; `onDidChange` fires only when `fireEvents` is set. */
function fakeSecrets(fireEvents: boolean) {
  const values = new Map<string, string>();
  const changed = new EventEmitter<{ key: string }>();
  return {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => {
      values.set(key, value);
      if (fireEvents) {
        changed.fire({ key });
      }
    },
    delete: async (key: string) => {
      values.delete(key);
      if (fireEvents) {
        changed.fire({ key });
      }
    },
    onDidChange: changed.event,
  };
}

/** Fake chat completions endpoint: translates to `译(<text>)`. */
function fakeDeepSeek(requests: { auth: string | null; system: string }[]) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      messages: { role: string; content: string }[];
    };
    const headers = new Headers(init.headers);
    requests.push({ auth: headers.get("authorization"), system: body.messages[0]?.content ?? "" });
    const { sentences } = JSON.parse(body.messages[1]?.content ?? "{}") as {
      sentences: { id: string; text: string }[];
    };
    const content = JSON.stringify({
      translations: sentences.map((s) => ({ id: s.id, translation: `译(${s.text})` })),
    });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pararead-host-"));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(vscode.window.showInformationMessage).mockReset();
  vi.mocked(vscode.window.showQuickPick).mockReset();
  settingUpdate.mockClear();
  settings.clear();
  vscode.env.language = "zh-cn";
  await rm(dir, { recursive: true, force: true });
});

describe("translation host", () => {
  it.each([true, false])(
    "translates once the API key is set after a failed request (secret events: %s)",
    async (fireEvents) => {
      const requests: { auth: string | null; system: string }[] = [];
      vi.stubGlobal("fetch", fakeDeepSeek(requests));
      const secrets = fakeSecrets(fireEvents);
      const context = fakeContext(secrets, dir);

      const service = new TranslationService(context);
      const bridge = new TranslationBridge(service);
      const keyChanged = vi.fn();
      service.onDidChangeApiKey(keyChanged);

      const posted: HostToWebview[] = [];
      const webview = {
        postMessage: async (message: HostToWebview) => {
          posted.push(message);
          return true;
        },
      } as unknown as Parameters<typeof bridge.handle>[0];
      const done = () =>
        vi.waitFor(() => {
          const last = posted.at(-1);
          if (last?.type !== "translationDone") {
            throw new Error("not done");
          }
          return last;
        });
      const sentences = [{ id: "p1-b1-s1", text: "We propose a new model.", group: "p1-b1" }];

      // No key yet: the sentence fails.
      bridge.handle(webview, { type: "translate", requestId: 1, sentences });
      const failed = await done();
      expect(failed).toMatchObject({ failures: [{ id: "p1-b1-s1" }] });
      expect(requests).toHaveLength(0);

      // Setting the key notifies the viewers...
      await service.setApiKey();
      await vi.waitFor(() => expect(keyChanged).toHaveBeenCalled());

      // ...and the retried request is translated with the key.
      posted.length = 0;
      bridge.handle(webview, { type: "translate", requestId: 2, sentences });
      const finished = await done();
      expect(finished).toMatchObject({ failures: [] });
      expect(posted).toContainEqual({
        type: "translations",
        requestId: 2,
        items: [{ id: "p1-b1-s1", translation: "译(We propose a new model.)" }],
      });
      expect(requests[0]?.auth).toBe("Bearer sk-test");
      expect(requests[0]?.system).toContain("from English into Simplified Chinese");
      service.dispose();
    },
  );

  it("offers to choose a language when the paper is in the automatic target language", async () => {
    const requests: { auth: string | null; system: string }[] = [];
    vi.stubGlobal("fetch", fakeDeepSeek(requests));
    vscode.env.language = "en";
    const secrets = fakeSecrets(false);
    await secrets.store("pararead.apiKey", "sk-test");
    const context = fakeContext(secrets, dir);
    const info = vi.mocked(vscode.window.showInformationMessage);
    info.mockResolvedValueOnce("Choose Language" as never);
    vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
      async (items) =>
        (await items).find((i) => i.description?.startsWith("Simplified Chinese")) as never,
    );

    const service = new TranslationService(context);
    const english = [
      "We propose a new model for translation.",
      "It is based on the attention mechanism.",
      "The results are shown in the table.",
    ].map((text, i) => ({ id: `s${i}`, text }));
    const { results } = await service.translate(english, {});

    // English paper, English VS Code: shown as is, and the user is asked.
    expect(results.map((r) => r.translation)).toEqual(english.map((s) => s.text));
    expect(requests).toHaveLength(0);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("already in English"),
      "Choose Language",
      "Don't Show Again",
    );
    await vi.waitFor(() =>
      expect(settingUpdate).toHaveBeenCalledWith("targetLanguage", "zh-CN", 1),
    );

    // Asked once per session.
    info.mockClear();
    await service.translate(english, {});
    expect(info).not.toHaveBeenCalled();
    vscode.env.language = "zh-cn";
    service.dispose();
  });

  it("confirms the translation language on the first paper and saves the answer", async () => {
    vscode.env.language = "en";
    const service = new TranslationService(fakeContext(fakeSecrets(false), dir));
    const info = vi.mocked(vscode.window.showInformationMessage);
    info.mockResolvedValueOnce("Keep English" as never);

    await service.confirmTargetLanguage();
    expect(info).toHaveBeenCalledWith(
      "ParaRead translates papers into English, the VS Code display language.",
      "Keep English",
      "Choose Language",
    );
    expect(settingUpdate).toHaveBeenCalledWith("targetLanguage", "en", 1);

    // Answered: not asked again, even in a new session.
    info.mockClear();
    await service.confirmTargetLanguage();
    await new TranslationService(fakeContext(fakeSecrets(false), dir)).confirmTargetLanguage();
    expect(info).not.toHaveBeenCalled();
    service.dispose();
  });

  it("asks a dismissed question again on later sessions, three times at most", async () => {
    const context = fakeContext(fakeSecrets(false), dir);
    const info = vi.mocked(vscode.window.showInformationMessage);
    for (let session = 0; session < 5; session++) {
      const service = new TranslationService(context);
      await service.confirmTargetLanguage();
      await service.confirmTargetLanguage();
      service.dispose();
    }
    expect(info).toHaveBeenCalledTimes(3);
    expect(settingUpdate).not.toHaveBeenCalled();
  });

  it("does not ask when the language was already chosen", async () => {
    settings.set("targetLanguage", "auto");
    const service = new TranslationService(fakeContext(fakeSecrets(false), dir));
    await service.confirmTargetLanguage();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    service.dispose();
  });

  it("lists the likely languages first and Auto last", async () => {
    vscode.env.language = "ja";
    const service = new TranslationService(fakeContext(fakeSecrets(false), dir));
    const pick = vi.mocked(vscode.window.showQuickPick);
    await service.chooseTargetLanguage();
    const items = (await pick.mock.calls[0]?.[0]) as { label: string; code: string }[];
    const codes = items.map((i) => i.code);
    expect(codes[0]).toBeDefined();
    expect(codes.slice(0, 2)).toContain("ja");
    expect(codes.at(-1)).toBe("auto");
    expect(new Set(codes).size).toBe(12);
    // "auto" is the current value.
    expect(items.at(-1)?.label).toMatch(/^\$\(check\) /u);
    service.dispose();
  });
});
