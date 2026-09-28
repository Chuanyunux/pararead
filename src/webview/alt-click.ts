/**
 * Alt+click on a sentence in the PDF selects it. Plain clicks, text selection
 * and the annotation editors are left alone.
 */

import type { Sentence } from "./segmenter/types";
import type { SentenceStore } from "./sentence-store";

function isAltClick(event: MouseEvent): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0;
}

export function installAltClick(
  app: PdfjsApplication,
  store: SentenceStore,
  onSentence: (sentence: Sentence) => void,
): void {
  const container = app.pdfViewer.container;
  // An annotation editor tool (highlight, ink, free text...) is active.
  const editing = () => app.pdfViewer.annotationEditorMode > 0;

  // Keep Alt+drag from starting a text selection.
  container.addEventListener(
    "pointerdown",
    (event) => {
      if (isAltClick(event) && !editing() && (event.target as Element).closest(".page") !== null) {
        event.preventDefault();
      }
    },
    true,
  );

  container.addEventListener(
    "click",
    (event) => {
      if (!isAltClick(event) || editing()) {
        return;
      }
      const pageDiv = (event.target as Element).closest<HTMLElement>(".page");
      const pageNumber = Number(pageDiv?.dataset["pageNumber"]);
      const pageView = app.pdfViewer.getPageView(pageNumber - 1);
      if (pageDiv === null || pageView === undefined) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const box = pageDiv.getBoundingClientRect();
      const [x = 0, y = 0] = pageView.viewport.convertToPdfPoint(
        event.clientX - box.left - pageDiv.clientLeft,
        event.clientY - box.top - pageDiv.clientTop,
      );
      void store.hitTest(pageNumber, x, y).then((sentence) => {
        if (sentence !== undefined) {
          onSentence(sentence);
        }
      });
    },
    true,
  );
}
