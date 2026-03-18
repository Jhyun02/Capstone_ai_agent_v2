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
