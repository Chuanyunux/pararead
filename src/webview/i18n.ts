/** Texts of the webview, localized by the extension host (English by default). */

import { WEBVIEW_STRINGS, type WebviewStringKey, type WebviewStrings } from "../webview-strings";

let strings: WebviewStrings = { ...WEBVIEW_STRINGS };

/** Installs the localized texts from the webview configuration. */
export function setStrings(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  const next: WebviewStrings = { ...WEBVIEW_STRINGS };
  for (const key of Object.keys(WEBVIEW_STRINGS) as WebviewStringKey[]) {
    const text = (value as Record<string, unknown>)[key];
    if (typeof text === "string" && text !== "") {
      next[key] = text;
    }
  }
  strings = next;
}

export function t(key: WebviewStringKey, ...args: (string | number)[]): string {
  return strings[key].replaceAll(/\{(\d+)\}/gu, (match, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? match : String(value);
  });
}
