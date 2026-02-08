# SQL Chatbot - 시스템 아키텍처 문서

## 목차

1. [시스템 개요](#시스템-개요)
2. [아키텍처 다이어그램](#아키텍처-다이어그램)
3. [프론트엔드 구조](#프론트엔드-구조)
4. [백엔드 구조](#백엔드-구조)
5. [데이터베이스 설계](#데이터베이스-설계)
6. [AI 통합](#ai-통합)
7. [API 명세](#api-명세)
8. [보안 고려사항](#보안-고려사항)

---

## 시스템 개요

### 프로젝트 설명

SQL Chatbot은 자연어로 데이터베이스를 조회할 수 있는 한국어 AI 챗봇 애플리케이션입니다.

### 주요 기능

- 자연어 → SQL 변환 및 실행
- CSV 데이터 업로드 및 분석
- 지식베이스 문서 검색 (RAG)
- 데이터 시각화 (차트)
- 로컬/클라우드 AI 지원

### 기술 스택

| 영역         | 기술                                          |
| ------------ | --------------------------------------------- |
| 프론트엔드   | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| 백엔드       | Node.js, Express.js, TypeScript               |
| 데이터베이스 | PostgreSQL (Drizzle ORM)                      |
| AI           | OpenRouter API, Ollama (로컬)                 |
| 빌드         | Vite, esbuild                                 |

---

## 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                           클라이언트 (Browser)                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  React Application                                            │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │   │
│  │  │  Chat UI    │ │  Database   │ │  Knowledge  │              │   │
│  │  │  Component  │ │  Page       │ │  Base Page  │              │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘              │   │
│  │           │              │               │                     │   │
│  │           └──────────────┼───────────────┘                     │   │
│  │                          │                                      │   │
│  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  TanStack Query (상태 관리 + API 캐싱)                      │  │   │
│  │  └──────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/REST
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           서버 (Express.js)                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  API Routes (/api/*)                                          │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │   │
│  │  │  /chat      │ │  /datasets  │ │  /rag       │              │   │
│  │  │  /query     │ │  /upload    │ │  /knowledge │              │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          │                                           │
│  ┌───────────────┐ ┌───────────────────────────┐                    │
│  │  RAG Service  │ │  Document Parser           │                    │
│  │ (Keyword Only)│ │  (PDF/DOC/PPT)             │                    │
│  └───────────────┘ └───────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
          │                                         │
          │                                         │
          ▼                                         ▼
┌─────────────────┐                       ┌─────────────────────────┐
│   PostgreSQL    │                       │    AI Services          │
│   (통합 DB)      │                       │  ┌─────────────────┐    │
│                 │                       │  │  OpenRouter     │    │
│  - users        │                       │  │  (클라우드)      │    │
│  - products     │                       │  └─────────────────┘    │
│  - sales        │                       │  ┌─────────────────┐    │
│  - datasets     │                       │  │  Ollama         │    │
│  - structured   │                       │  │  (로컬-Mistral)  │    │
│  - documents    │                       │  └─────────────────┘    │
└─────────────────┘                       └─────────────────────────┘
```

---

## 프론트엔드 구조

### 디렉토리 구조

```
client/
├── src/
│   ├── components/           # UI 컴포넌트
│   │   ├── ui/              # shadcn/ui 기본 컴포넌트
│   │   ├── ChatInput.tsx    # 채팅 입력
│   │   ├── ChatMessage.tsx  # 메시지 표시
│   │   ├── DataTable.tsx    # 쿼리 결과 테이블
│   │   ├── SqlBlock.tsx     # SQL 코드 블록
│   │   ├── ChartView.tsx    # 데이터 차트
│   │   ├── Sidebar.tsx      # 사이드바
│   │   ├── TopNav.tsx       # 상단 네비게이션
│   │   ├── SettingsPage.tsx # 설정 페이지
│   │   ├── DatabasePage.tsx # 데이터베이스 페이지
│   │   └── KnowledgeBasePage.tsx
│   │
│   ├── hooks/               # 커스텀 훅
│   │   ├── use-chat.ts      # 채팅 로직
│   │   ├── use-theme.ts     # 테마 관리
│   │   └── use-toast.ts     # 토스트 알림
│   │
│   ├── lib/                 # 유틸리티
│   │   ├── queryClient.ts   # TanStack Query 설정
│   │   └── utils.ts         # 헬퍼 함수
│   │
│   ├── pages/               # 페이지 컴포넌트
│   │   └── Home.tsx         # 메인 페이지
│   │
│   ├── App.tsx              # 앱 루트
│   ├── main.tsx             # 엔트리 포인트
│   └── index.css            # 전역 스타일
│
└── index.html
```

### 상태 관리

```
┌─────────────────────────────────────────────────────────────┐
│                     State Management                         │
│                                                              │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │  Local State    │    │  Server State (TanStack Query)  │ │
│  │  (useState)     │    │                                 │ │
│  │                 │    │  - API 응답 캐싱                 │ │
│  │  - UI 상태      │    │  - 자동 리페치                   │ │
│  │  - 폼 입력      │    │  - 로딩/에러 상태                │ │
│  │  - 테마         │    │  - Optimistic Updates           │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Persistent State (localStorage)                        │ │
│  │                                                          │ │
│  │  - 대화 기록 (최대 20개, 각 80개 메시지)                   │ │
│  │  - 테마 설정 (dark/light)                                 │ │
│  │  - RAG 모델 설정                                          │ │
│  │  - Ollama 설정                                            │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 백엔드 구조

### 디렉토리 구조

```
server/
├── index.ts              # 서버 엔트리 포인트
├── routes.ts             # API 라우트 정의
├── storage.ts            # 메모리 스토리지
├── db.ts                 # PostgreSQL 연결
├── vite.ts               # Vite 개발 서버
│
├── duckdb-service.ts     # DuckDB 분석 서비스
├── document-parser.ts    # 문서 파싱 (PDF/DOC/PPT)
├── embedding-service.ts  # 키워드 검색 서비스
├── rag-service.ts        # RAG 질의응답 서비스
├── ollama-service.ts     # Ollama 로컬 AI 서비스
│
└── replit_integrations/  # Replit 통합 모듈
    ├── chat.ts           # 채팅 라우트
    └── batchProcessing.ts
```

### 서비스 레이어

```typescript
// 서비스 의존성 관계

┌─────────────────────────────────────────────────────────────┐
│                        API Routes                            │
│                       (routes.ts)                            │
└─────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
           ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   RAG Service   │ │  DuckDB Service │ │ Document Parser │
│                 │ │                 │ │                 │
│  - queryRag()   │ │  - createTable()│ │  - parseDoc()   │
│  - generate()   │ │  - queryData()  │ │  - chunkText()  │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                  │                    │
         │                  │                    │
         ▼                  ▼                    ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Ollama Service  │ │    DuckDB       │ │  Embedding      │
│                 │ │   (analytics.   │ │   Service       │
│  - generate()   │ │    duckdb)      │ │                 │
│  - checkConn()  │ │                 │ │  - search()     │
│  - listModels() │ │                 │ │  - tokenize()   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │
         ▼
┌─────────────────┐
│  OpenRouter     │
│  (Fallback)     │
└─────────────────┘
```

---

## 데이터베이스 설계

### PostgreSQL 스키마

```sql
-- 사용자
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL
);

-- 제품 (샘플 데이터)
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  price DECIMAL(10,2),
  stock INTEGER DEFAULT 0
);

-- 판매 (샘플 데이터)
CREATE TABLE sales (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER,
  total_amount DECIMAL(10,2),
  sale_date TIMESTAMP DEFAULT NOW()
);

-- 업로드된 데이터셋
CREATE TABLE datasets (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  file_name VARCHAR(255),
  data_type VARCHAR(50),  -- 'structured' | 'unstructured'
  row_count INTEGER,
  columns JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 지식베이스 문서
CREATE TABLE knowledge_documents (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  file_type VARCHAR(50),
  status VARCHAR(50),     -- 'processing' | 'ready' | 'error'
  chunk_count INTEGER,
  page_count INTEGER,
  has_ocr BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 문서 청크
CREATE TABLE document_chunks (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES knowledge_documents(id),
  chunk_index INTEGER,
  content TEXT,
  page_number INTEGER,
  embedding VECTOR(1536)  -- pgvector (미래 확장용)
);
```

### DuckDB 사용

```typescript
// 고성능 분석 쿼리용 컬럼형 데이터베이스
// 파일: data/analytics.duckdb

// CSV 업로드 시 DuckDB 테이블 자동 생성
CREATE TABLE dataset_123 (
  column1 VARCHAR,
  column2 DOUBLE,
  column3 TIMESTAMP
);

// 장점:
// - MySQL 대비 970배 빠른 분석 쿼리
// - 메모리 효율적인 컬럼형 저장
// - 한국어 컬럼명 완벽 지원
```

---

## AI 통합

### 이중 모드 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Provider Selection                     │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                  ollama.enabled?                         │ │
│  │                        │                                  │ │
│  │          ┌─────────────┼─────────────┐                   │ │
│  │          │             │             │                   │ │
│  │         YES           NO                                  │ │
│  │          │             │                                  │ │
│  │          ▼             ▼                                  │ │
│  │  ┌──────────────┐ ┌──────────────┐                       │ │
│  │  │   Ollama     │ │  OpenRouter  │                       │ │
│  │  │  (Local)     │ │   (Cloud)    │                       │ │
│  │  │              │ │              │                       │ │
│  │  │ localhost:   │ │ openrouter.  │                       │ │
│  │  │ 11434        │ │ ai/api/v1    │                       │ │
│  │  └──────────────┘ └──────────────┘                       │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Ollama 서비스 구현

```typescript
// server/ollama-service.ts

interface OllamaConfig {
  baseUrl: string; // default: http://localhost:11434
  enabled: boolean; // default: false
}

// 주요 함수
export function isOllamaEnabled(): boolean;
export async function checkOllamaConnection(): Promise<{ connected: boolean }>;
export async function listOllamaModels(): Promise<{ models: Model[] }>;
export async function generateWithOllama(
  model: string,
  prompt: string,
  systemPrompt?: string,
  options?: GenerateOptions,
): Promise<{ response?: string; error?: string }>;
```

### 추천 모델 (8GB RAM)

| 모델        | 크기  | 특징                       |
| ----------- | ----- | -------------------------- |
| llama3.2:3b | 2GB   | 한국어 지원, 균형잡힌 성능 |
| gemma2:2b   | 1.5GB | 경량, 빠른 응답            |
| phi3:mini   | 2.3GB | 추론 능력 우수             |
| qwen2:1.5b  | 1GB   | 최소 리소스                |

---

## API 명세

### 채팅 API

```http
POST /api/chat
Content-Type: application/json

{
  "message": "이번 달 매출 합계를 알려주세요",
  "conversationId": "abc123"
}

Response:
{
  "response": "이번 달 총 매출은 15,000,000원입니다.",
  "sql": "SELECT SUM(total_amount) FROM sales WHERE ...",
  "data": [...],
  "chartable": true
}
```

### Ollama API

```http
# 설정 조회
GET /api/ollama/config
Response: { "baseUrl": "...", "enabled": false, "model": "llama3.2:3b" }

# 설정 변경
PUT /api/ollama/config
{ "baseUrl": "...", "enabled": true, "model": "..." }

# 연결 상태
GET /api/ollama/status
Response: { "connected": true }

# 모델 목록
GET /api/ollama/models
Response: { "models": [...] }

# 추천 모델
GET /api/ollama/recommended-models
Response: { "models": [...] }
```

### RAG API

```http
POST /api/rag/query
{
  "query": "문서에서 예산 관련 내용을 찾아주세요"
}

Response:
{
  "answer": "...",
  "sources": [
    {
      "documentName": "예산계획.pdf",
      "pageNumber": 3,
      "relevanceScore": 0.85,
      "excerpt": "..."
    }
  ]
}
```

---

## 보안 고려사항

### 인증 및 세션

- Express Session으로 세션 관리
- SESSION_SECRET 환경변수 필수

### SQL 인젝션 방지

- Drizzle ORM 파라미터 바인딩
- 사용자 입력 검증

### API 키 관리

- 환경변수로 API 키 저장
- 클라이언트에 키 노출 금지

### CORS 설정

- 개발환경: localhost 허용
- 프로덕션: 특정 도메인만 허용

---

## 관련 문서

- [설치 가이드](./SETUP_GUIDE.md)
- [Ollama 가이드](./OLLAMA_GUIDE.md)
- [API 전체 명세](/api-docs) (Swagger - 미구현)
