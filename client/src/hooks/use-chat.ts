import { useMutation } from "@tanstack/react-query";
import { api } from "@shared/routes";

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  data?: any[];
  sources?: {
    chunkId: number;
    documentId: number;
    documentName: string;
    content: string;
    pageNumber?: number;
    score: number;
  }[];
  error?: string;
  timestamp: Date;
};

interface ChatOptions {
  message: string;
  useRag?: boolean;
  datasetId?: number;
}

export function useChat() {
  return useMutation({
    mutationFn: async (options: ChatOptions) => {
      const { message, useRag, datasetId } = options;

      // Use RAG endpoint if enabled
      if (useRag) {
        const res = await fetch('/api/rag/query', {
          method: 'POST',
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: message }),
          credentials: "include",
        });
        
        if (!res.ok) {
          throw new Error("RAG 쿼리 실패");
        }
        
        const data = await res.json();
        return {
          answer: data.answer,
          sql: '',
          data: [],
          sources: data.sources,
        };
      }
      
      // Default SQL chat
      const input = api.chat.sql.input.parse({ message, datasetId });

      const res = await fetch(api.chat.sql.path, {
        method: api.chat.sql.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 500) {
           const errorData = api.chat.sql.responses[500].parse(await res.json());
           throw new Error(errorData.message);
        }
        throw new Error("Failed to send message");
      }

      return api.chat.sql.responses[200].parse(await res.json());
    },
  });
}
