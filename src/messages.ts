/** Messages between the extension host and the viewer webview. */

export type HostToWebview =
  /** Reopen the document from disk (external change or revert). */
  | { type: "reload" }
  /** Ask for the current document bytes, including annotation edits. */
  | { type: "getData"; requestId: number }
  /** The document was written; the webview resets its modified state. */
  | { type: "saved" };

export type WebviewToHost =
  /** Annotations changed since the last save. */
  | { type: "dirty" }
  /** A pdf.js save/download action (toolbar button, Ctrl+S) was triggered. */
  | { type: "requestSave" }
  | { type: "data"; requestId: number; data: Uint8Array }
  | { type: "dataError"; requestId: number; message: string };

/** Link clicks sent by the patched pdf.js link service (see patches/pdf.js.patch). */
export interface OpenLinkMessage {
  open: string;
}

export function isWebviewToHost(message: unknown): message is WebviewToHost {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return false;
  }
  switch (message.type) {
    case "dirty":
    case "requestSave":
      return true;
    case "data":
      return "requestId" in message && "data" in message && message.data instanceof Uint8Array;
    case "dataError":
      return "requestId" in message && "message" in message;
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
