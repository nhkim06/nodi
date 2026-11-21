# Nodi — 팀플 아이디에이션 도우미

> **교수님의 과제 요구사항과 팀원들의 경험을 바탕으로, 우리 팀이 실행할 수 있는 방향으로 아이디어를 구체화해 주는 AI 팀플 도우미.**

변경사항이 있으면 ai 관련은 ai.md, db 관련은 database.md에 반영해줘.

노드 기반 아이디에이션 캔버스에서 AI가 두 가지 입력을 기준으로 판단한다.

| 입력              | 출처                                                                 | AI가 판단하는 것                                   |
| ----------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| **과제 요구사항** | 교수님 공지 문서 → AI가 구조화 (`requirements`)                      | 무엇을 해야 하는가 (주제, 제출물, 평가 기준, 제약) |
| **팀원 경험**     | 팀원이 입력한 경험 카드 (`member_experiences`) + 서비스 안 활동 이력 | 우리 팀이 **어떻게, 어디까지** 할 수 있는가        |

**팀원 경험은 역할 배정에만 쓰이지 않는다.** 아이디어마다 다음 두 가지를 바꾸는 근거가 된다.

- **조사 방법**: 예) 설문 분석 경험이 있으면 정량 설문 → 없으면 인터뷰 5명 + 친화도 분석
- **구현 범위**: 예) 프론트엔드 경험자가 있으면 실제 동작하는 MVP → 없으면 Figma 프로토타입까지, 나머지는 범위 밖

그래서 모든 AI 결과(아이디어 생성, 피드백, 점검, 구체화)는 "요구사항 R*을 충족하고, 팀원 경험 E*로 실행 가능하다"는 근거를 함께 남긴다.

- DB 설계 상세 → [database.md](database.md)
- AI 기능 설계 상세 → [ai.md](ai.md)

---

## 1. 기술 스택 & 원칙

| 영역            | 선택                                                         | 비고                                                               |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| Frontend        | 순수 HTML / CSS / JavaScript (ES Modules)                    | 번들러·프레임워크 없음. `<script type="module">`                   |
| Backend/DB      | Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) | 별도 서버 없음                                                     |
| AI              | OpenAI ChatGPT API                                           | **반드시 Supabase Edge Function 경유** (키를 브라우저에 두지 않음) |
| 외부 라이브러리 | CDN으로만 로드, 버전 고정                                    | `@supabase/supabase-js@2`, `pdfjs-dist` (PDF 텍스트 추출)          |

### 반드시 지킬 원칙

1. **OpenAI API 키는 절대 프론트에 넣지 않는다.** `supabase/functions/ai`의 secret(`OPENAI_API_KEY`)으로만 사용.
2. 프론트에 노출되는 건 Supabase `anon key`뿐이며, 모든 테이블은 **RLS로 보호**한다 (프로젝트 멤버만 접근).
3. AI가 만든 데이터(요구사항, AI 노드, AI 코멘트)는 Edge Function이 service role로 기록한다.
4. 빌드 과정이 없으므로 파일은 브라우저가 그대로 읽는 형태로 작성한다. ES 모듈을 쓰므로 로컬에서도 `file://`이 아니라 정적 서버(`npx serve .` 또는 VS Code Live Server)로 띄운다.
5. 상태는 Supabase가 원본(source of truth)이다. 프론트 store는 캐시이며, Realtime 이벤트로 동기화한다.
6. **AI 프롬프트에는 항상 요구사항 블록과 팀 경험 블록을 함께 넣는다.** 경험이 비어 있으면 AI는 "경험 정보 없음"을 전제로 보수적인 범위를 제안하고, 경험 카드 입력을 유도한다.

---

## 2. 디렉토리 구조

```
nodi/
├── CLAUDE.md                 # 이 파일 — 전체 설계
├── database.md               # DB 스키마 / RLS / 트리거
├── ai.md                     # AI 기능 / 프롬프트 / Edge Function 설계
├── ia.md                     # 정보 구조 (HOME 탭 4개 → 프로젝트 상세 4개 영역) + 변경 내역
├── index.html                # 로그인 + HOME 탭(home / project / account / setting)
├── app.html                  # 프로젝트 상세 (캔버스 워크스페이스)
├── me.html                   # 나의 작업 (담당 노드·할 일)
├── favicon.svg               # 로고 마크 아이콘 — 모든 HTML이 <link rel="icon"> 로 지정 (없으면 /favicon.ico 404)
├── css/
│   ├── tokens.css            # 색상·간격·폰트 변수 (상태색, 신호등색, 멤버 팔레트)
│   ├── base.css              # reset, 공통 요소
│   ├── layout.css            # 3단 레이아웃 (sidebar / canvas / inspector)
│   ├── canvas.css            # 노드, 엣지, 말풍선
│   ├── panels.css            # 사이드바, 오른쪽 패널, 모달
│   └── nodi.css              # NO:DI 디자인 컴포넌트 (왼쪽 메뉴, 팀원 카드, 히어로, 프로젝트 카드)
├── js/
│   ├── config.example.js     # SUPABASE_URL, SUPABASE_ANON_KEY 템플릿 (config.js는 gitignore)
│   ├── supabase.js           # createClient 단일 인스턴스 export
│   ├── auth.js               # 로그인/로그아웃/세션 가드
│   ├── store.js              # 전역 상태 + 구독(pub/sub)
│   ├── router.js             # URL hash 기반 포커스 뷰 (#/home, #/focus/<id>,<id>)
│   ├── realtime.js           # 테이블별 채널 구독 → store 반영
│   ├── api/                  # Supabase 호출 래퍼 (테이블별 1파일)
│   │   ├── projects.js  nodes.js  assignees.js  links.js
│   │   ├── praises.js   signals.js  docs.js      ai.js
│   │   ├── experiences.js            # 경험 카드 CRUD
│   │   ├── plans.js                  # 노드 실행 계획 (node_plans)
│   │   ├── tasks.js                  # 노드 할 일 목록 (node_tasks)
│   ├── canvas/
│   │   ├── viewport.js       # pan / zoom (CSS transform)
│   │   ├── renderNodes.js    # 노드 DOM 생성/갱신 (keyed diff)
│   │   ├── renderEdges.js    # SVG 곡선 엣지
│   │   ├── interactions.js   # 선택, 드래그 이동, 다중선택, 더블클릭 생성
│   │   ├── layout.js         # 자식 자동 배치 / fit-to-view
│   │   └── bubbles.js        # AI 코멘트 말풍선
│   ├── panels/
│   │   ├── topnav.js         # 공통 플로팅 헤더 + 원근 그리드 배경 (NO:DI)
│   │   ├── sidebar.js        # 프로젝트 상세 왼쪽 메뉴 + 부품 배치 (맵/요구사항/팀원/링크/나의 작업)
│   │   ├── inspector.js      # 오른쪽: 노드 선택 시 옵션
│   │   ├── members.js        # 오른쪽: 미선택 시 팀원 드롭다운
│   │   └── modals.js         # 문서 업로드, 링크 관리, 칭찬 등
│   ├── pages/
│   │   ├── index.js  app.js  me.js
│   └── utils/
│       ├── dom.js  time.js  color.js  pdf.js
│       └── project.js        # ?project= 읽기 + 마지막으로 연 프로젝트 기억(쿼리 유실 대비)
└── supabase/
    ├── migrations/           # database.md의 SQL을 순서대로 분리
    └── functions/
        └── ai/index.ts       # OpenAI 프록시 + 컨텍스트 빌더 (ai.md 참고)
```

---

## 3. 화면 설계

### 3.0 비주얼 디자인 (NO:DI — Figma '와씨톤' Page 4)

- **배경**: 연회색(`--bg`) 위 원근 그리드(천장 + 바닥, 소실점은 화면 가운데). `topnav.js`의 `ensureBackground()`가 `.bg-grid`를 넣는다.
- **공통 헤더**: 흰 알약 플로팅 바 — 로고(보라 팔각형 마크 + `NO:DI`) · `Home / Project / Account / setting`(선택 탭은 보라 그라데이션 알약) · `Sign in` / `Sign up for free`(로그인 후 이름 + `Sign out`). 모든 페이지가 `topNav()`를 쓴다.
- **색·모양**: 포인트 보라 `--primary #6C4FEF`, 그라데이션 `--primary-grad`, 버튼은 알약형, 카드는 흰 바탕 + 16px 둥근 모서리 + 옅은 그림자.
- **랜딩**(로그아웃): "Make ideation easier." / "Save time and energy with **NO:DI**" / 부제 / `Start your NO:DI` → 로그인 모달.
- **프로젝트 카드**: 회색 썸네일(과목명 모노그램) + 제목. 호버하면 보라 글로우 + 살짝 확대. 마지막 `+` 카드 = 새 프로젝트·초대코드 참여 모달.
- **프로젝트 상세**: 왼쪽 알약 메뉴(선택 항목은 보라 아이콘 + 점), 가운데 점 격자 둥근 보드. 마인드맵 노드는 연보라 테두리, 루트는 보라 채움, 연결선은 회색 꺾은 선 + 자식 쪽 끝점. 팀원 메뉴는 팀원 카드(작업 상태 원 · 👍 수 · 전공 · 역할) + `+` 초대 카드.
- CSS 로드 순서: `tokens → base → layout → (canvas) → panels → nodi`.

### 3.1 메인 워크스페이스 (`app.html`)

공통 헤더 아래 **[왼쪽 메뉴 | 보드 | 오른쪽 패널]**. 왼쪽 메뉴(아이디어 맵 / 과제 요구사항 / 팀원 / 작업 링크 모음 / 나의 작업)를 누르면 `state.pageView`가 바뀌고, 아이디어 맵이면 캔버스 보드 + 오른쪽 패널, 나머지는 페이지 보드(`#page`)에 해당 부품을 펼친다 (`sidebar.js`의 `LAYOUT`). 아래 그림은 아이디어 맵 화면의 기능 배치다.

```
┌──────────────┬──────────────────────────────────────────────┬────────────────┐
│ LEFT SIDEBAR │  🏠 Home > 앱 아이디어 > 타깃 사용자  (breadcrumb)    │ RIGHT PANEL    │
│ (240px)      │ ┌──────────────────────────────────────────┐ │ (320px)        │
│              │ │                                          │ │                │
│ [프로젝트명] │ │        ( root )                          │ │ 노드 선택 시:  │
│  D-day ⚙️설정│ │       /   |    \          💬 AI 말풍선   │ │  → Inspector   │
│ 🏠 HOME      │ │   (A)    (B)   (C)                       │ │                │
│ 🗺️ 아이디어 맵│ │   / \     |                              │ │ 미선택 시:     │
│  트리·요구사항│ │ (A1)(A2) (B1)                            │ │  → 팀원 목록   │
│  ·AI 도구    │ │                                          │ │   (드롭다운)   │
│ 👥 팀원      │ │                         [ - 100% + ][⤢]  │ │                │
│ 🔗 작업 링크 │ └──────────────────────────────────────────┘ │                │
│ 👤 나의 작업 │  상단 툴바: [+노드] [✨AI 생성] [필터: 상태/담당자]  │                │
└──────────────┴──────────────────────────────────────────────┴────────────────┘
```

CSS Grid: `grid-template-columns: 240px 1fr 320px;` 왼쪽/오른쪽 패널은 접을 수 있다(접으면 48px 아이콘 바).

> 전체 정보 구조(HOME 탭 4개 → 프로젝트 상세 4개 영역)는 [ia.md](ia.md)를 기준으로 한다.

### 3.2 왼쪽 사이드바 (프로젝트 상세 4개 영역)

| 영역              | 항목                      | 동작                                                                                |
| ----------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| (헤더)            | 프로젝트                  | 프로젝트명, D-day(종료 시 '종료됨'), `⚙️ 설정` → `index.html#/settings/<id>`        |
| (내비)            | 🏠 HOME / 🗺️ 맵 전체 보기 | `index.html#/home` / 캔버스 `#/home`                                                |
| 🗺️ 아이디어 맵    | 🌳 노드 트리              | 계층형 아웃라인(Figma 레이어 패널처럼). 클릭하면 캔버스 해당 노드로 이동, 선택      |
|                   | 📄 과제 요구사항          | 업로드 모달 + 추출된 요구사항 목록(체크리스트, 편집 가능)                           |
|                   | ✨ AI 도구                | 아이디어 생성 / 전체 점검(요구사항 커버리지) / 방향 추천 / 역할 분담 추천           |
| 👥 팀원           | 🚦 내 작업 상태           | 🟢 진행 중 / 🟡 쉬는 중 / 🔴 막힘·도움 필요 토글 + 한 줄 메시지 + ⏱️ 오늘 누적 시간 |
|                   | 👍 팀원 칭찬하기          | 팀원 옆 👍 원클릭 좋아요(메시지 선택) → 칭찬 온도 상승                              |
| 🔗 작업 링크 모음 | 링크                      | 노션 / 회의록 / 피그마 / GitHub / 드라이브 / 기타 — 종류별 묶음 + 추가              |
| 👤 나의 작업      | ✅ 담당 노드              | 내 담당 노드(상태순) + 내 할 일 체크 + `me.html?project=<id>`                       |

### 3.3 오른쪽 패널

**(A) 노드 선택 시 — Inspector**

- 제목, 설명 (인라인 편집, blur 시 저장)
- 상태 버튼 3개: `채택` `고민중` `버림` (버린 노드면 `복구` 버튼)
- ⭐ 후보로 표시 토글 (`is_candidate`)
- 담당자: 칩 목록 + 추가 드롭다운 (여러 명 가능), 담당자별 작업 상태(todo/doing/done)
- **✅ 할 일 목록** (`node_tasks`, F18): 체크, 할 일별 담당자, 추가/삭제, `✨ AI로 만들기`(A8 구체화가 할 일도 생성)
- **실행 계획 탭** (`node_plans`, F15): 실행 가능성 점수, 조사 방법, 구현 범위(MVP / 여유 있으면 / 범위 밖), 리스크, 근거가 된 팀원 경험 칩. `✨ 우리 팀 기준으로 구체화` 버튼, 직접 수정 가능
- 연결된 작업 링크
- AI 영역: `이 노드 피드백 받기`, `하위 아이디어 생성`, 이 노드에 달린 AI 코멘트 목록(숨기기 가능)
- `이 노드를 루트로 보기` (포커스 진입)
- 다중 선택 시: 일괄 상태 변경, `선택한 노드들로 이어서 아이디에이션`

**(B) 아무것도 선택하지 않았을 때 — 팀원 목록**

- 팀원마다 접히는 드롭다운(`<details>`):
  - 헤더: 멤버 색상 점, 이름, 역할 라벨, 신호등 상태, 칭찬 온도
  - 펼치면: 담당 노드 목록(상태별), 진행률(done/전체), 신호등 메시지, **경험 카드 요약**(종류별 칩)
- **각 팀원 헤더는 드롭 타겟**: 캔버스의 노드를 끌어다 놓으면 담당자로 지정

### 3.4 나의 작업 (`me.html`)

- 담당 노드 확인 (todo / doing / done 칸반 3열, 카드 제목 → 캔버스 포커스)
- 내 할 일 (`node_tasks` 중 나에게 배정된 것, 체크)
- 작업 상태 시간 (오늘/최근 7일 상태별 누적 시간)
- 내 활동 내역 (activity_logs), 받은 좋아요
- 프로필·경험 카드는 HOME › account 로 옮겼다.

### 3.5 HOME (`index.html`)

- Supabase Auth (이메일 매직링크 또는 Google OAuth). 로그인 후 상단 탭 4개 (hash 라우팅):
  - `#/home` 프로젝트 현황: 진행 중 / 지난 프로젝트(`completed_at` 또는 마감 경과), 내 담당 진행률 (F17)
  - `#/projects` 전체 프로젝트 목록 + 새 프로젝트 생성(이름, 과목명, 마감일) + 초대코드로 참여 → 카드 = 프로젝트 상세
  - `#/account` 나의 정보(이름, 전공, 기술 태그) + **나의 프로젝트 경험**(경험 카드, F16)
  - `#/settings/<id>` 프로젝트 기본 정보(이름·과목명·마감일·소개) + **교수 요구사항**(`professor_note` → A1 분석) + 팀원 관리(역할 라벨, 내보내기/나가기) + **초대 링크 공유**(`index.html?join=CODE`) + 프로젝트 종료
- **경험 온보딩**: 프로젝트에 처음 들어올 때 경험 카드가 0개면 "우리 팀 AI가 실행 가능한 범위를 정하려면 경험이 필요해요" 단계를 띄운다. 최소 1개 입력을 권장하고 건너뛸 수 있다. 빠른 입력용 예시 칩(설문조사, 인터뷰, Figma, 웹 개발, 영상 편집, 발표 등)을 제공한다.

---

## 4. 핵심 기능 명세

우선순위: **P0** = MVP 필수, **P1** = MVP 직후, **P2** = 여유 있을 때(원문의 "b만"은 B순위/선택 기능으로 해석).

| #   | 기능                                                                                   | 우선순위 |
| --- | -------------------------------------------------------------------------------------- | -------- |
| F1  | 인증, 프로젝트 생성, 초대 링크·코드 참여, setting(기본 정보·교수 요구사항·팀원 관리)   | P0       |
| F17 | HOME 프로젝트 현황 (진행 중 / 지난 프로젝트) + 프로젝트 종료                           | P0       |
| F18 | **할 일 목록** (`node_tasks`, AI 구체화로 생성 + 직접 관리)                            | P0       |
| F2  | 노드 캔버스 (생성/편집/이동/삭제, pan/zoom)                                            | P0       |
| F3  | 노드 상태 관리 (채택/고민중/버림 + 복구)                                               | P0       |
| F4  | 포커스 뷰 (후보 노드를 루트로 이어서 아이디에이션, 홈 복귀)                            | P0       |
| F5  | 과제 문서 업로드 → AI 요구사항 추출                                                    | P0       |
| F6  | AI 아이디어 생성 → 노드 생성                                                           | P0       |
| F7  | AI 피드백 말풍선 (노드별 / 전체 점검) — 요구사항 + 팀 실행 가능성 관점                 | P0       |
| F15 | **아이디어 구체화**: 팀원 경험 기반 조사 방법 + 구현 범위 + 실행 가능성 (`node_plans`) | P0       |
| F16 | **팀원 경험 카드** 입력 + 경험 온보딩                                                  | P0       |
| F8  | 드래그 앤 드롭 역할 분담, 담당자 색상 표시 (중복 담당 가능)                            | P0       |
| F9  | 실시간 동기화 (Realtime)                                                               | P1       |
| F10 | 신호등 + 시간 측정                                                                     | P1       |
| F11 | 작업 링크 모음 (종류별)                                                                | P1       |
| F12 | 나의 작업 (담당 노드 확인 + 내 할 일)                                                  | P1       |
| F13 | AI 역할 분담 추천 (경험 카드 + 활동 이력 + 업무량 기반)                                | P1       |
| F14 | 팀원 칭찬하기 = 좋아요 + 칭찬 온도                                                     | P2       |

### F2. 노드 캔버스 구현 방식

- **DOM 노드 + SVG 엣지** 방식 (Canvas API 대신). 노드는 클릭, 편집, 드래그를 처리하기 쉬운 `div`.
- 구조:
  ```html
  <div id="viewport">
    <!-- overflow:hidden, 이벤트 수신 -->
    <div id="world">
      <!-- transform: translate(x,y) scale(k) -->
      <svg id="edges"></svg>
      <!-- 부모-자식 곡선 path -->
      <div id="nodes"></div>
      <!-- .node { position:absolute; left:x; top:y } -->
      <div id="bubbles"></div>
      <!-- AI 말풍선 -->
    </div>
  </div>
  ```
- Pan: 빈 공간 드래그 또는 Space+드래그. Zoom: Ctrl/⌘+휠, 0.25~2.0, 커서 기준 확대.
- 노드 생성: 빈 곳 더블클릭(선택된 노드가 있으면 그 노드의 자식), 선택 노드에서 `Tab` = 자식 추가, `Enter` = 형제 추가.
- 노드 이동: pointer 이벤트로 드래그하고, `pointerup` 시 x, y를 저장(드래그 중에는 저장하지 않음).
- 렌더링: `store.nodes`가 바뀔 때마다 id 기준 keyed diff로 바뀐 노드만 DOM을 갱신한다.
- 좌표는 노드의 전역 좌표(`nodes.x`, `nodes.y`) 하나만 쓴다. 포커스 뷰에서는 보이는 노드만 걸러서 fit-to-view 한다.

### F3. 노드 상태 & 색상 규칙

**상태와 담당자는 서로 다른 시각 채널로 표현한다** (둘 다 색이면 헷갈림).

| 상태                        | 표현                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 고민중 `considering` (기본) | 흰 배경 + 노란 테두리 `--status-considering`                                                                     |
| 채택 `adopted`              | 연한 초록 배경 + 진한 초록 테두리 + ✓ 배지                                                                       |
| 버림 `discarded`            | 회색 배경, 투명도 0.45, 제목 취소선, 우상단 ✕ 아이콘. **삭제하지 않고 남김**, `복구` 버튼으로 이전 상태로 되돌림 |
| 후보 `is_candidate`         | 상태와 별개인 ⭐ 배지                                                                                            |
| AI 생성 `source='ai'`       | ✨ 작은 배지                                                                                                     |

- 담당자: 노드 하단에 **멤버 색 아바타 칩**(이니셜 원형)을 겹쳐 표시하고, 노드 왼쪽 4px 세로 띠를 담당자 색으로 분할한다(2명이면 반반).
- 툴바 필터: "버린 노드 숨기기" 토글(기본은 표시), 담당자별 하이라이트.
- 실제 삭제(Delete 키)는 확인 모달을 거치고, 하위 노드까지 함께 삭제됨을 알린다.

### F4. 포커스 뷰 (루트 전환)

- 홈 `#/home`: 프로젝트 root 노드(프로젝트 생성 시 자동으로 생성되는 주제 노드) 기준으로 전체 트리를 보여준다.
- 노드 1개 이상 선택 → `선택한 노드로 이어서 아이디에이션` → `#/focus/<id1>,<id2>`
  - 선택된 노드들이 **루트처럼** 화면 상단에 나란히 배치되고, 그 하위 트리만 보인다.
  - 조상 노드는 흐리게(옵션) 또는 숨김. 상단 breadcrumb로 경로를 표시한다.
  - 이 뷰에서 AI 생성/피드백을 하면 포커스 노드들이 컨텍스트의 중심이 된다.
- 🏠 홈 버튼, breadcrumb, 브라우저 뒤로가기로 복귀한다(hash 라우팅이라 히스토리가 자연스럽게 쌓임).
- 포커스 상태는 URL에만 있으므로 DB 테이블이 필요 없고, 링크를 공유하면 같은 뷰가 열린다.

### F8. 드래그 앤 드롭 역할 분담

- 캔버스 노드를 드래그하다가 커서가 오른쪽 패널의 팀원 헤더(`[data-drop-member=<userId>]`) 위에서 놓이면 담당자로 추가한다.
- 노드 이동과 같은 pointer 드래그를 쓰고, `pointerup` 때 `document.elementFromPoint`로 드롭 타겟을 판정한다. HTML5 DnD는 쓰지 않는다(캔버스 transform과 충돌).
- 드래그 중 패널 위로 가면 노드 고스트를 표시하고, 드롭이 되면 노드를 원래 위치로 되돌린다(이동하지 않음).
- 이미 담당자면 무시하고 토스트로 알린다. 해제는 Inspector의 칩 ✕로 한다.

### F10. 신호등 + 시간 측정

- 🟢 `green` 진행 중 / 🟡 `yellow` 쉬는 중 / 🔴 `red` 막힘·도움 필요 / ⚪ `off` 오프라인
- 상태를 바꾸면 `project_members.signal`을 갱신하고, DB 트리거가 `signal_logs`의 이전 구간을 닫고 새 구간을 연다.
- 누적 시간은 `signal_logs`의 `ended_at - started_at` 합(진행 중이면 now까지).
- 🔴로 바꾸면 팀원 패널에 강조 표시를 하고, 옵션으로 AI 도움 제안을 한다(ai.md 참고).
- 탭을 닫으면(`pagehide`) `off`로 바꾸려고 시도한다. 실패할 수 있으니 오래된 green은 화면에서 "자리 비움?"으로 보정한다.

### F15. 아이디어 구체화 (실행 계획)

노드 하나를 "우리 팀이 실제로 할 수 있는 형태"로 바꾼다. 결과는 노드당 1개인 `node_plans` 행에 저장한다.

| 항목        | 내용                                                                             | 예시                                                                   |
| ----------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 실행 가능성 | 1~5점 + 한 줄 근거                                                               | 4점 — "Figma 경험자 2명, 설문 분석 경험 1명"                           |
| 조사 방법   | 방법, 이유, 근거 경험(E*), 맡을 사람(M*)                                         | "대학생 30명 구글폼 설문 — E3 설문 분석 경험 활용"                     |
| 구현 범위   | `mvp`(반드시) / `stretch`(여유 있으면) / `out_of_scope`(이번엔 안 함, 이유 포함) | MVP: Figma 프로토타입 5화면 / 범위 밖: 실제 앱 개발 — 개발 경험자 없음 |
| 리스크      | 경험 공백과 대응책                                                               | "데이터 분석 경험 없음 → 엑셀 피벗으로 단순화"                         |

- 노드 카드에는 실행 가능성 점수 배지(●●●●○)만 작게 표시하고, 상세 내용은 Inspector의 실행 계획 탭에 둔다.
- 팀원이 계획을 직접 고치면 `edited_by_user=true`가 되고, AI 재구체화 전에 "수정 내용을 덮어쓸까요?"라고 확인한다.
- 경험 카드가 추가/수정되면 기존 계획에 "팀 경험이 바뀌었어요 — 다시 구체화" 표시를 띄운다(`node_plans.generated_at` < 가장 최근 경험 수정 시각).

### F16. 팀원 경험 카드

- 한 카드 = 경험 하나. 종류(`kind`): 프로젝트 / 조사·리서치 / 도구·기술 / 도메인 지식 / 역할(발표·문서 등)
- 필드: 제목, 상세(무엇을 했고 결과가 어땠는지), 숙련도(1 해봤음 / 2 혼자 할 수 있음 / 3 가르칠 수 있음), 태그
- 사용자 단위로 저장해서 여러 프로젝트에서 재사용한다. 같은 프로젝트 팀원에게만 공개된다(RLS).
- 서비스 안 활동(완료한 노드, 맡았던 역할)은 `activity_logs`에서 자동 집계해 "이 팀플에서 한 일"로 함께 AI에 보낸다.

### F14. 칭찬 온도 = 좋아요 (P2)

- 팀원 칭찬하기는 👍 **좋아요** 한 번으로 보낸다. 메시지·태그는 선택(`praises.message` NULL 허용).
- 기본 36.5℃. 좋아요 1회당 +0.3℃, 최대 99℃. `member_temperature` 뷰로 계산한다(별도 컬럼 없이).
- 같은 사람에게 하루 1회만 보낼 수 있다(DB unique 제약). 자기 자신에게는 보낼 수 없다.

### F17. 프로젝트 현황 · 종료

- HOME `#/home` 에서 진행 중 / 지난 프로젝트를 나눠 보여준다. 지난 = `projects.completed_at` 이 있거나 `due_date` < 오늘(KST).
- 팀장이 setting 에서 `프로젝트 종료` ↔ `다시 진행`. 종료해도 내용은 그대로 열람·수정할 수 있다.

### F18. 할 일 목록

- 노드별 `node_tasks`(content, done, assignee_id, source). Inspector `✅ 할 일 목록`에서 관리, 사이드바 나의 작업과 me.html 에 내 할 일로 모인다.
- `✨ AI로 만들기` = A8 `concretize_node`. 실행 계획과 함께 할 일 3~7개(+추천 담당 M\*)를 만든다. 다시 만들면 **끝나지 않은 AI 할 일만** 교체하고 완료했거나 사람이 쓴 할 일은 남긴다.

---

## 5. 프론트엔드 아키텍처

### 5.1 상태 관리 (`js/store.js`)

간단한 pub/sub 전역 store를 쓴다.

```js
// store.js
const state = {
  user: null,
  project: null,
  members: new Map(), // userId -> member(+profile, temperature)
  nodes: new Map(), // nodeId -> node
  assignees: new Map(), // nodeId -> Set<userId>  (+task_state)
  aiComments: new Map(), // nodeId -> comment[]
  requirements: [],
  links: [],
  selection: new Set(), // 선택된 nodeId
  focus: [], // 포커스 루트 nodeId[] (빈 배열 = 홈)
  view: { x: 0, y: 0, k: 1 },
  filters: { hideDiscarded: false, member: null },
};
const listeners = new Set();
export const getState = () => state;
export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((l) => l(state));
}
export const subscribe = (fn) => (
  listeners.add(fn),
  () => listeners.delete(fn)
);
```

- 렌더 함수는 `subscribe`로 등록하고 `requestAnimationFrame`으로 묶어서 한 프레임에 한 번만 그린다.
- 쓰기 흐름: UI 이벤트 → `api/*.js`(Supabase) → 낙관적 업데이트로 store 반영 → Realtime 이벤트로 최종 확정(본인이 보낸 변경은 id로 중복 무시).

### 5.2 Realtime

- 프로젝트 하나당 채널 하나를 쓰고, 테이블별 `postgres_changes`에 `filter: project_id=eq.<id>`를 건다.
- 대상: `nodes`, `node_assignees`, `ai_comments`, `project_members`(신호등), `links`, `praises`, `requirements`, `node_plans`, `node_tasks`, `member_experiences`
- 선택: Presence로 "지금 보고 있는 사람"과 다른 사람이 선택 중인 노드를 표시한다(P2).

### 5.3 AI 호출

```js
// api/ai.js
export async function runAI(action, payload) {
  const { data, error } = await supabase.functions.invoke('ai', {
    body: { action, projectId, ...payload },
  });
  if (error) throw error;
  return data; // 결과는 DB에도 저장되므로 Realtime으로 다른 팀원에게도 반영됨
}
```

호출 중에는 대상 노드에 로딩 스피너를 표시하고 같은 요청이 중복으로 가지 않게 막는다. 상세 내용은 [ai.md](ai.md)를 본다.

---

## 6. 코딩 컨벤션

- 들여쓰기 2칸, 세미콜론 사용, `const` 우선, 파일당 하나의 책임.
- DOM 생성은 `utils/dom.js`의 `h(tag, attrs, ...children)` 헬퍼를 쓴다. 사용자 입력은 **`innerHTML`에 넣지 않고 `textContent`로만** 넣는다(XSS 방지).
- CSS는 `tokens.css` 변수만 쓰고 색상을 하드코딩하지 않는다. 클래스는 BEM 스타일(`node`, `node__title`, `node--adopted`).
- DB 컬럼은 snake_case, JS 객체 필드도 Supabase 응답 그대로 snake_case로 유지한다(변환 계층 없음).
- 에러는 `api/*` 래퍼에서 잡아 토스트로 보여주고, 콘솔에는 원본을 남긴다.
- 사용자 대상 문구는 한국어로 쓴다.

## 7. 개발 순서 (로드맵)

1. **세팅**: Supabase 프로젝트 생성 → `database.md` SQL 실행 → `js/config.js` 작성 → 정적 서버 실행
2. **F1 / F16** 인증, 프로젝트 생성, 초대 참여, 경험 카드 온보딩 (`index.html`)
3. **F2/F3** 캔버스 + 노드 CRUD + 상태 (`app.html`) ← 가장 큰 작업
4. **F4** 포커스 뷰 + breadcrumb + 사이드바 트리
5. **F8** 오른쪽 패널 (Inspector / 팀원 목록) + 드래그 담당자 지정
6. **F5/F6/F7/F15** Edge Function `ai` 배포 → 문서 분석 → 아이디어 생성 → 아이디어 구체화(실행 계획) → 피드백 말풍선
7. **F9** Realtime
8. **F10/F11/F12** 신호등, 링크, 개인 페이지
9. **F13/F14** AI 역할 추천, 칭찬 온도

## 8. 로컬 실행 & 배포

```bash
# .env (gitignore): OPEN_API_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
node scripts/gen-config.mjs         # .env 공개값 → js/config.js (OpenAI 키는 옮기지 않음)
npx serve .                         # http://localhost:3000 — serve.json: cleanUrls 는 "/" 에만(전체로 켜면 app.html?project= 쿼리가 리다이렉트로 사라짐), 폴더 목록 끔, /.env 차단
                                    # /app·/me → app.html·me.html rewrite: 예전 301(app.html?project=X → /app)을 브라우저가 캐시한 경우 대비.
                                    # 이때 쿼리가 없으므로 utils/project.js 가 방금 연 프로젝트 id(sessionStorage)로 대체한다

# Supabase CLI
supabase link --project-ref <ref>
supabase db push                    # migrations 적용
supabase secrets set --env-file .env            # OPEN_API_KEY (코드는 OPENAI_API_KEY 도 받음)
supabase secrets set OPENAI_MODEL=<모델명>
supabase functions deploy ai --no-verify-jwt    # 함수가 직접 JWT + 멤버십 검증
```

- 프론트 배포는 정적 호스팅(GitHub Pages / Netlify / Vercel)으로 한다. 배포 도메인은 Supabase Auth의 Redirect URLs에 등록한다.
