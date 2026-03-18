import { CheckCircle, Loader2, Circle } from "lucide-react";
import type { StreamStep } from "@/hooks/use-chat-stream";

interface StepProgressProps {
  currentStep: StreamStep;
  mode?: "sql_only" | "rag_only" | "hybrid";
}

const SQL_STEPS = [
  { key: "generating_sql" as const, label: "SQL 생성" },
  { key: "executing_sql" as const, label: "쿼리 실행" },
  { key: "visualizing" as const, label: "시각화" },
];

const HYBRID_STEPS = [
  { key: "classifying" as const, label: "모드 판별" },
  { key: "generating_sql" as const, label: "SQL + 문서 검색" },
  { key: "synthesizing" as const, label: "통합 분석" },
  { key: "visualizing" as const, label: "시각화" },
];

const RAG_STEPS = [
  { key: "searching_docs" as const, label: "문서 검색" },
  { key: "synthesizing" as const, label: "답변 생성" },
];

function getSteps(mode?: string) {
  if (mode === "hybrid") return HYBRID_STEPS;
  if (mode === "rag_only") return RAG_STEPS;
  return SQL_STEPS;
}

function getStepOrder(mode?: string): Record<string, number> {
  const steps = getSteps(mode);
  const order: Record<string, number> = {};
  steps.forEach((s, i) => { order[s.key] = i; });
  order["done"] = steps.length;
  return order;
}

export function StepProgress({ currentStep, mode }: StepProgressProps) {
  const steps = getSteps(mode);
  const stepOrder = getStepOrder(mode);
  const currentIdx = stepOrder[currentStep] ?? -1;

  return (
    <div className="flex items-center gap-3 py-2 px-1">
      {steps.map((step, idx) => {
        const isCompleted = currentIdx > idx;
        const isActive = currentIdx === idx;

        return (
          <div key={step.key} className="flex items-center gap-1.5">
            {isCompleted ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : isActive ? (
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
            ) : (
              <Circle className="w-4 h-4 text-muted-foreground/40" />
            )}
            <span
              className={`text-xs ${
                isCompleted
                  ? "text-green-600 dark:text-green-400"
                  : isActive
                    ? "text-primary font-medium"
                    : "text-muted-foreground/40"
              }`}
            >
              {step.label}
            </span>
            {idx < steps.length - 1 && (
              <div
                className={`w-6 h-px mx-1 ${
                  currentIdx > idx ? "bg-green-500" : "bg-muted-foreground/20"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
