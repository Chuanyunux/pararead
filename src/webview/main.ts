/*
 * Copyright 2021 Mathematic, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified by chuanyun, 2026: ported from assets/main.mjs to TypeScript and
 * extended with annotation saving and the bilingual reading features.
 */

// Loads the pdf.js viewer (kept external to the bundle; resolved at runtime
// relative to dist/webview/main.mjs).
import "../../assets/pdf.js/web/viewer.mjs";
import type { HostToWebview, WebviewToHost } from "../messages";
import { installAltClick } from "./alt-click";
import { HighlightOverlay, scrollToSentence } from "./highlight-overlay";
import { TranslationPanel } from "./panel";
import { SaveBridge } from "./save-bridge";
import { HeuristicSegmenter } from "./segmenter/heuristic";
import { SentenceStore } from "./sentence-store";

// The patched viewer calls acquireVsCodeApi() itself, which may only be called
// once per webview. This module runs before the viewer initializes, so acquire
// the API here and hand the same instance to the viewer.
const vscode = acquireVsCodeApi();
window.acquireVsCodeApi = () => vscode;
const post = (message: WebviewToHost) => vscode.postMessage(message);

function loadConfig(): Record<string, unknown> & { url: string } {
  const elem = document.querySelector<HTMLElement>("#pdf-view-config");
  const raw = elem?.dataset["config"];
  if (raw !== undefined) {
    return JSON.parse(raw) as Record<string, unknown> & { url: string };
  }
  throw new Error("Could not load configuration.");
}

const config = loadConfig();

const options = window.PDFViewerApplicationOptions;
options.set("defaultUrl", "");
options.set("disablePreferences", true);
options.set("defaultZoomValue", config["defaultZoomValue"] ?? "auto");
options.set("sidebarViewOnLoad", config["sidebarViewOnLoad"] ?? 0);
for (const key of [
  "sandboxBundleSrc",
  "cMapUrl",
  "iccUrl",
  "standardFontDataUrl",
  "wasmUrl",
  "imageResourcesPath",
] as const) {
  options.set(key, config[key]);
}

// Prevent pdf.js from intercepting Ctrl+P/Cmd+P and triggering the print dialog.
document.addEventListener(
  "keydown",
  (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true,
);

const app = window.PDFViewerApplication;

async function start() {
  await app.initializedPromise;

  const saveBridge = new SaveBridge(app, post);
  const store = new SentenceStore(app, new HeuristicSegmenter());
  const overlay = new HighlightOverlay(app);
  const panel = new TranslationPanel({
    app,
    store,
    vscode,
    onSelect: (sentence) => {
      // Scroll first: bringing a page back into view resets its DOM.
      scrollToSentence(app, sentence);
      overlay.show(sentence);
    },
  });
  installAltClick(app, store, (sentence) => {
    overlay.show(sentence);
    panel.reveal(sentence);
  });

  // Exposed for the development harness (tools/harness.mjs) only.
  if (config["debug"] === true) {
    Object.assign(window, { __bilingual: { store, overlay, panel } });
  }

  // Segment pages lazily, as the viewer renders their text layers.
  app.eventBus.on("textlayerrendered", ({ pageNumber }: { pageNumber: number }) => {
    void store.ensure(pageNumber).catch(() => {
      // Reloaded while segmenting.
    });
  });

  window.addEventListener("message", async (event: MessageEvent<HostToWebview>) => {
    if (event.origin !== window.origin) {
      return;
    }
    const message = event.data;
    if (await saveBridge.handle(message)) {
      return;
    }
    if (message.type === "reload") {
      const currentPageNumber = app.pdfViewer.currentPageNumber;
      store.reset();
      panel.reset();
      overlay.clear();
      await app.open(config);
      await app.pdfViewer.pagesPromise;
      app.pdfViewer.currentPageNumber = Math.min(currentPageNumber, app.pdfViewer.pagesCount);
    }
  });

  await app.open(config);
  await app.pdfViewer.pagesPromise;
  const [, hash] = config.url.split("#");
  if (hash !== undefined && hash !== "") {
    app.pdfLinkService.setHash(decodeURIComponent(hash));
  }
}

void start();

window.addEventListener("error", (error) => {
  console.error(error);
});
