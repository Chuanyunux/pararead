/**
 * Prompt for sentence-level academic translation. The system message is kept
 * byte-identical across requests (for a given language and glossary) so that
 * DeepSeek's prefix cache can serve it.
 */

import { createHash } from "node:crypto";

import { type LanguageInfo, languageInfo, SOURCE_LANGUAGE } from "../languages";

/**
 * Bump when the prompt changes in a way that should invalidate cached
 * translations. Version 1 translations into Chinese remain valid under the
 * language-neutral prompt, so it was not bumped for it.
 */
export const PROMPT_VERSION = "1";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SourceSentence {
  id: string;
  text: string;
  /** Paragraph (block) id; sentences of one paragraph are kept in one request. */
  group?: string;
}

function sortedGlossary(glossary: Record<string, string>): [string, string][] {
  return Object.entries(glossary).toSorted(([a], [b]) => a.localeCompare(b));
}

/** Stable hash of the glossary; part of the cache key. */
export function glossaryHash(glossary: Record<string, string>): string {
  return createHash("sha1")
    .update(JSON.stringify(sortedGlossary(glossary)))
    .digest("hex")
    .slice(0, 12);
}

function describe(info: LanguageInfo): string {
  return info.nativeName === info.englishName
    ? info.englishName
    : `${info.englishName} (${info.nativeName})`;
}

export function buildSystemPrompt(
  glossary: Record<string, string>,
  targetLanguage: string,
  sourceLanguage: string = SOURCE_LANGUAGE,
): string {
  const target = languageInfo(targetLanguage);
  const source = languageInfo(sourceLanguage);
  if (target === undefined || source === undefined) {
    throw new Error(`Unsupported language pair: ${sourceLanguage} → ${targetLanguage}`);
  }
  const lines = [
    `You are a professional translator of academic papers. Translate each sentence the user gives from ${describe(source)} into ${describe(target)}, in the register of academic writing.`,
    "",
    "Rules:",
    "1. Translate sentence by sentence: exactly one translation per id; do not merge, split or skip sentences; return every id unchanged.",
    "2. Keep unchanged: mathematical formulas, variables and symbols, code and identifiers, names of models, systems and datasets (e.g. GPT-4, BERT, PyTorch), abbreviations (e.g. LLM, RLHF) and citation markers (e.g. [12], (Vaswani et al., 2017)).",
    "3. Sentences may be incomplete because of the PDF layout; translate them as they are, without completing, explaining or adding notes.",
    `4. Be accurate and concise, following the conventions of academic writing in ${target.englishName}.${target.promptNote === undefined ? "" : ` ${target.promptNote}`}`,
    "5. Output a single json object and nothing else.",
    "",
    "Output format (json) example:",
    'Input: {"sentences":[{"id":"s1","text":"<sentence 1>"},{"id":"s2","text":"<sentence 2>"}]}',
    `Output: {"translations":[{"id":"s1","translation":"<${target.englishName} translation of sentence 1>"},{"id":"s2","translation":"<${target.englishName} translation of sentence 2>"}]}`,
  ];
  const terms = sortedGlossary(glossary);
  if (terms.length > 0) {
    lines.push("", "Glossary (always use these renderings for these terms):");
    for (const [term, rendering] of terms) {
      lines.push(`- ${term} → ${rendering}`);
    }
  }
  return lines.join("\n");
}

export function buildUserMessage(sentences: SourceSentence[]): string {
  return JSON.stringify({ sentences: sentences.map(({ id, text }) => ({ id, text })) });
}

export function buildMessages(systemPrompt: string, sentences: SourceSentence[]): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildUserMessage(sentences) },
  ];
}
