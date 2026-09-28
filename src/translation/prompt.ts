/**
 * Prompt for sentence-level academic translation. The system message is kept
 * byte-identical across requests (for a given glossary) so that DeepSeek's
 * prefix cache can serve it.
 */

import { createHash } from "node:crypto";

/** Bump when the prompt changes in a way that should invalidate cached translations. */
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

export function buildSystemPrompt(glossary: Record<string, string>): string {
  const lines = [
    "你是一名专业的学术论文翻译。把用户给出的英文句子逐句翻译成简体中文学术语体。",
    "",
    "要求：",
    "1. 逐句翻译：每个 id 对应一条译文，不合并、不拆分、不遗漏，id 原样返回。",
    "2. 数学公式、变量与符号、代码与标识符、模型或系统名称（如 GPT-4、BERT、PyTorch）、缩写（如 LLM、RLHF）、引用标记（如 [12]、(Vaswani et al., 2017)）一律保持原样。",
    "3. 句子可能因 PDF 排版而不完整，按原样翻译，不要补写、解释或添加注释。",
    "4. 译文准确、简洁，符合中文学术写作习惯。",
    "5. 只输出一个 JSON 对象，不要输出任何其他文字。",
    "",
    "输出格式（json）示例：",
    '输入：{"sentences":[{"id":"s1","en":"We propose a new attention mechanism."},{"id":"s2","en":"It outperforms BERT [4]."}]}',
    '输出：{"translations":[{"id":"s1","zh":"我们提出了一种新的注意力机制。"},{"id":"s2","zh":"它的性能优于 BERT [4]。"}]}',
  ];
  const terms = sortedGlossary(glossary);
  if (terms.length > 0) {
    lines.push("", "术语表（出现以下术语时必须使用对应译法）：");
    for (const [term, rendering] of terms) {
      lines.push(`- ${term} → ${rendering}`);
    }
  }
  return lines.join("\n");
}

export function buildUserMessage(sentences: SourceSentence[]): string {
  return JSON.stringify({ sentences: sentences.map(({ id, text }) => ({ id, en: text })) });
}

export function buildMessages(systemPrompt: string, sentences: SourceSentence[]): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildUserMessage(sentences) },
  ];
}
