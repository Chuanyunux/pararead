/** Locations of the generated segmenter fixtures (see global-setup.ts). */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { PageTextInput } from "../src/webview/segmenter/types";

export const ROOT = join(import.meta.dirname, "..");
export const FIXTURE_DIR = join(ROOT, ".cache", "fixtures");
export const PAPER_DIR = join(ROOT, ".cache", "papers");

export const TRACEMONKEY = { name: "tracemonkey", pages: 14 };
export const ATTENTION = { name: "attention", pages: 15 };

export function hasFixture(paper: { name: string }, page: number): boolean {
  return existsSync(join(FIXTURE_DIR, `${paper.name}.p${page}.json`));
}

export function loadFixture(paper: { name: string }, page: number): PageTextInput {
  return JSON.parse(
    readFileSync(join(FIXTURE_DIR, `${paper.name}.p${page}.json`), "utf8"),
  ) as PageTextInput;
}
