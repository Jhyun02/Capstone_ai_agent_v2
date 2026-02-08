import { type Request, type Response } from "express";

// Ollama 설정 상태 관리
let ollamaConfig = {
  baseUrl: "http://localhost:11434",
  enabled: false,
};

// 저사양 PC를 위한 추천 모델 목록
export const RECOMMENDED_OLLAMA_MODELS = [
  { name: "llama3.2:3b", size: "2.0GB", recommended: true },
  { name: "gemma2:2b", size: "1.6GB", recommended: false },
  { name: "phi3:mini", size: "2.3GB", recommended: false },
  { name: "qwen2:1.5b", size: "1.1GB", recommended: false },
];

export function getOllamaConfig() {
  return ollamaConfig;
}

export function setOllamaConfig(baseUrl: string, enabled: boolean) {
  ollamaConfig = { baseUrl, enabled };
}

export function isOllamaEnabled() {
  return ollamaConfig.enabled;
}

// Ollama 서버 연결 상태 확인
export async function checkOllamaConnection(): Promise<{
  connected: boolean;
  version?: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2초 타임아웃

    const res = await fetch(`${ollamaConfig.baseUrl}/api/version`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as { version: string };
      return { connected: true, version: data.version };
    }
    return { connected: false };
  } catch (e) {
    return { connected: false };
  }
}

// 설치된 모델 목록 조회
export async function listOllamaModels() {
  try {
    // 연결 확인 없이 바로 요청 (타임아웃은 fetch 기본값 또는 브라우저/노드 설정 따름)
    const res = await fetch(`${ollamaConfig.baseUrl}/api/tags`);
    if (res.ok) {
      const data = (await res.json()) as { models: any[] };
      return { models: data.models || [] };
    }
    return { models: [] };
  } catch (e) {
    console.error("Ollama 모델 목록 조회 실패:", e);
    return { models: [], error: "모델 목록을 가져올 수 없습니다." };
  }
}

// 텍스트 생성 (RAG용)
export async function generateWithOllama(
  model: string,
  prompt: string,
  systemPrompt: string,
  options: { temperature?: number; maxTokens?: number } = {},
) {
  try {
    const res = await fetch(`${ollamaConfig.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: `${prompt}`,
        system: systemPrompt,
        stream: false,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama API 응답 오류: ${res.status}`);
    }

    const data = (await res.json()) as { response: string };
    return { response: data.response };
  } catch (e: any) {
    console.error("Ollama 생성 오류:", e);
    return { error: e.message || "Ollama 응답 생성 실패" };
  }
}
