import type { ProvenanceInfo } from "@shared/schema";
import { Info, AlertTriangle } from "lucide-react";

interface ProvenanceFootnoteProps {
  provenance: ProvenanceInfo;
}

export function ProvenanceFootnote({ provenance }: ProvenanceFootnoteProps) {
  if (provenance.qualityScore < 0) return null;

  const scoreColor =
    provenance.qualityScore >= 80
      ? "text-green-600"
      : provenance.qualityScore >= 60
        ? "text-yellow-600"
        : "text-red-600";

  return (
    <div className="mt-2 rounded-md border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5 mb-1">
        <Info className="h-3 w-3" />
        <span className="font-medium">출처 정보</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        <span>데이터셋: {provenance.datasetName}</span>
        <span>행 수: {provenance.rowCount.toLocaleString()}</span>
        <span>
          품질 점수: <span className={scoreColor}>{provenance.qualityScore}/100</span>
        </span>
        {provenance.measuredAt && (
          <span>측정: {new Date(provenance.measuredAt).toLocaleDateString("ko-KR")}</span>
        )}
      </div>
      {provenance.warnings.length > 0 && (
        <div className="mt-1 flex items-start gap-1 text-yellow-600">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{provenance.warnings.slice(0, 3).join(" | ")}</span>
        </div>
      )}
    </div>
  );
}
