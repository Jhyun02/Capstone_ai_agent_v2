import { isOllamaEnabled } from "./ollama-service";

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
  keywords: string[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

export function extractKeywords(text: string): string[] {
  const tokens = tokenize(text);
  const frequency: Record<string, number> = {};

  for (const token of tokens) {
    frequency[token] = (frequency[token] || 0) + 1;
  }

  return Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([word]) => word);
}

export async function generateEmbedding(
  text: string,
): Promise<EmbeddingResult> {
  const keywords = extractKeywords(text);
  let embedding: number[] = [];

  return {
    embedding: [],
    tokenCount: keywords.length,
    keywords,
  };
}

export async function generateEmbeddings(
  texts: string[],
): Promise<EmbeddingResult[]> {
  return texts.map((text) => ({
    embedding: [],
    tokenCount: 0,
    keywords: extractKeywords(text),
  }));
}

export function keywordSimilarity(
  queryKeywords: string[],
  contentKeywords: string[],
): number {
  if (queryKeywords.length === 0 || contentKeywords.length === 0) return 0;

  const querySet = new Set(queryKeywords);
  const contentSet = new Set(contentKeywords);

  let matchCount = 0;
  const queryArray = Array.from(querySet);
  const contentArray = Array.from(contentSet);

  for (const keyword of queryArray) {
    if (contentSet.has(keyword)) {
      matchCount++;
    }
    for (const contentKeyword of contentArray) {
      if (
        contentKeyword.includes(keyword) ||
        keyword.includes(contentKeyword)
      ) {
        matchCount += 0.5;
      }
    }
  }

  const score = matchCount / Math.max(querySet.size, 1);
  return Math.min(score, 1.0);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export function rankByRelevance<T extends { embedding?: string | number[] }>(
  items: T[],
  queryEmbedding: number[],
  topK: number = 5,
): (T & { score: number })[] {
  const scored = items.map((item) => {
    let embedding: number[] = [];
    if (typeof item.embedding === "string") {
      try {
        embedding = JSON.parse(item.embedding);
      } catch {
        embedding = [];
      }
    } else if (Array.isArray(item.embedding)) {
      embedding = item.embedding;
    }

    const score = cosineSimilarity(queryEmbedding, embedding);
    return { ...item, score };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
