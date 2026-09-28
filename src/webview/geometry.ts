/** Conversions between PDF user space and client (viewport) pixels. */

import type { Rect } from "./segmenter/types";

/** Client rectangle of a PDF-space rectangle on a page, or null if the page has no view. */
export function pdfRectToClient(
  app: PdfjsApplication,
  pageNumber: number,
  rect: Rect,
): DOMRect | null {
  const pageView = app.pdfViewer.getPageView(pageNumber - 1);
  if (pageView === undefined || !pageView.div.isConnected) {
    return null;
  }
  const { viewport, div } = pageView;
  const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(rect.x, rect.y);
  const [x2 = 0, y2 = 0] = viewport.convertToViewportPoint(rect.x + rect.w, rect.y + rect.h);
  const box = div.getBoundingClientRect();
  const left = box.left + div.clientLeft + Math.min(x1, x2);
  const top = box.top + div.clientTop + Math.min(y1, y2);
  return new DOMRect(left, top, Math.abs(x2 - x1), Math.abs(y2 - y1));
}

/** The page under a client y coordinate, with the PDF-space point there. */
export function pdfPointAt(
  app: PdfjsApplication,
  clientX: number,
  clientY: number,
): { pageNumber: number; x: number; y: number } | null {
  const viewer = app.pdfViewer;
  const current = viewer.currentPageNumber;
  // Only pages near the current one can be under the viewport.
  for (let n = Math.max(1, current - 2); n <= Math.min(viewer.pagesCount, current + 2); n++) {
    const pageView = viewer.getPageView(n - 1);
    if (pageView === undefined) {
      continue;
    }
    const box = pageView.div.getBoundingClientRect();
    if (clientY >= box.top && clientY <= box.bottom) {
      const [x = 0, y = 0] = pageView.viewport.convertToPdfPoint(
        clientX - box.left - pageView.div.clientLeft,
        clientY - box.top - pageView.div.clientTop,
      );
      return { pageNumber: n, x, y };
    }
  }
  return null;
}

export function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
}
