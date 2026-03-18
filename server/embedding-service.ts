import { isOllamaEnabled, getOllamaConfig, checkEmbeddingModel } from "./ollama-service";

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
  keywords: string[];
}

// 한국어 조사/어미 패턴
const KOREAN_SUFFIXES = /(?:에서|으로|이란|에게|부터|까지|처럼|만큼|이라|라고|이라는|에는|한테|로서|로써|하고|이나|이든|인가|인지|이다|입니다|합니다|이고|이며|해서|하면|에요|인데|는데|이랑|이야|이지|잖아|은|는|이|가|을|를|의|에|도|만|로|와|과|요|야|서|며|고|나|다)$/;

function stripKoreanSuffix(token: string): string {
  if (!/[가-힣]/.test(token)) return token;
  const stripped = token.replace(KOREAN_SUFFIXES, '');
  return stripped.length >= 2 ? stripped : token;
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
    // 원본 + 조사 제거 버전 둘 다 카운트
    frequency[token] = (frequency[token] || 0) + 1;
    const stripped = stripKoreanSuffix(token);
    if (stripped !== token) {
      frequency[stripped] = (frequency[stripped] || 0) + 1;
    }
  }

  return Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([word]) => word);
}

// Ollama nomic-embed-text를 이용한 벡터 임베딩 생성
async function generateOllamaEmbedding(text: string): Promise<number[]> {
  const config = getOllamaConfig();
  const res = await fetch(`${config.baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nomic-embed-text",
      prompt: text,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama 임베딩 API 오류: ${res.status}`);
  }

  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}

export async function generateEmbedding(
  text: string,
): Promise<EmbeddingResult> {
  const keywords = extractKeywords(text);
  let embedding: number[] = [];

  // Ollama 활성화 시 벡터 임베딩 생성 시도
  if (isOllamaEnabled()) {
    try {
      const hasModel = await checkEmbeddingModel();
      if (hasModel) {
        embedding = await generateOllamaEmbedding(text);
      }
    } catch (err) {
      console.error("Ollama 임베딩 생성 실패 (키워드만 사용):", err);
    }
  }

  return {
    embedding,
    tokenCount: keywords.length,
    keywords,
  };
}

export async function generateEmbeddings(
  texts: string[],
): Promise<EmbeddingResult[]> {
  // Ollama 비활성화 시 키워드만 반환
  if (!isOllamaEnabled()) {
    return texts.map((text) => ({
      embedding: [],
      tokenCount: 0,
      keywords: extractKeywords(text),
    }));
  }

  // Ollama 활성화 시 5개씩 배치 처리
  const results: EmbeddingResult[] = [];
  const batchSize = 5;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((text) => generateEmbedding(text)),
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        // 실패 시 키워드만 반환
        results.push({
          embedding: [],
          tokenCount: 0,
          keywords: extractKeywords(batch[j]),
        });
      }
    }
  }

  return results;
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
