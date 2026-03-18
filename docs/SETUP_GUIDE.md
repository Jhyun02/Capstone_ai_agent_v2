# SQL Chatbot - 설치 및 실행 가이드

## 목차

1. [시스템 요구사항](#시스템-요구사항)
2. [Visual Studio Code 설정](#visual-studio-code-설정)
3. [프로젝트 설치](#프로젝트-설치)
4. [데이터베이스 설정](#데이터베이스-설정)
5. [환경 변수 설정](#환경-변수-설정)
6. [실행 방법](#실행-방법)
7. [문제 해결](#문제-해결)

---

## 시스템 요구사항

### 최소 사양

- **CPU**: Intel Core i5 또는 동급
- **RAM**: 8GB (16GB 권장 - Mistral 모델 사용 시)
- **저장공간**: 10GB (모델 포함)
- **OS**: Windows 10/11, macOS 10.15+, Ubuntu 20.04+

### 필수 소프트웨어

- [Node.js](https://nodejs.org/) v20.x 이상
- [PostgreSQL](https://www.postgresql.org/) 14 이상
- [Visual Studio Code](https://code.visualstudio.com/)
- [Git](https://git-scm.com/)

### 선택 소프트웨어 (로컬 AI)

- [Ollama](https://ollama.com/) - 로컬 AI 모델 실행

---

## Visual Studio Code 설정

### 1. VS Code 설치

1. https://code.visualstudio.com/ 에서 다운로드
2. 설치 후 실행

### 2. 권장 확장 프로그램 설치

프로젝트를 열면 VS Code가 자동으로 권장 확장 프로그램 설치를 제안합니다.

수동 설치 시:

- **Prettier** (esbenp.prettier-vscode) - 코드 포맷팅
- **ESLint** (dbaeumer.vscode-eslint) - 코드 린팅
- **Tailwind CSS IntelliSense** (bradlc.vscode-tailwindcss) - CSS 자동완성
- **TypeScript** (ms-vscode.vscode-typescript-next) - TypeScript 지원

### 3. 프로젝트 열기

```bash
# 프로젝트 클론
git clone <repository-url>
cd sql-chatbot

# VS Code로 열기
code .
```

---

## 프로젝트 설치

### 1. 의존성 설치

```bash
npm install
```

### 2. TypeScript 타입 체크

```bash
npm run check
```

---

## 데이터베이스 설정

### PostgreSQL 설치 (로컬)

**Windows:**

1. https://www.postgresql.org/download/windows/ 에서 다운로드
2. 설치 시 비밀번호 설정 (예: postgres)
3. 기본 포트: 5432

**macOS:**

```bash
brew install postgresql@14
brew services start postgresql@14
```

**Ubuntu:**

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### 데이터베이스 생성

```bash
# PostgreSQL 접속
psql -U postgres

# 데이터베이스 생성
CREATE DATABASE sql_chatbot;
\q
```

### 스키마 동기화

```bash
npm run db:push
```

---

## 환경 변수 설정

### .env 파일 생성

프로젝트 루트에 `.env` 파일을 생성합니다:

```env
# 데이터베이스 연결
DATABASE_URL=postgresql://postgres:password@localhost:5432/sql_chatbot

# 세션 암호키 (랜덤 문자열)
SESSION_SECRET=your-secret-key-here-minimum-32-characters

# OpenRouter API (클라우드 AI 사용 시)
AI_INTEGRATIONS_OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxx
AI_INTEGRATIONS_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

### OpenRouter API 키 발급

1. https://openrouter.ai 접속
2. 회원가입 및 로그인
3. https://openrouter.ai/keys 에서 API 키 생성
4. `.env` 파일에 키 입력

---

## 실행 방법

### 방법 1: 터미널에서 실행

```bash
# 개발 모드 실행
npm run dev
```

브라우저에서 http://localhost:5000 접속

### 방법 2: VS Code에서 실행

1. `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`)
2. "Tasks: Run Task" 선택
3. "dev" 선택

### 방법 3: VS Code 디버거 사용

1. `F5` 키 누르기
2. "Run Server (Development)" 선택

---

## 문제 해결

### 포트 충돌

```bash
# 5000번 포트 사용 중인 프로세스 확인
# Windows
netstat -ano | findstr :5000

# macOS/Linux
lsof -i :5000
```

### 데이터베이스 연결 실패

```bash
# PostgreSQL 서비스 상태 확인
# Windows
sc query postgresql-x64-14

# macOS
brew services list | grep postgresql

# Linux
sudo systemctl status postgresql
```

### Node.js 버전 확인

```bash
node --version  # v20.x 이상 필요
npm --version   # v10.x 이상 권장
```

### 의존성 재설치

```bash
rm -rf node_modules
rm package-lock.json
npm install
```

---

## 빌드 및 배포

### 프로덕션 빌드

```bash
npm run build
```

### 프로덕션 실행

```bash
npm start
```

---

## 다음 단계

- [Ollama 설치 가이드](./OLLAMA_GUIDE.md) - 로컬 AI 설정
