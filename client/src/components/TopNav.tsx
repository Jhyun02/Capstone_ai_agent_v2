import { MessageSquare, Database, Settings, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export type TabType = 'chat' | 'database' | 'settings';

interface TopNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onMenuClick: () => void;
}

const tabs: { id: TabType; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: '채팅', icon: MessageSquare },
  { id: 'database', label: '데이터베이스', icon: Database },
];

export function TopNav({ activeTab, onTabChange, onMenuClick }: TopNavProps) {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/50 bg-background/80 backdrop-blur-md">
      <div className="px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onMenuClick}
            data-testid="button-menu"
          >
            <Menu className="w-5 h-5" />
          </Button>
          
          <div className="flex flex-col">
            <h1 className="text-base sm:text-xl font-bold text-foreground truncate">
              {activeTab === 'settings' ? '설정' : '데이터 코파일럿'}
            </h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">
              {activeTab === 'settings'
                ? '모델과 설정을 조정하세요'
                : '질문하면 SQL과 차트를 바로 만들어 드립니다'}
            </p>
          </div>
        </div>

        <nav className="flex items-center gap-0.5 sm:gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors flex items-center gap-1 sm:gap-2
                ${activeTab === tab.id 
                  ? 'bg-primary/10 text-primary' 
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'}
              `}
              data-testid={`tab-${tab.id}`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
          
          <div className="w-px h-5 sm:h-6 bg-border mx-1 sm:mx-2" />
          
          <button
            onClick={() => onTabChange('settings')}
            className={`
              px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors flex items-center gap-1 sm:gap-2
              ${activeTab === 'settings' 
                ? 'bg-primary/10 text-primary' 
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'}
            `}
            data-testid="tab-settings"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">설정</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
