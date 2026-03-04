import { CheckCircle, Loader2, Circle } from "lucide-react";
import type { StreamStep } from "@/hooks/use-chat-stream";

interface StepProgressProps {
  currentStep: StreamStep;
}

const STEPS = [
  { key: "generating_sql" as const, label: "SQL 생성" },
  { key: "executing_sql" as const, label: "쿼리 실행" },
  { key: "generating_summary" as const, label: "결과 요약" },
];

// 각 단계의 순서 인덱스
const STEP_ORDER: Record<string, number> = {
  generating_sql: 0,
  executing_sql: 1,
  generating_summary: 2,
  done: 3,
};

export function StepProgress({ currentStep }: StepProgressProps) {
  const currentIdx = STEP_ORDER[currentStep] ?? -1;

  return (
    <div className="flex items-center gap-3 py-2 px-1">
      {STEPS.map((step, idx) => {
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
            {idx < STEPS.length - 1 && (
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
