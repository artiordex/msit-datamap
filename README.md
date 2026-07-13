# 활용사례 Kestra 자동화 설정

`food-safety` 프로젝트의 Python 3.12, `.env.example`, Git 관리 방식을 참고해 `활용사례` 폴더에 Kestra 플로 중심의 작업 구조를 구성했습니다.

## 구성

| 경로 | 역할 |
| --- | --- |
| `.vscode/` | YAML/Python 작성, 검증, Kestra 배포·실행·로그 확인 작업 |
| `flows/` | Kestra 배포용 YAML 플로 |
| `src/usecase_pipeline/` | Kestra에서 호출하는 Python 실행 코드 |
| `scripts/` | 플로 검증과 Kestra API 배포·실행·상태·로그 확인 |
| `logs/`, `outputs/` | 로컬 실행 로그와 결과 산출물 |

## 최초 준비

```powershell
copy .env.example .env
uv sync
```

`.env`에서 Kestra 서버가 다르면 `KESTRA_BASE_URL`을 수정합니다. 인증이 필요한 Kestra라면 `KESTRA_USERNAME`/`KESTRA_PASSWORD` 또는 `KESTRA_API_TOKEN`을 채웁니다.

현재 PC에는 Docker와 실행 중인 Kestra 서버가 확인되지 않았습니다. Kestra UI/API가 준비되면 기본 주소는 `http://localhost:8080`입니다.

## 자주 쓰는 명령

```powershell
# YAML 문법과 필수 Kestra 키 확인
python scripts/validate_flows.py

# 모든 flows/*.yml 배포
python scripts/kestra_api.py deploy

# 기본 플로 실행
python scripts/kestra_api.py run

# 실행 상태 확인
python scripts/kestra_api.py status <execution-id>

# 실행 로그 확인
python scripts/kestra_api.py logs <execution-id>
```

VS Code에서는 `Terminal > Run Task...`에서 같은 작업을 선택할 수 있습니다.

## GPT 인터넷 검색 연동

`활용사례_자동화_검색.xlsx`에 아래 탭이 있으면 탭별 목적에 맞게 검색 쿼리를 자동 생성합니다.

- `공공데이터 민간활용`
- `AI 도입활용`
- `데이터 분석 활용`

먼저 비용이 들지 않는 dry-run으로 검색 예정 쿼리를 확인합니다.

```powershell
python src/usecase_pipeline/gpt_search.py --project-dir . --input-file 활용사례_자동화_검색.xlsx --mode dry-run --max-rows 10
```

실제 OpenAI 웹 검색을 실행하려면 `.env`에 `OPENAI_API_KEY`를 넣고 `--mode execute`로 실행합니다.

```powershell
python src/usecase_pipeline/gpt_search.py --project-dir . --input-file 활용사례_자동화_검색.xlsx --mode execute --max-rows 10
```

결과는 `outputs/gpt_search/YYYYMMDD/` 아래 JSONL과 XLSX로 저장됩니다.

## Playwright 직접 웹검색

API 요금을 쓰지 않고 브라우저가 검색엔진 페이지를 직접 열어 결과 제목/요약/URL을 수집할 수도 있습니다. 최초 1회만 Chromium 브라우저를 설치합니다.

```powershell
python -m playwright install chromium
```

검색 실행:

```powershell
python src/usecase_pipeline/browser_search.py --project-dir . --input-file 활용사례_자동화_검색.xlsx --max-rows 10 --max-results 5
```

기본 검색엔진은 `naver`입니다. 필요하면 `--engine daum`, `--engine bing`, `--engine duckduckgo`로 바꿀 수 있습니다.

브라우저를 눈으로 보면서 실행하려면:

```powershell
python src/usecase_pipeline/browser_search.py --project-dir . --input-file 활용사례_자동화_검색.xlsx --max-rows 3 --headed
```

결과는 `outputs/browser_search/YYYYMMDD/` 아래 JSONL과 XLSX로 저장됩니다. 이 방식은 OpenAI API 요금이 없지만 검색엔진 캡차, 차단, 화면 변경에 영향을 받을 수 있습니다.

## Kestra 플로 요약

`flows/food_safety_usecase_pipeline.yml`은 다음 운영 패턴을 포함합니다.

- `Schedule` 트리거로 평일 09:00 자동 실행
- `ForEach`와 `concurrencyLimit`로 반복·병렬 처리
- `retry`로 실패 시 최대 3회 재시도
- `logs/`와 `outputs/` 산출물로 실행 결과 관리
- Kestra 실행 화면과 API로 상태·로그 조회
- 선택 입력 `enable_gpt_search=true`로 GPT 웹 검색 태스크 실행
- 선택 입력 `enable_browser_search=true`로 Playwright 직접 웹검색 태스크 실행

기본 입력 파일은 `활용사례_자동화_검색.xlsx`입니다.
