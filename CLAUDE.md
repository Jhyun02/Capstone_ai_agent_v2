# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

모든 답변, 설명, 코드 주석, 커밋 메시지는 반드시 한국어로 작성한다.

## Project Overview

Korean-language SQL chatbot that converts natural language questions into SQL queries and executes them against user-uploaded CSV datasets or sample business data. Supports RAG (Retrieval-Augmented Generation) for document knowledge bases, with both cloud (OpenRouter) and local (Ollama) AI model modes.

## Commands

```bash
npm run dev        # Development server (Express + Vite HMR on port 5000)
npm run build      # Production build: esbuild (server) + Vite (client) → dist/
npm start          # Run production build: node dist/index.cjs
npm run check      # TypeScript type check
npm run db:push    # Push Drizzle schema changes to PostgreSQL
```

No test framework is configured.

## Architecture

**Monorepo with path aliases**:
- `@/` → `client/src/`
- `@shared/` → `shared/`

**Runtime flow**:
1. `server/index.ts` starts Express, registers all routes from `server/routes.ts`, and serves Vite HMR middleware in dev or static files in prod.
2. All API endpoints live in `server/routes.ts` (~1000 lines) under `/api/*`.
3. The client is a React SPA with Wouter routing. All navigation happens client-side; the server returns `index.html` for non-API routes.

**SQL generation pipeline** (`/api/sql-chat`):
- `buildDynamicSchema()` constructs a schema string from uploaded dataset metadata
- AI (OpenRouter or Ollama) generates SQL given the schema + user question
- SQL executes against PostgreSQL (`structured_data` table with JSONB rows)
- On SQL error: `fixSqlWithLLM()` retries once with the error message
- AI summarizes the result rows in Korean

**Dataset storage**: Uploaded CSVs are stored as JSONB rows in the `structured_data` table. DuckDB (`server/duckdb-service.ts`) is used for high-performance analytics queries. Access pattern: `data->>'columnname'` with mandatory `WHERE dataset_id = <id>`.

**RAG pipeline** (`/api/rag/query`):
- Documents (PDF/DOC/DOCX/PPT) parsed by `server/document-parser.ts` with Tesseract.js OCR fallback
- Chunked (500 tokens, 50-token overlap) and stored in `document_chunks` table
- Keyword-based search (no vector embeddings) in `server/embedding-service.ts`
- RAG model managed separately in `server/rag-service.ts`

**State management**:
- Server state: React Query with `staleTime: Infinity`
- Conversations: localStorage (max 20 conversations, 80 messages each)
- Settings (AI model, temperature, RAG toggle): localStorage

## Key Files

| File | Purpose |
|------|---------|
| `shared/schema.ts` | Single source of truth for all DB table definitions (Drizzle + Zod) |
| `shared/routes.ts` | Zod schemas for API request/response validation |
| `server/routes.ts` | All API route handlers |
| `server/duckdb-service.ts` | DuckDB analytics integration |
| `server/rag-service.ts` | RAG query execution + model switching |
| `server/ollama-service.ts` | Local Ollama model integration |
| `client/src/pages/Home.tsx` | Main chat interface (~500 lines) |
| `client/src/hooks/use-chat.ts` | Mutation hooks for `/api/sql-chat` and `/api/rag/query` |
| `script/build.ts` | Custom esbuild bundler for production |

## Environment Variables

```
DATABASE_URL=postgresql://...
SESSION_SECRET=...                          # 32+ chars
AI_INTEGRATIONS_OPENROUTER_API_KEY=...      # Optional; falls back to Ollama
AI_INTEGRATIONS_OPENROUTER_BASE_URL=...
NODE_ENV=development|production
PORT=5000                                   # Default; Replit maps to 80 externally
```

## SQL Constraints (enforced via LLM prompt)

- Only `SELECT` queries are allowed
- Dataset queries must include `WHERE dataset_id = <id>`
- Numeric/date columns require `CAST()` (stored as JSONB text)
- No JOINs across `products`/`sales` and user dataset tables
