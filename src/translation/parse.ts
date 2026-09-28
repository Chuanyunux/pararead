/** Parsing and validation of the model's JSON reply. */

export interface ParseResult {
  /** id → translation, only for requested ids with a non-empty translation. */
  found: Map<string, string>;
  /** Requested ids without a usable translation. */
  missing: string[];
}

/** Extracts translations for `expectedIds`; unknown ids are ignored. */
export function parseTranslations(content: string, expectedIds: readonly string[]): ParseResult {
  const found = new Map<string, string>();
  const expected = new Set(expectedIds);

  for (const entry of translationEntries(content)) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { id, zh } = entry as { id?: unknown; zh?: unknown };
    if (typeof id === "string" && expected.has(id) && typeof zh === "string" && zh.trim() !== "") {
      found.set(id, zh.trim());
    }
  }
  return { found, missing: expectedIds.filter((id) => !found.has(id)) };
}

function translationEntries(content: string): unknown[] {
  const json = parseJson(content);
  if (Array.isArray(json)) {
    return json;
  }
  if (
    typeof json === "object" &&
    json !== null &&
    "translations" in json &&
    Array.isArray(json.translations)
  ) {
    return json.translations as unknown[];
  }
  return [];
}

function parseJson(content: string): unknown {
  // Tolerate a Markdown code fence around the JSON.
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
