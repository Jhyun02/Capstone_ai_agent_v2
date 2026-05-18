import { useState, useRef, useCallback, useEffect } from "react";
import type { Message } from "@/hooks/use-chat";
import { buildInsightUserPrompt, INSIGHT_SYSTEM_PROMPT } from "@/lib/insight";

interface UseInsightParams {
  messages: Message[];
  usedAnalyzableColumnsList: string[];
  enabled: boolean;
  reliabilityWarning?: string | null;
}

export function useInsight({
  messages,
  usedAnalyzableColumnsList,
  enabled,
  reliabilityWarning,
}: UseInsightParams) {
  const [isLoading, setIsLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isLoading) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isLoading]);

  const close = useCallback(() => setIsOpen(false), []);

  const requestInsight = useCallback(async () => {
    if (!enabled || isLoading) return;

    setIsLoading(true);
    setResult(null);
    setIsOpen(true);

    try {
      const userPrompt = buildInsightUserPrompt(
        messages,
        usedAnalyzableColumnsList,
        reliabilityWarning ?? null,
      );

      const res = await fetch("/api/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: INSIGHT_SYSTEM_PROMPT,
          userPrompt,
        }),
      });

      if (!res.ok) {
        throw new Error("인사이트 생성 요청 실패");
      }

      const data = await res.json();
      setResult(data.insight);
    } catch (err: any) {
      setResult(`오류가 발생했습니다: ${err.message || "알 수 없는 오류"}`);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, isLoading, messages, usedAnalyzableColumnsList, reliabilityWarning]);

  return {
    isLoading,
    elapsedSeconds,
    result,
    isOpen,
    close,
    requestInsight,
  };
}
