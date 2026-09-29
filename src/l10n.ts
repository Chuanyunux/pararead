/**
 * Localization helpers on the extension host side. Strings are looked up with
 * `vscode.l10n` (bundles in `l10n/`); English is the default.
 */

import { l10n } from "vscode";

import { ERROR_MESSAGES, type ErrorCode, type MessageArg } from "./translation/errors";
import { WEBVIEW_STRINGS, type WebviewStrings } from "./webview-strings";

/** Localized message of a translation failure; `fallback` for unknown errors. */
export function localizeError(
  code: ErrorCode | undefined,
  args: readonly MessageArg[] | undefined,
  fallback: string,
): string {
  return code === undefined ? fallback : l10n.t(ERROR_MESSAGES[code], ...(args ?? []));
}

/** Webview texts in the display language, placeholders left for the webview. */
export function webviewStrings(): WebviewStrings {
  const entries = Object.entries(WEBVIEW_STRINGS).map(([key, text]) => [
    key,
    // Passing "{0}" back as the argument keeps the placeholder in the result.
    l10n.t(text, "{0}"),
  ]);
  return Object.fromEntries(entries) as WebviewStrings;
}
