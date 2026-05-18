import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Table, Loader2, Info, FileSpreadsheet, Trash2, Eye, ChevronLeft, ChevronRight, FileText, BarChart3, AlertTriangle, Save, Tags } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QualityReportDialog } from "./QualityReportDialog";

type SemanticRoleValue = "auto" | "metric" | "dimension" | "date" | "id" | "boolean";

const SEMANTIC_ROLE_LABELS: Record<SemanticRoleValue, string> = {
  auto: "자동 추론",
  metric: "수치 지표",
  dimension: "분류 기준",
  date: "날짜/시간",
  id: "식별자",
  boolean: "참/거짓",
};

interface ColumnInfo {
  name: string;
  type: string;
  description?: string;
  nullable?: boolean;
  sampleValues?: string[];
  semanticRole?: string;
}

interface TableInfo {
  name: string;
  description?: string;
  columns: ColumnInfo[] | string[];
  rowCount: number;
}

interface Dataset {
  id: number;
  name: string;
  fileName: string;
  dataType: 'structured' | 'unstructured';
  rowCount: number;
  columnInfo: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DatasetDataResponse {
  dataset: Dataset;
  data: any[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface QualityMetrics {
  overallScore: number;
  completeness: number;
  consistency: number;
  validity: number;
  timeliness: number | null;
  warnings: string[];
  measuredAt: string | null;
}

function getScoreColor(score: number) {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

function getScoreBgVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 80) return "default";
  if (score >= 60) return "secondary";
  return "destructive";
}

function QualityOverview({ datasetId }: { datasetId: number }) {
  const { data: metrics } = useQuery<QualityMetrics | null>({
    queryKey: ["/api/datasets", datasetId, "quality-metrics"],
    queryFn: async () => {
      const res = await fetch(`/api/datasets/${datasetId}/quality-metrics`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  if (!metrics) return null;

  const dimensions = [
    { label: "완전성", value: metrics.completeness },
    { label: "일관성", value: metrics.consistency },
    { label: "유효성", value: metrics.validity },
    ...(metrics.timeliness !== null ? [{ label: "적시성", value: metrics.timeliness }] : []),
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {dimensions.map((d) => (
          <div key={d.label} className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">{d.label}</span>
              <span className={getScoreColor(d.value)}>{d.value}</span>
            </div>
            <Progress value={d.value} className="h-1" />
          </div>
        ))}
      </div>
      {metrics.warnings.length > 0 && (
        <div className="flex items-start gap-1 text-[11px] text-yellow-600">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{metrics.warnings.slice(0, 2).join(" | ")}</span>
        </div>
      )}
    </div>
  );
}

function QualityScoreBadge({ datasetId }: { datasetId: number }) {
  const { data: metrics } = useQuery<QualityMetrics | null>({
    queryKey: ["/api/datasets", datasetId, "quality-metrics"],
    queryFn: async () => {
      const res = await fetch(`/api/datasets/${datasetId}/quality-metrics`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  if (!metrics) return null;

  return (
    <Badge variant={getScoreBgVariant(metrics.overallScore)} className="text-[10px] px-1.5">
      {metrics.overallScore}점
    </Badge>
  );
}

interface DatabasePageProps {
  refreshKey?: number;
}

export function DatabasePage({ refreshKey }: DatabasePageProps) {
  const [viewingDataset, setViewingDataset] = useState<Dataset | null>(null);
  const [deleteDataset, setDeleteDataset] = useState<Dataset | null>(null);
  const [qualityReportDataset, setQualityReportDataset] = useState<Dataset | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [semanticDraft, setSemanticDraft] = useState<Record<string, SemanticRoleValue>>({});
  const [isSavingRoles, setIsSavingRoles] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!viewingDataset) {
      setSemanticDraft({});
      setShowColumnSettings(false);
      return;
    }
    const columns: ColumnInfo[] =
      typeof viewingDataset.columnInfo === "string"
        ? JSON.parse(viewingDataset.columnInfo || "[]")
        : viewingDataset.columnInfo || [];
    setSemanticDraft(
      Object.fromEntries(
        columns.map((col) => [col.name, (col.semanticRole as SemanticRoleValue) || "auto"])
      )
    );
  }, [viewingDataset?.id]);

  const saveColumnRoles = async () => {
    if (!viewingDataset) return;
    setIsSavingRoles(true);
    try {
      const columns: ColumnInfo[] =
        typeof viewingDataset.columnInfo === "string"
          ? JSON.parse(viewingDataset.columnInfo || "[]")
          : viewingDataset.columnInfo || [];

      const res = await fetch(`/api/datasets/${viewingDataset.id}/columns`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columns: columns.map((col) => ({
            name: col.name,
            semanticRole: semanticDraft[col.name] === "auto" ? undefined : semanticDraft[col.name],
          })),
        }),
      });

      if (!res.ok) throw new Error("저장 실패");

      const updated = await res.json();
      setViewingDataset(updated);
      refetchDatasets();
      toast({ title: "저장 완료", description: "컬럼 타입이 저장되었습니다." });
    } catch {
      toast({ variant: "destructive", title: "저장 실패", description: "컬럼 타입 저장 중 오류가 발생했습니다." });
    } finally {
      setIsSavingRoles(false);
    }
  };

  const { data: tables, isLoading: tablesLoading } = useQuery<TableInfo[]>({
    queryKey: ['/api/tables']
  });

  const { data: datasets, isLoading: datasetsLoading, refetch: refetchDatasets } = useQuery<Dataset[]>({
    queryKey: ['/api/datasets', refreshKey],
    queryFn: async () => {
      const res = await fetch('/api/datasets');
      if (!res.ok) throw new Error('Failed to fetch datasets');
      return res.json();
    }
  });

  const { data: datasetData, isLoading: dataLoading } = useQuery<DatasetDataResponse>({
    queryKey: ['/api/datasets', viewingDataset?.id, 'data', currentPage],
    queryFn: async () => {
      const res = await fetch(`/api/datasets/${viewingDataset!.id}/data?page=${currentPage}&limit=20`);
      if (!res.ok) throw new Error('Failed to fetch data');
      return res.json();
    },
    enabled: !!viewingDataset
  });

  const handleDeleteDataset = async () => {
    if (!deleteDataset) return;

    try {
      const res = await fetch(`/api/datasets/${deleteDataset.id}`, {
        method: 'DELETE'
      });

      if (!res.ok) throw new Error('Delete failed');

      toast({
        title: "삭제 완료",
        description: `"${deleteDataset.name}" 데이터셋이 삭제되었습니다.`
      });

      refetchDatasets();
      queryClient.invalidateQueries({ queryKey: ['/api/tables'] });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "삭제 실패",
        description: "데이터셋 삭제 중 오류가 발생했습니다."
      });
    } finally {
      setDeleteDataset(null);
    }
  };

  if (tablesLoading || datasetsLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const isEnhancedColumn = (col: ColumnInfo | string): col is ColumnInfo => {
    return typeof col === 'object' && 'name' in col;
  };

  const parseColumnInfo = (columnInfo: string | null): ColumnInfo[] | null => {
    if (!columnInfo) return null;
    try {
      return JSON.parse(columnInfo);
    } catch {
      return null;
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 overflow-y-auto">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Database className="w-5 h-5" />
          데이터베이스
        </h2>
        <p className="text-sm text-muted-foreground mt-1">현재 연결된 데이터베이스의 테이블 목록입니다</p>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <Table className="w-4 h-4" />
          기본 테이블
        </h3>
        <div className="grid gap-4">
          {tables && tables.length > 0 ? (
            tables.map((table) => (
              <Card key={table.name}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Table className="w-4 h-4" />
                    {table.name}
                  </CardTitle>
                  <CardDescription>
                    {table.description && <span className="mr-2">{table.description}</span>}
                    <span className="text-primary font-medium">{table.rowCount.toLocaleString()}개 행</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium mb-2">컬럼 정보</p>
                    <div className="grid gap-2">
                      {table.columns.map((col) => (
                        isEnhancedColumn(col) ? (
                          <div
                            key={col.name}
                            className="flex items-center justify-between p-2 bg-muted/50 rounded-md"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{col.name}</span>
                              <span className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded">
                                {col.type}
                              </span>
                            </div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground cursor-help">
                                  <Info className="w-3 h-3" />
                                  <span className="hidden sm:inline">{col.description}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                <p>{col.description}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        ) : (
                          <span
                            key={col}
                            className="px-2 py-1 text-xs bg-muted rounded-md text-muted-foreground inline-block"
                          >
                            {col}
                          </span>
                        )
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                데이터베이스에 테이블이 없습니다
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" />
          업로드된 데이터셋
        </h3>
        <div className="grid gap-4">
          {datasets && datasets.length > 0 ? (
            datasets.map((dataset) => {
              const columns = parseColumnInfo(dataset.columnInfo);
              return (
                <Card key={dataset.id} data-testid={`dataset-card-${dataset.id}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-base">
                        {dataset.dataType === 'structured' ? (
                          <Database className="w-4 h-4" />
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                        {dataset.name}
                        <Badge variant={dataset.dataType === 'structured' ? 'default' : 'secondary'} className="text-xs">
                          {dataset.dataType === 'structured' ? '정형' : '비정형'}
                        </Badge>
                        {dataset.dataType === 'structured' && (
                          <QualityScoreBadge datasetId={dataset.id} />
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setViewingDataset(dataset);
                            setCurrentPage(1);
                          }}
                          data-testid={`button-view-dataset-${dataset.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {dataset.dataType === 'structured' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setQualityReportDataset(dataset)}
                            data-testid={`button-quality-report-${dataset.id}`}
                          >
                            <BarChart3 className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteDataset(dataset)}
                          className="text-destructive hover:text-destructive"
                          data-testid={`button-delete-dataset-${dataset.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 flex-wrap">
                      <span>{dataset.fileName}</span>
                      <span className="text-primary font-medium">{dataset.rowCount.toLocaleString()}개 행</span>
                      {dataset.description && (
                        <span className="text-muted-foreground">• {dataset.description}</span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {columns && columns.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground font-medium mb-2">컬럼 정보</p>
                        <div className="flex flex-wrap gap-2">
                          {columns.slice(0, 6).map((col: any) => (
                            <Tooltip key={col.name}>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 rounded-md cursor-help">
                                  <span className="text-xs font-medium text-foreground">{col.name}</span>
                                  <span className="text-[10px] px-1 py-0.5 bg-primary/10 text-primary rounded">
                                    {col.type}
                                  </span>
                                  {col.semanticRole && (
                                    <span className="text-[10px] px-1 py-0.5 bg-violet-500/10 text-violet-600 rounded">
                                      {SEMANTIC_ROLE_LABELS[col.semanticRole as SemanticRoleValue] || col.semanticRole}
                                    </span>
                                  )}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>샘플: {col.sampleValues?.join(', ') || 'N/A'}</p>
                              </TooltipContent>
                            </Tooltip>
                          ))}
                          {columns.length > 6 && (
                            <span className="text-xs text-muted-foreground px-2 py-1">
                              +{columns.length - 6}개 더
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {dataset.dataType === 'structured' && (
                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground font-medium mb-2">데이터 품질 (DCAT 3.0 DQV)</p>
                        <QualityOverview datasetId={dataset.id} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>업로드된 데이터셋이 없습니다</p>
                <p className="text-xs mt-1">사이드바의 "파일 첨부" 버튼을 클릭하여 CSV 파일을 업로드하세요</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card className="bg-muted/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4" />
            테이블 관계
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-1">
            <p><code className="text-primary">sales.product_id</code> → <code className="text-primary">products.id</code></p>
            <p className="text-xs">하나의 제품에 여러 판매 기록이 연결됩니다 (1:N 관계)</p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!viewingDataset} onOpenChange={(open) => !open && setViewingDataset(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewingDataset?.dataType === 'structured' ? (
                <Database className="w-5 h-5" />
              ) : (
                <FileText className="w-5 h-5" />
              )}
              {viewingDataset?.name}
            </DialogTitle>
            <DialogDescription>
              {viewingDataset?.fileName} • {viewingDataset?.rowCount.toLocaleString()}개 행
            </DialogDescription>
          </DialogHeader>

          {viewingDataset?.dataType === 'structured' && viewingDataset.columnInfo && (
            <div className="border rounded-lg">
              <button
                onClick={() => setShowColumnSettings((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Tags className="w-4 h-4" />
                  컬럼 타입 설정
                </div>
                <span className="text-xs">{showColumnSettings ? "접기" : "펼치기"}</span>
              </button>
              {showColumnSettings && (() => {
                const cols: ColumnInfo[] =
                  typeof viewingDataset.columnInfo === "string"
                    ? JSON.parse(viewingDataset.columnInfo || "[]")
                    : viewingDataset.columnInfo || [];
                return (
                  <div className="border-t px-4 py-3 space-y-3">
                    <div className="grid gap-2 max-h-[200px] overflow-y-auto">
                      {cols.map((col) => (
                        <div key={col.name} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium truncate">{col.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded shrink-0">
                              {col.type}
                            </span>
                          </div>
                          <select
                            value={semanticDraft[col.name] || "auto"}
                            onChange={(e) =>
                              setSemanticDraft((prev) => ({
                                ...prev,
                                [col.name]: e.target.value as SemanticRoleValue,
                              }))
                            }
                            className="h-7 text-xs rounded-md border border-input bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary shrink-0"
                          >
                            {(Object.entries(SEMANTIC_ROLE_LABELS) as [SemanticRoleValue, string][]).map(
                              ([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              )
                            )}
                          </select>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={saveColumnRoles}
                        disabled={isSavingRoles}
                      >
                        {isSavingRoles ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : (
                          <Save className="w-3 h-3 mr-1" />
                        )}
                        컬럼 타입 저장
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {dataLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : datasetData && datasetData.data.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      {Object.keys(datasetData.data[0]).map((key) => (
                        <th key={key} className="text-left p-2 font-medium text-muted-foreground border-b">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datasetData.data.map((row, idx) => (
                      <tr key={idx} className="border-b hover:bg-muted/30">
                        {Object.values(row).map((value: any, colIdx) => (
                          <td key={colIdx} className="p-2 max-w-[200px] truncate">
                            {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                데이터가 없습니다
              </div>
            )}
          </div>

          {datasetData && datasetData.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t">
              <span className="text-sm text-muted-foreground">
                페이지 {currentPage} / {datasetData.pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4" />
                  이전
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(datasetData.pagination.totalPages, p + 1))}
                  disabled={currentPage >= datasetData.pagination.totalPages}
                  data-testid="button-next-page"
                >
                  다음
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <QualityReportDialog
        dataset={qualityReportDataset}
        onClose={() => setQualityReportDataset(null)}
      />

      <AlertDialog open={!!deleteDataset} onOpenChange={(open) => !open && setDeleteDataset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>데이터셋 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteDataset?.name}" 데이터셋을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDataset}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
