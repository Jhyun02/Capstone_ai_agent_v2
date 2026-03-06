import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import type { QualityReport, QualityReportColumn } from "@shared/schema";

interface QualityReportDialogProps {
  dataset: { id: number; name: string } | null;
  onClose: () => void;
}

function getScoreColor(score: number) {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

function getScoreBgColor(score: number) {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  return "bg-red-500";
}

function getTypeBadgeVariant(type: string): "default" | "secondary" | "outline" | "destructive" {
  switch (type) {
    case "number": return "default";
    case "date": return "secondary";
    case "boolean": return "outline";
    default: return "secondary";
  }
}

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function ColumnCard({ column }: { column: QualityReportColumn }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {column.name}
          <Badge variant={getTypeBadgeVariant(column.type)} className="text-[10px]">
            {column.type}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatItem label="완전성" value={`${column.completeness}%`} />
          <StatItem label="결측값" value={column.nullCount.toLocaleString()} />
          <StatItem label="고유값" value={column.uniqueCount.toLocaleString()} />
          <StatItem label="타입 일관성" value={`${column.typeConsistency}%`} />
        </div>

        {column.type === "number" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t">
            {column.min !== undefined && <StatItem label="최솟값" value={column.min.toLocaleString()} />}
            {column.max !== undefined && <StatItem label="최댓값" value={column.max.toLocaleString()} />}
            {column.mean !== undefined && <StatItem label="평균" value={column.mean.toLocaleString()} />}
            {column.outlierCount !== undefined && (
              <StatItem label="이상치" value={`${column.outlierCount}개`} />
            )}
          </div>
        )}

        {column.type === "text" && (
          <div className="pt-2 border-t space-y-2">
            <div className="grid grid-cols-2 gap-3">
              {column.minLength !== undefined && <StatItem label="최소 길이" value={column.minLength} />}
              {column.maxLength !== undefined && <StatItem label="최대 길이" value={column.maxLength} />}
            </div>
            {column.topValues && column.topValues.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground">빈도 상위 값</span>
                <div className="mt-1 space-y-1">
                  {column.topValues.map((tv, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1">
                      <span className="truncate max-w-[200px]">{tv.value}</span>
                      <span className="text-muted-foreground ml-2 shrink-0">{tv.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {column.type === "date" && (column.minDate || column.maxDate) && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t">
            {column.minDate && <StatItem label="시작일" value={column.minDate} />}
            {column.maxDate && <StatItem label="종료일" value={column.maxDate} />}
          </div>
        )}

        <div className="pt-1">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">완전성</span>
            <span className={getScoreColor(column.completeness)}>{column.completeness}%</span>
          </div>
          <Progress value={column.completeness} className="h-1.5" />
        </div>
      </CardContent>
    </Card>
  );
}

export function QualityReportDialog({ dataset, onClose }: QualityReportDialogProps) {
  const { data: report, isLoading } = useQuery<QualityReport>({
    queryKey: ['/api/datasets', dataset?.id, 'quality-report'],
    queryFn: () => fetch(`/api/datasets/${dataset!.id}/quality-report`).then(r => r.json()),
    enabled: !!dataset,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Dialog open={!!dataset} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>품질 리포트 - {dataset?.name}</DialogTitle>
          <DialogDescription>
            {report
              ? report.totalRows === report.sampledRows
                ? `전체 ${report.totalRows.toLocaleString()}행 분석`
                : `전체 ${report.totalRows.toLocaleString()}행 중 ${report.sampledRows.toLocaleString()}행 샘플링 분석`
              : "분석 중..."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : report ? (
            <>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div className={`text-4xl font-bold ${getScoreColor(report.overallScore)}`}>
                        {report.overallScore}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">전체 점수</div>
                    </div>
                    <div className="flex-1">
                      <Progress
                        value={report.overallScore}
                        className="h-3"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground mt-1">
                        <span>0</span>
                        <span>100</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {report.columns.map((col) => (
                <ColumnCard key={col.name} column={col} />
              ))}
            </>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
