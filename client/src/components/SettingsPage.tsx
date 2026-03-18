import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Bot, Zap, Database, Plus, Trash2, Power, Server, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface Settings {
  modelName: string;
  temperature: number;
  useRag: boolean;
  chatMode: "sql" | "rag" | "auto";
}

interface RagModel {
  id: string;
  name: string;
  enabled: boolean;
}

interface OllamaConfig {
  baseUrl: string;
  enabled: boolean;
  model: string;
}

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

interface RecommendedModel {
  id: string;
  name: string;
  size: string;
  recommended: boolean;
}

interface SettingsPageProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

const RAG_MODELS_STORAGE_KEY = 'sql-copilot-rag-models';
const OLLAMA_CONFIG_STORAGE_KEY = 'sql-copilot-ollama-config';

export function SettingsPage({ settings, onSettingsChange }: SettingsPageProps) {
  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [localModels, setLocalModels] = useState<RagModel[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Ollama state
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://localhost:11434");
  const [ollamaEnabled, setOllamaEnabled] = useState(false);
  const [ollamaModel, setOllamaModel] = useState("llama3.2:3b");

  // Fetch RAG models from server
  const { data: modelsData, isLoading: modelsLoading } = useQuery<{ models: RagModel[] }>({
    queryKey: ['/api/rag/models'],
  });

  // Fetch Ollama config
  const { data: ollamaConfigData } = useQuery<OllamaConfig>({
    queryKey: ['/api/ollama/config'],
  });

  // Check Ollama connection
  const { data: ollamaStatus, refetch: refetchOllamaStatus } = useQuery<{ connected: boolean; error?: string }>({
    queryKey: ['/api/ollama/status'],
    refetchInterval: ollamaEnabled ? 10000 : false,
  });

  // Fetch installed Ollama models
  const { data: ollamaModelsData, refetch: refetchOllamaModels } = useQuery<{ models: OllamaModel[]; error?: string }>({
    queryKey: ['/api/ollama/models'],
    enabled: ollamaEnabled && ollamaStatus?.connected,
  });

  // Fetch recommended models
  const { data: recommendedModelsData } = useQuery<{ models: RecommendedModel[] }>({
    queryKey: ['/api/ollama/recommended-models'],
  });

  // Sync models mutation
  const syncModelsMutation = useMutation({
    mutationFn: async (models: RagModel[]) => {
      return apiRequest('PUT', '/api/rag/models', { models });
    },
  });

  // Ollama config mutation
  const updateOllamaConfigMutation = useMutation({
    mutationFn: async (config: { baseUrl: string; enabled: boolean; model: string }) => {
      return apiRequest('PUT', '/api/ollama/config', config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ollama/config'] });
      refetchOllamaStatus();
      if (ollamaEnabled) {
        refetchOllamaModels();
      }
    },
  });

  // Load Ollama config from localStorage
  useEffect(() => {
    const savedConfig = localStorage.getItem(OLLAMA_CONFIG_STORAGE_KEY);
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setOllamaBaseUrl(parsed.baseUrl || "http://localhost:11434");
        setOllamaEnabled(parsed.enabled || false);
        setOllamaModel(parsed.model || "llama3.2:3b");
        // Sync to server
        updateOllamaConfigMutation.mutate({
          baseUrl: parsed.baseUrl || "http://localhost:11434",
          enabled: parsed.enabled || false,
          model: parsed.model || "llama3.2:3b",
        });
      } catch (e) {
        console.error('Failed to parse saved Ollama config:', e);
      }
    } else if (ollamaConfigData) {
      setOllamaBaseUrl(ollamaConfigData.baseUrl);
      setOllamaEnabled(ollamaConfigData.enabled);
      setOllamaModel(ollamaConfigData.model);
    }
  }, [ollamaConfigData]);

  // Save Ollama config to localStorage
  const saveOllamaConfig = (baseUrl: string, enabled: boolean, model: string) => {
    const config = { baseUrl, enabled, model };
    localStorage.setItem(OLLAMA_CONFIG_STORAGE_KEY, JSON.stringify(config));
    updateOllamaConfigMutation.mutate(config);
  };

  // Load RAG models from localStorage
  useEffect(() => {
    const savedModels = localStorage.getItem(RAG_MODELS_STORAGE_KEY);
    if (savedModels) {
      try {
        const parsed = JSON.parse(savedModels);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLocalModels(parsed);
          syncModelsMutation.mutate(parsed);
          setIsInitialized(true);
          return;
        }
      } catch (e) {
        console.error('Failed to parse saved models:', e);
      }
    }
    if (modelsData?.models) {
      setLocalModels(modelsData.models);
      setIsInitialized(true);
    }
  }, [modelsData?.models]);

  // Save models to localStorage
  useEffect(() => {
    if (isInitialized && localModels.length > 0) {
      localStorage.setItem(RAG_MODELS_STORAGE_KEY, JSON.stringify(localModels));
    }
  }, [localModels, isInitialized]);

  const handleToggleModel = (id: string, enabled: boolean) => {
    const updated = localModels.map(m => m.id === id ? { ...m, enabled } : m);
    setLocalModels(updated);
    syncModelsMutation.mutate(updated);
  };

  const handleAddModel = () => {
    if (newModelId && newModelName) {
      if (localModels.find(m => m.id === newModelId)) return;
      const updated = [...localModels, { id: newModelId, name: newModelName, enabled: true }];
      setLocalModels(updated);
      syncModelsMutation.mutate(updated);
      setNewModelId("");
      setNewModelName("");
      setShowAddForm(false);
    }
  };

  const handleRemoveModel = (id: string) => {
    const updated = localModels.filter(m => m.id !== id);
    setLocalModels(updated);
    syncModelsMutation.mutate(updated);
  };

  const ragModels = localModels.length > 0 ? localModels : (modelsData?.models || []);
  const installedOllamaModels = ollamaModelsData?.models || [];
  const recommendedModels = recommendedModelsData?.models || [];

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Ollama Local AI Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            Ollama 로컬 AI 설정
          </CardTitle>
          <CardDescription>Intel i5 + 8GB RAM에서 로컬 AI 모델 실행</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Ollama Enable Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Ollama 사용</Label>
              <p className="text-xs text-muted-foreground">
                활성화하면 클라우드 API 대신 로컬 Ollama 서버 사용
              </p>
            </div>
            <Switch
              checked={ollamaEnabled}
              onCheckedChange={(checked) => {
                setOllamaEnabled(checked);
                saveOllamaConfig(ollamaBaseUrl, checked, ollamaModel);
              }}
              data-testid="switch-ollama-enabled"
            />
          </div>

          {/* Ollama Connection Status */}
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-2">
              {ollamaStatus?.connected ? (
                <Wifi className="w-4 h-4 text-green-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="text-sm">
                {ollamaStatus?.connected ? '연결됨' : ollamaStatus?.error || '연결 안됨'}
              </span>
            </div>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => refetchOllamaStatus()}
              data-testid="button-refresh-ollama-status"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          {ollamaEnabled && (
            <>
              {/* Ollama Base URL */}
              <div className="space-y-2">
                <Label htmlFor="ollama-url">Ollama 서버 주소</Label>
                <Input
                  id="ollama-url"
                  value={ollamaBaseUrl}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  onBlur={() => saveOllamaConfig(ollamaBaseUrl, ollamaEnabled, ollamaModel)}
                  placeholder="http://localhost:11434"
                  data-testid="input-ollama-url"
                />
                <p className="text-xs text-muted-foreground">
                  로컬: http://localhost:11434 | 원격: http://IP:11434
                </p>
              </div>

              {/* Model Selection */}
              <div className="space-y-2">
                <Label>사용할 모델</Label>
                <Select
                  value={ollamaModel}
                  onValueChange={(value) => {
                    setOllamaModel(value);
                    saveOllamaConfig(ollamaBaseUrl, ollamaEnabled, value);
                  }}
                >
                  <SelectTrigger data-testid="select-ollama-model">
                    <SelectValue placeholder="모델 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Installed models first */}
                    {installedOllamaModels.length > 0 && (
                      <>
                        {installedOllamaModels.map((m) => (
                          <SelectItem key={m.name} value={m.name}>
                            {m.name} (설치됨)
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {/* Recommended models */}
                    {recommendedModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} ({m.size}) {m.recommended && '⭐'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Recommended Models Info */}
              <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                <p className="text-sm font-medium">8GB RAM 추천 모델:</p>
                <div className="flex flex-wrap gap-2">
                  {recommendedModels.filter(m => m.recommended).map((m) => (
                    <Badge key={m.id} variant="secondary" className="text-xs">
                      {m.name} ({m.size})
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  터미널에서: <code className="bg-muted px-1 rounded">ollama pull llama3.2:3b</code>
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* SQL Query Model Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            SQL 쿼리 모델 설정
          </CardTitle>
          <CardDescription>SQL 쿼리 생성에 사용할 AI 모델을 설정합니다</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="model">모델 선택</Label>
            <Select
              value={settings.modelName}
              onValueChange={(value) => onSettingsChange({ ...settings, modelName: value })}
            >
              <SelectTrigger id="model" data-testid="select-model">
                <SelectValue placeholder="모델을 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mistralai/mistral-7b-instruct:free">Mistral 7B (무료)</SelectItem>
                <SelectItem value="mistralai/mistral-small-3.1-24b-instruct:free">Mistral Small 24B (무료)</SelectItem>
                <SelectItem value="meta-llama/llama-3.2-3b-instruct:free">Llama 3.2 3B (무료)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              낮은 사양에서는 Mistral 7B를 권장합니다
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Temperature: {settings.temperature.toFixed(1)}</Label>
            </div>
            <Slider
              value={[settings.temperature]}
              onValueChange={([value]) => onSettingsChange({ ...settings, temperature: value })}
              min={0}
              max={1}
              step={0.1}
              className="w-full"
              data-testid="slider-temperature"
            />
            <p className="text-xs text-muted-foreground">
              낮을수록 일관된 답변, 높을수록 창의적인 답변
            </p>
          </div>
        </CardContent>
      </Card>

      {/* RAG Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            지식베이스 검색 (RAG)
          </CardTitle>
          <CardDescription>문서 기반 질의응답 설정</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>지식베이스 검색 모드</Label>
              <p className="text-xs text-muted-foreground">
                활성화하면 SQL 쿼리 대신 등록된 문서에서 답변을 검색합니다
              </p>
            </div>
            <Switch
              checked={settings.useRag}
              onCheckedChange={(checked) => onSettingsChange({ ...settings, useRag: checked })}
              data-testid="switch-rag"
            />
          </div>
          
          {settings.useRag && (
            <div className="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20">
              <p className="text-sm text-primary">
                {ollamaEnabled 
                  ? `로컬 Ollama 모델(${ollamaModel})을 사용하여 문서를 분석합니다.`
                  : '클라우드 모델을 사용하여 문서를 분석합니다.'
                }
              </p>
            </div>
          )}

          {/* Cloud Models (when Ollama disabled) */}
          {!ollamaEnabled && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">클라우드 RAG 모델</Label>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => setShowAddForm(!showAddForm)}
                  data-testid="button-add-model-toggle"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  모델 추가
                </Button>
              </div>

              {showAddForm && (
                <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="new-model-id">모델 ID (OpenRouter 형식)</Label>
                    <Input
                      id="new-model-id"
                      placeholder="예: openai/gpt-3.5-turbo:free"
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                      data-testid="input-new-model-id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-model-name">표시 이름</Label>
                    <Input
                      id="new-model-name"
                      placeholder="예: GPT-3.5 Turbo"
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      data-testid="input-new-model-name"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      onClick={handleAddModel}
                      disabled={!newModelId || !newModelName}
                      data-testid="button-add-model-confirm"
                    >
                      추가
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => {
                        setShowAddForm(false);
                        setNewModelId("");
                        setNewModelName("");
                      }}
                      data-testid="button-add-model-cancel"
                    >
                      취소
                    </Button>
                  </div>
                </div>
              )}

              {modelsLoading ? (
                <p className="text-sm text-muted-foreground">모델 목록 로딩 중...</p>
              ) : ragModels.length === 0 ? (
                <p className="text-sm text-muted-foreground">등록된 모델이 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {ragModels.map((model, index) => (
                    <div 
                      key={model.id} 
                      className="flex items-center justify-between p-3 rounded-lg border bg-card"
                      data-testid={`model-item-${index}`}
                    >
                      <div className="flex items-center gap-3">
                        <Power className={`w-4 h-4 ${model.enabled ? 'text-green-500' : 'text-muted-foreground'}`} />
                        <div>
                          <p className="font-medium text-sm">{model.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{model.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={model.enabled}
                          onCheckedChange={(checked) => handleToggleModel(model.id, checked)}
                          data-testid={`switch-model-${index}`}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleRemoveModel(model.id)}
                          data-testid={`button-remove-model-${index}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                활성화된 모델은 RAG 질의 시 우선순위에 따라 사용됩니다.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            성능 최적화
          </CardTitle>
          <CardDescription>저사양 시스템을 위한 최적화 설정</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg bg-muted/50 border border-border">
            <p className="text-sm text-muted-foreground">
              현재 시스템: <span className="font-medium text-foreground">Intel i5 CPU + 8GB RAM</span>
            </p>
            <ul className="mt-3 text-sm text-muted-foreground space-y-1">
              {ollamaEnabled ? (
                <>
                  <li>• Ollama 로컬 모델 사용 중</li>
                  <li>• 선택된 모델: {ollamaModel}</li>
                  <li>• 네트워크 불필요 (완전 로컬 실행)</li>
                </>
              ) : (
                <>
                  <li>• OpenRouter 클라우드 API 사용 중</li>
                  <li>• 네트워크 연결 필요</li>
                </>
              )}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
