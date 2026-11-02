# Cloudtype 자동 배포

`main` 푸시 시 GitHub Actions가 Cloudtype에 배포합니다.

## 최초 1회 설정

1. **Cloudtype API Key**  
   Cloudtype → 스페이스 설정 → 인증 → API Key 생성  
   → GitHub `englishwitheasyword_backend` → Settings → Secrets → Actions  
   → `CLOUDTYPE_TOKEN` (또는 기존 `CLOUDTYPE_API_KEY`)

2. **프로젝트 경로**  
   Cloudtype 서비스 상세 → **CLI** 탭 → `project: 스페이스/프로젝트` 값 복사  
   → GitHub → Settings → Variables → Actions  
   → `CLOUDTYPE_PROJECT` = 예: `isleofsky76/my-project`

3. **환경변수 Secrets** (Cloudtype 프로젝트)  
   대시보드에 쓰던 이름 그대로 등록:  
   `MONGO_URI`, `ADMIN_PASSWORD`, `GOOGLE_*`, `OPENAI_API_KEY` 등

4. Actions → **Deploy to Cloudtype** → Run workflow 로 한 번 확인

이후에는 `main` 푸시만 하면 백엔드가 갱신됩니다.
