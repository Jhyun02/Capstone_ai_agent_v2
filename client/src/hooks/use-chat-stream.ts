import { useState, useCallback, useRef } from "react";

export type StreamStep = "generating_sql" | "executing_sql" | "visualizing" | "idle" | "done" | "error";

export interface StreamState {
  currentStep: StreamStep;
  stepLabel: string;
  sql: string;
  data: any[];
  rowCount: number;
  isStreaming: boolean;
  error: string | null;
}

const initialState: StreamState = {
  currentStep: "idle",
  stepLabel: "",
  sql: "",
  data: [],
  rowCount: 0,
  isStreaming: false,
  error: null,
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

  const sendStream = useCallback(async (message: string, datasetId?: number) => {
    // 이전 요청 중단
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      ...initialState,
      isStreaming: true,
      currentStep: "generating_sql",
      stepLabel: "SQL 생성 중...",
    });

    // 90초 타임아웃: 스트리밍이 완료되지 않으면 자동 폴백
    const streamTimeout = setTimeout(() => {
      controller.abort();
      setState(initialState);
      onFallback(message, datasetId);
    }, 90_000);

    try {
      const res = await fetch("/api/sql-chat-stream", {
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

              case "sql":
                setState((prev) => ({
                  ...prev,
                  sql: parsed.sql,
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

              case "done":
                setState((prev) => ({
                  ...prev,
                  currentStep: "done",
                  isStreaming: false,
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
