import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Upload,
  FileText,
  Trash2,
  AlertCircle,
  CheckCircle,
  Loader2,
  BookOpen,
  FileType,
} from "lucide-react";
import type { KnowledgeDocument } from "@shared/schema";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per file
const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500MB total
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx'];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(date: string | Date | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'ready':
      return <Badge variant="default" className="bg-green-500/20 text-green-600 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />준비됨</Badge>;
    case 'processing':
      return <Badge variant="secondary" className="bg-blue-500/20 text-blue-600 border-blue-500/30"><Loader2 className="w-3 h-3 mr-1 animate-spin" />처리중</Badge>;
    case 'error':
      return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />오류</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function KnowledgeBasePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const { data: documents = [], isLoading } = useQuery<KnowledgeDocument[]>({
    queryKey: ['/api/knowledge-base/documents'],
    refetchInterval: 5000,
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: FileList) => {
      const formData = new FormData();
      Array.from(files).forEach(file => {
        formData.append('files', file);
      });

      const response = await fetch('/api/knowledge-base/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '업로드 실패');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge-base/documents'] });
      setUploadProgress(100);
      setTimeout(() => setUploadProgress(0), 1000);
    },
    onError: (error: Error) => {
      console.error('Upload error:', error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/knowledge-base/documents/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge-base/documents'] });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];
    let totalSize = 0;
    const errors: string[] = [];

    Array.from(files).forEach(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();

      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        errors.push(`${file.name}: 지원하지 않는 형식`);
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: 100MB 초과`);
        return;
      }

      totalSize += file.size;
      validFiles.push(file);
    });

    if (totalSize > MAX_TOTAL_SIZE) {
      alert('총 파일 크기가 500MB를 초과합니다');
      return;
    }

    if (errors.length > 0) {
      alert('일부 파일이 제외되었습니다:\n' + errors.join('\n'));
    }

    if (validFiles.length > 0) {
      setUploading(true);
      setUploadProgress(10);

      const dt = new DataTransfer();
      validFiles.forEach(f => dt.items.add(f));

      try {
        await uploadMutation.mutateAsync(dt.files);
      } finally {
        setUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    }
  };

  const processingDocs = documents.filter(d => d.status === 'processing');

  return (
    <div className="h-full flex flex-col p-4 sm:p-6 space-y-4 overflow-hidden">
      {/* 업로드 영역 - 가로 한 줄 */}
      <div
        className="border-2 border-dashed border-border rounded-lg p-4 flex items-center gap-4 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
        onClick={() => fileInputRef.current?.click()}
        data-testid="upload-dropzone"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.ppt,.pptx"
          className="hidden"
          onChange={handleFileSelect}
          data-testid="file-input-knowledge"
        />
        <Upload className="w-6 h-6 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm">파일을 드래그하거나 클릭하여 업로드</p>
          <p className="text-xs text-muted-foreground">
            PDF, DOC, DOCX, PPT, PPTX (최대 100MB)
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
          파일 선택
        </Button>
      </div>

      {uploading && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">업로드 중...</span>
          </div>
          <Progress value={uploadProgress} className="h-2" />
        </div>
      )}

      {uploadMutation.isError && (
        <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {uploadMutation.error.message}
        </div>
      )}

      {/* 문서 목록 */}
      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5" />
            등록된 문서
            <Badge variant="secondary" className="text-xs font-normal">
              {documents.length}
            </Badge>
            {processingDocs.length > 0 && (
              <Badge variant="secondary" className="bg-blue-500/20 text-blue-600 border-blue-500/30 text-xs">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                {processingDocs.length}건 처리 중
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
              <BookOpen className="w-16 h-16 mb-4 opacity-30" />
              <p className="font-medium mb-2">등록된 문서가 없습니다</p>
              <p className="text-sm text-center max-w-sm">
                위 영역에 PDF, DOC, PPT 파일을 업로드하면
                AI가 자동으로 분석하여 채팅에서 질문할 수 있습니다.
                설정에서 "지식베이스 검색" 옵션을 활성화해 주세요.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                    data-testid={`document-${doc.id}`}
                  >
                    <FileType className="w-5 h-5 text-muted-foreground shrink-0" />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{doc.name}</p>
                        {getStatusBadge(doc.status)}
                        {doc.hasOcr && (
                          <Badge variant="outline" className="text-xs">OCR</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>{doc.fileType.toUpperCase()}</span>
                        <span>{formatFileSize(doc.fileSize)}</span>
                        {doc.pageCount && doc.pageCount > 0 && (
                          <span>{doc.pageCount}페이지</span>
                        )}
                        {doc.chunkCount && doc.chunkCount > 0 && (
                          <span>{doc.chunkCount}청크</span>
                        )}
                        <span>{formatDate(doc.createdAt)}</span>
                      </div>
                      {doc.status === 'error' && doc.errorMessage && (
                        <p className="text-xs text-destructive mt-1">{doc.errorMessage}</p>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(doc.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`delete-document-${doc.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
