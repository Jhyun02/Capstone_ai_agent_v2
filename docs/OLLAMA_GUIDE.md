# Ollama 로컬 AI 설치 및 설정 가이드

## 목차

1. [Ollama란?](#ollama란)
2. [설치 방법](#설치-방법)
3. [모델 다운로드](#모델-다운로드)
4. [API 서버 구성](#api-서버-구성)
5. [애플리케이션 연동](#애플리케이션-연동)
6. [성능 최적화](#성능-최적화)
7. [문제 해결](#문제-해결)

---

## Ollama란?

Ollama는 로컬에서 대규모 언어 모델(LLM)을 실행할 수 있게 해주는 도구입니다.

### 장점

- **개인정보 보호**: 데이터가 로컬에서만 처리됨
- **오프라인 사용**: 인터넷 연결 없이도 AI 사용 가능
- **무료 사용**: API 비용 없음
- **빠른 응답**: 네트워크 지연 없음

### 시스템 요구사항

| 모델       | 최소 RAM | 권장 RAM |
| ---------- | -------- | -------- |
| mistral    | 8GB      | 16GB     |
| gemma2:2b  | 3GB      | 6GB      |
| phi3:mini  | 4GB      | 8GB      |
| qwen2:1.5b | 2GB      | 4GB      |

---

## 설치 방법

### Windows

**방법 1: 설치 프로그램**

1. https://ollama.com/download/windows 접속
2. `OllamaSetup.exe` 다운로드
3. 설치 프로그램 실행
4. 설치 완료 후 자동으로 서비스 시작

**방법 2: winget 사용**

```powershell
winget install Ollama.Ollama
```

### macOS

**방법 1: 공식 앱**

1. https://ollama.com/download/mac 접속
2. `Ollama-darwin.zip` 다운로드
3. 압축 해제 후 Applications 폴더로 이동
4. Ollama 앱 실행

**방법 2: Homebrew 사용**

```bash
brew install ollama
```

### Linux (Ubuntu/Debian)

```bash
# 설치 스크립트 실행
curl -fsSL https://ollama.com/install.sh | sh

# 서비스 시작
sudo systemctl start ollama
sudo systemctl enable ollama
```

### 설치 확인

```bash
ollama --version
# 출력 예: ollama version 0.3.x
```

---

## 모델 다운로드

### 8GB RAM 추천 모델

```bash
# 1순위 추천: Mistral (균형 잡힌 성능)
ollama pull mistral

# 경량 옵션: Gemma 2 2B (1.5GB)
ollama pull gemma2:2b

# 균형 옵션: Phi-3 Mini (2.3GB)
ollama pull phi3:mini

# 최소 사양: Qwen 2 1.5B (1GB)
ollama pull qwen2:1.5b
```

### 다운로드 확인

```bash
# 설치된 모델 목록
ollama list

# 출력 예:
# NAME            ID           SIZE    MODIFIED
# mistral         abc123...    4.1 GB  5 minutes ago
```

### 모델 테스트

```bash
# 대화형 테스트
ollama run llama3.2:3b

# 간단한 질문
>>> 안녕하세요, 자기소개 해주세요.
```

---

## API 서버 구성

### 서버 시작

Ollama는 설치 후 자동으로 API 서버를 시작합니다.

```bash
# 수동 시작 (필요시)
ollama serve

# 백그라운드 실행
ollama serve &
```

### 기본 설정

- **포트**: 11434
- **주소**: http://localhost:11434
- **API 형식**: REST API

### API 연결 테스트

```bash
# 서버 상태 확인
curl http://localhost:11434/

# 출력: "Ollama is running"

# 모델 목록 조회
curl http://localhost:11434/api/tags

# 텍스트 생성 테스트
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "한국의 수도는?",
  "stream": false
}'
```

### 원격 접속 설정 (선택사항)

다른 컴퓨터에서 접속하려면:

**Windows:**

1. 환경 변수 설정: `OLLAMA_HOST=0.0.0.0:11434`
2. 방화벽에서 11434 포트 허용

**Linux:**

```bash
# /etc/systemd/system/ollama.service 편집
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"

# 서비스 재시작
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

---

## 애플리케이션 연동

### 1. 설정 페이지 접속

1. 애플리케이션 실행 (http://localhost:5000)
2. 상단 메뉴에서 "설정" 클릭

### 2. Ollama 활성화

1. "Ollama 로컬 AI 설정" 카드 찾기
2. "Ollama 사용" 토글 ON

### 3. 연결 설정

- **서버 주소**: http://localhost:11434 (기본값)
- **모델 선택**: llama3.2:3b (권장)

### 4. 연결 상태 확인

- 초록색 아이콘: 연결됨
- 회색 아이콘: 연결 안됨

### 5. RAG 모드 사용

1. "지식베이스 검색 모드" 토글 ON
2. Ollama가 활성화되어 있으면 로컬 모델로 문서 분석

---

## 성능 최적화

### GPU 가속 (NVIDIA)

```bash
# CUDA 드라이버 확인
nvidia-smi

# Ollama가 자동으로 GPU 감지 및 사용
ollama run llama3.2:3b
```

### 메모리 최적화

**8GB RAM 시스템:**

```bash
# 경량 모델 사용
ollama pull llama3.2:3b   # 2GB
ollama pull qwen2:1.5b    # 1GB

# 다른 응용프로그램 종료 권장
```

**16GB+ RAM 시스템:**

```bash
# 더 큰 모델 사용 가능
ollama pull llama3.1:8b   # 4.7GB
ollama pull mistral:7b    # 4.1GB
```

### 응답 속도 개선

```bash
# 모델 미리 로드
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "",
  "keep_alive": "10m"
}'
```

---

## 문제 해결

### Ollama 서버가 시작되지 않음

**Windows:**

```powershell
# 서비스 상태 확인
Get-Service OllamaService

# 서비스 재시작
Restart-Service OllamaService
```

**Linux:**

```bash
# 로그 확인
journalctl -u ollama -f

# 서비스 재시작
sudo systemctl restart ollama
```

### "모델을 찾을 수 없습니다" 오류

```bash
# 모델 다시 다운로드
ollama pull llama3.2:3b

# 모델 목록 확인
ollama list
```

### 메모리 부족 오류

```bash
# 더 작은 모델 사용
ollama pull qwen2:1.5b  # 1GB

# 사용 중인 모델 정리
ollama rm <model-name>
```

### 포트 충돌

```bash
# 다른 포트 사용
OLLAMA_HOST=0.0.0.0:11435 ollama serve
```

### 연결 테스트 스크립트

```bash
#!/bin/bash
echo "=== Ollama 연결 테스트 ==="

# 1. 서버 상태
echo -n "서버 상태: "
curl -s http://localhost:11434/ || echo "연결 실패"

# 2. 모델 목록
echo -e "\n\n설치된 모델:"
curl -s http://localhost:11434/api/tags | jq '.models[].name'

# 3. 생성 테스트
echo -e "\n\n생성 테스트:"
curl -s http://localhost:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "Hello",
  "stream": false
}' | jq '.response'
```

---

## 자주 묻는 질문

### Q: Ollama와 OpenRouter 중 어느 것을 사용해야 하나요?

| 상황               | 권장       |
| ------------------ | ---------- |
| 개인정보 보호 중요 | Ollama     |
| 오프라인 환경      | Ollama     |
| 빠른 응답 필요     | Ollama     |
| 저사양 시스템      | OpenRouter |
| 최신 모델 필요     | OpenRouter |

### Q: 여러 모델을 동시에 사용할 수 있나요?

네, 하지만 RAM이 충분해야 합니다. 각 모델은 별도의 메모리를 사용합니다.

### Q: 모델을 업데이트하려면?

```bash
ollama pull llama3.2:3b  # 최신 버전으로 업데이트
```

---

## 관련 문서

- [설치 가이드](./SETUP_GUIDE.md)
- [아키텍처 문서](./ARCHITECTURE.md)
- [Ollama 공식 문서](https://github.com/ollama/ollama)
