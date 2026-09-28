/**
 * The selected sentence, shared by the PDF highlight, the panel, the arrow
 * and scroll alignment. Hovering selects (preview), clicking selects and
 * marks the sentence as clicked; hovering another sentence afterwards still
 * moves the selection. Clicking empty space or Escape clears it.
 */

import type { Sentence } from "./segmenter/types";

export type SelectionSource = "pdf" | "panel";

export interface Selection {
  sentence: Sentence;
  /** Selected by a click rather than by hovering. */
  pinned: boolean;
  /** Where the user selected it; the other side follows. */
  source: SelectionSource;
}

export class SelectionController {
  #current: Selection | null = null;
  readonly #listeners = new Set<(selection: Selection | null) => void>();

  get current(): Selection | null {
    return this.#current;
  }

  onChange(listener: (selection: Selection | null) => void): void {
    this.#listeners.add(listener);
  }

  /** Hover selection; hovering the already selected sentence changes nothing. */
  preview(sentence: Sentence, source: SelectionSource): void {
    if (this.#current?.sentence.id === sentence.id) {
      return;
    }
    this.#set({ sentence, pinned: false, source });
  }

  /** Click selection. */
  pin(sentence: Sentence, source: SelectionSource): void {
    this.#set({ sentence, pinned: true, source });
  }

  clear(): void {
    if (this.#current !== null) {
      this.#set(null);
    }
  }

  #set(selection: Selection | null): void {
    this.#current = selection;
    for (const listener of this.#listeners) {
      listener(selection);
    }
  }
}
