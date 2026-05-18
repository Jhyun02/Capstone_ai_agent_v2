import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Trash2, Info, Database, Server, CircleCheck, CircleX } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface Settings {
  modelName: string;
  temperature: number;
  useRag: boolean;
  chatMode: "sql" | "rag" | "auto";
}

interface SettingsPageProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  conversationCount: number;
  messageCount: number;
  onClearAllConversations: () => void;
}

export function SettingsPage({ settings, onSettingsChange, conversationCount, messageCount, onClearAllConversations }: SettingsPageProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  // Ollama 연결 상태
  const { data: ollamaStatus } = useQuery<{ connected: boolean; error?: string }>({
    queryKey: ['/api/ollama/status'],
    refetchInterval: 10000,
  });

  // Ollama 설정 (현재 모델 표시용)
  const { data: ollamaConfig } = useQuery<{ baseUrl: string; enabled: boolean; model: string }>({
    queryKey: ['/api/ollama/config'],
  });

  const handleClearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    onClearAllConversations();
    setConfirmClear(false);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* 채팅 관리 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            채팅 관리
          </CardTitle>
          <CardDescription>대화 기록을 관리합니다</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">저장된 대화</p>
              <p className="text-xs text-muted-foreground">
                {conversationCount}개 대화, 총 {messageCount}개 메시지
              </p>
            </div>
            <Button
              variant={confirmClear ? "destructive" : "outline"}
              size="sm"
              onClick={handleClearAll}
              disabled={conversationCount === 0}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              {confirmClear ? "정말 삭제?" : "전체 삭제"}
            </Button>
          </div>

          <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
            <p>대화는 브라우저 로컬 저장소에 보관됩니다.</p>
            <p>최대 20개 대화, 대화당 80개 메시지까지 저장됩니다.</p>
          </div>
        </CardContent>
      </Card>

      {/* 시스템 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="w-5 h-5" />
            시스템 정보
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Database className="w-4 h-4 text-muted-foreground" />
                PostgreSQL
              </div>
              <Badge variant="secondary" className="bg-green-500/20 text-green-600 border-green-500/30 text-xs">
                <CircleCheck className="w-3 h-3 mr-1" />
                연결됨
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Server className="w-4 h-4 text-muted-foreground" />
                Ollama
                {ollamaConfig?.model && (
                  <span className="text-xs text-muted-foreground">({ollamaConfig.model})</span>
                )}
              </div>
              {ollamaStatus?.connected ? (
                <Badge variant="secondary" className="bg-green-500/20 text-green-600 border-green-500/30 text-xs">
                  <CircleCheck className="w-3 h-3 mr-1" />
                  연결됨
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-red-500/20 text-red-500 border-red-500/30 text-xs">
                  <CircleX className="w-3 h-3 mr-1" />
                  연결 안됨
                </Badge>
              )}
            </div>

            <div className="pt-2 border-t text-xs text-muted-foreground">
              SQL ChatBot v1.0.0
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
