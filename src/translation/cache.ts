/**
 * Content-addressed, sentence-level translation cache on disk. Keys are
 * spread over 256 shard files so that lookups load only a small file.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface CacheEntry {
  zh: string;
  /** Unix time (ms) of the write. */
  t: number;
}

type Shard = Map<string, CacheEntry>;

const FLUSH_DELAY_MS = 500;

/** Normalizes source text so that layout-only differences share a cache entry. */
export function normalizeSource(text: string): string {
  return text.normalize("NFC").replaceAll(/\s+/gu, " ").trim();
}

export interface CacheKeyParts {
  text: string;
  model: string;
  targetLanguage: string;
  promptVersion: string;
  glossaryHash: string;
}

export function cacheKey({
  text,
  model,
  targetLanguage,
  promptVersion,
  glossaryHash,
}: CacheKeyParts): string {
  return createHash("sha1")
    .update(
      [normalizeSource(text), model, targetLanguage, promptVersion, glossaryHash].join("\u0000"),
    )
    .digest("hex");
}

export class TranslationCache {
  readonly #dir: string;
  readonly #shards = new Map<string, Promise<Shard>>();
  readonly #dirty = new Set<string>();
  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  #flushing: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.#dir = dir;
  }

  get dir(): string {
    return this.#dir;
  }

  async get(key: string): Promise<string | undefined> {
    return (await this.#shard(key)).get(key)?.zh;
  }

  async set(key: string, zh: string): Promise<void> {
    (await this.#shard(key)).set(key, { zh, t: Date.now() });
    this.#dirty.add(shardName(key));
    this.#scheduleFlush();
  }

  /** Writes pending changes to disk. */
  flush(): Promise<void> {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    this.#flushing = this.#flushing.then(() => this.#writeDirty());
    return this.#flushing;
  }

  async clear(): Promise<void> {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    await this.#flushing;
    this.#shards.clear();
    this.#dirty.clear();
    await rm(this.#dir, { recursive: true, force: true });
  }

  #scheduleFlush(): void {
    if (this.#flushTimer === undefined) {
      this.#flushTimer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
    }
  }

  async #writeDirty(): Promise<void> {
    const names = [...this.#dirty];
    this.#dirty.clear();
    if (names.length === 0) {
      return;
    }
    await mkdir(this.#dir, { recursive: true });
    for (const name of names) {
      const shard = await this.#shards.get(name);
      if (shard === undefined) {
        continue;
      }
      const file = join(this.#dir, `${name}.json`);
      // Write to a temporary file first so a crash never leaves a torn shard.
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(Object.fromEntries(shard)));
      await rename(tmp, file);
    }
  }

  #shard(key: string): Promise<Shard> {
    const name = shardName(key);
    let shard = this.#shards.get(name);
    if (shard === undefined) {
      shard = this.#load(name);
      this.#shards.set(name, shard);
    }
    return shard;
  }

  async #load(name: string): Promise<Shard> {
    try {
      const raw = JSON.parse(await readFile(join(this.#dir, `${name}.json`), "utf8")) as Record<
        string,
        CacheEntry
      >;
      return new Map(
        Object.entries(raw).filter(([, entry]) => typeof entry?.zh === "string" && entry.zh !== ""),
      );
    } catch {
      // Missing or unreadable shard: start empty (it will be rewritten).
      return new Map();
    }
  }
}

function shardName(key: string): string {
  return key.slice(0, 2);
}
