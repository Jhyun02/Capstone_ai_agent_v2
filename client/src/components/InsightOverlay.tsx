import { useEffect } from "react";
import { X, Loader2, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InsightOverlayProps {
  isOpen: boolean;
  isLoading: boolean;
  elapsedSeconds?: number;
  result: string | null;
  onClose: () => void;
}

export function InsightOverlay({
  isOpen,
  isLoading,
  elapsedSeconds = 0,
  result,
  onClose,
}: InsightOverlayProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl mx-4 bg-background rounded-xl border shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">AI 인사이트</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4" style={{ maxHeight: "65vh" }}>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground">두 모델 분석 중...</p>
                <p className="text-xs text-muted-foreground">
                  약 20초 소요 예정 · {elapsedSeconds}초 경과
                </p>
              </div>
            </div>
          ) : result ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {result}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {!isLoading && result && (
          <div className="px-6 py-3 border-t shrink-0 flex justify-end">
            <Button variant="outline" size="sm" disabled>
              Word 저장 (준비 중)
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
