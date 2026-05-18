import OpenAI from "openai";
import { db } from "./db";
import { sql } from "drizzle-orm";
import * as ollamaService from "./ollama-service";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { SqlValidationItem, SqlValidation } from "@shared/routes";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY || "not-set",
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
});

const MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const OLLAMA_MODEL = "mistral";
const MAX_RETRIES = 2;

const PIPELINE_MODE = process.env.PIPELINE_MODE || "enhanced";

// === 오류 유형 정의 ===

export type SqlErrorType =
  | "SCHEMA_MISMATCH"
  | "COLUMN_MAPPING"
  | "SYNTAX_ERROR"
  | "DATASET_ID_MISSING"
  | "TYPE_CAST"
  | "UNKNOWN";

export interface PipelineLog {
  mode: "legacy" | "enhanced";
  primaryLlm: "ollama" | "openrouter";
  primarySql: string;
  primaryLatencyMs: number;
  schemaValidation: { passed: boolean; failedItems: string[] };
  errorClassification?: SqlErrorType;
  fallbackUsed: boolean;
  fallbackLlm?: "ollama" | "openrouter";
  fallbackSql?: string;
  fallbackLatencyMs?: number;
  selfCorrectionAttempts: number;
  selfCorrectionHistory: Array<{
    attempt: number;
    errorType: SqlErrorType;
    errorMessage: string;
    correctedSql: string;
    latencyMs: number;
  }>;
  finalSql: string;
  success: boolean;
  totalLatencyMs: number;
}

export interface PipelineParams {
  userQuestion: string;
  datasetId?: number;
  dynamicSchema: string;
  dynamicExamples: string;
  columnNames: string[];
  onEvent?: (event: string, data: any) => void;
}

export interface PipelineResult {
  generatedSql: string;
  queryResult: any[];
  lastError: string | null;
  validation: SqlValidation;
  pipelineLog: PipelineLog;
}

// === 유틸리티 함수 ===

export function cleanSql(rawSql: string): string {
  let cleaned = rawSql
    .replace(/```sql/gi, "")
    .replace(/```/g, "")
    .trim();
  const sqlMatch = cleaned.match(/SELECT[\s\S]*?(?:;|$)/i);
  if (sqlMatch) {
    cleaned = sqlMatch[0].replace(/;$/, "");
  }
  return cleaned;
}

export function validateGeneratedSql(
  sqlQuery: string,
  columnNames: string[],
  datasetId?: number,
): { items: SqlValidationItem[]; overall: boolean } {
  const items: SqlValidationItem[] = [];
  const trimmed = sqlQuery.trim().toLowerCase();

  const dangerousKeywords = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;
  const isSafe = trimmed.startsWith("select") && !dangerousKeywords.test(sqlQuery);
  items.push({
    key: "syntax",
    label: "구문 검증",
    passed: isSafe,
    message: isSafe ? "SELECT 쿼리 확인" : "허용되지 않는 SQL 구문 감지",
  });

  if (columnNames.length > 0) {
    const usedColumns: string[] = [];
    const colRegex = /data->>'\s*([^']+)'/gi;
    let match;
    while ((match = colRegex.exec(sqlQuery)) !== null) {
      usedColumns.push(match[1].trim());
    }

    if (usedColumns.length > 0) {
      const invalidColumns = usedColumns.filter(c => !columnNames.includes(c));
      const schemaValid = invalidColumns.length === 0;
      items.push({
        key: "schema",
        label: "스키마 검증",
        passed: schemaValid,
        message: schemaValid
          ? `사용된 컬럼 ${usedColumns.length}개 모두 유효`
          : `존재하지 않는 컬럼: ${invalidColumns.join(", ")}`,
      });
    } else {
      items.push({
        key: "schema",
        label: "스키마 검증",
        passed: true,
        message: "JSONB 컬럼 접근 없음 (집계 쿼리)",
      });
    }
  }

  if (datasetId != null) {
    const idPattern = new RegExp(`dataset_id\\s*=\\s*${datasetId}\\b`);
    const hasDatasetId = idPattern.test(sqlQuery);
    items.push({
      key: "dataset_id",
      label: "데이터셋 ID 검증",
      passed: hasDatasetId,
      message: hasDatasetId
        ? `dataset_id = ${datasetId} 조건 포함`
        : `WHERE dataset_id = ${datasetId} 조건 누락`,
    });
  }

  const overall = items.every(item => item.passed);
  return { items, overall };
}

export function addExecutionResult(
  validation: { items: SqlValidationItem[]; overall: boolean },
  success: boolean,
  errorMessage?: string,
): SqlValidation {
  const executionItem: SqlValidationItem = {
    key: "execution",
    label: "실행 결과",
    passed: success,
    message: success ? "쿼리 실행 성공" : `실행 오류: ${errorMessage || "알 수 없는 오류"}`,
  };
  const items = [...validation.items, executionItem];
  return { items, overall: items.every(item => item.passed) };
}

// === 3단계: 오류 유형 분류 ===

export function classifySqlError(
  errorMessage: string,
  sqlQuery: string,
  columnNames: string[],
): SqlErrorType {
  const msg = errorMessage.toLowerCase();

  if (/column\s+"[^"]*"\s+does not exist/.test(msg) || /relation\s+"[^"]*"\s+does not exist/.test(msg)) {
    const colMatch = errorMessage.match(/column\s+"([^"]+)"/i);
    if (colMatch) {
      const badCol = colMatch[1];
      const isAscii = /^[a-zA-Z0-9_]+$/.test(badCol);
      const hasKoreanCols = columnNames.some(c => /[가-힣]/.test(c));
      if (isAscii && hasKoreanCols) {
        return "COLUMN_MAPPING";
      }
    }
    return "SCHEMA_MISMATCH";
  }

  if (/invalid input syntax for type/.test(msg) || /cannot cast/.test(msg)) {
    return "TYPE_CAST";
  }

  if (/syntax error at or near/.test(msg)) {
    return "SYNTAX_ERROR";
  }

  if (!sqlQuery.toLowerCase().includes("dataset_id")) {
    return "DATASET_ID_MISSING";
  }

  return "UNKNOWN";
}

// 검증 실패 항목에서 오류 유형 추출
function classifyFromValidation(
  items: SqlValidationItem[],
  columnNames: string[],
): SqlErrorType {
  const failedKeys = items.filter(i => !i.passed).map(i => i.key);

  if (failedKeys.includes("dataset_id")) return "DATASET_ID_MISSING";
  if (failedKeys.includes("syntax")) return "SYNTAX_ERROR";
  if (failedKeys.includes("schema")) {
    const schemaItem = items.find(i => i.key === "schema" && !i.passed);
    if (schemaItem) {
      const mentioned = schemaItem.message;
      const hasAsciiCol = /[a-zA-Z_]+/.test(mentioned);
      const hasKoreanCols = columnNames.some(c => /[가-힣]/.test(c));
      if (hasAsciiCol && hasKoreanCols) return "COLUMN_MAPPING";
    }
    return "SCHEMA_MISMATCH";
  }

  return "UNKNOWN";
}

// === 4단계: 오류 유형별 맞춤 프롬프트 ===

function buildErrorSpecificPrompt(
  errorType: SqlErrorType,
  originalSql: string,
  errorMessage: string,
  schema: string,
  columnNames: string[],
): string {
  const basePrompt = `Original SQL: ${originalSql}\nError: ${errorMessage}\n\nDatabase Schema:\n${schema}\n`;

  const hints: Record<SqlErrorType, string> = {
    SCHEMA_MISMATCH: `HINT: 사용 가능한 컬럼 목록: [${columnNames.join(", ")}]\n컬럼은 반드시 data->>'컬럼명' 형태로 접근하세요. 스키마에 없는 컬럼은 사용할 수 없습니다.`,
    COLUMN_MAPPING: `HINT: 한글 컬럼명을 영문으로 변환하지 마세요! 반드시 원래 한글 컬럼명을 그대로 사용하세요.\n사용 가능한 컬럼: [${columnNames.join(", ")}]\n예시: data->>'${columnNames[0] || "컬럼명"}'`,
    SYNTAX_ERROR: `HINT: PostgreSQL 문법을 정확히 따르세요. 특히:\n- JSONB 접근: data->>'컬럼명' (따옴표 주의)\n- 괄호 짝 확인\n- 예약어 충돌 시 큰따옴표 사용`,
    DATASET_ID_MISSING: `HINT: 반드시 WHERE dataset_id = {해당 ID} 조건을 포함하세요. structured_data 테이블의 모든 쿼리에 필수입니다.`,
    TYPE_CAST: `HINT: JSONB 값은 텍스트입니다. 숫자 비교/정렬 시 CAST(data->>'컬럼명' AS NUMERIC), 날짜는 CAST(... AS DATE)를 사용하세요.`,
    UNKNOWN: `HINT: 에러 메시지를 참고하여 SQL을 수정하세���.`,
  };

  return `${basePrompt}\n${hints[errorType]}\n\nRules:\n1. Output ONLY the corrected SQL query\n2. No explanations, no markdown\n3. Ensure valid PostgreSQL\n\nFixed SQL:`;
}

// === LLM 래퍼 ===

function getPrimaryLlm(): "ollama" | "openrouter" {
  return "ollama";
}

function getFallbackLlm(): "ollama" | "openrouter" | null {
  const primary = getPrimaryLlm();
  if (primary === "openrouter") return "ollama";
  if (primary === "ollama" && process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY) return "openrouter";
  return null;
}

async function callLlm(
  llm: "ollama" | "openrouter",
  prompt: string,
  systemPrompt: string,
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  if (llm === "openrouter") {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 2048,
    });
    return completion.choices[0]?.message?.content || "";
  } else {
    const result = await ollamaService.generateWithOllama(
      OLLAMA_MODEL,
      prompt,
      systemPrompt,
      { temperature: options.temperature ?? 0, maxTokens: options.maxTokens ?? 200 },
    );
    return result.response || "";
  }
}

// === 시스템 프롬프트 생성 ===

export function buildSqlSystemPrompt(
  dynamicSchema: string,
  dynamicExamples: string,
  datasetId?: number,
): string {
  let systemPrompt = `You are a PostgreSQL expert. Convert natural language questions into valid PostgreSQL queries.

${dynamicSchema}

${dynamicExamples}

Rules:
1. Output ONLY the SQL query (no code blocks, no explanation)
2. Use ONLY 'structured_data' table (never use sales, products)
3. No JOINs
4. Use CAST() for numeric/date column sorting and calculations
5. Use LIMIT for "top", "best", "most" queries
6. Access JSONB columns via data->>'column_name'
7. LIKE search: data->>'col' LIKE '%keyword%'
8. Use exact column names from schema (no translation)`;

  if (datasetId) {
    systemPrompt += `\n9. REQUIRED: Always include WHERE dataset_id = ${datasetId}`;
  }

  return systemPrompt;
}

// === dataset_id 자동 수정 ===

function autoFixDatasetId(sqlQuery: string, datasetId?: number): string {
  if (!datasetId || !sqlQuery) return sqlQuery;
  const idRegex = /dataset_id\s*=\s*(?:'[^']*'|"[^"]*"|\d+|[^\s,;)]+)/gi;
  if (idRegex.test(sqlQuery)) {
    return sqlQuery.replace(
      /dataset_id\s*=\s*(?:'[^']*'|"[^"]*"|\d+|[^\s,;)]+)/gi,
      `dataset_id = ${datasetId}`,
    );
  }
  return sqlQuery;
}

// === fixSqlWithLLM (enhanced) ===

async function fixSqlWithLLM(
  originalSql: string,
  errorMessage: string,
  userQuestion: string,
  schema: string,
  columnNames: string[],
  errorType: SqlErrorType,
  preferredLlm: "ollama" | "openrouter",
): Promise<string> {
  const prompt = buildErrorSpecificPrompt(errorType, originalSql, errorMessage, schema, columnNames);
  const systemPrompt = "You are a SQL expert. Output only valid PostgreSQL queries.";

  try {
    const raw = await callLlm(preferredLlm, prompt, systemPrompt, { temperature: 0 });
    return cleanSql(raw);
  } catch (err) {
    console.error(`[Pipeline] fixSqlWithLLM (${preferredLlm}) 실패:`, err);
    return originalSql;
  }
}

// === fixSqlWithLLM (legacy — 기존 동작 그대로) ===

async function fixSqlWithLLMLegacy(
  originalSql: string,
  errorMessage: string,
  userQuestion: string,
  schema: string,
): Promise<string> {
  const fixPrompt = `
You are a SQL expert. The following SQL query failed with an error. Fix it.

Original Question: "${userQuestion}"
Failed SQL: ${originalSql}
Error: ${errorMessage}

Database Schema:
${schema}

Rules:
1. Output ONLY the corrected SQL query
2. No explanations, no markdown
3. Ensure the query is valid PostgreSQL

Fixed SQL:`;

  try {
    const llm = getPrimaryLlm();
    const raw = await callLlm(llm, fixPrompt, "You are a SQL expert. Output only valid PostgreSQL queries.", { temperature: 0 });
    return cleanSql(raw);
  } catch (err) {
    console.error("[Pipeline/Legacy] fixSqlWithLLM 실패:", err);
    return originalSql;
  }
}

// === 파이프라�� 로깅 ===

function logPipelineResult(log: PipelineLog, userQuestion: string) {
  try {
    const logsDir = join(process.cwd(), "logs");
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
    const entry = {
      timestamp: new Date().toISOString(),
      question: userQuestion,
      ...log,
    };
    appendFileSync(join(logsDir, "pipeline-eval.jsonl"), JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("[Pipeline] 로그 기록 실패:", err);
  }
}

function printPipelineLog(log: PipelineLog, question: string) {
  const lines = [
    `[Pipeline] 질문: "${question.slice(0, 50)}${question.length > 50 ? "..." : ""}"`,
    `  모드: ${log.mode}`,
    `  1차 LLM: ${log.primaryLlm} (${log.primaryLatencyMs}ms)`,
    `  스키마 검증: ${log.schemaValidation.passed ? "통과" : `실패 (${log.schemaValidation.failedItems.join(", ")})`}`,
  ];

  if (log.errorClassification) {
    lines.push(`  오류 분류: ${log.errorClassification}`);
  }
  if (log.fallbackUsed) {
    lines.push(`  Fallback: ${log.fallbackLlm} (${log.fallbackLatencyMs}ms)`);
  }
  if (log.selfCorrectionAttempts > 0) {
    lines.push(`  Self-correction: ${log.selfCorrectionAttempts}회`);
    for (const h of log.selfCorrectionHistory) {
      lines.push(`    [${h.attempt}] ${h.errorType}: ${h.errorMessage.slice(0, 60)}... (${h.latencyMs}ms)`);
    }
  }
  lines.push(`  최종: ${log.success ? "성공" : "실패"} (총 ${log.totalLatencyMs}ms)`);

  console.log(lines.join("\n"));
}

// === 핵심: 5단계 파이프라인 ===

export async function executeSqlPipeline(params: PipelineParams): Promise<PipelineResult> {
  const { userQuestion, datasetId, dynamicSchema, dynamicExamples, columnNames, onEvent } = params;
  const totalStart = Date.now();
  const isEnhanced = PIPELINE_MODE === "enhanced";

  const pipelineLog: PipelineLog = {
    mode: isEnhanced ? "enhanced" : "legacy",
    primaryLlm: getPrimaryLlm(),
    primarySql: "",
    primaryLatencyMs: 0,
    schemaValidation: { passed: false, failedItems: [] },
    fallbackUsed: false,
    selfCorrectionAttempts: 0,
    selfCorrectionHistory: [],
    finalSql: "",
    success: false,
    totalLatencyMs: 0,
  };

  const systemPrompt = buildSqlSystemPrompt(dynamicSchema, dynamicExamples, datasetId);

  // === 1단계: 1차 SQL 생성 ===
  onEvent?.("step", { step: "generating_sql", label: "SQL 생성 중..." });
  const primaryLlm = getPrimaryLlm();
  const genStart = Date.now();

  let generatedSql = "";
  try {
    const raw = await callLlm(primaryLlm, userQuestion, systemPrompt, { temperature: 0 });
    console.log(`[Pipeline] raw LLM response (${primaryLlm}):`, raw?.substring(0, 200));
    generatedSql = cleanSql(raw);
    console.log(`[Pipeline] cleanSql result:`, generatedSql?.substring(0, 200));
  } catch (err) {
    console.error(`[Pipeline] 1차 생성 (${primaryLlm}) 실패:`, err);
  }

  pipelineLog.primaryLatencyMs = Date.now() - genStart;
  generatedSql = autoFixDatasetId(generatedSql, datasetId);
  pipelineLog.primarySql = generatedSql;

  if (!generatedSql || !generatedSql.toLowerCase().startsWith("select")) {
    pipelineLog.totalLatencyMs = Date.now() - totalStart;
    pipelineLog.finalSql = "";
    logPipelineResult(pipelineLog, userQuestion);
    printPipelineLog(pipelineLog, userQuestion);

    return {
      generatedSql: "",
      queryResult: [],
      lastError: null,
      validation: { items: [], overall: false },
      pipelineLog,
    };
  }

  // === 2단계: 스키마 정합성 검증 ===
  let preValidation = validateGeneratedSql(generatedSql, columnNames, datasetId);
  pipelineLog.schemaValidation = {
    passed: preValidation.overall,
    failedItems: preValidation.items.filter(i => !i.passed).map(i => i.key),
  };

  onEvent?.("sql", { sql: generatedSql });
  onEvent?.("validation", preValidation);

  // === Enhanced: 3~4단계 (검증 실패 시 오류 분류 + fallback 재생성) ===
  if (isEnhanced && !preValidation.overall) {
    // 3단계: 오류 유형 분류
    const errorType = classifyFromValidation(preValidation.items, columnNames);
    pipelineLog.errorClassification = errorType;

    // 4단계: fallback 재생성
    const fallbackLlm = getFallbackLlm() || primaryLlm;
    pipelineLog.fallbackLlm = fallbackLlm;

    const fallbackStart = Date.now();
    const errorMsg = preValidation.items
      .filter(i => !i.passed)
      .map(i => i.message)
      .join("; ");

    const fixedSql = await fixSqlWithLLM(
      generatedSql, errorMsg, userQuestion, dynamicSchema,
      columnNames, errorType, fallbackLlm,
    );

    pipelineLog.fallbackLatencyMs = Date.now() - fallbackStart;

    if (fixedSql && fixedSql !== generatedSql) {
      generatedSql = autoFixDatasetId(fixedSql, datasetId);
      pipelineLog.fallbackUsed = true;
      pipelineLog.fallbackSql = generatedSql;

      preValidation = validateGeneratedSql(generatedSql, columnNames, datasetId);
      onEvent?.("sql", { sql: generatedSql });
      onEvent?.("validation", preValidation);
    }
  }

  // === 5단계: SQL 실행 + Self-Correction ===
  onEvent?.("step", { step: "executing_sql", label: "쿼리 실행 중..." });

  let queryResult: any[] = [];
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await db.execute(sql.raw(generatedSql));
      queryResult = result.rows;
      lastError = null;
      break;
    } catch (dbError: any) {
      lastError = dbError.message;
      console.error(`[Pipeline] SQL 실행 오류 (attempt ${attempt + 1}):`, dbError.message);

      if (attempt < MAX_RETRIES) {
        const correctionStart = Date.now();

        if (isEnhanced) {
          const errorType = classifySqlError(dbError.message, generatedSql, columnNames);
          const correctionLlm = attempt === 0 ? primaryLlm : (getFallbackLlm() || primaryLlm);

          const fixedSql = await fixSqlWithLLM(
            generatedSql, dbError.message, userQuestion, dynamicSchema,
            columnNames, errorType, correctionLlm,
          );

          const latency = Date.now() - correctionStart;
          pipelineLog.selfCorrectionAttempts++;
          pipelineLog.selfCorrectionHistory.push({
            attempt: attempt + 1,
            errorType,
            errorMessage: dbError.message,
            correctedSql: fixedSql,
            latencyMs: latency,
          });

          if (fixedSql && fixedSql !== generatedSql) {
            generatedSql = autoFixDatasetId(fixedSql, datasetId);
            preValidation = validateGeneratedSql(generatedSql, columnNames, datasetId);
            onEvent?.("sql", { sql: generatedSql });
            onEvent?.("validation", preValidation);
          }
        } else {
          // Legacy: 기존 동작
          const fixedSql = await fixSqlWithLLMLegacy(generatedSql, dbError.message, userQuestion, dynamicSchema);
          const latency = Date.now() - correctionStart;

          pipelineLog.selfCorrectionAttempts++;
          pipelineLog.selfCorrectionHistory.push({
            attempt: attempt + 1,
            errorType: "UNKNOWN",
            errorMessage: dbError.message,
            correctedSql: fixedSql,
            latencyMs: latency,
          });

          if (fixedSql && fixedSql !== generatedSql) {
            generatedSql = fixedSql;
            preValidation = validateGeneratedSql(generatedSql, columnNames, datasetId);
            onEvent?.("sql", { sql: generatedSql });
            onEvent?.("validation", preValidation);
          }
        }
      }
    }
  }

  // === 최종 결과 ===
  pipelineLog.finalSql = generatedSql;
  pipelineLog.success = lastError === null;
  pipelineLog.totalLatencyMs = Date.now() - totalStart;

  const validation = addExecutionResult(preValidation, !lastError, lastError || undefined);

  logPipelineResult(pipelineLog, userQuestion);
  printPipelineLog(pipelineLog, userQuestion);

  return {
    generatedSql,
    queryResult,
    lastError,
    validation,
    pipelineLog,
  };
}
