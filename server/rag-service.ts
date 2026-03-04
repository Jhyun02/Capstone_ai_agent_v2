import { db } from "./db";
import {
  knowledgeDocuments,
  documentChunks,
  KnowledgeDocument,
  DocumentChunk,
} from "@shared/schema";
import { eq, ilike, sql, desc, inArray, and, or } from "drizzle-orm";
import { generateEmbedding } from "./embedding-service";
import * as ollamaService from "./ollama-service";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY || "not-set",
  baseURL:
    process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL ||
    "https://openrouter.ai/api/v1",
});

// Ollama 모델 설정
let ollamaModel = "mistral";

export function setOllamaModel(model: string) {
  ollamaModel = model;
}

export function getOllamaModel(): string {
  return ollamaModel;
}

// 기본 RAG 모델 목록 (OpenRouter 클라우드 모델 - Ollama 비활성화 시 사용)
const DEFAULT_RAG_MODELS = [
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Meta Llama 3.3 70B",
    enabled: true,
  },
  {
    id: "mistralai/devstral-2512:free",
    name: "Mistral Devstral",
    enabled: true,
  },
];

// 런타임에 사용할 모델 목록 (설정에서 관리)
let ragModels = [...DEFAULT_RAG_MODELS];

export function getRagModels() {
  return ragModels;
}

export function setRagModels(models: typeof ragModels) {
  ragModels = models;
}

export function addRagModel(id: string, name: string) {
  if (!ragModels.find((m) => m.id === id)) {
    ragModels.push({ id, name, enabled: true });
  }
  return ragModels;
}

export function toggleRagModel(id: string, enabled: boolean) {
  const model = ragModels.find((m) => m.id === id);
  if (model) {
    model.enabled = enabled;
  }
  return ragModels;
}

export function removeRagModel(id: string) {
  ragModels = ragModels.filter((m) => m.id !== id);
  return ragModels;
}

export interface SearchResult {
  chunkId: number;
  documentId: number;
  documentName: string;
  content: string;
  pageNumber?: number;
  score: number;
}

export interface RagContext {
  results: SearchResult[];
  totalFound: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

async function keywordSearch(query: string, topK: number): Promise<RagContext> {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return { results: [], totalFound: 0 };
  }

  // DB 최적화: 검색어 토큰 중 하나라도 포함된 청크만 DB에서 가져옵니다.
  // 기존에는 모든 청크를 가져와서 메모리에서 필터링했으므로 데이터가 많아지면 매우 느려졌습니다.
  const searchConditions = queryTokens.map((token) =>
    ilike(documentChunks.content, `%${token}%`),
  );

  const allChunks = await db
    .select({
      id: documentChunks.id,
      documentId: documentChunks.documentId,
      content: documentChunks.content,
      pageNumber: documentChunks.pageNumber,
      documentName: knowledgeDocuments.name,
    })
    .from(documentChunks)
    .innerJoin(
      knowledgeDocuments,
      eq(documentChunks.documentId, knowledgeDocuments.id),
    )
    .where(
      and(eq(knowledgeDocuments.status, "ready"), or(...searchConditions)),
    )
    .limit(200); // [최적화] 검색 후보군 개수 제한 (CPU 부하 방지)

  if (allChunks.length === 0) {
    return { results: [], totalFound: 0 };
  }

  const scoredChunks = allChunks.map((chunk) => {
    const contentTokens = tokenize(chunk.content);
    let matchScore = 0;
    for (const queryToken of queryTokens) {
      for (const contentToken of contentTokens) {
        if (contentToken === queryToken) matchScore += 1.0;
        else if (
          contentToken.includes(queryToken) ||
          queryToken.includes(contentToken)
        )
          matchScore += 0.5;
      }
    }
    const normalizedScore = Math.min(
      matchScore / Math.max(queryTokens.length, 1),
      1.0,
    );
    return { ...chunk, score: normalizedScore };
  });

  const results = scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((c) => ({
      chunkId: c.id,
      documentId: c.documentId!,
      documentName: c.documentName,
      content: c.content,
      pageNumber: c.pageNumber || undefined,
      score: c.score,
    }));

  return { results, totalFound: results.length };
}

export async function hybridSearch(
  query: string,
  topK: number = 5,
): Promise<RagContext> {
  // Vector search removed as per requirement. Using keyword search only.
  return keywordSearch(query, topK);
}

export async function generateRagResponse(
  query: string,
  context: SearchResult[],
): Promise<string> {
  if (context.length === 0) {
    return "관련 문서를 찾을 수 없습니다. 지식베이스에 문서를 먼저 등록해주세요.";
  }

  const contextText = context
    .map((r, i) => {
      const pageInfo = r.pageNumber ? ` (${r.pageNumber}페이지)` : "";
      return `[출처 ${i + 1}: ${r.documentName}${pageInfo}]\n${r.content}`;
    })
    .join("\n\n---\n\n");

  const isSummaryRequest = /요약|정리|간략|핵심|개요/.test(query);
  const isExcerptRequest = /발췌|인용|원문|그대로/.test(query);
  const isContentRequest = /내용|뭐야|무엇|무슨|어떤/.test(query);

  let taskInstruction = "";
  if (isSummaryRequest) {
    taskInstruction =
      "문서 내용을 체계적으로 요약하여 핵심 포인트를 정리해주세요.";
  } else if (isExcerptRequest) {
    taskInstruction =
      "관련 내용을 원문에서 그대로 발췌하여 인용 형태로 보여주세요.";
  } else if (isContentRequest) {
    taskInstruction = "문서의 해당 내용을 상세하게 설명해주세요.";
  } else {
    taskInstruction = "질문에 대해 정확하고 상세하게 답변해주세요.";
  }

  const systemPrompt = `당신은 문서 분석 전문 AI 어시스턴트입니다. 한국어로 답변합니다.
사용자가 지식베이스에 등록한 문서를 기반으로 질문에 답변해야 합니다.

## 역할
- 문서 내용 분석 및 요약
- 특정 정보 검색 및 추출
- 문서 간 관련 정보 연결
- 원문 발췌 및 인용

## 답변 규칙
1. 제공된 문서 컨텍스트만 사용하여 답변하세요
2. 답변 시 출처(문서명, 페이지)를 명시하세요
3. 문서에 없는 내용은 "해당 내용은 등록된 문서에서 찾을 수 없습니다"라고 솔직하게 말하세요
4. 요약 요청 시 핵심 포인트를 불릿 포인트로 정리하세요
5. 발췌 요청 시 원문을 인용부호와 함께 제시하세요
6. 전문 용어는 한국어 설명을 추가하세요`;

  const userPrompt = `## 질문
${query}

## 작업
${taskInstruction}

## 참조 문서
${contextText}

위 문서 내용을 바탕으로 답변해주세요.`;

  // Ollama 사용 시 로컬 모델로 응답 생성
  if (ollamaService.isOllamaEnabled()) {
    console.log(`RAG using Ollama model: ${ollamaModel}`);
    const result = await ollamaService.generateWithOllama(
      ollamaModel,
      userPrompt,
      systemPrompt,
      { temperature: 0.2, maxTokens: 2000 },
    );

    if (result.response) {
      return result.response;
    }

    if (result.error) {
      console.error("Ollama error:", result.error);
      return `Ollama 오류: ${result.error}. Ollama 서버가 실행 중인지 확인해주세요.`;
    }
  }

  // OpenRouter 클라우드 모델 사용 (Ollama 비활성화 시)
  const enabledModels = ragModels.filter((m) => m.enabled);

  if (enabledModels.length === 0) {
    return "활성화된 RAG 모델이 없습니다. 설정에서 Ollama를 활성화하거나 클라우드 모델을 활성화해주세요.";
  }

  for (const model of enabledModels) {
    try {
      console.log(`RAG using OpenRouter model: ${model.id} (${model.name})`);
      const response = await openai.chat.completions.create({
        model: model.id,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        return content;
      }
    } catch (error: any) {
      console.error(`RAG model ${model.id} error:`, error.message || error);
      // 다음 모델로 폴백
      continue;
    }
  }

  return "응답 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}

export async function queryRag(query: string): Promise<{
  answer: string;
  sources: SearchResult[];
}> {
  const searchContext = await hybridSearch(query, 5);
  const answer = await generateRagResponse(query, searchContext.results);

  return {
    answer,
    sources: searchContext.results,
  };
}

export async function getDocumentStats(): Promise<{
  totalDocuments: number;
  totalChunks: number;
  documentsByStatus: Record<string, number>;
}> {
  const docs = await db.select().from(knowledgeDocuments);

  const statusCounts: Record<string, number> = {};
  for (const doc of docs) {
    statusCounts[doc.status] = (statusCounts[doc.status] || 0) + 1;
  }

  const chunks = await db.select().from(documentChunks);

  return {
    totalDocuments: docs.length,
    totalChunks: chunks.length,
    documentsByStatus: statusCounts,
  };
}
