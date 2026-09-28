/**
 * Selecting sentences in the PDF with the mouse:
 * - hover over a sentence for a moment to select it (optional);
 * - click (without dragging) or Alt+click to select it and translate its
 *   paragraph; hovering keeps working afterwards;
 * - click on empty space or press Escape to clear the selection.
 * Text selection, links and the annotation editors are left alone.
 */

import type { Sentence } from "./segmenter/types";
import type { SelectionController } from "./selection";
import type { SentenceStore } from "./sentence-store";

/** How long the pointer must rest on a sentence before it is previewed. */
export const HOVER_DWELL_MS = 250;
/** Movement (px) between pointerdown and click that still counts as a click. */
const CLICK_SLOP = 4;
/**
 * Existing annotations and their comment popups belong to pdf.js (hover shows
 * the popup, click toggles it, double-click edits the annotation). Links are
 * not included: inline citations are everywhere in papers.
 */
const ANNOTATION = ".annotationLayer section:not(.linkAnnotation), .annotationLayer .popup";

export function isOnAnnotation(element: Element | null | undefined): boolean {
  return (element?.closest(ANNOTATION) ?? null) !== null;
}

export interface PointerSelectOptions {
  app: PdfjsApplication;
  store: SentenceStore;
  selection: SelectionController;
  hoverEnabled: () => boolean;
  /** A sentence was pinned from the PDF (translate it if needed). */
  onPin: (sentence: Sentence) => void;
}

export function installPointerSelect({
  app,
  store,
  selection,
  hoverEnabled,
  onPin,
}: PointerSelectOptions): void {
  const container = app.pdfViewer.container;
  // An annotation editor tool (highlight, ink, free text...) is active.
  const editing = () => app.pdfViewer.annotationEditorMode > 0;
  const hasTextSelection = () => {
    const s = window.getSelection();
    return s !== null && !s.isCollapsed && s.toString().trim() !== "";
  };

  /** The sentence at a client point, if its page is already segmented. */
  const sentenceAt = (clientX: number, clientY: number): Sentence | undefined => {
    const pageDiv = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(".page");
    const pageNumber = Number(pageDiv?.dataset["pageNumber"]);
    const pageView = app.pdfViewer.getPageView(pageNumber - 1);
    if (pageDiv === null || pageDiv === undefined || pageView === undefined) {
      return undefined;
    }
    const box = pageDiv.getBoundingClientRect();
    const [x = 0, y = 0] = pageView.viewport.convertToPdfPoint(
      clientX - box.left - pageDiv.clientLeft,
      clientY - box.top - pageDiv.clientTop,
    );
    return store.hitTestCached(pageNumber, x, y);
  };

  // Hover with dwell. Scrolling moves the page under a still pointer, so the
  // last pointer position is re-tested on scroll too.
  let pointer: { x: number; y: number } | null = null;
  let candidate: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;

  const probe = () => {
    frame = 0;
    if (
      pointer === null ||
      !hoverEnabled() ||
      editing() ||
      hasTextSelection() ||
      isOnAnnotation(document.elementFromPoint(pointer.x, pointer.y))
    ) {
      clearTimeout(timer);
      candidate = null;
      return;
    }
    const sentence = sentenceAt(pointer.x, pointer.y);
    if (sentence === undefined) {
      // Empty space: keep the current selection, cancel a pending preview.
      clearTimeout(timer);
      candidate = null;
      return;
    }
    if (sentence.id === candidate) {
      return;
    }
    candidate = sentence.id;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (candidate === sentence.id) {
        selection.preview(sentence, "pdf");
        // Re-arm on the next move: the preview may have been ignored because
        // another sentence is pinned, and hovering here after unpinning must work.
        candidate = null;
      }
    }, HOVER_DWELL_MS);
  };
  const scheduleProbe = () => {
    frame ||= requestAnimationFrame(probe);
  };

  container.addEventListener("pointermove", (event) => {
    // Buttons held: selecting text or drawing.
    pointer = event.buttons === 0 ? { x: event.clientX, y: event.clientY } : null;
    scheduleProbe();
  });
  container.addEventListener("pointerleave", () => {
    pointer = null;
    clearTimeout(timer);
    candidate = null;
  });
  container.addEventListener("scroll", scheduleProbe, { passive: true });

  // Clicks.
  let down: { x: number; y: number } | null = null;
  container.addEventListener(
    "pointerdown",
    (event) => {
      down = { x: event.clientX, y: event.clientY };
      // Keep Alt+drag from starting a text selection.
      if (isAltClick(event) && !editing() && (event.target as Element).closest(".page") !== null) {
        event.preventDefault();
      }
    },
    true,
  );
  container.addEventListener(
    "click",
    (event) => {
      if (editing() || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const moved =
        down !== null && Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP;
      const target = event.target as Element;
      if (
        moved ||
        (!event.altKey && hasTextSelection()) ||
        target.closest("a, .linkAnnotation, button, input, textarea") !== null ||
        isOnAnnotation(target)
      ) {
        return;
      }
      const sentence = sentenceAt(event.clientX, event.clientY);
      if (sentence === undefined) {
        // Empty space (page margins, between pages): clear the selection.
        clearTimeout(timer);
        candidate = null;
        selection.clear();
        return;
      }
      if (event.altKey) {
        event.preventDefault();
        event.stopPropagation();
      }
      clearTimeout(timer);
      selection.pin(sentence, "pdf");
      onPin(sentence);
    },
    true,
  );

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !editing()) {
      selection.clear();
    }
  });
}

function isAltClick(event: MouseEvent): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0;
}
