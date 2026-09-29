// The extension host's translation path (service + bridge) against a fake
// VS Code API and a fake DeepSeek endpoint.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostToWebview } from "../src/messages";

type Listener<T> = (event: T) => void;

const settingUpdate = vi.hoisted(() => vi.fn(async () => undefined));

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
        get: (_key: string, fallback: unknown) => fallback,
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
  await rm(dir, { recursive: true, force: true });
});

describe("translation host", () => {
  it.each([true, false])(
    "translates once the API key is set after a failed request (secret events: %s)",
    async (fireEvents) => {
      const requests: { auth: string | null; system: string }[] = [];
      vi.stubGlobal("fetch", fakeDeepSeek(requests));
      const secrets = fakeSecrets(fireEvents);
      const context = {
        secrets,
        globalStorageUri: { fsPath: dir },
        subscriptions: [],
      } as unknown as ConstructorParameters<typeof TranslationService>[0];

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
    const context = {
      secrets,
      globalStorageUri: { fsPath: dir },
      subscriptions: [],
    } as unknown as ConstructorParameters<typeof TranslationService>[0];
    const info = vi.mocked(vscode.window.showInformationMessage);
    info.mockResolvedValueOnce("Choose Language" as never);
    vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
      async (items) => (await items).find((i) => i.description === "Simplified Chinese") as never,
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
});
