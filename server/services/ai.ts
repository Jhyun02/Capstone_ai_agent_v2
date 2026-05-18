import OpenAI from "openai";
import * as ollamaService from "../ollama-service";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY || "not-set",
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
});

const PRIMARY_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const OLLAMA_MODEL = "mistral";

interface GenerateParams {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

async function callOpenRouter(
  model: string,
  params: GenerateParams,
): Promise<string> {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    temperature: params.temperature ?? 0.7,
    max_tokens: params.maxTokens ?? 1024,
  });
  return response.choices[0]?.message?.content || "";
}

// Ollama 우선 → OpenRouter fallback (기존 패턴 유지)
export async function generateTextPrimary(params: GenerateParams): Promise<string> {
  try {
    const connected = await ollamaService.checkOllamaConnection();
    if (connected) {
      const result = await ollamaService.generateWithOllama(
        OLLAMA_MODEL,
        params.userPrompt,
        params.systemPrompt,
        { temperature: params.temperature, maxTokens: params.maxTokens },
      );
      if ("response" in result && result.response) {
        return result.response;
      }
    }
  } catch {
    // Ollama 실패 시 OpenRouter fallback
  }
  return callOpenRouter(PRIMARY_MODEL, params);
}

// SQL 검증용 (기존 모델과 동일 패턴)
export async function generateTextForValidation(params: GenerateParams): Promise<string> {
  return generateTextPrimary(params);
}

// 인사이트 통합용 (기존 모델과 동일 패턴)
export async function generateTextForSynthesis(params: GenerateParams): Promise<string> {
  return generateTextPrimary(params);
}
