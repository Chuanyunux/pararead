/**
 * Texts shown by the webview. The English defaults double as `vscode.l10n`
 * keys: the extension host localizes them and passes them to the webview.
 * `{0}` is replaced by an argument.
 */

export const WEBVIEW_STRINGS = {
  panelTitle: "Translation",
  sourceButton: "Original",
  sourceButtonTitle: "Show the original text under each paragraph",
  togglePanel: "Show or hide the translation panel",
  emptyHint:
    "Scroll the PDF to see translations. Rest the pointer on a sentence to compare it; click empty space to clear.",
  page: "Page {0}",
  figureText: "[Figure text]",
  translationFailed: "Translation failed, click to retry: {0}",
} as const;

export type WebviewStringKey = keyof typeof WEBVIEW_STRINGS;
export type WebviewStrings = Record<WebviewStringKey, string>;
