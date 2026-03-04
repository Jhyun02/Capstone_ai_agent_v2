# macOS Ollama 성능 최적화 - 스트리밍 구현

## 개요

macOS (Apple Silicon)에서 Ollama 채팅 응답이 10초 이상 소요되는 문제를 해결하기 위해, SSE 스트리밍 + 단계별 진행 UI + 프롬프트 최적화를 적용했습니다.

**목표**: 실제 응답 시간 단축 + 체감 대기 시간 대폭 감소

---

## 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `server/ollama-service.ts` | `generateWithOllamaStream()` 추가, Ollama 옵션 최적화 |
| `server/routes.ts` | `/api/sql-chat-stream` SSE 엔드포인트, 프롬프트 최적화, 스키마 캐싱 |
| `client/src/hooks/use-chat-stream.ts` | **새 파일**: SSE 스트리밍 훅 |
| `client/src/components/StepProgress.tsx` | **새 파일**: 단계별 진행 UI 컴포넌트 |
| `client/src/pages/Home.tsx` | 스트리밍 훅 통합, 로딩 UI 교체 |
| `client/src/hooks/use-chat.ts` | `ChatOptions`에 `datasetId` 추가 |

---

## 구현 상세

### 1단계: Ollama 스트리밍 함수 (`server/ollama-service.ts`)

- `generateWithOllamaStream()` 함수 추가
  - `stream: true`로 Ollama API 호출
  - NDJSON 응답 파싱 → `onToken(token)` 콜백으로 토큰 단위 전달
  - `onDone(fullResponse)`, `onError(error)` 콜백 지원
  - `AbortController`로 클라이언트 연결 끊김 시 요청 중단
- Ollama 최적화 옵션:
  - `num_ctx: 2048` (기본 8192에서 축소 → 프롬프트 평가 속도 향상)
  - `num_batch: 512` (프롬프트 병렬 평가)
- 기존 `generateWithOllama()` 함수 유지 (SQL 생성 등 짧은 응답용)

### 2단계: SSE 스트리밍 엔드포인트 (`server/routes.ts`)

새 엔드포인트 `POST /api/sql-chat-stream` 추가 (기존 `/api/sql-chat` 유지)

**SSE 이벤트 프로토콜:**
```
event: step    → {"step": "generating_sql", "label": "SQL 생성 중..."}
event: sql     → {"sql": "SELECT ..."}
event: step    → {"step": "executing_sql", "label": "쿼리 실행 중..."}
event: data    → {"rows": [...], "rowCount": 5}
event: step    → {"step": "generating_summary", "label": "결과 요약 중..."}
event: token   → {"content": "총"}  (토큰 단위 스트리밍)
event: done    → {"suggestedQuestions": [...]}
event: error   → {"message": "오류 설명"}
```

- SQL 생성·실행은 기존 로직 유지 (비스트리밍, 단계별 이벤트 전송)
- 요약 생성만 `generateWithOllamaStream()` 사용하여 토큰 스트리밍
- 클라이언트 연결 끊김 감지 (`req.on("close")`) → Ollama 요청 중단

### 3단계: 프롬프트 최적화 (`server/routes.ts`)

- **SQL 생성 프롬프트**: 영어로 변경 (Mistral이 코드 태스크에서 영어 성능이 더 좋음), 중복 규칙 제거, 토큰 수 30-40% 감소
- **요약 생성 프롬프트**: 데이터 프리뷰 10행→5행, 지시문 압축
- **`buildDynamicSchema()` 캐싱**: datasetId 기준, TTL 1분 → 반복 질문 시 DB 쿼리 제거

### 4단계: 클라이언트 스트리밍 훅 (`client/src/hooks/use-chat-stream.ts`)

- `fetch` API + `ReadableStream`으로 SSE 소비 (POST 요청이므로 `EventSource` 불가)
- SSE 이벤트 파서 구현 (`event:`/`data:` 라인 파싱)
- 상태 관리: `currentStep`, `stepLabel`, `sql`, `data`, `partialContent`, `isStreaming`
- 스트리밍 실패 시 기존 `/api/sql-chat` 엔드포인트로 자동 폴백

### 5단계: 단계별 진행 UI (`client/src/components/StepProgress.tsx`)

- 3단계 진행 표시: SQL 생성 → 쿼리 실행 → 결과 요약
- 완료(체크) / 진행 중(스피너) / 대기(회색) 상태 아이콘
- Lucide 아이콘 사용 (CheckCircle, Loader2, Circle)

### 6단계: Home.tsx 스트리밍 UI 통합

- SQL 분석 모드에서 스트리밍 사용, RAG 모드는 기존 방식 유지
- 스트리밍 중:
  1. `StepProgress`로 단계별 진행 바 표시
  2. SQL 생성 완료 시 즉시 `SqlBlock` 표시
  3. 쿼리 실행 완료 시 즉시 `DataTable` 표시
  4. 요약 텍스트 토큰 단위로 점진 표시 (커서 애니메이션)
- 스트리밍 완료 시 최종 메시지로 변환하여 대화 기록에 저장

---

## 예상 성능 개선

| 지표 | 현재 | 개선 후 |
|------|------|---------|
| 첫 시각적 피드백 | 10-12초 | <0.5초 (단계 표시) |
| SQL 확인 가능 시점 | 10-12초 | ~2-3초 |
| 데이터 테이블 표시 | 10-12초 | ~3-4초 |
| 요약 첫 토큰 | 10-12초 | ~4-5초 |
| 총 완료 시간 | 10-12초 | ~7-9초 (프롬프트 최적화로 15-25% 감소) |
| **체감 대기 시간** | **10-12초** | **<1초** |

---

## 검증 방법

```bash
# 1. Ollama 스트리밍 확인
curl -N -X POST http://localhost:5000/api/sql-chat-stream \
  -H "Content-Type: application/json" \
  -d '{"message":"데이터 5개 보여줘","datasetId":1}'

# 2. 이벤트가 점진적으로 도착하는지 확인
# 3. 한글 스트리밍이 깨지지 않는지 확인
# 4. 스트리밍 실패 시 기존 엔드포인트로 폴백 확인
# 5. OpenRouter 사용 시 기존 /api/sql-chat 정상 작동 확인
```

---

## 아키텍처 다이어그램

```
[사용자 입력]
    │
    ▼
[Home.tsx] ─── RAG 모드 ──→ [기존 /api/rag/query]
    │
    └── SQL 모드 ──→ [use-chat-stream.ts]
                          │
                          ▼
                    [POST /api/sql-chat-stream]
                          │
                ┌─────────┼──────────┐
                ▼         ▼          ▼
          [SQL 생성]  [SQL 실행]  [요약 스트리밍]
          (step→sql)  (step→data) (step→token...→done)
                │         │          │
                ▼         ▼          ▼
          [SqlBlock]  [DataTable]  [텍스트 점진 표시]
          즉시 표시    즉시 표시    토큰 단위 렌더링
```
