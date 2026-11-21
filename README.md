# Nodi — 팀플 아이디에이션 도우미

과제 공지를 올리면 AI가 요구사항을 정리하고, 팀 아이디어를 노드로 펼치고, 빠진 부분을 짚어 주는 웹 서비스.
설계 문서: [CLAUDE.md](CLAUDE.md) · [database.md](database.md) · [ai.md](ai.md)

순수 HTML/CSS/JS(ES Modules) + Supabase + OpenAI(Edge Function 경유). 빌드 과정 없음.

## 실행 방법

### 1. Supabase 프로젝트 준비
1. [supabase.com](https://supabase.com)에서 프로젝트를 만든다.
2. **SQL Editor**에 `supabase/migrations/20261121000000_init.sql` 내용을 통째로 붙여넣고 한 번 실행한다.
   (또는 CLI: `supabase link --project-ref <ref>` → `supabase db push`)
   - 경험 카드 / 실행 계획이 없던 **예전 init.sql을 이미 적용한 DB**라면 `20261121000001_experiences_plans.sql`도 실행한다.
     이 파일은 멱등이라 최신 init 위에 다시 실행해도 안전하다.
3. **Authentication → URL Configuration**
   - Site URL: `http://localhost:3000`
   - Redirect URLs: `http://localhost:3000/**` (배포 후엔 배포 도메인도 추가)
4. (선택) **Authentication → Providers**에서 Google 로그인을 켠다. 이메일 매직링크는 기본으로 켜져 있다.

### 2. 환경 변수 (`.env`, git에 올리지 않음)
```bash
OPEN_API_KEY=sk-...                                  # OpenAI 키 — Edge Function secret 으로만 쓴다 (OPENAI_API_KEY 이름도 가능)
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co   # 프론트 공개값
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...  # 프론트 공개값 (RLS로 보호)
```

### 3. 프론트 설정
빌드 과정이 없는 정적 앱이라 브라우저는 `.env`를 못 읽는다. 공개값 두 개만 `js/config.js`로 옮긴다.
```bash
node scripts/gen-config.mjs     # .env → js/config.js (gitignore 대상, OpenAI 키는 옮기지 않음)
```
정적 호스팅(Vercel/Netlify)에 배포할 때는 빌드 명령을 `node scripts/gen-config.mjs`로 두고 같은 이름의 환경변수를 대시보드에 넣는다.

### 4. AI(Edge Function) 배포
```bash
supabase secrets set --env-file .env      # OPEN_API_KEY 를 secret 으로 등록 (NEXT_PUBLIC_* 는 같이 올라가도 무해)
supabase secrets set OPENAI_MODEL=gpt-5.4-mini OPENAI_MODEL_HEAVY=gpt-5.4 OPENAI_MODEL_FALLBACK=gpt-4o-mini
# 선택: OPENAI_MODEL_CONCRETIZE=gpt-5.4 (구체화 품질을 올리고 싶을 때)
#       AI_USER_HOURLY_LIMIT=30 AI_PROJECT_DAILY_LIMIT=200 AI_HEAVY_DAILY_LIMIT=20 ALLOWED_ORIGIN=https://내도메인
supabase functions deploy ai --no-verify-jwt
```
- 함수가 직접 사용자 JWT를 검증하고 프로젝트 멤버인지 확인하므로 `--no-verify-jwt`로 배포한다.
  (publishable 키 / 새 JWT 서명 키를 쓰는 프로젝트에서 게이트웨이 검증이 401을 내는 문제를 피한다)
- `supabase/config.toml`이 없다고 나오면 먼저 `supabase init`을 한 번 실행한다(기존 migrations/functions 폴더는 그대로 둔다).

### 5. 로컬 실행
```bash
node scripts/gen-config.mjs && npx serve . -l 3000     # http://localhost:3000
```
ES 모듈을 쓰기 때문에 `file://`로 열면 동작하지 않는다.

## 파일 구조 요약
| 경로 | 내용 |
|---|---|
| `index.html` / `js/pages/index.js` | 로그인, 프로젝트 목록/생성, 초대코드 참여 |
| `app.html` / `js/pages/app.js` | 캔버스 워크스페이스 (사이드바 · 캔버스 · Inspector/팀원) |
| `me.html` / `js/pages/me.js` | 개인 작업 페이지 (칸반, 신호등 기록, 활동, 칭찬, 프로필) |
| `js/canvas/*` | pan/zoom, 노드·엣지·말풍선 렌더링, 드래그/드롭 |
| `js/panels/*` | 사이드바, Inspector, 팀원 목록, 모달 |
| `js/actions.js` | 여러 화면이 함께 쓰는 동작 (노드 생성·삭제, AI 호출 흐름 등) |
| `js/api/*` | Supabase 호출 래퍼 (`client.js` = 공통 에러 처리) |
| `supabase/functions/ai/*` | OpenAI 프록시: 인증·멤버 확인·사용량 제한 → 컨텍스트(요구사항 R* + 팀 경험 E* + 트리 N*) 빌드 → 호출 → 검증 → DB 저장 |
| `js/panels/experiences.js` / `js/api/experiences.js` | 팀원 경험 카드 편집기 (온보딩 · 내 작업 · 워크스페이스 모달 공용) |
| `js/api/plans.js` / Inspector `🧭 실행 계획` 탭 | 노드 실행 계획 (조사 방법 · 구현 범위 · 리스크), AI 구체화 / 직접 수정 |
| `scripts/gen-config.mjs` | `.env` 공개값 → `js/config.js` |

## 단축키 (캔버스)
더블클릭: 새 노드 · Tab: 자식 추가 · Enter: 형제 추가 · F2/더블클릭: 이름 변경 · Delete: 삭제 ·
Shift+클릭/드래그: 다중 선택 · Ctrl+A: 전체 선택 · Space+드래그/휠: 이동 · Ctrl+휠: 확대/축소 · Esc: 선택 해제
