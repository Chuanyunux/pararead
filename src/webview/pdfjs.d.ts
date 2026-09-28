/**
 * Minimal typings for the parts of the pdf.js viewer used by the webview.
 * The viewer ships as plain JavaScript (assets/pdf.js/web/viewer.mjs).
 */

declare module "*/viewer.mjs";

interface PdfjsEventBus {
  on(name: string, listener: (event: any) => void, options?: { signal?: AbortSignal }): void;
  off(name: string, listener: (event: any) => void): void;
}

interface PdfjsPageViewport {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
  convertToPdfPoint(x: number, y: number): number[];
}

interface PdfjsTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

interface PdfjsTextMarkedContent {
  type: string;
  id?: string;
}

interface PdfjsTextContent {
  items: (PdfjsTextItem | PdfjsTextMarkedContent)[];
  styles: Record<string, { fontFamily: string }>;
}

interface PdfjsPageProxy {
  view: number[];
  getTextContent(params?: { includeMarkedContent?: boolean; disableNormalization?: boolean }): Promise<PdfjsTextContent>;
}

interface PdfjsPageView {
  id: number;
  div: HTMLDivElement;
  viewport: PdfjsPageViewport;
}

interface PdfjsAnnotationStorage {
  size: number;
  onSetModified: (() => void) | null;
  resetModified(): void;
}

interface PdfjsDocumentProxy {
  numPages: number;
  annotationStorage: PdfjsAnnotationStorage;
  getPage(pageNumber: number): Promise<PdfjsPageProxy>;
  getData(): Promise<Uint8Array>;
  saveDocument(): Promise<Uint8Array>;
}

interface PdfjsViewer {
  container: HTMLDivElement;
  currentPageNumber: number;
  pagesCount: number;
  /** `AnnotationEditorType`: -1 disabled, 0 none, > 0 an editor tool is active. */
  annotationEditorMode: number;
  pagesPromise: Promise<void>;
  getPageView(index: number): PdfjsPageView | undefined;
  scrollPageIntoView(params: { pageNumber: number; destArray?: unknown[]; allowNegativeOffset?: boolean }): void;
  _layerProperties?: { annotationEditorUIManager?: { endCurrentEditing(): void } };
}

interface PdfjsApplication {
  initializedPromise: Promise<void>;
  eventBus: PdfjsEventBus;
  pdfViewer: PdfjsViewer;
  pdfDocument: PdfjsDocumentProxy | null;
  downloadManager: { download(data: Uint8Array, url: string, filename: string): void } | null;
  pdfLinkService: { setHash(hash: string): void };
  pdfScriptingManager?: { dispatchWillSave(): Promise<void>; dispatchDidSave(): Promise<void> };
  open(args: Record<string, unknown>): Promise<void>;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface Window {
  PDFViewerApplication: PdfjsApplication;
  PDFViewerApplicationOptions: { set(name: string, value: unknown): void };
  acquireVsCodeApi: () => VsCodeApi;
}
