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

// 임베딩 모델(nomic-embed-text) 설치 여부 확인
export async function checkEmbeddingModel(): Promise<boolean> {
  try {
    const { models } = await listOllamaModels();
    return models.some((m: any) => {
      const name: string = m.name || m.model || '';
      return name.startsWith('nomic-embed-text');
    });
  } catch {
    return false;
  }
}

// 최적화된 Ollama 옵션 (macOS Apple Silicon 최적화)
const OLLAMA_OPTIMIZED_OPTIONS = {
  num_ctx: 2048,    // 기본 8192에서 축소 → 프롬프트 평가 속도 향상
  num_batch: 512,   // 프롬프트 병렬 평가
};

// 텍스트 생성 (RAG용, SQL 생성 등 짧은 응답용)
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
        keep_alive: "30m",
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
          ...OLLAMA_OPTIMIZED_OPTIONS,
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

// 스트리밍 텍스트 생성 (요약 등 긴 응답용)
export async function generateWithOllamaStream(
  model: string,
  prompt: string,
  systemPrompt: string,
  callbacks: {
    onToken: (token: string) => void;
    onDone: (fullResponse: string) => void;
    onError: (error: Error) => void;
  },
  options: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
) {
  try {
    const res = await fetch(`${ollamaConfig.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        system: systemPrompt,
        stream: true,
        keep_alive: "30m",
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
          ...OLLAMA_OPTIMIZED_OPTIONS,
        },
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama API 응답 오류: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("응답 스트림을 읽을 수 없습니다");
    }

    const decoder = new TextDecoder();
    let fullResponse = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // NDJSON 파싱: 줄바꿈으로 구분된 JSON 객체
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // 마지막 불완전한 줄은 버퍼에 유지

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as { response?: string; done?: boolean };
          if (chunk.response) {
            fullResponse += chunk.response;
            callbacks.onToken(chunk.response);
          }
          if (chunk.done) {
            callbacks.onDone(fullResponse);
            return;
          }
        } catch {
          // JSON 파싱 실패 시 무시
        }
      }
    }

    // 버퍼에 남은 데이터 처리 (마지막 청크에 줄바꿈이 없는 경우)
    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer) as { response?: string; done?: boolean };
        if (chunk.response) {
          fullResponse += chunk.response;
          callbacks.onToken(chunk.response);
        }
        if (chunk.done) {
          callbacks.onDone(fullResponse);
          return;
        }
      } catch {
        // JSON 파싱 실패 시 무시
      }
    }

    // 스트림이 끝났지만 done 이벤트가 없었을 경우
    callbacks.onDone(fullResponse);
  } catch (e: any) {
    if (e.name === "AbortError") {
      callbacks.onError(new Error("AbortError"));
      return;
    }
    console.error("Ollama 스트리밍 오류:", e);
    callbacks.onError(e);
  }
}
