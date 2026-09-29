/** Messages between the extension host and the viewer webview. */

export type TranslateRange = "page" | "nearby" | "manual";

export interface SentenceToTranslate {
  id: string;
  text: string;
  /** Paragraph (block) id, used to batch a paragraph into one request. */
  group: string;
}

export interface TranslatedItem {
  id: string;
  translation: string;
}

export interface FailedItem {
  id: string;
  message: string;
}

export type HostToWebview =
  /** Reopen the document from disk (external change or revert). */
  | { type: "reload" }
  /** Ask for the current document bytes, including annotation edits. */
  | { type: "getData"; requestId: number }
  /** The document was written; the webview resets its modified state. */
  | { type: "saved" }
  /** Translations for a `translate` request; may arrive in several parts. */
  | { type: "translations"; requestId: number; items: TranslatedItem[] }
  /** A `translate` request finished; `failures` were not translated. */
  | { type: "translationDone"; requestId: number; failures: FailedItem[] }
  /** Command: translate the current page now. */
  | { type: "translateCurrentPage" }
  /** Command: translate the whole document as job `jobId`. */
  | { type: "translateAll"; jobId: number }
  | { type: "cancelTranslateAll"; jobId: number }
  /** The API key changed: failed sentences may succeed now. */
  | { type: "retryFailed" }
  | {
      type: "settings";
      translateRange: TranslateRange;
      selectOnHover: boolean;
      /** Resolved target language code. */
      targetLanguage: string;
    };

export type WebviewToHost =
  /** Annotations changed since the last save. */
  | { type: "dirty" }
  /** A pdf.js save/download action (toolbar button, Ctrl+S) was triggered. */
  | { type: "requestSave" }
  | { type: "data"; requestId: number; data: Uint8Array }
  | { type: "dataError"; requestId: number; message: string }
  /** Translate sentences; part of whole-document job `jobId` if set. */
  | { type: "translate"; requestId: number; sentences: SentenceToTranslate[]; jobId?: number }
  | { type: "translateAllProgress"; jobId: number; done: number; total: number }
  | { type: "translateAllDone"; jobId: number }
  /** The panel's language button was clicked. */
  | { type: "chooseTargetLanguage" };

/** Link clicks sent by the patched pdf.js link service (see patches/pdf.js.patch). */
export interface OpenLinkMessage {
  open: string;
}

function isSentence(value: unknown): value is SentenceToTranslate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { id, text, group } = value as Record<string, unknown>;
  return typeof id === "string" && typeof text === "string" && typeof group === "string";
}

export function isWebviewToHost(message: unknown): message is WebviewToHost {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return false;
  }
  const m = message as Record<string, unknown>;
  switch (m["type"]) {
    case "dirty":
    case "requestSave":
    case "chooseTargetLanguage":
      return true;
    case "data":
      return typeof m["requestId"] === "number" && m["data"] instanceof Uint8Array;
    case "dataError":
      return typeof m["requestId"] === "number" && typeof m["message"] === "string";
    case "translate":
      return (
        typeof m["requestId"] === "number" &&
        Array.isArray(m["sentences"]) &&
        m["sentences"].every(isSentence) &&
        (m["jobId"] === undefined || typeof m["jobId"] === "number")
      );
    case "translateAllProgress":
      return (
        typeof m["jobId"] === "number" &&
        typeof m["done"] === "number" &&
        typeof m["total"] === "number"
      );
    case "translateAllDone":
      return typeof m["jobId"] === "number";
    default:
      return false;
  }
}

export function isOpenLinkMessage(message: unknown): message is OpenLinkMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "open" in message &&
    typeof message.open === "string"
  );
}
