import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import OpenAI from "openai";
import { db } from "./db";
import { sql, eq, desc } from "drizzle-orm";
import multer from "multer";
import Papa from "papaparse";
import {
  datasets,
  structuredData,
  unstructuredData,
  knowledgeDocuments,
  documentChunks,
  type ColumnInfo,
  type QualityReport,
  type QualityReportColumn,
} from "@shared/schema";
import * as documentParser from "./document-parser";
import * as embeddingService from "./embedding-service";
import * as ragService from "./rag-service";
import * as ollamaService from "./ollama-service";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY || "not-set",
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
});

const MODEL = "mistralai/devstral-2512:free";
const OLLAMA_MODEL = "mistral";

// buildDynamicSchema 캐시 (datasetId 기준, TTL 1분)
const schemaCache = new Map<string, { schema: string; examples: string; cachedAt: number }>();
const SCHEMA_CACHE_TTL = 60_000; // 1분

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
});

const knowledgeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB per file
});

// Fix Korean filename encoding (multer returns latin1 encoded filenames)
function decodeFilename(filename: string): string {
  try {
    // Try to decode from latin1 to UTF-8
    return Buffer.from(filename, "latin1").toString("utf8");
  } catch {
    return filename;
  }
}

function inferColumnType(
  values: string[],
): "text" | "number" | "date" | "boolean" {
  const nonEmptyValues = values.filter(
    (v) => v !== null && v !== undefined && v.trim() !== "",
  );
  if (nonEmptyValues.length === 0) return "text";

  const numberCount = nonEmptyValues.filter(
    (v) => !isNaN(Number(v.replace(/,/g, ""))),
  ).length;
  if (numberCount / nonEmptyValues.length > 0.8) return "number";

  const booleanCount = nonEmptyValues.filter((v) =>
    ["true", "false", "yes", "no", "1", "0", "예", "아니오", "Y", "N"].includes(
      v.toLowerCase(),
    ),
  ).length;
  if (booleanCount / nonEmptyValues.length > 0.8) return "boolean";

  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}/,
    /^\d{2}\/\d{2}\/\d{4}/,
    /^\d{4}\/\d{2}\/\d{2}/,
  ];
  const dateCount = nonEmptyValues.filter((v) =>
    datePatterns.some((p) => p.test(v)),
  ).length;
  if (dateCount / nonEmptyValues.length > 0.8) return "date";

  return "text";
}

function analyzeColumns(headers: string[], rows: any[]): ColumnInfo[] {
  return headers.map((header) => {
    const values = rows.slice(0, 100).map((row) => String(row[header] || ""));
    return {
      name: header,
      type: inferColumnType(values),
      nullable: values.some((v) => !v || v.trim() === ""),
      sampleValues: values.slice(0, 3).filter((v) => v.trim() !== ""),
    };
  });
}

async function buildDynamicSchema(targetDatasetId?: number): Promise<{ schema: string; examples: string }> {
  // 캐시 확인
  const cacheKey = String(targetDatasetId ?? "none");
  const cached = schemaCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < SCHEMA_CACHE_TTL) {
    return { schema: cached.schema, examples: cached.examples };
  }

  let schema = ENHANCED_SCHEMA;
  let examples = "";

  try {
    const uploadedDatasets = targetDatasetId
      ? await db.select().from(datasets).where(eq(datasets.id, targetDatasetId))
      : []; // [최적화] 데이터셋 미선택 시 커스텀 스키마를 로드하지 않아 프롬프트 크기를 줄임

    if (uploadedDatasets.length > 0) {
      schema += "\n\n=== 사용자 업로드 데이터셋 ===\n";

      for (const dataset of uploadedDatasets) {
        if (dataset.dataType === "structured" && dataset.columnInfo) {
          const columns: ColumnInfo[] = JSON.parse(dataset.columnInfo);
          const datasetName = dataset.name;

          // PostgreSQL storage
          schema += `\n=== 데이터셋 정보 (ID: ${dataset.id}) ===\n`;
          schema += `이름: ${dataset.name}\n`;
          schema += `설명: ${dataset.description || dataset.fileName}\n`;
          schema += "| 컬럼명 | 타입 |\n";
          schema += "|--------|------|\n";

          for (const col of columns) {
            const sqlType =
              col.type === "number"
                ? "NUMERIC"
                : col.type === "date"
                  ? "TIMESTAMP"
                  : col.type === "boolean"
                    ? "BOOLEAN"
                    : "TEXT";
            schema += `| ${col.name} | ${sqlType} |\n`;
          }

          // [핵심] 현재 데이터셋에 맞춤화된 Few-Shot 예시 생성
          examples += `\n=== 올바른 쿼리 작성 예시 (참고용) ===\n`;
          examples += `Q: "${datasetName}의 전체 데이터 수"\n`;
          examples += `A: SELECT COUNT(*) FROM structured_data WHERE dataset_id = ${dataset.id}\n\n`;

          const textCol = columns.find(c => c.type === 'text')?.name;
          if (textCol) {
            examples += `Q: "${datasetName}에서 ${textCol} 컬럼에 '검색어'가 포함된 데이터"\n`;
            examples += `A: SELECT * FROM structured_data WHERE dataset_id = ${dataset.id} AND data->>'${textCol}' LIKE '%검색어%'\n\n`;
          }

          const numCol = columns.find(c => c.type === 'number')?.name;
          if (numCol) {
            examples += `Q: "${datasetName}의 ${numCol} 평균"\n`;
            examples += `A: SELECT AVG(CAST(data->>'${numCol}' AS DECIMAL)) FROM structured_data WHERE dataset_id = ${dataset.id}\n\n`;
          }

          schema += `\n[쿼리 작성 규칙]\n`;
          schema += `1. 테이블: structured_data\n`;
          schema += `2. 필수 조건: WHERE dataset_id = ${dataset.id} (주의: 데이터셋 이름 '${dataset.name}'이 아닌 숫자 ID ${dataset.id}를 사용해야 함)\n`;
          schema += `3. 컬럼 접근: data->>'컬럼명' (예: data->>'${columns[0]?.name || "column"}')\n`;
          schema += `4. 형변환: 숫자/날짜 비교 시 CAST 필수 (예: 숫자/날짜 비교 시 CAST(data->>'컬럼명' AS 타입) 사용. 타입은 NUMERIC, TIMESTAMP, DATE 중 하나여야 함)\n`;
        } else if (dataset.dataType === "unstructured") {
          schema += `설명: ${dataset.description || dataset.fileName} (비정형 텍스트 데이터, 키워드 검색 지원)\n`;
          schema += "| 컬럼명 | 타입 | 설명 |\n";
          schema += "|--------|------|------|\n";
          schema += "| raw_content | TEXT | 원본 텍스트 |\n";
          schema += "| search_text | TEXT | 검색용 텍스트 (소문자) |\n";
          schema += `\n쿼리 예시: SELECT raw_content FROM unstructured_data WHERE dataset_id = ${dataset.id} AND search_text LIKE '%검색어%'\n`;
        }
      }

      schema += `\n[참고] 정형 데이터는 JSON 형식으로 저장됨. data->>'컬럼명'으로 접근\n`;
    }
  } catch (err) {
    console.error("Error building dynamic schema:", err);
  }

  // 캐시 저장
  schemaCache.set(cacheKey, { schema, examples, cachedAt: Date.now() });
  return { schema, examples };
}

const ENHANCED_SCHEMA = `
=== 데이터베이스 스키마 (PostgreSQL) ===

기본 데이터베이스에는 사전 정의된 테이블이 없습니다.
사용자가 업로드한 데이터셋(structured_data)을 통해서만 질의가 가능합니다.
`;

async function fixSqlWithLLM(
  originalSql: string,
  errorMessage: string,
  userQuestion: string,
  schema: string = ENHANCED_SCHEMA,
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
    let fixedSql = "";

    if (process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY) {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a SQL expert. Output only valid PostgreSQL queries.",
          },
          { role: "user", content: fixPrompt },
        ],
        temperature: 0,
        max_tokens: 256,
      });
      fixedSql = completion.choices[0]?.message?.content || "";
    } else {
      // Ollama fallback
      const result = await ollamaService.generateWithOllama(
        OLLAMA_MODEL,
        fixPrompt,
        "You are a SQL expert. Output only valid PostgreSQL queries.",
        { temperature: 0, maxTokens: 200 }, // [최적화] 수정 로직 길이 추가 단축
      );
      fixedSql = result.response || "";
    }

    fixedSql = fixedSql
      .replace(/```sql/gi, "")
      .replace(/```/g, "")
      .trim();
    const sqlMatch = fixedSql.match(/SELECT[\s\S]*?(?:;|$)/i);
    if (sqlMatch) {
      return sqlMatch[0].replace(/;$/, "");
    }
    return fixedSql;
  } catch (err) {
    console.error("SQL fix error:", err);
    return originalSql;
  }
}

/**
 * structured_data 쿼리 결과에서 JSONB 'data' 컬럼을 개별 컬럼으로 펼침.
 * 예: { id: 1, dataset_id: 3, data: { "이름": "홍길동" } }
 *   → { "이름": "홍길동" }
 */
function flattenJsonbRows(rows: any[]): any[] {
  if (rows.length === 0) return rows;

  const first = rows[0];
  if (!first || typeof first.data !== "object" || first.data === null) return rows;

  return rows.map((row) => {
    if (typeof row.data === "object" && row.data !== null && !Array.isArray(row.data)) {
      return { ...row.data };
    }
    return row;
  });
}

function cleanSql(rawSql: string): string {
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

function getFallbackSql(message: string): string {
  return "";
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // await storage.seed(); // Default data seeding disabled

  app.get("/api/tables", async (req, res) => {
    try {
      res.json([]);
    } catch (err) {
      console.error("Tables error:", err);
      res.status(500).json({ message: "Failed to get tables" });
    }
  });

  app.post(api.chat.sql.path, async (req, res) => {
    try {
      const { message, datasetId } = api.chat.sql.input.parse(req.body);

      // Build dynamic schema including uploaded datasets
      const { schema: dynamicSchema, examples: dynamicExamples } = await buildDynamicSchema(datasetId);

      let systemPrompt = `You are a PostgreSQL SQL expert assistant. Convert natural language questions (Korean or English) into valid PostgreSQL queries.

${dynamicSchema}

${dynamicExamples}

=== 규칙 ===
1. SQL 쿼리만 출력 (코드 블록 X)
2. 오직 'structured_data' 테이블만 사용하세요. (sales, products 테이블 사용 금지)
3. JOIN 사용 금지.
4. 숫자, 날짜관련 컬럼 정렬/계산 시 CAST() 함수 필수 사용
5. "가장", "top", "best" 요청 시 반드시 LIMIT 사용
6. "data->>'컬럼명'" 형태로 JSONB 컬럼에 접근
7. LIKE 검색 시: data->>'컬럼명' LIKE '%keyword%' 형태 유지
8. 컬럼명은 반드시 스키마에 있는 명칭을 정확히 사용 (임의로 영문 변환 금지)
`;

      if (datasetId) {
        // [핵심 변경] 데이터셋 ID가 선택된 경우, AI에게 해당 ID 사용을 강제합니다.
        systemPrompt += `8. **필수**: 쿼리에 반드시 "WHERE dataset_id = ${datasetId}" 조건을 포함하세요. (데이터셋 이름이 아닌 숫자 ID ${datasetId}를 사용해야 합니다)\n`;
      } else {
        systemPrompt += `8. 사용자 업로드 데이터셋(structured_data) 질의 시:
    - "FROM structured_data WHERE dataset_id = <dataset_id>" 형태 유지
    - 반드시 **숫자 dataset_id** 사용 (데이터셋 이름 문자열 사용 **절대 금지**). 예: dataset_id = 42 (O), dataset_id = '잘못된이름' (X)\n`;
      }

      let generatedSql = "";

      console.log(`[AI] Generating SQL using: ${process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY ? "OpenRouter" : "Local Ollama (" + OLLAMA_MODEL + ")"}`);

      if (process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY) {
        const completion = await openai.chat.completions.create({
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
          ],
          temperature: 0,
          max_tokens: 256,
        });
        generatedSql = cleanSql(completion.choices[0]?.message?.content || "");
      } else {
        // Ollama fallback
        const result = await ollamaService.generateWithOllama(
          OLLAMA_MODEL,
          message,
          systemPrompt,
          { temperature: 0, maxTokens: 200 }, // [최적화] SQL 생성 길이 추가 단축
        );
        generatedSql = cleanSql(result.response || "");
      }

      console.log("Generated SQL:", generatedSql);

      // [Auto-Correction] datasetId가 명시된 경우, SQL의 dataset_id 조건을 강제로 수정
      if (datasetId && generatedSql) {
        // dataset_id = '...' 또는 dataset_id = 123 또는 dataset_id = 이름 형태를 찾아서 올바른 ID로 교체
        // 정규식 개선: 따옴표로 감싸진 값, 숫자, 또는 공백/구분자 전까지의 문자열을 모두 잡음
        const idRegex = /dataset_id\s*=\s*(?:'[^']*'|"[^"]*"|\d+|[^\s,;)]+)/gi;
        if (idRegex.test(generatedSql)) {
          const fixedSql = generatedSql.replace(idRegex, `dataset_id = ${datasetId}`);
          if (fixedSql !== generatedSql) {
            console.log(`[Auto-Fix] Corrected dataset_id: ${generatedSql} -> ${fixedSql}`);
            generatedSql = fixedSql;
          }
        }
      }

      if (!generatedSql || !generatedSql.toLowerCase().startsWith("select")) {
        console.log("Invalid SQL, using fallback");
        generatedSql = getFallbackSql(message);
        console.log("Fallback SQL:", generatedSql);
      }

      if (!generatedSql) {
        return res.json({
          answer: "데이터셋을 선택하거나 업로드해주세요. 기본 데이터에 대한 질의는 지원하지 않습니다.",
          sql: "",
          data: [],
        });
      }

      let queryResult: any[] = [];
      let lastError: string | null = null;
      const MAX_RETRIES = 2;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await db.execute(sql.raw(generatedSql));
          queryResult = result.rows;
          lastError = null;
          break;
        } catch (dbError: any) {
          console.error(
            `SQL execution error (attempt ${attempt + 1}):`,
            dbError.message,
          );
          lastError = dbError.message;

          if (attempt < MAX_RETRIES) {
            console.log("Attempting to fix SQL with LLM...");
            const fixedSql = await fixSqlWithLLM(
              generatedSql,
              dbError.message,
              message,
              dynamicSchema,
            );

            if (fixedSql && fixedSql !== generatedSql) {
              console.log("Fixed SQL:", fixedSql);
              generatedSql = fixedSql;
            } else {
              generatedSql = getFallbackSql(message);
              console.log("Using fallback SQL:", generatedSql);
            }
          }
        }
      }

      if (lastError) {
        return res.status(200).json({
          answer:
            "죄송합니다. 해당 질문에 대한 쿼리를 실행할 수 없습니다. 다른 방식으로 질문해 주시겠어요?",
          sql: generatedSql,
          data: [],
          error: lastError,
        });
      }

      const summaryPrompt = `
사용자 질문: "${message}"
실행된 SQL: "${generatedSql}"
결과 데이터: ${JSON.stringify(queryResult.slice(0, 10))} ${queryResult.length > 10 ? `(총 ${queryResult.length}건 중 10건 표시)` : `(${queryResult.length}건)`}

작업:
- 데이터를 기반으로 사용자 질문에 친절하게 한국어로 답변
- 숫자가 있으면 읽기 쉽게 포맷 (예: 1000000 → 100만)
- 데이터가 없으면 "조회된 데이터가 없습니다"라고 안내
- SQL이나 기술 용어 사용 금지, 결과만 자연스럽게 설명
- 답변 마지막에 "---추천 질문---"이라고 적고, 이어서 데이터 분석에 도움이 될만한 후속 질문 3가지를 줄바꿈으로 구분하여 작성해줘. (예: "카테고리별 매출 비중은?", "가장 재고가 적은 제품은?")
`;

      let answer = "결과를 확인해 주세요.";

      console.log(`[AI] Generating summary using: ${process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY ? "OpenRouter" : "Local Ollama (" + OLLAMA_MODEL + ")"}`);

      if (process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY) {
        const summaryCompletion = await openai.chat.completions.create({
          model: MODEL,
          messages: [
            {
              role: "system",
              content:
                "당신은 친절한 데이터 분석 어시스턴트입니다. 자연스럽고 간결한 한국어로 답변하세요.",
            },
            { role: "user", content: summaryPrompt },
          ],
          max_tokens: 512,
        });
        answer = summaryCompletion.choices[0]?.message?.content || answer;
      } else {
        // Ollama fallback
        const result = await ollamaService.generateWithOllama(
          OLLAMA_MODEL,
          summaryPrompt,
          "당신은 친절한 데이터 분석 어시스턴트입니다. 자연스럽고 간결한 한국어로 답변하세요.",
          { temperature: 0.2, maxTokens: 400 }, // [최적화] 요약 답변 길이 추가 단축
        );
        answer = result.response || answer;
      }

      // 추천 질문 파싱
      let finalAnswer = answer;
      let suggestedQuestions: string[] = [];

      if (answer.includes("---추천 질문---")) {
        const parts = answer.split("---추천 질문---");
        finalAnswer = parts[0].trim();
        suggestedQuestions = parts[1]
          .split("\n")
          .map((q) => q.trim().replace(/^-\s*/, "").replace(/^\d+\.\s*/, ""))
          .filter((q) => q.length > 0);
      }

      res.json({
        answer: finalAnswer,
        sql: generatedSql,
        data: flattenJsonbRows(queryResult),
        suggestedQuestions,
      });
    } catch (err) {
      console.error("Chat error:", err);
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid input" });
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  // === SSE 스트리밍 엔드포인트 ===
  app.post("/api/sql-chat-stream", async (req, res) => {
    // SSE 헤더 설정
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx 버퍼링 비활성화
    });

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 클라이언트 연결 끊김 감지
    const abortController = new AbortController();
    req.on("close", () => abortController.abort());

    try {
      const { message, datasetId } = api.chat.sql.input.parse(req.body);

      // 1단계: SQL 생성
      sendEvent("step", { step: "generating_sql", label: "SQL 생성 중..." });

      const { schema: dynamicSchema, examples: dynamicExamples } = await buildDynamicSchema(datasetId);

      // [최적화] 영어 프롬프트로 변환 (Mistral 코드 태스크 성능 향상 + 토큰 수 30-40% 감소)
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

      let generatedSql = "";

      if (process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY) {
        const completion = await openai.chat.completions.create({
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
          ],
          temperature: 0,
          max_tokens: 256,
        });
        generatedSql = cleanSql(completion.choices[0]?.message?.content || "");
      } else {
        const result = await ollamaService.generateWithOllama(
          OLLAMA_MODEL,
          message,
          systemPrompt,
          { temperature: 0, maxTokens: 200 },
        );
        generatedSql = cleanSql(result.response || "");
      }

      // dataset_id 자동 수정
      if (datasetId && generatedSql) {
        const idRegex = /dataset_id\s*=\s*(?:'[^']*'|"[^"]*"|\d+|[^\s,;)]+)/gi;
        if (idRegex.test(generatedSql)) {
          generatedSql = generatedSql.replace(
            /dataset_id\s*=\s*(?:'[^']*'|"[^"]*"|\d+|[^\s,;)]+)/gi,
            `dataset_id = ${datasetId}`,
          );
        }
      }

      if (!generatedSql || !generatedSql.toLowerCase().startsWith("select")) {
        generatedSql = getFallbackSql(message);
      }

      if (!generatedSql) {
        sendEvent("done", {
          answer: "데이터셋을 선택하거나 업로드해주세요.",
          sql: "",
          data: [],
          suggestedQuestions: [],
        });
        res.end();
        return;
      }

      // SQL 전송
      sendEvent("sql", { sql: generatedSql });

      // 2단계: SQL 실행
      sendEvent("step", { step: "executing_sql", label: "쿼리 실행 중..." });

      let queryResult: any[] = [];
      let lastError: string | null = null;
      const MAX_RETRIES = 2;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await db.execute(sql.raw(generatedSql));
          queryResult = result.rows;
          lastError = null;
          break;
        } catch (dbError: any) {
          lastError = dbError.message;
          if (attempt < MAX_RETRIES) {
            const fixedSql = await fixSqlWithLLM(generatedSql, dbError.message, message, dynamicSchema);
            if (fixedSql && fixedSql !== generatedSql) {
              generatedSql = fixedSql;
              sendEvent("sql", { sql: generatedSql }); // 수정된 SQL 재전송
            } else {
              generatedSql = getFallbackSql(message);
            }
          }
        }
      }

      if (lastError) {
        sendEvent("done", {
          answer: "죄송합니다. 해당 질문에 대한 쿼리를 실행할 수 없습니다. 다른 방식으로 질문해 주시겠어요?",
          sql: generatedSql,
          data: [],
          error: lastError,
          suggestedQuestions: [],
        });
        res.end();
        return;
      }

      // 데이터 전송
      const flatRows = flattenJsonbRows(queryResult);
      sendEvent("data", { rows: flatRows, rowCount: flatRows.length });

      // 요약 단계 제거 → 바로 완료
      sendEvent("done", {});

      res.end();
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error("Stream chat error:", err);
      try {
        sendEvent("error", { message: err.message || "Internal server error" });
      } catch {}
      res.end();
    }
  });

  // === Dataset Management API ===

  // List all datasets
  app.get("/api/datasets", async (req, res) => {
    try {
      const allDatasets = await db
        .select()
        .from(datasets)
        .orderBy(desc(datasets.createdAt));
      res.json(allDatasets);
    } catch (err) {
      console.error("Get datasets error:", err);
      res.status(500).json({ message: "Failed to get datasets" });
    }
  });

  // Get single dataset
  app.get("/api/datasets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const dataset = await db
        .select()
        .from(datasets)
        .where(eq(datasets.id, id))
        .limit(1);
      if (dataset.length === 0) {
        return res.status(404).json({ message: "Dataset not found" });
      }
      res.json(dataset[0]);
    } catch (err) {
      console.error("Get dataset error:", err);
      res.status(500).json({ message: "Failed to get dataset" });
    }
  });

  // Get dataset data with pagination
  app.get("/api/datasets/:id/data", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;

      const dataset = await db
        .select()
        .from(datasets)
        .where(eq(datasets.id, id))
        .limit(1);
      if (dataset.length === 0) {
        return res.status(404).json({ message: "Dataset not found" });
      }

      const ds = dataset[0];
      let rows: any[] = [];

      if (ds.dataType === "structured") {
        // Data in PostgreSQL
        const result = await db
          .select()
          .from(structuredData)
          .where(eq(structuredData.datasetId, id))
          .orderBy(structuredData.rowIndex)
          .limit(limit)
          .offset(offset);
        rows = result.map((r) => r.data);
      } else {
        // Unstructured data from PostgreSQL
        const result = await db
          .select()
          .from(unstructuredData)
          .where(eq(unstructuredData.datasetId, id))
          .orderBy(unstructuredData.rowIndex)
          .limit(limit)
          .offset(offset);
        rows = result.map((r) => ({
          _id: r.id,
          _content: r.rawContent,
          _metadata: r.metadata,
        }));
      }

      res.json({
        dataset: ds,
        data: rows,
        pagination: {
          page,
          limit,
          total: ds.rowCount,
          totalPages: Math.ceil(ds.rowCount / limit),
        },
        storage: "PostgreSQL",
      });
    } catch (err) {
      console.error("Get dataset data error:", err);
      res.status(500).json({ message: "Failed to get dataset data" });
    }
  });

  // 데이터 품질 리포트
  app.get("/api/datasets/:id/quality-report", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const dataset = await db
        .select()
        .from(datasets)
        .where(eq(datasets.id, id))
        .limit(1);
      if (dataset.length === 0) {
        return res.status(404).json({ message: "Dataset not found" });
      }

      const ds = dataset[0];
      if (ds.dataType !== "structured") {
        return res.status(400).json({ message: "Quality report is only available for structured datasets" });
      }

      const columnInfo: ColumnInfo[] = ds.columnInfo ? JSON.parse(ds.columnInfo) : [];
      if (columnInfo.length === 0) {
        return res.status(400).json({ message: "No column info available" });
      }

      const useSampling = ds.rowCount > 10000;
      const sampleCte = useSampling
        ? `WITH sampled AS (SELECT * FROM structured_data WHERE dataset_id = ${id} ORDER BY RANDOM() LIMIT 10000)`
        : `WITH sampled AS (SELECT * FROM structured_data WHERE dataset_id = ${id})`;
      const tableName = "sampled";

      // 메인 집계 쿼리 동적 생성
      const selectParts: string[] = [`COUNT(*) AS total_count`];

      for (const col of columnInfo) {
        const colKey = col.name.replace(/'/g, "''");
        const colAlias = col.name.replace(/[^a-zA-Z0-9_\uAC00-\uD7A3]/g, "_");

        // null/빈값 카운트
        selectParts.push(
          `SUM(CASE WHEN data->>'${colKey}' IS NULL OR TRIM(data->>'${colKey}') = '' THEN 1 ELSE 0 END) AS "${colAlias}_null"`
        );
        // 고유값 수
        selectParts.push(
          `COUNT(DISTINCT data->>'${colKey}') AS "${colAlias}_unique"`
        );

        if (col.type === "number") {
          // 타입 일관성 (숫자 정규식)
          selectParts.push(
            `SUM(CASE WHEN data->>'${colKey}' IS NOT NULL AND TRIM(data->>'${colKey}') != '' AND data->>'${colKey}' ~ '^-?[0-9,]+\\.?[0-9]*$' THEN 1 ELSE 0 END) AS "${colAlias}_type_match"`
          );
          // 숫자 통계
          selectParts.push(
            `MIN(CAST(NULLIF(REGEXP_REPLACE(TRIM(data->>'${colKey}'), ',', '', 'g'), '') AS NUMERIC)) AS "${colAlias}_min"`
          );
          selectParts.push(
            `MAX(CAST(NULLIF(REGEXP_REPLACE(TRIM(data->>'${colKey}'), ',', '', 'g'), '') AS NUMERIC)) AS "${colAlias}_max"`
          );
          selectParts.push(
            `AVG(CAST(NULLIF(REGEXP_REPLACE(TRIM(data->>'${colKey}'), ',', '', 'g'), '') AS NUMERIC)) AS "${colAlias}_mean"`
          );
          selectParts.push(
            `STDDEV(CAST(NULLIF(REGEXP_REPLACE(TRIM(data->>'${colKey}'), ',', '', 'g'), '') AS NUMERIC)) AS "${colAlias}_stddev"`
          );
        } else if (col.type === "date") {
          selectParts.push(
            `SUM(CASE WHEN data->>'${colKey}' IS NOT NULL AND TRIM(data->>'${colKey}') != '' AND data->>'${colKey}' ~ '^\\d{4}[-/]\\d{2}[-/]\\d{2}' THEN 1 ELSE 0 END) AS "${colAlias}_type_match"`
          );
          selectParts.push(`MIN(data->>'${colKey}') AS "${colAlias}_min_date"`);
          selectParts.push(`MAX(data->>'${colKey}') AS "${colAlias}_max_date"`);
        } else if (col.type === "boolean") {
          selectParts.push(
            `SUM(CASE WHEN data->>'${colKey}' IS NOT NULL AND TRIM(data->>'${colKey}') != '' AND LOWER(TRIM(data->>'${colKey}')) IN ('true','false','yes','no','1','0','y','n','예','아니오') THEN 1 ELSE 0 END) AS "${colAlias}_type_match"`
          );
        } else {
          // text: 길이 통계
          selectParts.push(
            `MIN(LENGTH(data->>'${colKey}')) AS "${colAlias}_min_len"`
          );
          selectParts.push(
            `MAX(LENGTH(data->>'${colKey}')) AS "${colAlias}_max_len"`
          );
        }
      }

      const mainQuery = `${sampleCte} SELECT ${selectParts.join(", ")} FROM ${tableName}`;
      const mainResult = await db.execute(sql.raw(mainQuery));
      const stats = (mainResult as any).rows[0];
      const totalCount = parseInt(stats.total_count);

      // 텍스트 컬럼 top 5 값 쿼리
      const textTopValues: Record<string, { value: string; count: number }[]> = {};
      const textCols = columnInfo.filter((c) => c.type === "text");
      for (const col of textCols) {
        const colKey = col.name.replace(/'/g, "''");
        const topQuery = `${sampleCte} SELECT data->>'${colKey}' AS value, COUNT(*) AS cnt FROM ${tableName} WHERE data->>'${colKey}' IS NOT NULL AND TRIM(data->>'${colKey}') != '' GROUP BY data->>'${colKey}' ORDER BY cnt DESC LIMIT 5`;
        const topResult = await db.execute(sql.raw(topQuery));
        textTopValues[col.name] = (topResult as any).rows.map((r: any) => ({
          value: r.value,
          count: parseInt(r.cnt),
        }));
      }

      // 숫자 컬럼 이상치 카운트
      const outlierCounts: Record<string, number> = {};
      const numCols = columnInfo.filter((c) => c.type === "number");
      for (const col of numCols) {
        const colAlias = col.name.replace(/[^a-zA-Z0-9_\uAC00-\uD7A3]/g, "_");
        const mean = parseFloat(stats[`${colAlias}_mean`]);
        const stddev = parseFloat(stats[`${colAlias}_stddev`]);
        if (!isNaN(mean) && !isNaN(stddev) && stddev > 0) {
          const colKey = col.name.replace(/'/g, "''");
          const outlierQuery = `${sampleCte} SELECT COUNT(*) AS cnt FROM ${tableName} WHERE data->>'${colKey}' IS NOT NULL AND TRIM(data->>'${colKey}') != '' AND data->>'${colKey}' ~ '^-?[0-9,]+\\.?[0-9]*$' AND ABS(CAST(REGEXP_REPLACE(TRIM(data->>'${colKey}'), ',', '', 'g') AS NUMERIC) - ${mean}) > 3 * ${stddev}`;
          const outlierResult = await db.execute(sql.raw(outlierQuery));
          outlierCounts[col.name] = parseInt((outlierResult as any).rows[0].cnt);
        } else {
          outlierCounts[col.name] = 0;
        }
      }

      // 컬럼별 결과 조합
      const reportColumns: QualityReportColumn[] = columnInfo.map((col) => {
        const colAlias = col.name.replace(/[^a-zA-Z0-9_\uAC00-\uD7A3]/g, "_");
        const nullCount = parseInt(stats[`${colAlias}_null`]) || 0;
        const uniqueCount = parseInt(stats[`${colAlias}_unique`]) || 0;
        const nonNullCount = totalCount - nullCount;
        const completeness = totalCount > 0 ? Math.round((nonNullCount / totalCount) * 100) : 0;

        let typeConsistency = 100;
        if (col.type !== "text" && nonNullCount > 0) {
          const typeMatch = parseInt(stats[`${colAlias}_type_match`]) || 0;
          typeConsistency = Math.round((typeMatch / nonNullCount) * 100);
        }

        const result: QualityReportColumn = {
          name: col.name,
          type: col.type,
          totalCount,
          nullCount,
          completeness,
          uniqueCount,
          typeConsistency,
        };

        if (col.type === "number") {
          const minVal = parseFloat(stats[`${colAlias}_min`]);
          const maxVal = parseFloat(stats[`${colAlias}_max`]);
          const meanVal = parseFloat(stats[`${colAlias}_mean`]);
          if (!isNaN(minVal)) result.min = Math.round(minVal * 100) / 100;
          if (!isNaN(maxVal)) result.max = Math.round(maxVal * 100) / 100;
          if (!isNaN(meanVal)) result.mean = Math.round(meanVal * 100) / 100;
          result.outlierCount = outlierCounts[col.name] || 0;
        } else if (col.type === "text") {
          const minLen = parseInt(stats[`${colAlias}_min_len`]);
          const maxLen = parseInt(stats[`${colAlias}_max_len`]);
          if (!isNaN(minLen)) result.minLength = minLen;
          if (!isNaN(maxLen)) result.maxLength = maxLen;
          result.topValues = textTopValues[col.name] || [];
        } else if (col.type === "date") {
          result.minDate = stats[`${colAlias}_min_date`] || undefined;
          result.maxDate = stats[`${colAlias}_max_date`] || undefined;
        }

        return result;
      });

      // 전체 점수: 각 컬럼의 (완전성 + 타입일관성) / 2 의 평균
      const overallScore = reportColumns.length > 0
        ? Math.round(
            reportColumns.reduce((sum, col) => sum + (col.completeness + col.typeConsistency) / 2, 0) / reportColumns.length
          )
        : 0;

      const report: QualityReport = {
        datasetId: id,
        datasetName: ds.name,
        totalRows: ds.rowCount,
        sampledRows: useSampling ? 10000 : ds.rowCount,
        overallScore,
        columns: reportColumns,
        generatedAt: new Date().toISOString(),
      };

      res.json(report);
    } catch (err) {
      console.error("Quality report error:", err);
      res.status(500).json({ message: "Failed to generate quality report" });
    }
  });

  // Upload CSV file
  app.post("/api/datasets/upload", (req, res, next) => {
    // Multer 미들웨어를 수동으로 호출하여 에러를 명시적으로 잡습니다.
    upload.any()(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: "File upload failed: " + err.message });
      }
      next();
    });
  }, async (req, res) => {
    try {
      // req.files(배열) 또는 req.file에서 파일을 찾습니다.
      const file = (req.files as Express.Multer.File[])?.[0] || req.file;

      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { name, dataType, description, encoding } = req.body;
      if (!name || !dataType) {
        return res
          .status(400)
          .json({ message: "Name and dataType are required" });
      }

      console.log(`[Upload] Starting upload. Name: ${name}, Encoding: ${encoding || 'utf-8'}`);

      // Use TextDecoder to handle various encodings like UTF-8 and EUC-KR
      const decoder = new TextDecoder(encoding || "utf-8");
      const csvContent = decoder.decode(file.buffer);
      
      // [디버깅] CSV 내용 미리보기 (한글 깨짐 확인용)
      console.log(`[Upload] Content Preview: ${csvContent.substring(0, 50)}...`);

      const parsed = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
      });

      if (parsed.errors.length > 0) {
        console.error("CSV parse errors:", parsed.errors);
      }

      const rows = parsed.data as Record<string, string>[];
      const headers = parsed.meta.fields || [];

      if (rows.length === 0) {
        return res.status(400).json({ message: "CSV file is empty" });
      }

      // Analyze column types for structured data
      // [차이점 1] 정형 데이터만 컬럼 타입(숫자, 날짜 등)을 분석하여 SQL 쿼리 생성을 준비합니다.
      const columnInfo =
        dataType === "structured" ? analyzeColumns(headers, rows) : null;

      // Decode file name properly for Korean/UTF-8 characters
      let fileName = file.originalname;
      try {
        // Multer may encode non-ASCII names incorrectly, try to decode
        fileName = decodeFilename(file.originalname);
        console.log(`[Upload] Filename decoded: ${fileName}`);
      } catch {
        // Keep original if decoding fails
      }

      // Create dataset record (without DuckDB table name first)
      const [newDataset] = await db
        .insert(datasets)
        .values({
          name,
          fileName,
          dataType,
          rowCount: rows.length,
          columnInfo: columnInfo ? JSON.stringify(columnInfo) : null,
          description: description || null,
        })
        .returning();

      // Insert data rows
      if (dataType === "structured" && columnInfo) {
        // [차이점 2] 정형 데이터 처리
        // 목적: SQL 쿼리를 통한 정확한 데이터 분석 및 통계
        // 방식: 각 행을 JSON 객체로 유지하여 저장 (data->>'column' 형태로 쿼리 가능)
        const batchSize = 100;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize).map((row, idx) => ({
            datasetId: newDataset.id,
            rowIndex: i + idx,
            data: row,
          }));
          await db.insert(structuredData).values(batch);
        }
      } else {
        // [차이점 3] 비정형 데이터 처리
        // 목적: 텍스트 기반의 의미 검색 및 RAG(검색 증강 생성)
        // 방식: 행의 모든 값을 하나의 텍스트로 병합하여 저장
        const batchSize = 100;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize).map((row, idx) => {
            // 모든 컬럼의 값을 공백으로 연결하여 하나의 텍스트 덩어리로 만듦
            const content = Object.values(row).join(" ").trim();
            return {
              datasetId: newDataset.id,
              rowIndex: i + idx,
              rawContent: content,
              metadata: row,
              searchText: content.toLowerCase(),
            };
          });
          await db.insert(unstructuredData).values(batch);
        }
      }

      res.json({
        message: "Dataset uploaded successfully",
        dataset: newDataset,
        columns: columnInfo,
        storage: "PostgreSQL",
      });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ message: "Failed to upload dataset" });
    }
  });

  // Update dataset metadata
  app.put("/api/datasets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, description } = req.body;

      const [updated] = await db
        .update(datasets)
        .set({
          name: name || undefined,
          description: description !== undefined ? description : undefined,
          updatedAt: new Date(),
        })
        .where(eq(datasets.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Dataset not found" });
      }

      res.json(updated);
    } catch (err) {
      console.error("Update dataset error:", err);
      res.status(500).json({ message: "Failed to update dataset" });
    }
  });

  // Generate sample questions based on datasets
  app.get("/api/sample-questions", async (req, res) => {
    try {
      // Base sample queries for default schema
      const defaultQueries: string[] = [];

      // Fetch uploaded datasets
      const uploadedDatasets = await db
        .select()
        .from(datasets)
        .orderBy(desc(datasets.createdAt))
        .limit(3); // [최적화] 최근 3개 데이터셋만 분석하여 초기 로딩 속도 향상

      if (uploadedDatasets.length === 0) {
        return res.json({ questions: defaultQueries, datasetQuestions: [] });
      }

      // Generate questions for each dataset based on its columns
      const datasetQuestions: { datasetId: number; datasetName: string; questions: string[] }[] =
        [];

      for (const dataset of uploadedDatasets) {
        const datasetName = dataset.name;
        const questions: string[] = [];

        if (dataset.dataType === "unstructured") {
          questions.push(`${datasetName}의 내용을 요약해줘`);

          try {
            // 실제 데이터 내용에서 키워드 추출
            const samples = await db
              .select({ content: unstructuredData.rawContent })
              .from(unstructuredData)
              .where(eq(unstructuredData.datasetId, dataset.id))
              .limit(10); // [최적화] 속도 개선을 위해 샘플링 개수 축소 (50 -> 10)

            const textContent = samples
              .map((s) => s.content)
              .filter((c) => c)
              .join(" ");

            if (textContent) {
              const keywords = embeddingService.extractKeywords(textContent);
              // 상위 키워드 3개로 질문 생성
              for (const keyword of keywords.slice(0, 3)) {
                questions.push(
                  `${datasetName}에서 "${keyword}" 관련 내용 찾아줘`,
                );
              }
            }
          } catch (err) {
            console.error("Error generating keyword questions:", err);
          }

          // 키워드가 부족할 경우 기본 질문 추가
          if (questions.length < 2) {
            questions.push(`${datasetName}의 핵심 주제가 뭐야?`);
            questions.push(`${datasetName}에 어떤 내용이 포함되어 있어?`);
          }
        } else if (dataset.columnInfo) {
          try {
            const columns: ColumnInfo[] = JSON.parse(dataset.columnInfo);

            // Filter columns with valid (non-empty) names
            const validColumns = columns.filter(
              (c) => c.name && c.name.trim() !== "",
            );
            const numberCols = validColumns.filter(
              (c) => c.type === "number" && c.name.trim(),
            );
            const textCols = validColumns.filter(
              (c) => c.type === "text" && c.name.trim(),
            );
            const dateCols = validColumns.filter(
              (c) => c.type === "date" && c.name.trim(),
            );

            // Pattern 1: Count total records (always valid)
            questions.push(`${datasetName}의 전체 데이터 수는?`);

            // Pattern 2: Simple aggregation (Sum)
            if (numberCols.length > 0) {
              const numCol = numberCols[0].name.trim();
              questions.push(`${datasetName}의 총 ${numCol} 합계는?`);
            }

            // Pattern 3: Show sample data (Simple SELECT)
            questions.push(`${datasetName} 데이터 5개만 보여줘`);

            // Pattern 4: Search specific value (only if sample values exist)
            // 로컬 LLM이 WHERE 절을 잘 못 만들 수 있으므로, 가장 단순한 형태의 검색 질문만 생성
            if (textCols.length > 0 && textCols[0].sampleValues?.length > 0) {
              const sampleValue = textCols[0].sampleValues[0];
              if (
                sampleValue &&
                sampleValue.trim() &&
                sampleValue.length <= 30
              ) {
                questions.push(
                  `${datasetName}에서 "${sampleValue}" 관련 데이터 찾아줘`,
                );
              }
            }
          } catch (parseErr) {
            console.error(
              "Failed to parse column info for dataset:",
              dataset.id,
              parseErr,
            );
          }
        }

        // Only add if we have meaningful questions
        if (questions.length >= 2) {
          datasetQuestions.push({
            datasetId: dataset.id,
            datasetName,
            questions: questions.slice(0, 4), // Limit to 4 questions per dataset
          });
        }
      }

      res.json({
        questions: defaultQueries,
        datasetQuestions,
      });
    } catch (err) {
      console.error("Sample questions error:", err);
      res.status(500).json({ message: "Failed to generate sample questions" });
    }
  });

  // Delete dataset
  app.delete("/api/datasets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log(`[Delete] Request received for dataset ID: ${id}`);

      // Get dataset to check for DuckDB table
      const [dataset] = await db
        .select()
        .from(datasets)
        .where(eq(datasets.id, id))
        .limit(1);

      if (!dataset) {
        console.log(`[Delete] Dataset ID ${id} not found`);
        return res.status(404).json({ message: "Dataset not found" });
      }

      // Delete from PostgreSQL (cascade will delete related data)
      await db.delete(datasets).where(eq(datasets.id, id));
      console.log(`[Delete] Dataset ID ${id} deleted successfully`);

      res.json({ message: "Dataset deleted successfully" });
    } catch (err) {
      console.error("Delete dataset error:", err);
      res.status(500).json({ message: "Failed to delete dataset" });
    }
  });

  // === Knowledge Base (RAG) API ===

  // List all knowledge documents
  app.get("/api/knowledge-base/documents", async (req, res) => {
    try {
      const docs = await db
        .select()
        .from(knowledgeDocuments)
        .orderBy(desc(knowledgeDocuments.createdAt));
      res.json(docs);
    } catch (err) {
      console.error("Get knowledge documents error:", err);
      res.status(500).json({ message: "Failed to get documents" });
    }
  });

  // Get knowledge base stats
  app.get("/api/knowledge-base/stats", async (req, res) => {
    try {
      const stats = await ragService.getDocumentStats();
      res.json(stats);
    } catch (err) {
      console.error("Get knowledge stats error:", err);
      res.status(500).json({ message: "Failed to get stats" });
    }
  });

  // Upload documents (multi-file support)
  app.post(
    "/api/knowledge-base/upload",
    knowledgeUpload.array("files", 50),
    async (req, res) => {
      try {
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
          return res
            .status(400)
            .json({ message: "파일이 업로드되지 않았습니다" });
        }

        // Check total size limit (500MB)
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        if (totalSize > 500 * 1024 * 1024) {
          return res
            .status(400)
            .json({ message: "총 파일 크기가 500MB를 초과합니다" });
        }

        const results: any[] = [];
        const errors: any[] = [];

        for (const file of files) {
          try {
            // Decode filename for proper Korean support
            const decodedFilename = decodeFilename(file.originalname);

            // Validate file type
            if (!documentParser.isValidFileType(decodedFilename)) {
              errors.push({
                fileName: decodedFilename,
                error:
                  "지원하지 않는 파일 형식입니다 (PDF, DOC, DOCX, PPT, PPTX만 가능)",
              });
              continue;
            }

            // Create document record
            const [newDoc] = await db
              .insert(knowledgeDocuments)
              .values({
                name: decodedFilename.replace(/\.[^/.]+$/, ""),
                fileName: decodedFilename,
                fileType: documentParser.getFileType(decodedFilename),
                fileSize: file.size,
                status: "processing",
              })
              .returning();

            // Process document asynchronously
            processDocument(newDoc.id, file.buffer, decodedFilename).catch(
              (err) => {
                console.error(`Failed to process document ${newDoc.id}:`, err);
              },
            );

            results.push({
              id: newDoc.id,
              fileName: decodedFilename,
              status: "processing",
            });
          } catch (fileErr: any) {
            errors.push({
              fileName: decodeFilename(file.originalname),
              error: fileErr.message,
            });
          }
        }

        res.json({
          success: results.length > 0,
          uploaded: results,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (err) {
        console.error("Knowledge upload error:", err);
        res.status(500).json({ message: "파일 업로드에 실패했습니다" });
      }
    },
  );

  // RAG query endpoint
  app.post("/api/rag/query", async (req, res) => {
    try {
      const { query } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ message: "질문을 입력해주세요" });
      }

      const result = await ragService.queryRag(query);
      res.json(result);
    } catch (err) {
      console.error("RAG query error:", err);
      res.status(500).json({ message: "질문 처리에 실패했습니다" });
    }
  });

  // Search documents
  app.post("/api/knowledge-base/search", async (req, res) => {
    try {
      const { query, topK = 5 } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ message: "검색어를 입력해주세요" });
      }

      const searchContext = await ragService.hybridSearch(query, topK);
      res.json(searchContext);
    } catch (err) {
      console.error("Knowledge search error:", err);
      res.status(500).json({ message: "검색에 실패했습니다" });
    }
  });

  // Delete knowledge document
  app.delete("/api/knowledge-base/documents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      const [doc] = await db
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, id))
        .limit(1);

      if (!doc) {
        return res.status(404).json({ message: "문서를 찾을 수 없습니다" });
      }

      // Delete chunks first (cascade should handle this, but explicit)
      await db.delete(documentChunks).where(eq(documentChunks.documentId, id));

      // Delete document
      await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id));

      res.json({ message: "문서가 삭제되었습니다" });
    } catch (err) {
      console.error("Delete knowledge document error:", err);
      res.status(500).json({ message: "문서 삭제에 실패했습니다" });
    }
  });

  // RAG Model Management APIs

  // Get all RAG models
  app.get("/api/rag/models", async (req, res) => {
    try {
      const models = ragService.getRagModels();
      res.json({ models });
    } catch (err) {
      console.error("Get RAG models error:", err);
      res.status(500).json({ message: "모델 목록을 가져오는데 실패했습니다" });
    }
  });

  // Update all RAG models (for batch updates)
  app.put("/api/rag/models", async (req, res) => {
    try {
      const { models } = req.body;
      if (!Array.isArray(models)) {
        return res.status(400).json({ message: "잘못된 요청입니다" });
      }
      ragService.setRagModels(models);
      res.json({ models: ragService.getRagModels() });
    } catch (err) {
      console.error("Update RAG models error:", err);
      res.status(500).json({ message: "모델 업데이트에 실패했습니다" });
    }
  });

  // Toggle RAG model enabled/disabled
  app.patch("/api/rag/models/:id/toggle", async (req, res) => {
    try {
      const modelId = decodeURIComponent(req.params.id);
      const { enabled } = req.body;

      if (typeof enabled !== "boolean") {
        return res.status(400).json({ message: "enabled 값이 필요합니다" });
      }

      const models = ragService.toggleRagModel(modelId, enabled);
      res.json({ models });
    } catch (err) {
      console.error("Toggle RAG model error:", err);
      res.status(500).json({ message: "모델 토글에 실패했습니다" });
    }
  });

  // Add new RAG model
  app.post("/api/rag/models", async (req, res) => {
    try {
      const { id, name } = req.body;

      if (!id || !name) {
        return res.status(400).json({ message: "모델 ID와 이름이 필요합니다" });
      }

      const models = ragService.addRagModel(id, name);
      res.json({ models });
    } catch (err) {
      console.error("Add RAG model error:", err);
      res.status(500).json({ message: "모델 추가에 실패했습니다" });
    }
  });

  // Remove RAG model
  app.delete("/api/rag/models/:id", async (req, res) => {
    try {
      const modelId = decodeURIComponent(req.params.id);
      const models = ragService.removeRagModel(modelId);
      res.json({ models });
    } catch (err) {
      console.error("Remove RAG model error:", err);
      res.status(500).json({ message: "모델 삭제에 실패했습니다" });
    }
  });

  // Ollama API Endpoints

  // Get Ollama configuration
  app.get("/api/ollama/config", async (req, res) => {
    try {
      const config = ollamaService.getOllamaConfig();
      const ollamaModel = ragService.getOllamaModel();
      res.json({ ...config, model: ollamaModel });
    } catch (err) {
      console.error("Get Ollama config error:", err);
      res
        .status(500)
        .json({ message: "Ollama 설정을 가져오는데 실패했습니다" });
    }
  });

  // Update Ollama configuration
  app.put("/api/ollama/config", async (req, res) => {
    try {
      const { baseUrl, enabled, model } = req.body;

      if (baseUrl !== undefined && enabled !== undefined) {
        ollamaService.setOllamaConfig(baseUrl, enabled);
      }

      if (model) {
        ragService.setOllamaModel(model);
      }

      const config = ollamaService.getOllamaConfig();
      const ollamaModel = ragService.getOllamaModel();
      res.json({ ...config, model: ollamaModel });
    } catch (err) {
      console.error("Update Ollama config error:", err);
      res.status(500).json({ message: "Ollama 설정 업데이트에 실패했습니다" });
    }
  });

  // Check Ollama connection
  app.get("/api/ollama/status", async (req, res) => {
    try {
      const status = await ollamaService.checkOllamaConnection();
      res.json(status);
    } catch (err) {
      console.error("Ollama status check error:", err);
      res.status(500).json({ connected: false, error: "연결 확인 실패" });
    }
  });

  // List Ollama models
  app.get("/api/ollama/models", async (req, res) => {
    try {
      const result = await ollamaService.listOllamaModels();
      res.json(result);
    } catch (err) {
      console.error("List Ollama models error:", err);
      res.status(500).json({ models: [], error: "모델 목록 조회 실패" });
    }
  });

  // Get recommended Ollama models for low-spec systems
  app.get("/api/ollama/recommended-models", async (req, res) => {
    res.json({ models: ollamaService.RECOMMENDED_OLLAMA_MODELS });
  });

  return httpServer;
}

// Async document processing function
async function processDocument(
  docId: number,
  buffer: Buffer,
  fileName: string,
): Promise<void> {
  try {
    // Parse document
    const parsed = await documentParser.parseDocument(buffer, fileName, "");

    // Update document with page count
    await db
      .update(knowledgeDocuments)
      .set({
        pageCount: parsed.pageCount,
        hasOcr: parsed.hasOcr,
      })
      .where(eq(knowledgeDocuments.id, docId));

    // Chunk the text
    const chunks = documentParser.chunkText(parsed.text, {
      chunkSize: 500,
      chunkOverlap: 50,
    });

    if (chunks.length === 0) {
      await db
        .update(knowledgeDocuments)
        .set({
          status: "error",
          errorMessage: "문서에서 텍스트를 추출할 수 없습니다",
        })
        .where(eq(knowledgeDocuments.id, docId));
      return;
    }

    // Generate embeddings and insert chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i];
      await db.insert(documentChunks).values({
        documentId: docId,
        chunkIndex: i,
        content: chunkContent,
        pageNumber: Math.floor((i / chunks.length) * parsed.pageCount) + 1,
        embedding: null, // No embedding
      });
    }

    // Update document status
    await db
      .update(knowledgeDocuments)
      .set({
        status: "ready",
        chunkCount: chunks.length,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, docId));

    console.log(
      `Document ${docId} processed successfully: ${chunks.length} chunks`,
    );
  } catch (error: any) {
    console.error(`Document ${docId} processing error:`, error);
    await db
      .update(knowledgeDocuments)
      .set({
        status: "error",
        errorMessage: error.message || "문서 처리 중 오류가 발생했습니다",
      })
      .where(eq(knowledgeDocuments.id, docId));
  }
}
