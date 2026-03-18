# SQL Chatbot 아키텍처 설계서

## 1. 시스템 개요

### 1.1 프로젝트 목적
한국어 자연어 질문을 SQL 쿼리로 변환하여 PostgreSQL 데이터베이스를 조회하고, 결과를 사용자 친화적인 형태로 제공하는 AI 기반 데이터 분석 챗봇입니다. 사용자가 업로드한 CSV 데이터셋 및 문서(PDF/DOCX/PPT) 기반 RAG 지식베이스를 지원합니다.

### 1.2 주요 기능
- **SQL 챗봇**: 한국어 자연어 → SQL 쿼리 자동 변환 및 실행
- **데이터셋 관리**: CSV 업로드, JSONB 기반 구조화 데이터 저장 및 조회
- **RAG 지식베이스**: PDF/DOCX/PPT 문서 업로드 → 청킹 → 키워드 검색 → AI 답변
- **데이터 품질 리포트**: 업로드된 데이터셋의 통계/이상치 분석
- **SSE 스트리밍**: 실시간 AI 응답 스트리밍
- **다크/라이트 모드**: 테마 전환 지원
- **듀얼 AI 모드**: OpenRouter (클라우드) / Ollama (로컬) 전환 가능

### 1.3 기술 스택
| 영역 | 기술 |
|------|------|
| 프론트엔드 | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| 상태관리 | TanStack React Query, localStorage |
| 라우팅 | Wouter |
| 백엔드 | Express.js, Node.js (ESM) |
| 데이터베이스 | PostgreSQL, Drizzle ORM |
| AI (클라우드) | OpenRouter API (Mistral Devstral) |
| AI (로컬) | Ollama (Mistral) |
| 문서 파싱 | pdf-parse, mammoth, officeparser, Tesseract.js OCR |
| 빌드 | Vite (클라이언트), esbuild (서버) |

---

## 2. 시스템 아키텍처

### 2.1 전체 구조도

```
┌─────────────────────────────────────────────────────────────────┐
│                      클라이언트 (React SPA)                       │
├──────────┬──────────┬──────────┬──────────┬─────────────────────┤
│ Sidebar  │ TopNav   │ ChatInput│ SqlBlock │ KnowledgeBasePage   │
│(대화목록)│(탭 네비) │(입력창)  │(SQL+차트)│(RAG 문서 관리)      │
├──────────┴──────────┴──────────┴──────────┴─────────────────────┤
│                  use-chat-stream.ts (SSE 스트리밍)                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP/SSE
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     백엔드 서버 (Express)                         │
├─────────────────────────────────────────────────────────────────┤
│  routes.ts (모든 API 라우트)                                     │
│  ├─ /api/chat/sql          SQL 챗봇 (SSE 스트리밍)               │
│  ├─ /api/datasets/*        데이터셋 CRUD + CSV 업로드            │
│  ├─ /api/knowledge-base/*  RAG 문서 관리                         │
│  ├─ /api/rag/query         RAG 질의                              │
│  └─ /api/ollama/*          Ollama 설정/상태                      │
├───────────┬───────────┬──────────────┬──────────────────────────┤
│ rag-      │ document- │ embedding-   │ ollama-                  │
│ service   │ parser    │ service      │ service                  │
└─────┬─────┴─────┬─────┴──────┬───────┴──────────┬──────────────┘
      │           │            │                   │
      ▼           ▼            ▼                   ▼
┌──────────┐ ┌─────────┐ ┌──────────┐      ┌────────────┐
│PostgreSQL│ │Tesseract│ │OpenRouter│      │   Ollama   │
│(Drizzle) │ │  OCR    │ │  API     │      │ (로컬 AI)  │
└──────────┘ └─────────┘ └──────────┘      └────────────┘
```

### 2.2 디렉토리 구조

```
Capstone_ai_agent_v2/
├── client/src/
│   ├── pages/
│   │   └── Home.tsx              # 메인 채팅 페이지
│   ├── components/
│   │   ├── ChatInput.tsx         # 채팅 입력
│   │   ├── SqlBlock.tsx          # SQL 결과 표시
│   │   ├── DataTable.tsx         # 데이터 테이블
│   │   ├── DataChart.tsx         # 차트 시각화 (recharts)
│   │   ├── DatabasePage.tsx      # 데이터셋 관리 페이지
│   │   ├── KnowledgeBasePage.tsx # RAG 지식베이스 페이지
│   │   ├── SettingsPage.tsx      # 모델/Ollama 설정
│   │   ├── FileUploadDialog.tsx  # CSV/문서 업로드 다이얼로그
│   │   ├── QualityReportDialog.tsx # 데이터 품질 리포트
│   │   ├── StepProgress.tsx      # 처리 단계 진행 표시
│   │   ├── Sidebar.tsx           # 대화 목록 사이드바
│   │   ├── TopNav.tsx            # 탭 네비게이션
│   │   ├── Header.tsx            # 헤더
│   │   └── ui/                   # shadcn 공통 UI 컴포넌트
│   ├── hooks/
│   │   ├── use-chat-stream.ts    # SSE 스트리밍 채팅 훅
│   │   ├── use-chat.ts           # 채팅 API 뮤테이션 훅
│   │   ├── use-toast.ts          # 토스트 알림 훅
│   │   └── use-mobile.tsx        # 모바일 감지 훅
│   └── lib/
│       └── queryClient.ts        # React Query 설정
├── server/
│   ├── index.ts                  # 서버 엔트리포인트
│   ├── routes.ts                 # 모든 API 라우트 핸들러
│   ├── storage.ts                # 데이터 액세스 레이어
│   ├── db.ts                     # Drizzle DB 연결
│   ├── rag-service.ts            # RAG 쿼리 실행 + 모델 전환
│   ├── embedding-service.ts      # 텍스트 임베딩/키워드 검색
│   ├── document-parser.ts        # PDF/DOCX/PPT 파싱 + OCR
│   ├── ollama-service.ts         # Ollama 로컬 AI 통합
│   ├── static.ts                 # 프로덕션 정적 파일 서빙
│   └── vite.ts                   # 개발 모드 Vite HMR 미들웨어
├── shared/
│   ├── schema.ts                 # Drizzle 테이블 정의 + Zod 타입
│   └── routes.ts                 # API 요청/응답 Zod 스키마
├── script/
│   └── build.ts                  # esbuild 프로덕션 빌드 스크립트
├── docs/
│   ├── SETUP_GUIDE.md            # 설치 가이드
│   └── OLLAMA_GUIDE.md           # Ollama 설정 가이드
└── .env.example                  # 환경 변수 템플릿
```

---

## 3. 데이터베이스 스키마

### 3.1 ERD

```
┌──────────────────┐     ┌──────────────────┐
│    datasets      │     │ structured_data  │
├──────────────────┤     ├──────────────────┤
│ id (PK)          │◄────│ dataset_id (FK)  │
│ name             │     │ id (PK)          │
│ fileName         │     │ data (JSONB)     │
│ rowCount         │     │ rowIndex         │
│ columns (JSONB)  │     └──────────────────┘
│ dataType         │
│ createdAt        │     ┌──────────────────┐
└──────────────────┘     │ unstructured_data│
                         ├──────────────────┤
┌──────────────────┐     │ dataset_id (FK)  │
│knowledge_documents│    │ id (PK)          │
├──────────────────┤     │ content (TEXT)   │
│ id (PK)          │     └──────────────────┘
│ title            │
│ fileType         │     ┌──────────────────┐
│ fileSize         │     │ document_chunks  │
│ chunkCount       │     ├──────────────────┤
│ status           │◄────│ documentId (FK)  │
│ createdAt        │     │ id (PK)          │
└──────────────────┘     │ content (TEXT)   │
                         │ chunkIndex       │
┌──────────────────┐     │ embedding (JSONB)│
│    products      │     └──────────────────┘
├──────────────────┤
│ id (PK)          │     ┌──────────────────┐
│ name, category   │     │      sales       │
│ price, stock     │     ├──────────────────┤
│ description      │     │ id (PK)          │
└──────────────────┘     │ product_id (FK)  │
                         │ quantity         │
                         │ total_price      │
                         │ sale_date        │
                         └──────────────────┘
```

### 3.2 주요 테이블 설명

| 테이블 | 용도 |
|--------|------|
| `datasets` | 업로드된 CSV 파일 메타데이터 (이름, 컬럼 정보, 행 수) |
| `structured_data` | CSV 행 데이터를 JSONB로 저장. `data->>'컬럼명'`으로 쿼리 |
| `unstructured_data` | 비정형 텍스트 데이터 (키워드 검색용) |
| `knowledge_documents` | RAG 문서 메타데이터 (제목, 파일 타입, 처리 상태) |
| `document_chunks` | 문서를 500토큰 단위로 청킹한 텍스트 + 임베딩 |
| `products` / `sales` | 샘플 비즈니스 데이터 (데모용) |

---

## 4. 핵심 처리 흐름

### 4.1 SQL 챗봇 흐름 (SSE 스트리밍)

```
사용자 질문 입력
    │
    ▼
[use-chat-stream.ts] ──► POST /api/chat/sql (SSE)
    │
    ▼
routes.ts:
    ├─ 1. buildDynamicSchema(): 데이터셋 메타데이터로 스키마 문자열 생성
    ├─ 2. AI (OpenRouter/Ollama): 스키마 + 질문 → SQL 생성
    ├─ 3. PostgreSQL: SQL 실행 (structured_data 테이블)
    ├─ 4. 실패 시: fixSqlWithLLM()으로 AI 재시도 1회
    └─ 5. AI: 결과 요약 (한국어)
    │
    ▼
SSE 이벤트 스트리밍:
    ├─ step: 진행 단계 표시
    ├─ sql: 생성된 SQL
    ├─ data: 쿼리 결과 (행 데이터)
    ├─ answer: AI 요약 답변
    └─ done: 완료
```

### 4.2 RAG 질의 흐름

```
사용자 질문
    │
    ▼
POST /api/rag/query
    │
    ├─ 1. document-parser.ts: 문서 파싱 (PDF/DOCX/PPT + OCR)
    ├─ 2. embedding-service.ts: 키워드 기반 유사 청크 검색
    ├─ 3. rag-service.ts: 관련 청크 + 질문 → AI 답변 생성
    └─ 4. 출처 정보 포함 응답 반환
```

### 4.3 데이터셋 업로드 흐름

```
CSV 파일 선택 + 설정
    │
    ▼
POST /api/datasets/upload (multipart/form-data)
    │
    ├─ 1. papaparse: CSV 파싱 (인코딩: UTF-8/EUC-KR)
    ├─ 2. analyzeColumns(): 컬럼 타입 자동 추론
    ├─ 3. datasets 테이블: 메타데이터 저장
    └─ 4. structured_data 테이블: JSONB 행 배치 삽입
```

---

## 5. AI 통합

### 5.1 듀얼 모드
| 모드 | 서비스 | 모델 | 용도 |
|------|--------|------|------|
| 클라우드 | OpenRouter API | mistralai/devstral-2512:free | 기본 모드 |
| 로컬 | Ollama | mistral | API 키 없을 때 폴백 |

### 5.2 SQL 생성 규칙 (LLM 프롬프트)
- SELECT 쿼리만 허용
- 데이터셋 쿼리 시 `WHERE dataset_id = <id>` 필수
- 숫자/날짜 컬럼은 `CAST()` 사용 (JSONB 텍스트 저장)
- products/sales와 사용자 데이터셋 간 JOIN 금지

### 5.3 오류 복구
1. AI 생성 SQL 실행 실패 → `fixSqlWithLLM()`으로 오류 메시지 전달 후 재시도
2. 재시도 실패 → 오류 메시지 사용자에게 반환

---

## 6. 상태 관리

| 데이터 | 저장 위치 | 방식 |
|--------|-----------|------|
| 서버 데이터 (데이터셋, 문서) | React Query | `staleTime: Infinity` |
| 대화 기록 | localStorage | 최대 20개 대화, 80개 메시지 |
| 설정 (모델, 온도, RAG 토글) | localStorage | JSON |
| 테마 (다크/라이트) | localStorage | boolean |

---

## 7. 환경 변수

```env
DATABASE_URL=postgresql://...          # PostgreSQL 연결 문자열
SESSION_SECRET=...                     # 세션 암호키 (32자 이상)
AI_INTEGRATIONS_OPENROUTER_API_KEY=... # OpenRouter API 키 (선택)
AI_INTEGRATIONS_OPENROUTER_BASE_URL=... # OpenRouter API URL
NODE_ENV=development|production
PORT=5000
```

---

## 8. 빌드 및 실행

```bash
npm run dev        # 개발 서버 (Express + Vite HMR, 포트 5000)
npm run build      # 프로덕션 빌드 (esbuild + Vite)
npm start          # 프로덕션 실행
npm run check      # TypeScript 타입 체크
npm run db:push    # DB 스키마 동기화
```
