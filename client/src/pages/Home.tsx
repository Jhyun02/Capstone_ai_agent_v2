import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChat, type Message } from "@/hooks/use-chat";
import { Sidebar, type Conversation } from "@/components/Sidebar";
import { TopNav, type TabType } from "@/components/TopNav";
import { ChatInput } from "@/components/ChatInput";
import { SqlBlock } from "@/components/SqlBlock";
import { DataTable } from "@/components/DataTable";
import { DataChart, ChartToggle, canShowChart } from "@/components/DataChart";
import { SettingsPage } from "@/components/SettingsPage";
import { DatabasePage } from "@/components/DatabasePage";
import { KnowledgeBasePage } from "@/components/KnowledgeBasePage";
import { FileUploadDialog } from "@/components/FileUploadDialog";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  User,
  AlertCircle,
  Sparkles,
  Terminal,
  Database,
  BookOpen,
} from "lucide-react";

interface SampleQuestionsResponse {
  questions: string[];
  datasetQuestions: {
    datasetName: string;
    questions: string[];
  }[];
}

const STORAGE_KEY = "sqlchat_history_v2";
const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES = 80;

interface StoredConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

interface AppSettings {
  modelName: string;
  temperature: number;
  useRag: boolean;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationMessages, setConversationMessages] = useState<
    Record<string, Message[]>
  >({});
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [activeTab, setActiveTab] = useState<TabType>("chat");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebarCollapsed");
      return saved === "true";
    }
    return false;
  });
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      return saved ? saved === "dark" : true;
    }
    return true;
  });
  const [settings, setSettings] = useState<AppSettings>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sqlchat_settings");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {}
      }
    }
    return {
      modelName: "mistralai/mistral-7b-instruct:free",
      temperature: 0,
      useRag: false,
    };
  });
  const [isFileDialogOpen, setIsFileDialogOpen] = useState(false);
  const [datasetRefreshKey, setDatasetRefreshKey] = useState(0);
  const [showChartForMessage, setShowChartForMessage] = useState<
    Record<string, boolean>
  >({});

  const bottomRef = useRef<HTMLDivElement>(null);
  const hasInitialized = useRef(false);
  const chatMutation = useChat();

  // Fetch dynamic sample questions based on uploaded datasets
  const { data: sampleQuestionsData } = useQuery<SampleQuestionsResponse>({
    queryKey: ["/api/sample-questions", datasetRefreshKey],
    queryFn: async () => {
      const res = await fetch("/api/sample-questions");
      if (!res.ok) throw new Error("Failed to fetch sample questions");
      return res.json();
    },
    staleTime: 30000, // Cache for 30 seconds
  });

  const makeWelcomeMessage = (): Message => ({
    id: "welcome",
    role: "assistant",
    content:
      '안녕하세요! 저는 SQL 데이터 어시스턴트입니다. 제품 및 판매 데이터를 분석하는 데 도움을 드릴 수 있습니다. "가장 많이 팔린 제품은?" 또는 "이번 주 판매량을 보여줘"와 같은 질문을 해보세요.',
    timestamp: new Date(),
  });

  // Initialize from localStorage
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed: StoredConversation[] = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const restored = parsed.map((c) => ({
            id: c.id,
            title: c.title,
            createdAt: new Date(c.createdAt),
            updatedAt: new Date(c.updatedAt),
          }));

          const msgMap: Record<string, Message[]> = {};
          parsed.forEach((c) => {
            msgMap[c.id] = (c.messages || []).map((m: any) => ({
              ...m,
              timestamp: new Date(m.timestamp),
            }));
          });

          setConversations(restored);
          setConversationMessages(msgMap);
          setActiveConversationId(restored[0].id);
          const firstMsgs = msgMap[restored[0].id];
          setMessages(
            firstMsgs && firstMsgs.length > 0
              ? firstMsgs
              : [makeWelcomeMessage()],
          );
          return;
        }
      } catch (e) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    // Create first conversation inline
    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const welcomeMsg = makeWelcomeMessage();
    const newConv: Conversation = {
      id,
      title: "새 대화",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setConversations([newConv]);
    setConversationMessages({ [id]: [welcomeMsg] });
    setActiveConversationId(id);
    setMessages([welcomeMsg]);
  }, []);

  // Save conversations to localStorage when they change
  useEffect(() => {
    if (conversations.length === 0 || !activeConversationId) return;

    // Update the current conversation's messages in the map
    const updatedMsgMap = {
      ...conversationMessages,
      [activeConversationId]: messages.slice(-MAX_MESSAGES),
    };

    const toStore: StoredConversation[] = conversations
      .slice(0, MAX_CONVERSATIONS)
      .map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        messages: (updatedMsgMap[c.id] || []).slice(-MAX_MESSAGES).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          sql: m.sql,
          data: undefined, // Don't store data to save space
          error: m.error,
        })),
      }));

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [conversations, messages, activeConversationId, conversationMessages]);

  // Update conversation title when messages change
  useEffect(() => {
    if (!activeConversationId || messages.length === 0) return;

    setConversations((prev) => {
      const existing = prev.find((c) => c.id === activeConversationId);
      if (!existing) return prev;

      const firstUserMsg = messages.find((m) => m.role === "user");
      const newTitle =
        existing.title === "새 대화" && firstUserMsg?.content
          ? firstUserMsg.content.slice(0, 24)
          : existing.title;

      if (newTitle === existing.title) return prev;

      return prev.map((c) =>
        c.id === activeConversationId
          ? { ...c, title: newTitle, updatedAt: new Date() }
          : c,
      );
    });
  }, [messages, activeConversationId]);

  // Theme toggle with persistence
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode);
    localStorage.setItem("theme", isDarkMode ? "dark" : "light");
  }, [isDarkMode]);

  // Sidebar collapse persistence
  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", isSidebarCollapsed.toString());
  }, [isSidebarCollapsed]);

  // Settings persistence
  useEffect(() => {
    localStorage.setItem("sqlchat_settings", JSON.stringify(settings));
  }, [settings]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatMutation.isPending]);

  function createNewConversation() {
    // Save current messages to the map before switching
    if (activeConversationId && messages.length > 0) {
      setConversationMessages((prev) => ({
        ...prev,
        [activeConversationId]: messages,
      }));
    }

    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const welcomeMsg = makeWelcomeMessage();
    const newConv: Conversation = {
      id,
      title: "새 대화",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setConversations((prev) => [newConv, ...prev]);
    setConversationMessages((prev) => ({
      ...prev,
      [id]: [welcomeMsg],
    }));
    setActiveConversationId(id);
    setMessages([welcomeMsg]);
    setActiveTab("chat");
  }

  const handleSend = (content: string) => {
    const newMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, newMessage]);

    chatMutation.mutate(
      { message: content, useRag: settings.useRag },
      {
        onSuccess: (data) => {
          const responseMessage: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.answer,
            sql: data.sql,
            data: data.data,
            sources: (data as any).sources,
            error: (data as any).error,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, responseMessage]);
        },
        onError: (error) => {
          const errorMessage: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "죄송합니다, 요청을 처리하는 중 오류가 발생했습니다.",
            error: error.message,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, errorMessage]);
        },
      },
    );
  };

  const handleSelectConversation = (id: string) => {
    setActiveTab("chat");

    if (id === activeConversationId) return;

    // Save current messages before switching
    if (activeConversationId && messages.length > 0) {
      setConversationMessages((prev) => ({
        ...prev,
        [activeConversationId]: messages,
      }));
    }

    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;

    setActiveConversationId(id);
    const storedMessages = conversationMessages[id];
    setMessages(
      storedMessages && storedMessages.length > 0
        ? storedMessages
        : [makeWelcomeMessage()],
    );
  };

  const handleDeleteConversation = (id: string) => {
    if (!confirm("이 대화를 삭제할까요?")) return;
    const nextList = conversations.filter((c) => c.id !== id);
    setConversations(nextList);

    // Remove from message map
    setConversationMessages((prev) => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });

    if (activeConversationId === id) {
      if (nextList.length > 0) {
        setActiveConversationId(nextList[0].id);
        setMessages(
          conversationMessages[nextList[0].id] || [makeWelcomeMessage()],
        );
      } else {
        createNewConversation();
      }
    }
  };

  const handleRenameConversation = (id: string, newTitle: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c)),
    );
  };

  const handleFileUpload = () => {
    setIsFileDialogOpen(true);
  };

  const handleUploadSuccess = () => {
    setDatasetRefreshKey((prev) => prev + 1);
    // Switch to database tab to show uploaded data
    setActiveTab("database");
  };

  // Use dynamic sample queries from API, with fallback to static ones
  const defaultQueries = [
    "가장 비싼 상위 5개 제품을 보여줘",
    "카테고리별 총 매출은 얼마야?",
    "최근 7일간의 모든 판매 내역을 보여줘",
    "재고가 20개 미만인 제품은?",
  ];
  const sampleQueries = sampleQuestionsData?.questions || defaultQueries;
  const datasetQueries = sampleQuestionsData?.datasetQuestions || [];

  const renderChatContent = () => (
    <div className="flex-1 flex flex-col relative h-full overflow-hidden">
      <div className="flex-1 px-2 sm:px-4 py-4 sm:py-8 overflow-y-auto min-h-0">
        <div className="space-y-4 sm:space-y-8 pb-4 max-w-4xl mx-auto">
          <AnimatePresence mode="popLayout">
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3 }}
                className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`
                  flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-sm
                  ${
                    msg.role === "assistant"
                      ? "bg-gradient-to-br from-primary to-indigo-600 text-white shadow-primary/20"
                      : "bg-muted text-muted-foreground"
                  }
                `}
                >
                  {msg.role === "assistant" ? (
                    <Bot className="w-6 h-6" />
                  ) : (
                    <User className="w-6 h-6" />
                  )}
                </div>

                <div
                  className={`flex flex-col gap-2 max-w-[90%] sm:max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`
                    px-3 sm:px-5 py-2.5 sm:py-3.5 rounded-2xl shadow-sm text-sm leading-relaxed
                    ${
                      msg.role === "user"
                        ? "bg-white dark:bg-card text-foreground border border-border rounded-tr-none"
                        : "bg-card border border-border/50 text-foreground rounded-tl-none"
                    }
                  `}
                  >
                    {msg.content}
                  </div>

                  {msg.role === "assistant" && (
                    <div className="w-full space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                      {msg.error && (
                        <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/5 border border-destructive/20 text-destructive text-sm">
                          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          <div className="flex flex-col gap-1">
                            <span className="font-semibold">
                              쿼리 처리 오류
                            </span>
                            <span className="opacity-90">{msg.error}</span>
                          </div>
                        </div>
                      )}

                      {msg.sql && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="w-full"
                        >
                          <SqlBlock code={msg.sql} />
                        </motion.div>
                      )}

                      {msg.data && msg.data.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.2 }}
                          className="w-full space-y-3"
                        >
                          <div className="flex items-center gap-2">
                            <ChartToggle
                              showChart={
                                showChartForMessage[msg.id] ??
                                canShowChart(msg.data || [])
                              }
                              onToggle={() =>
                                setShowChartForMessage((prev) => ({
                                  ...prev,
                                  [msg.id]: !(
                                    prev[msg.id] ?? canShowChart(msg.data || [])
                                  ),
                                }))
                              }
                              canChart={canShowChart(msg.data || [])}
                            />
                          </div>
                          {(showChartForMessage[msg.id] ??
                            canShowChart(msg.data || [])) &&
                            canShowChart(msg.data || []) && (
                              <DataChart data={msg.data || []} />
                            )}
                          <DataTable data={msg.data} />
                        </motion.div>
                      )}

                      {msg.sources && msg.sources.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.2 }}
                          className="w-full mt-3"
                        >
                          <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                              <BookOpen className="w-3 h-3" />
                              출처
                            </p>
                            <div className="space-y-2">
                              {msg.sources.slice(0, 3).map((source, idx) => (
                                <div
                                  key={source.chunkId}
                                  className="text-xs p-2 rounded bg-background border border-border/30"
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-foreground">
                                      {source.documentName}
                                    </span>
                                    {source.pageNumber && (
                                      <span className="text-muted-foreground">
                                        ({source.pageNumber}페이지)
                                      </span>
                                    )}
                                    <span className="text-muted-foreground/60 text-[10px] ml-auto">
                                      관련도: {Math.round(source.score * 100)}%
                                    </span>
                                  </div>
                                  <p className="text-muted-foreground line-clamp-2">
                                    {source.content}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}

                  <span className="text-[10px] text-muted-foreground opacity-60 px-1">
                    {msg.timestamp instanceof Date
                      ? msg.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {chatMutation.isPending && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-4"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-primary/20">
                <Sparkles className="w-5 h-5 animate-pulse" />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 p-4 rounded-2xl rounded-tl-none bg-card border border-border/50 shadow-sm w-fit">
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce" />
                </div>
                <span className="text-xs text-muted-foreground animate-pulse ml-1">
                  {settings.useRag
                    ? "문서 검색 중..."
                    : "데이터베이스 분석 중..."}
                </span>
              </div>
            </motion.div>
          )}

          <div ref={bottomRef} />

          {messages.length <= 1 && (
            <div className="space-y-6 mt-4 sm:mt-8 px-1 sm:px-4">
              {datasetQueries.length > 0 ? (
                // Dataset-specific questions
                <div className="space-y-4">
                  {datasetQueries.map((ds, dsIdx) => (
                    <div key={dsIdx} className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-primary">
                        <Database className="w-4 h-4" />
                        <span>{ds.datasetName} 관련 질문</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {ds.questions.map((query, i) => (
                          <button
                            key={i}
                            onClick={() => handleSend(query)}
                            className="group relative p-3 sm:p-4 rounded-xl border border-primary/30 bg-primary/5 hover:border-primary hover:bg-primary/10 hover:shadow-lg hover:shadow-primary/5 text-left transition-all duration-300"
                            data-testid={`dataset-query-${dsIdx}-${i}`}
                          >
                            <div className="absolute top-3 sm:top-4 right-3 sm:right-4 text-primary/30 group-hover:text-primary transition-colors">
                              <Database className="w-4 h-4" />
                            </div>
                            <span className="text-sm text-muted-foreground group-hover:text-foreground/90 transition-colors pr-6">
                              "{query}"
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                // Default sample queries
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Terminal className="w-4 h-4" />
                    <span>기본 테이블 질문</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    {sampleQueries.map((query, i) => (
                      <button
                        key={i}
                        onClick={() => handleSend(query)}
                        className="group relative p-3 sm:p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 text-left transition-all duration-300"
                        data-testid={`sample-query-${i}`}
                      >
                        <div className="absolute top-3 sm:top-4 right-3 sm:right-4 text-primary/20 group-hover:text-primary transition-colors">
                          <Terminal className="w-4 h-4" />
                        </div>
                        <span className="text-sm text-muted-foreground group-hover:text-foreground/80 transition-colors pr-6">
                          "{query}"
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="w-full bg-background border-t border-border pt-4 pb-4 px-2 sm:px-4 z-40 shrink-0">
        <div className="max-w-4xl mx-auto mb-2">
          <button
            onClick={() =>
              setSettings((prev) => ({ ...prev, useRag: !prev.useRag }))
            }
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              settings.useRag
                ? "bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30"
                : "bg-muted text-muted-foreground border border-border hover:bg-muted/80"
            }`}
            data-testid="button-mode-toggle"
          >
            {settings.useRag ? (
              <>
                <BookOpen className="w-3.5 h-3.5" />
                지식베이스 모드
              </>
            ) : (
              <>
                <Database className="w-3.5 h-3.5" />
                SQL 분석 모드
              </>
            )}
            <span className="text-[10px] opacity-60">(클릭하여 전환)</span>
          </button>
        </div>
        <ChatInput onSend={handleSend} isLoading={chatMutation.isPending} />
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case "chat":
        return renderChatContent();
      case "database":
        return <DatabasePage refreshKey={datasetRefreshKey} />;
      case "knowledge":
        return <KnowledgeBasePage />;
      case "settings":
        return (
          <SettingsPage settings={settings} onSettingsChange={setSettings} />
        );
      default:
        return renderChatContent();
    }
  };

  return (
    <div className="h-screen flex bg-background font-sans overflow-hidden">
      <FileUploadDialog
        open={isFileDialogOpen}
        onOpenChange={setIsFileDialogOpen}
        onUploadSuccess={handleUploadSuccess}
      />

      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onNewConversation={() => createNewConversation()}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        onFileUpload={handleFileUpload}
        isDarkMode={isDarkMode}
        onToggleTheme={() => setIsDarkMode(!isDarkMode)}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      <div className="flex-1 flex flex-col overflow-hidden lg:ml-0">
        <TopNav
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onMenuClick={() => setIsSidebarOpen(true)}
        />
        <main className="flex-1 overflow-hidden flex flex-col">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
