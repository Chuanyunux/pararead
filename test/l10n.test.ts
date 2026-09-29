import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ERROR_MESSAGES, formatMessage, TranslationError } from "../src/translation/errors";
import { WEBVIEW_STRINGS } from "../src/webview-strings";

const ROOT = join(import.meta.dirname, "..");
const readJson = (path: string) =>
  JSON.parse(readFileSync(join(ROOT, path), "utf8")) as Record<string, unknown>;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

/** First-argument string literals of `l10n.t(...)` calls in the sources. */
function l10nLiterals(): string[] {
  const literals: string[] = [];
  const call = /l10n\.t\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gu;
  for (const file of sourceFiles(join(ROOT, "src"))) {
    for (const match of readFileSync(file, "utf8").matchAll(call)) {
      const raw = match[2] ?? "";
      literals.push(raw.replaceAll(/\\(.)/gu, "$1"));
    }
  }
  return literals;
}

const placeholders = (text: string) => [...text.matchAll(/\{\d+\}/gu)].map((m) => m[0]).toSorted();

describe("package.json localization", () => {
  const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
  const used = new Set([...pkg.matchAll(/"%([^%"]+)%"/gu)].map((m) => m[1]));
  const english = readJson("package.nls.json");
  const chinese = readJson("package.nls.zh-cn.json");

  it("defines every %key% in English and Chinese, without unused keys", () => {
    expect(used.size).toBeGreaterThan(0);
    expect(Object.keys(english).toSorted()).toEqual([...used].toSorted());
    expect(Object.keys(chinese).toSorted()).toEqual([...used].toSorted());
  });

  it("has no empty texts", () => {
    for (const texts of [english, chinese]) {
      for (const value of Object.values(texts)) {
        expect(typeof value === "string" && value.trim() !== "").toBe(true);
      }
    }
  });
});

describe("l10n bundle", () => {
  const bundle = readJson("l10n/bundle.l10n.zh-cn.json") as Record<string, string>;
  const expected = new Set([
    ...l10nLiterals(),
    ...Object.values(ERROR_MESSAGES),
    ...Object.values(WEBVIEW_STRINGS),
  ]);

  it("translates every string of the code, error and webview texts", () => {
    const missing = [...expected].filter((key) => !(key in bundle));
    expect(missing).toEqual([]);
  });

  it("has no stale entries", () => {
    const stale = Object.keys(bundle).filter((key) => !expected.has(key));
    expect(stale).toEqual([]);
  });

  it("keeps the placeholders of each message", () => {
    for (const [key, value] of Object.entries(bundle)) {
      expect(placeholders(value), key).toEqual(placeholders(key));
    }
  });
});

describe("error messages", () => {
  it("formats arguments into the English templates", () => {
    expect(formatMessage("Request timed out ({0} s).", [60])).toBe("Request timed out (60 s).");
    expect(formatMessage("{0} / {1}", [3])).toBe("3 / {1}");
    const error = new TranslationError("http", [503, "busy"]);
    expect(error.message).toBe("The translation API returned error 503: busy");
    expect(error.code).toBe("http");
  });
});
