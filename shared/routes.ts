import { z } from 'zod';

// SQL 검증 스키마
export const sqlValidationItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  passed: z.boolean(),
  message: z.string(),
});

export const sqlValidationSchema = z.object({
  items: z.array(sqlValidationItemSchema),
  overall: z.boolean(),
});

export type SqlValidationItem = z.infer<typeof sqlValidationItemSchema>;
export type SqlValidation = z.infer<typeof sqlValidationSchema>;

export const pipelineLogSchema = z.object({
  mode: z.enum(["legacy", "enhanced"]),
  primaryLlm: z.enum(["ollama", "openrouter"]),
  primarySql: z.string(),
  primaryLatencyMs: z.number(),
  schemaValidation: z.object({
    passed: z.boolean(),
    failedItems: z.array(z.string()),
  }),
  errorClassification: z.string().optional(),
  fallbackUsed: z.boolean(),
  fallbackLlm: z.enum(["ollama", "openrouter"]).optional(),
  fallbackSql: z.string().optional(),
  fallbackLatencyMs: z.number().optional(),
  selfCorrectionAttempts: z.number(),
  selfCorrectionHistory: z.array(z.object({
    attempt: z.number(),
    errorType: z.string(),
    errorMessage: z.string(),
    correctedSql: z.string(),
    latencyMs: z.number(),
  })),
  finalSql: z.string(),
  success: z.boolean(),
  totalLatencyMs: z.number(),
});

export type PipelineLog = z.infer<typeof pipelineLogSchema>;

export const api = {
  chat: {
    sql: {
      method: 'POST' as const,
      path: '/api/sql-chat',
      input: z.object({
        message: z.string(),
        datasetId: z.number().optional(),
      }),
      responses: {
        200: z.object({
          answer: z.string(),
          sql: z.string(),
          data: z.array(z.any()),
          error: z.string().optional(),
          validation: sqlValidationSchema.optional(),
        }),
        500: z.object({
          message: z.string(),
        }),
      },
    },
    hybrid: {
      method: 'POST' as const,
      path: '/api/chat/hybrid',
      input: z.object({
        message: z.string(),
        datasetId: z.number().optional(),
      }),
    },
  },
};

// SQL LLM 검증 스키마
export const sqlValidateInputSchema = z.object({
  userQuestion: z.string(),
  sql: z.string(),
  executionError: z.string().nullable().optional(),
  resultRowCount: z.number().int().nonnegative().nullable().optional(),
});

export const sqlValidateOutputSchema = z.object({
  verdict: z.enum(["pass", "warn", "fail"]),
  summary: z.string(),
  checks: z.array(z.string()),
});

export type SqlValidateInput = z.infer<typeof sqlValidateInputSchema>;
export type SqlValidateOutput = z.infer<typeof sqlValidateOutputSchema>;

// 인사이트 생성 스키마
export const insightInputSchema = z.object({
  systemPrompt: z.string(),
  userPrompt: z.string(),
});

export type InsightInput = z.infer<typeof insightInputSchema>;
