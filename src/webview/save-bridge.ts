/**
 * Connects pdf.js annotation editing with the VS Code custom editor lifecycle:
 * reports unsaved edits, and serializes the document when the host saves.
 */

import type { HostToWebview, WebviewToHost } from "../messages";

export class SaveBridge {
  readonly #app: PdfjsApplication;
  readonly #post: (message: WebviewToHost) => void;

  constructor(app: PdfjsApplication, post: (message: WebviewToHost) => void) {
    this.#app = app;
    this.#post = post;

    // Chain onto pdf.js' own callback, which is installed before this event.
    app.eventBus.on("documentloaded", () => {
      const storage = app.pdfDocument?.annotationStorage;
      if (storage === undefined) {
        return;
      }
      const previous = storage.onSetModified;
      storage.onSetModified = () => {
        previous?.();
        this.#post({ type: "dirty" });
      };
    });

    // Every pdf.js save path (toolbar button, Ctrl+S, menu) ends in
    // `downloadManager.download`, which cannot save a file from a webview.
    // Hand the save over to VS Code instead.
    if (app.downloadManager !== null) {
      app.downloadManager.download = () => {
        this.#post({ type: "requestSave" });
      };
    }
  }

  /** Handles host messages; returns whether the message was consumed. */
  async handle(message: HostToWebview): Promise<boolean> {
    switch (message.type) {
      case "getData":
        await this.#sendData(message.requestId);
        return true;
      case "saved":
        // After a reset, the next edit fires `onSetModified` again.
        this.#app.pdfDocument?.annotationStorage.resetModified();
        return true;
      default:
        return false;
    }
  }

  async #sendData(requestId: number) {
    const app = this.#app;
    const doc = app.pdfDocument;
    if (doc === null) {
      this.#post({ type: "dataError", requestId, message: "No document is loaded." });
      return;
    }
    // Commit a free-text annotation that is still being typed.
    app.pdfViewer._layerProperties?.annotationEditorUIManager?.endCurrentEditing();
    await app.pdfScriptingManager?.dispatchWillSave();
    try {
      const data = doc.annotationStorage.size > 0 ? await doc.saveDocument() : await doc.getData();
      this.#post({ type: "data", requestId, data });
    } catch (error) {
      this.#post({ type: "dataError", requestId, message: String(error) });
    } finally {
      await app.pdfScriptingManager?.dispatchDidSave();
    }
  }
}
