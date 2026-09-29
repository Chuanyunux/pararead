/*
 * Copyright 2021 Mathematic Inc
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
 * Modified by chuanyun, 2026: editable custom editor (annotation save,
 * save as, revert, backup), typed message bridge, bilingual webview bundle,
 * translation requests.
 */

import { join } from "node:path";

import {
  type CancellationToken,
  type CustomDocumentBackup,
  type CustomDocumentBackupContext,
  type CustomDocumentContentChangeEvent,
  type CustomDocumentOpenContext,
  type CustomEditorProvider,
  commands,
  type Disposable,
  EventEmitter,
  type ExtensionContext,
  Uri,
  type Webview,
  type WebviewPanel,
  window,
  workspace,
} from "vscode";

import rawViewerHtml from "../assets/pdf.js/web/viewer.html";
import { disposeAll } from "./disposable";
import { webviewStrings } from "./l10n";
import {
  type HostToWebview,
  isOpenLinkMessage,
  isWebviewToHost,
  type WebviewToHost,
} from "./messages";
import { PDFDocument } from "./pdf-document";
import type { TranslationBridge } from "./translation-bridge";
import type { TranslationService } from "./translation/service";
import { escapeAttribute } from "./utils";
import { WebviewCollection } from "./webview-collection";

const viewerHtml = rawViewerHtml
  .replace(
    /* html */
    `<link rel="resource" type="application/l10n" href="locale/locale.json" />`,
    "",
  )
  .replace(/* html */ `<script src="../build/pdf.mjs" type="module"></script>`, "")
  .replace(/* html */ `<script src="viewer.mjs" type="module"></script>`, "")
  .replace(/* html */ `<link rel="stylesheet" href="viewer.css" />`, "");

const resourcePathRegex = /\/[^/]+?\.\w+$/u;

/** How long to wait for the webview to serialize the document. */
const DATA_TIMEOUT_MS = 60_000;

function withTrailingSlash(uri: Uri): string {
  const value = uri.toString();
  return value.endsWith("/") ? value : `${value}/`;
}

function selectOnHover(): boolean {
  return workspace.getConfiguration("pararead").get<boolean>("selectOnHover", true);
}

function parentDirectory(uri: Uri): Uri {
  return uri.with({ path: uri.path.replace(resourcePathRegex, "/") });
}

interface PendingRequest {
  resolve: (data: Uint8Array) => void;
  reject: (error: Error) => void;
}

export class PDFViewerProvider implements CustomEditorProvider<PDFDocument> {
  static readonly viewType = "pararead.view";

  static register(provider: PDFViewerProvider) {
    return window.registerCustomEditorProvider(PDFViewerProvider.viewType, provider, {
      supportsMultipleEditorsPerDocument: false,
      // Unsaved annotation edits and the panel state live in the webview.
      webviewOptions: { retainContextWhenHidden: true },
    });
  }

  /** Tracks all known webviews */
  private readonly webviews = new WebviewCollection();

  private readonly extensionRoot: Uri;

  private readonly _onDidChangeCustomDocument = new EventEmitter<
    CustomDocumentContentChangeEvent<PDFDocument>
  >();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest>();

  private readonly translation: TranslationService;
  private readonly bridge: TranslationBridge;

  constructor(
    context: ExtensionContext,
    translation: TranslationService,
    bridge: TranslationBridge,
  ) {
    this.extensionRoot = Uri.file(context.extensionPath);
    this.translation = translation;
    this.bridge = bridge;
    context.subscriptions.push(
      translation.onDidChangeSettings(() => {
        for (const webviewPanel of this.webviews.all()) {
          this.post(webviewPanel.webview, {
            type: "settings",
            translateRange: translation.translateRange,
            selectOnHover: selectOnHover(),
            targetLanguage: translation.targetLanguage,
          });
        }
      }),
      translation.onDidChangeApiKey(() => {
        for (const webviewPanel of this.webviews.all()) {
          this.post(webviewPanel.webview, { type: "retryFailed" });
        }
      }),
    );
  }

  /** The webview of the focused PDF viewer, if any. */
  activeWebview(): Webview | undefined {
    for (const webviewPanel of this.webviews.all()) {
      if (webviewPanel.active) {
        return webviewPanel.webview;
      }
    }
    return undefined;
  }

  /** Sends a message to the focused PDF viewer; returns false if there is none. */
  postToActive(message: HostToWebview): boolean {
    const webview = this.activeWebview();
    if (webview !== undefined) {
      this.post(webview, message);
    }
    return webview !== undefined;
  }

  openCustomDocument(uri: Uri, openContext: CustomDocumentOpenContext) {
    const backupUri =
      openContext.backupId === undefined ? undefined : Uri.parse(openContext.backupId);
    const document = new PDFDocument(uri, backupUri);

    const listeners: Disposable[] = [];

    listeners.push(
      document.onDidChange((e) => {
        // Update all webviews when the document changes
        for (const webviewPanel of this.webviews.get(e)) {
          this.post(webviewPanel.webview, { type: "reload" });
        }
      }),
      document.onDidChangeContent(() => {
        this._onDidChangeCustomDocument.fire({ document });
      }),
    );

    document.onDidDelete(() => disposeAll(listeners));

    return document;
  }

  async saveCustomDocument(document: PDFDocument, cancellation: CancellationToken): Promise<void> {
    const data = await this.requestData(document);
    if (cancellation.isCancellationRequested) {
      return;
    }
    await document.write(document.uri, data);
    document.markSaved();
    for (const webviewPanel of this.webviews.get(document.uri)) {
      this.post(webviewPanel.webview, { type: "saved" });
    }
  }

  async saveCustomDocumentAs(
    document: PDFDocument,
    destination: Uri,
    cancellation: CancellationToken,
  ): Promise<void> {
    const data = await this.requestData(document);
    if (cancellation.isCancellationRequested) {
      return;
    }
    await document.write(destination, data);
  }

  async revertCustomDocument(document: PDFDocument): Promise<void> {
    document.markSaved();
    for (const webviewPanel of this.webviews.get(document.uri)) {
      this.post(webviewPanel.webview, { type: "reload" });
    }
  }

  async backupCustomDocument(
    document: PDFDocument,
    context: CustomDocumentBackupContext,
    cancellation: CancellationToken,
  ): Promise<CustomDocumentBackup> {
    const data = await this.requestData(document);
    if (!cancellation.isCancellationRequested) {
      await document.write(context.destination, data);
    }
    return {
      id: context.destination.toString(),
      delete: () => {
        void workspace.fs.delete(context.destination).then(undefined, () => {
          // The backup may already be gone.
        });
      },
    };
  }

  private post(webview: Webview, message: HostToWebview) {
    void webview.postMessage(message);
  }

  /** Asks the webview for the document bytes with all annotation edits applied. */
  private requestData(document: PDFDocument): Promise<Uint8Array> {
    const [webviewPanel] = this.webviews.get(document.uri);
    if (webviewPanel === undefined) {
      return Promise.reject(new Error("The PDF viewer is not open."));
    }
    const requestId = this.nextRequestId++;
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Timed out waiting for the PDF viewer to serialize the document."));
      }, DATA_TIMEOUT_MS);
      this.pendingRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.post(webviewPanel.webview, { type: "getData", requestId });
    });
  }

  private UriResolver(webview: Webview) {
    return (...paths: string[]): Uri =>
      webview.asWebviewUri(Uri.file(join(this.extensionRoot.path, ...paths)));
  }

  resolveCustomEditor(document: PDFDocument, webviewPanel: WebviewPanel): void {
    // Add the webview to our internal set of active webviews
    this.webviews.add(document.uri, webviewPanel);
    // First paper: confirm the translation language, which may come from the UI language.
    void this.translation.confirmTargetLanguage();

    // Setup initial content for the webview
    const resourceRoot = parentDirectory(document.uri);
    const webviewResourceRoot = withTrailingSlash(webviewPanel.webview.asWebviewUri(resourceRoot));
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot, parentDirectory(document.dataUri), this.extensionRoot],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(
      document,
      webviewPanel.webview,
      resourceRoot,
    );

    webviewPanel.onDidDispose(() => this.bridge.release(webviewPanel.webview));

    webviewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (isWebviewToHost(message)) {
        if (!this.bridge.handle(webviewPanel.webview, message)) {
          await this.onWebviewMessage(document, message);
        }
        return;
      }
      if (!isOpenLinkMessage(message)) {
        return;
      }

      try {
        const resourceRootUrl = new URL(webviewResourceRoot);
        const targetUrl = new URL(message.open);
        if (
          targetUrl.origin !== resourceRootUrl.origin ||
          !targetUrl.pathname.startsWith(resourceRootUrl.pathname)
        ) {
          return;
        }

        const relativePath = decodeURIComponent(
          targetUrl.pathname.slice(resourceRootUrl.pathname.length),
        );
        const fragment = decodeURIComponent(targetUrl.hash.slice(1));
        await commands.executeCommand(
          "vscode.open",
          Uri.joinPath(resourceRoot, relativePath).with({ fragment }),
        );
      } catch {
        // Ignore malformed or non-local messages from the webview.
      }
    });
  }

  private async onWebviewMessage(document: PDFDocument, message: WebviewToHost) {
    switch (message.type) {
      case "dirty":
        document.markDirty();
        break;
      case "requestSave":
        // Route through VS Code so the editor's dirty state stays in sync.
        // Ctrl+S may reach both VS Code and pdf.js; save only once.
        if (document.isDirty) {
          await commands.executeCommand("workbench.action.files.save");
        }
        break;
      case "data":
        this.pendingRequests.get(message.requestId)?.resolve(message.data);
        this.pendingRequests.delete(message.requestId);
        break;
      case "dataError":
        this.pendingRequests.get(message.requestId)?.reject(new Error(message.message));
        this.pendingRequests.delete(message.requestId);
        break;
      default:
        // Translation messages are handled by the bridge.
        break;
    }
  }

  private getHtmlForWebview(document: PDFDocument, webview: Webview, resourceRoot: Uri): string {
    const resolveUri = this.UriResolver(webview);
    const resolvePdfJsURI = (...paths: string[]) => resolveUri("assets", "pdf.js", ...paths);

    const cspSource = webview.cspSource;

    const config = workspace.getConfiguration("pararead", document.uri);
    const settings = {
      url: `${webview.asWebviewUri(document.dataUri)}`,
      docBaseUrl: `${webview.asWebviewUri(document.uri)}`,
      resourceRoot: withTrailingSlash(webview.asWebviewUri(resourceRoot)),
      defaultZoomValue: config.get<string>("defaultZoomValue", "auto"),
      sidebarViewOnLoad: config.get<number>("sidebarViewOnLoad", 0),
      sandboxBundleSrc: `${resolvePdfJsURI("build", "pdf.sandbox.mjs")}`,
      cMapUrl: withTrailingSlash(resolvePdfJsURI("web", "cmaps")),
      iccUrl: withTrailingSlash(resolvePdfJsURI("web", "iccs")),
      standardFontDataUrl: withTrailingSlash(resolvePdfJsURI("web", "standard_fonts")),
      wasmUrl: withTrailingSlash(resolvePdfJsURI("web", "wasm")),
      imageResourcesPath: withTrailingSlash(resolvePdfJsURI("web", "images")),
      translateRange: this.translation.translateRange,
      targetLanguage: this.translation.targetLanguage,
      selectOnHover: config.get<boolean>("selectOnHover", true),
      strings: webviewStrings(),
    };

    return viewerHtml
      .replace(
        /* html */ "<title>PDF.js viewer</title>",
        /* html */
        `
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${cspSource} blob: data:; script-src ${cspSource} 'wasm-unsafe-eval'; worker-src ${cspSource} blob:; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} blob: data:; font-src ${cspSource} data:; media-src blob:; base-uri 'none'; form-action 'none';">
<meta id="pdf-view-config" data-config="${escapeAttribute(settings)}">

<title>PDF.js viewer</title>

<link rel="stylesheet" href="${resolvePdfJsURI("web", "viewer.css")}">
<link rel="stylesheet" href="${resolveUri("assets", "main.css")}">
<link rel="stylesheet" href="${resolveUri("assets", "panel.css")}">

<script src="${resolvePdfJsURI("build", "pdf.mjs")}" type="module"></script>
<script src="${resolveUri("dist", "webview", "main.mjs")}" type="module"></script>

<link rel="resource" type="application/l10n" href="${resolvePdfJsURI("web", "locale", "locale.json")}">`,
      )
      .trim();
  }
}
