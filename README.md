# 과기부 공공데이터맵 자동화 설정

과학기술정보통신부 공공데이터 목록을 크롤링하고, 데이터맵 웹앱을 빌드한 뒤 Cloudflare에 배포하는 자동화 프로젝트입니다.

## 구성

| 경로 | 역할 |
| --- | --- |
| `.github/workflows/` | GitHub Actions 주간 크롤링·배포 워크플로 |
| `crawler/` | data.go.kr 크롤러와 최신 `datamap.json` 산출물 |
| `datamap-web/` | Vite 기반 데이터맵 웹앱 |
| `scripts/` | 데이터맵 복사와 Redis Pub/Sub 발행 스크립트 |
| `flows/` | 선택적으로 유지하는 Kestra 플로 |

## 최초 준비

```powershell
npm install
npx playwright install chromium
```

## 자주 쓰는 명령

```powershell
# 크롤링 실행
npm run crawl

# 최신 datamap을 웹앱 public 데이터로 복사
npm run copy-datamap

# 웹앱 개발 서버 실행
npm run dev

# Cloudflare 배포
npm run deploy
```

## 과기부 데이터맵 Cloudflare 배포

`datamap-web`은 Vite 정적 앱이며 `datamap-web/wrangler.jsonc` 설정으로 Cloudflare Workers Assets에 배포합니다.

최신 크롤링 결과를 웹앱 public 데이터로 복사하고 빌드합니다.

```powershell
npm run copy-datamap
npm run build --workspace=datamap-web
```

Cloudflare 로그인이 필요하면 먼저 Wrangler 로그인을 실행합니다.

```powershell
npx wrangler login
```

배포는 루트에서 실행합니다.

```powershell
npm run deploy
```

`npm run deploy`는 다음 순서로 실행됩니다.

- `crawler/datamap.json` 또는 최신 `crawler/datamap_YYMMDD.json`을 `datamap-web/public/data/datamap.json`으로 복사
- `datamap-web`을 Vite로 빌드
- `datamap-web/wrangler.jsonc` 설정으로 Cloudflare에 배포

## 과기부 데이터맵 GitHub Actions 자동화

`.github/workflows/weekly-crawl.yml`은 매주 금요일 21:00 KST에 실행됩니다.

```yaml
cron: "0 12 * * 5"
```

GitHub Actions cron은 UTC 기준이므로 KST 21:00은 UTC 12:00입니다.

워크플로 실행 순서:

- Node.js 22 설치
- npm 의존성 설치
- Playwright Chromium 및 브라우저 의존성 설치
- `crawler/crawler_api_과기부.js --fresh` 실행
- `crawler/datamap.json`을 `datamap-web/public/data/datamap.json`으로 복사
- `datamap-web` 빌드
- Cloudflare 배포
- Redis Pub/Sub 성공/실패 이벤트 발행
- Slack 성공/실패 알림 전송

GitHub 저장소의 `Settings > Secrets and variables > Actions > Secrets`에 값을 등록합니다.

필수 GitHub Secrets:

- `CLOUDFLARE_API_TOKEN`: Cloudflare 배포용 API 토큰
- `REDIS_URL`: Redis Pub/Sub 발행용 접속 URL
- `SLACK_WEBHOOK_URL`: Slack Incoming Webhook URL

선택 GitHub Secret:

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare 계정이 여러 개일 때 필요한 선택값

GitHub 저장소의 `Settings > Secrets and variables > Actions > Variables`에 선택 값을 등록합니다.

선택 GitHub Variables:

- `REDIS_CHANNEL`: 기본값은 `msit:pipeline:events`

secret이 없으면 해당 단계는 실패하지 않고 건너뜁니다. 실제 운영에서는 세 secret을 모두 등록해야 Cloudflare 배포, Pub/Sub, Slack 알림이 모두 실행됩니다.

최초 확인은 GitHub `Actions > Weekly MSIT Crawler > Run workflow`에서 수동 실행합니다. 성공하면 이후 매주 금요일 21:00 KST에 자동 실행됩니다.

## 과기부 데이터맵 Kestra 주간 자동화

`flows/msit_datamap_pipeline.yml`은 매주 금요일 21:00 KST에 실행됩니다.

```yaml
cron: "0 21 * * 5"
timezone: Asia/Seoul
```

이 플로는 Playwright를 직접 실행하지 않고 GitHub `repository_dispatch` API를 호출합니다. 실제 크롤링, 웹앱 빌드, Cloudflare 배포, Redis Pub/Sub 발행, Slack 알림은 GitHub Actions가 담당합니다.

Kestra 플로 입력:

- `github_repository`: `OWNER/REPO` 형식의 GitHub 저장소
- `event_type`: 기본값 `msit-weekly-crawl`
- `run_reason`: 기본값 `kestra-schedule`

Kestra secret:

- `GITHUB_TOKEN`: GitHub repository dispatch 호출 권한이 있는 토큰

Kestra를 이렇게 쓰면 개인 PC나 Kestra 실행 환경에 Node.js, Playwright, Wrangler를 설치하지 않아도 됩니다. Kestra는 스케줄, 실행 이력, 재실행 버튼 역할만 담당합니다.
