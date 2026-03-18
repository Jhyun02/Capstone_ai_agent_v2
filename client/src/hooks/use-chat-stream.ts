import { useState, useCallback, useRef } from "react";
import type { SqlValidation } from "@shared/routes";

export type StreamStep = "classifying" | "generating_sql" | "executing_sql"
  | "searching_docs" | "synthesizing" | "visualizing" | "idle" | "done" | "error";

export interface StreamState {
  currentStep: StreamStep;
  stepLabel: string;
  sql: string;
  data: any[];
  rowCount: number;
  isStreaming: boolean;
  error: string | null;
  sources?: {
    chunkId: number;
    documentId: number;
    documentName: string;
    content: string;
    pageNumber?: number;
    score: number;
  }[];
  mode?: "sql_only" | "rag_only" | "hybrid";
  answer?: string;
  validation?: SqlValidation;
}

const initialState: StreamState = {
  currentStep: "idle",
  stepLabel: "",
  sql: "",
  data: [],
  rowCount: 0,
  isStreaming: false,
  error: null,
  sources: undefined,
  mode: undefined,
  answer: undefined,
  validation: undefined,
};

interface UseChatStreamOptions {
  onFallback: (message: string, datasetId?: number) => void;
}

export function useChatStream({ onFallback }: UseChatStreamOptions) {
  const [state, setState] = useState<StreamState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  const sendStream = useCallback(async (
    message: string,
    datasetId?: number,
    endpoint: "sql" | "hybrid" = "sql",
  ) => {
    // 이전 요청 중단
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      ...initialState,
      isStreaming: true,
      currentStep: endpoint === "hybrid" ? "classifying" : "generating_sql",
      stepLabel: endpoint === "hybrid" ? "분석 모드 판별 중..." : "SQL 생성 중...",
    });

    const url = endpoint === "hybrid" ? "/api/chat/hybrid" : "/api/sql-chat-stream";

    // 90초 타임아웃: 스트리밍이 완료되지 않으면 자동 폴백
    const streamTimeout = setTimeout(() => {
      controller.abort();
      setState(initialState);
      onFallback(message, datasetId);
    }, 90_000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, datasetId }),
        credentials: "include",
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error("스트리밍 요청 실패");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("ReadableStream 지원 불가");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 파싱: 이벤트는 빈 줄(\n\n)로 구분
        const events = buffer.split("\n\n");
        buffer = events.pop() || ""; // 마지막 불완전한 이벤트는 버퍼에 유지

        for (const eventBlock of events) {
          if (!eventBlock.trim()) continue;

          let eventType = "";
          let eventData = "";

          for (const line of eventBlock.split("\n")) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              eventData = line.slice(6);
            }
          }

          if (!eventType || !eventData) continue;

          try {
            const parsed = JSON.parse(eventData);

            switch (eventType) {
              case "step":
                setState((prev) => ({
                  ...prev,
                  currentStep: parsed.step,
                  stepLabel: parsed.label,
                }));
                break;

              case "intent":
                setState((prev) => ({
                  ...prev,
                  mode: parsed.mode,
                }));
                break;

              case "sql":
                setState((prev) => ({
                  ...prev,
                  sql: parsed.sql,
                }));
                break;

              case "validation":
                setState((prev) => ({
                  ...prev,
                  validation: parsed,
                }));
                break;

              case "data":
                setState((prev) => ({
                  ...prev,
                  data: parsed.rows,
                  rowCount: parsed.rowCount,
                  currentStep: "visualizing",
                  stepLabel: "시각화 중...",
                }));
                break;

              case "rag":
                setState((prev) => ({
                  ...prev,
                  sources: parsed.sources,
                }));
                break;

              case "done":
                setState((prev) => ({
                  ...prev,
                  currentStep: "done",
                  isStreaming: false,
                  answer: parsed.answer || prev.answer,
                  mode: parsed.mode || prev.mode,
                  sources: parsed.sources || prev.sources,
                  sql: parsed.sql || prev.sql,
                  data: parsed.data || prev.data,
                  validation: parsed.validation || prev.validation,
                }));
                break;

              case "error":
                setState((prev) => ({
                  ...prev,
                  currentStep: "error",
                  isStreaming: false,
                  error: parsed.message,
                }));
                break;
            }
          } catch {
            // JSON 파싱 실패 시 무시
          }
        }
      }

      clearTimeout(streamTimeout);

      // 스트림이 끝났는데 done 이벤트가 없었을 경우
      setState((prev) => {
        if (prev.isStreaming) {
          return { ...prev, isStreaming: false, currentStep: "done" };
        }
        return prev;
      });
    } catch (e: any) {
      clearTimeout(streamTimeout);
      if (e.name === "AbortError") return;

      console.warn("스트리밍 실패, 폴백 사용:", e.message);
      setState(initialState);
      // 기존 엔드포인트로 폴백
      onFallback(message, datasetId);
    }
  }, [onFallback]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isStreaming: false, currentStep: "idle" }));
  }, []);

  return {
    ...state,
    sendStream,
    reset,
    abort,
  };
}
