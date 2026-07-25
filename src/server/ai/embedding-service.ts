import { embedWithOllama } from "./ollama-client";

export const MAX_EMBEDDING_CHARACTERS = 12_000;
const EMBEDDING_BATCH_SIZE = 32;
const EMBEDDING_CACHE_SIZE = 1_200;

export type NoteForEmbedding = {
  id: string;
  title: string;
  contentText: string;
  optimisticVersion: number;
};

const embeddingCache = new Map<string, number[]>();

export async function embeddingsForNotes(
  notes: NoteForEmbedding[],
  model: string,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  const missing: NoteForEmbedding[] = [];
  for (const note of notes) {
    const cached = embeddingCache.get(embeddingCacheKey(note, model));
    if (cached) {
      result.set(note.id, cached);
      touchCacheEntry(embeddingCacheKey(note, model), cached);
    } else {
      missing.push(note);
    }
  }

  for (let index = 0; index < missing.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = missing.slice(index, index + EMBEDDING_BATCH_SIZE);
    const vectors = await embedWithOllama(batch.map(embeddingText));
    batch.forEach((note, batchIndex) => {
      const vector = vectors[batchIndex];
      if (!vector) return;
      const key = embeddingCacheKey(note, model);
      embeddingCache.set(key, vector);
      result.set(note.id, vector);
      trimEmbeddingCache();
    });
  }
  return result;
}

export async function embeddingForQuery(query: string): Promise<number[]> {
  const [vector] = await embedWithOllama([
    [
      "Represent this natural-language query for semantic retrieval across personal notes.",
      `Query: ${query.slice(0, 500)}`,
    ].join("\n"),
  ]);
  if (!vector) return [];
  return vector;
}

function embeddingText(note: NoteForEmbedding): string {
  return [
    "Represent this personal note for semantic retrieval, duplicate detection, and organisation.",
    `Title: ${note.title.slice(0, 500)}`,
    `Content: ${note.contentText.slice(0, MAX_EMBEDDING_CHARACTERS)}`,
  ].join("\n");
}

function embeddingCacheKey(note: NoteForEmbedding, model: string): string {
  return `${model}\u0000${note.id}\u0000${note.optimisticVersion}`;
}

function touchCacheEntry(key: string, vector: number[]) {
  embeddingCache.delete(key);
  embeddingCache.set(key, vector);
}

function trimEmbeddingCache() {
  while (embeddingCache.size > EMBEDDING_CACHE_SIZE) {
    const oldest = embeddingCache.keys().next().value;
    if (typeof oldest !== "string") return;
    embeddingCache.delete(oldest);
  }
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function clearEmbeddingCacheForTests() {
  embeddingCache.clear();
}
