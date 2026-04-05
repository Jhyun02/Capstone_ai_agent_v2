# SQL ChatbotHY - AI 데이터 분석 챗봇

> **한양대학교 ERICA 산업캡스톤** | 바이브 코딩을 이용한 AI-Agent 개발
>
> 자연어로 데이터를 질문하고, AI가 SQL을 생성하여 즉시 답변하는 풀스택 챗봇 애플리케이션

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React_18-61DAFB?style=flat-square&logo=react&logoColor=black)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-C5F74F?style=flat-square&logo=drizzle&logoColor=black)

---

## 주요 기능

**SQL 챗봇** - 한국어 자연어 질문을 PostgreSQL 쿼리로 자동 변환하고 실행합니다. SQL 오류 시 LLM이 자동 수정을 시도하며, 결과를 한국어로 요약합니다.

**데이터 시각화** - SQL 쿼리 결과를 recharts 기반 차트(바, 라인, 파이 등)로 자동 시각화합니다.

**데이터 품질 리포트** - 업로드된 데이터셋의 통계 분석, 결측값 탐지, 이상치 검출 리포트를 자동 생성합니다.

**실시간 스트리밍** - SSE(Server-Sent Events) 기반으로 AI 응답을 실시간 스트리밍하여 빠른 사용자 경험을 제공합니다.

---

## 스크린샷

<!-- 스크린샷 추가 예정: 아래 주석을 실제 이미지 경로로 교체하세요 -->
<!-- ![메인 채팅 화면](docs/screenshots/chat.png) -->
<!-- ![데이터베이스 관리](docs/screenshots/database.png) -->
<!-- ![지식베이스](docs/screenshots/knowledge-base.png) -->

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| **Frontend** | React 18, TypeScript, Tailwind CSS, shadcn/ui, Radix UI, Framer Motion |
| **Backend** | Node.js, Express.js, TypeScript (ESM) |
| **Database** | PostgreSQL, Drizzle ORM |
| **AI/LLM** | OpenRouter API (Mistral), Ollama (로컬 추론) |
| **문서 처리** | pdf-parse, mammoth, officeparser, Tesseract.js (OCR) |
| **상태 관리** | TanStack Query (React Query), localStorage |
| **차트** | Recharts |
| **빌드** | Vite (클라이언트), esbuild (서버) |
| **라우팅** | Wouter (클라이언트), Express Router (서버) |

---

## 아키텍처

### SQL 생성 파이프라인

```
사용자 질문 (한국어)
    │
    ▼
스키마 동적 구성 (buildDynamicSchema)
    │
    ▼
LLM에 스키마 + 질문 전달
    │
    ▼
SQL 생성 (SELECT만 허용)
    │
    ▼
PostgreSQL 실행 ──(오류)──▶ fixSqlWithLLM() 자동 수정 후 재시도
    │
    ▼
결과 요약 (한국어) + 차트 시각화
```

### RAG 파이프라인

```
문서 업로드 (PDF/DOCX/PPT)
    │
    ▼
문서 파싱 (OCR 폴백 포함)
    │
    ▼
텍스트 청킹 (500토큰, 50토큰 오버랩)
    │
    ▼
document_chunks 테이블 저장
    │
    ▼
사용자 질문 → 키워드 기반 하이브리드 검색
    │
    ▼
관련 청크 + 질문 → LLM 답변 생성
```

---

## 시작하기

### 사전 요구사항

- **Node.js** 18 이상
- **PostgreSQL** 14 이상
- **Ollama** (선택 - 로컬 AI 모드 사용 시)

### 설치 및 실행

```bash
# 1. 저장소 클론
git clone https://github.com/Jhyun02/Capstone_ai_agent_v2.git
cd Capstone_ai_agent_v2

# 2. 의존성 설치
npm install

# 3. 환경 변수 설정
cp .env.example .env
# .env 파일을 열어 아래 환경 변수를 설정하세요

# 4. 데이터베이스 스키마 적용
npm run db:push

# 5. 개발 서버 실행
npm run dev
```

서버가 `http://localhost:5000`에서 실행됩니다.

### 환경 변수

| 변수 | 설명 | 필수 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 연결 문자열 | O |
| `SESSION_SECRET` | 세션 시크릿 (32자 이상) | O |
| `AI_INTEGRATIONS_OPENROUTER_API_KEY` | OpenRouter API 키 | X (없으면 Ollama 사용) |
| `AI_INTEGRATIONS_OPENROUTER_BASE_URL` | OpenRouter 베이스 URL | X |

### 프로덕션 빌드

```bash
npm run build    # 빌드
npm start        # 실행
```

---

## 프로젝트 구조

```
Capstone_ai_agent_v2/
├── client/src/
│   ├── pages/Home.tsx              # 메인 채팅 인터페이스
│   ├── components/
│   │   ├── ChatInput.tsx           # 질문 입력
│   │   ├── SqlBlock.tsx            # SQL 결과 표시
│   │   ├── DataTable.tsx           # 데이터 테이블
│   │   ├── DataChart.tsx           # 차트 시각화
│   │   ├── DatabasePage.tsx        # 데이터셋 관리
│   │   ├── KnowledgeBasePage.tsx   # RAG 문서 관리
│   │   ├── SettingsPage.tsx        # AI 모델 설정
│   │   └── ui/                     # shadcn/ui 컴포넌트
│   └── hooks/use-chat.ts           # 채팅 API 훅
├── server/
│   ├── index.ts                    # 서버 진입점
│   ├── routes.ts                   # API 라우트 핸들러
│   ├── storage.ts                  # 데이터 접근 계층
│   ├── db.ts                       # DB 연결 설정
│   ├── rag-service.ts              # RAG 검색 로직
│   ├── embedding-service.ts        # 텍스트 임베딩
│   ├── document-parser.ts          # 문서 파싱 (OCR 포함)
│   └── ollama-service.ts           # Ollama 연동
├── shared/
│   ├── schema.ts                   # DB 스키마 (Drizzle + Zod)
│   └── routes.ts                   # API 스키마 정의
└── docs/                           # 상세 문서
```

---

## 라이선스

MIT License
