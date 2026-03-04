import { z } from 'zod';

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
        }),
        500: z.object({
          message: z.string(),
        }),
      },
    },
  },
};
