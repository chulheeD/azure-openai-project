# 🤖 Azure OpenAI 기반 콘솔 로그 분석 자동화 시스템

이 프로젝트는 **Azure Functions**와 **OpenAI (GPT-4o)** 를 이용해  
콘솔 로그를 분석하고, 자동으로 요약/대응 방안을 생성하여 **Teams에 전송**하는 시스템입니다.  
또한, **Azure Table Storage**에 로그 히스토리를 저장하고, **신규 로그 여부를 판단**하는 기능을 포함합니다.

---

## ✅ 사전 준비 사항

### 1. Node.js 설치
- [Node.js 공식 사이트](https://nodejs.org/)에서 설치 (LTS 권장)
- 설치 확인
```bash
node -v
npm -v
```

### 2. Azure Functions Core Tools 설치
```bash
npm install -g azure-functions-core-tools@4 --unsafe-perm true
```

### 3. 의존 패키지 설치
```bash
npm install
```

---

## 🚀 실행 방법

### 1. Function 로컬 실행

```bash
npx azure-functions-core-tools@4 start
```

### 2. Azure에 배포 후 테스트 요청

```bash
curl -X POST https://<your-function-url>/api/logger_analyze \
  -H "Content-Type: application/json" \
  -d @console-log-YYYYMMDD.json
```

---

## 📦 출력 파일

- `analysis-result.json` : 분석 요약 결과 (로컬 디버깅 시 저장)
- **Azure Table Storage** : 신규 로그 Row 기록
- **Teams** : 실시간 분석 리포트 전송

---

## 📊 분석 항목 예시

- 오류 유형 분류 (JS 오류 / 네트워크 실패 / 리소스 누락 등)
- 소스 코드 기반 발생 원인 추론
- 중요도 점수화 및 대응 가이드
- 사용자 경험에 미치는 영향 평가

---

## 🔄 자동화 요소

| 항목             | 방식                                      |
|------------------|-------------------------------------------|
| 매일 자동 실행    | Power Automate Desktop (PAD)              |
| 히스토리 비교     | Azure Table Storage (해시 기반 중복 제거) |
| 배포 자동화       | GitHub Actions (예정)                     |

---

## 📚 사용 기술 스택

- **Azure Functions** - 서버리스 API 처리
- **OpenAI GPT-4o** - 로그 자연어 분석
- **Table Storage** - 로그 해시 저장, 중복 제거, 일일 신규 오류 모니터링
- **Axios** - HTTP 통신
- **Power Automate Desktop** - 일일 자동 실행
- **GitHub Actions** - 자동 배포

---

