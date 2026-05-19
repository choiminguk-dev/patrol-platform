# 코어(patrol-platform) Phase 3 재머지 + NHN 배포 — 진행 일지

> 작성: 2026-05-20 KST
> 어제 핸드오프 [`CORE_PATROL_HANDOFF_2026-05-19.md`](./CORE_PATROL_HANDOFF_2026-05-19.md) 의 §1.3 → §2 → §8 전 과정 완료 기록.

---

## 1. 결과 (한 줄)

`f5df387` (Phase 3) + 세션 UX 보강 4 커밋 = `2d73a44` (PR #2) → NHN `patrol.ai.kr` production 배포 완료 (2026-05-20 00:42:36 KST).

---

## 2. 진행 타임라인

| 시각 (KST) | 단계 | 결과 |
|---|---|---|
| 22:35 | §1.3 환경 정리 | docker-compose `5433→5435`, `.env` POSTGRES_PASSWORD 주석 → 자체 라인 분리, postgres-1 on 5435, migration columns idempotent OK |
| 22:40 | §2 dev 검증 시작 | feat/dashboard-filter-dot 체크아웃, dev ready 972ms |
| 22:45~23:30 | 시각 검증 + bug fix | 아래 §3 발견 버그 5건 fix |
| 23:50 | 4 커밋 분할 + push | `2d592a3`/`ced0d92`/`dfbcb63`/`b50112e` → feat 브랜치 |
| 00:10 | PR #2 생성 + 머지 | `2d73a44` (PR #1 머지+revert 흔적 우회) |
| 00:42 | NHN 배포 | git pull / `prisma db execute` migration / prisma generate / build / restart |
| 00:43 | smoke + production DB 정리 | `/login` 200/385ms, `[AI]` memo 정리 + admin → 청소관리자 rename |

---

## 3. 세션 중 발견 + 수정 버그

### 3.1 분류 prefix 클릭 미적용 (commit `ced0d92`)

**증상**: "가로" 입력 → "→ 가로등" 미리보기 보이지만 클릭해도 적용 안 됨. 끝까지 수동 입력 필요.

**원인**: 미리보기가 `<span>` (장식 텍스트, 클릭 핸들러 없음).

**fix**: `<button>` 으로 교체. `onClick={() => commitCategory(e.id, resolved.id, e.category)}`.

### 3.2 메모에 AI reasoning 누설 (commit `ced0d92` + `dfbcb63`)

**증상**: 카드 메모에 `[AI] 사진 3·4는 야간 주택가 골목... address 빈 문자열.` 같은 개발자 메모가 보임.

**원인 2가지**:
1. `track-b.tsx:574` 가 submit 시 `memo = ${g.memo}\n[AI] ${g.aiReasoning}` 로 concat.
2. AI prompt 가 "address는 빈 문자열로 두세요" 같은 코드 용어 사용 → reasoning 에 그대로 echo.

**fix**:
- `track-b.tsx`: `memo = g.memo` 만 송신 (concat 제거).
- `analyze-batch/route.ts` prompt: `주소를 비워두세요` + reasoning 지시문에 "코드 용어 금지, 사용자 언어 사용" 명시.
- DB cleanup: 기존 entry 의 `\n[AI] ...` suffix 정리 SQL.

### 3.3 SAFETY 사용자 bulk 삭제 불가 (commit `ced0d92`)

**증상**: 16동 사용자 = 안전관리자(SAFETY), `삭제` 버튼 미노출.

**원인**: dashboard `me?.role === "ADMIN"` UI 가드. 실제 `bulk-delete` API 는 비-ADMIN ownership 으로 필터.

**fix**: UI 가드 제거. API 가 이미 안전한 ownership 필터 적용.

### 3.4 전체선택 위치 + emerald 톤 (commit `ced0d92`)

**vigil `3838121` 포팅**: 전체선택 버튼을 하단 → 선택 모드 행 맨 앞 emerald 외곽선 칩. 선택 카드 외곽선 `border-blue-500 ring-blue-200` → `border-emerald-500 ring-emerald-200`. 선택 체크 칩 `bg-blue-600` → `bg-emerald-600`. 사이트 톤 일관.

### 3.5 reverseGeocode 폴백 + AI reasoning 모순 (commit `dfbcb63`)

**증상**: AI 가 "파란 주소판이 보이지 않아 주소를 비워둠" 라고 reasoning 작성, 하지만 실제 주소는 `후암동 (후암로 47)` 로 채워져 있음. 사용자 혼란.

**원인**: client-side `/api/geocode?lat=...&lng=...` 가 분석 후 enrich 단계에서 주소 채우지만 reasoning 은 그대로.

**fix**: `track-b.tsx` enrich 블록에서 reverseGeocode 성공 시 `aiReasoning` 에 `\n→ 위치 정보(좌표)로 주소 자동 보강: <주소>` append. 두 사실이 한 화면에 모순 없이 표시.

### 3.6 구역 탭 첫 화면 + 기간 chip (commit `b50112e`)

**요청**: 구역 탭 진입 시 첫 화면을 구역 지도 → 전체 지도(일자별 entry). 기간 빠른선택 chip (오늘/일주일/한달).

**fix**: `zones/page.tsx` view 기본값 `"map"` → `"daily"`. 날짜 input 앞에 emerald chip 3개 (KST 기준 N일 전 ~ 오늘 자동 세팅). 활성 chip 은 fill, 나머지는 outline.

### 3.7 청소담당 로그인 카드 (commit `ced0d92`)

**증상**: 로그인 페이지에 안전관리자 1명만 노출.

**원인**: `login/page.tsx:23` `ALLOWED_IDS = ["me", "safety"]` — admin 미포함.

**fix**: `["me", "safety", "admin"]` 로 확장 + DB `users.name = "청소관리자"` (안전관리자 대칭). 라벨 매핑 `ADMIN → 청소담당` 은 기존 코드 그대로.

### 3.8 "추천" 라벨 모호 (post-deploy, uncommitted)

**증상**: 분류 카드 옆 `추천` amber span 의 의미를 사용자가 못 알아챔. 옆에 `✓ 확정` 버튼이 이미 같은 의미 (suggested 상태) 전달.

**fix**: dashboard L1088-1092 의 `<span>추천</span>` 제거. `✓ 확정` 버튼 단독으로 의미 충분.

### 3.9 "🤖 AI 병합" 버튼 미사용 (post-deploy, uncommitted)

**증상**: 현황탭 상단 보라색 `🤖 AI 병합` 버튼. 사용자가 안 씀 (수동 통합으로 대체된 흐름).

**fix**: dashboard L806-814 버튼 + L446-465 `autoMergeDate` 함수 dead-code 제거. `/api/entries/auto-merge` endpoint 자체는 보존 (별도 호출 가능).

---

## 4. NHN 배포 결과

| 항목 | 값 |
|---|---|
| Host | `patrol.ai.kr` / `133.186.218.27` / `patrol-server` |
| Key | `~/OneDrive/Desktop/patrol-key/patrol-key.pem` (User `ubuntu`) |
| HEAD | `2d73a44` (PR #2 머지) |
| systemd | `patrol.service` active running since 00:42:36 KST |
| Next.js | `next-server v16.2.6` (production audit fix 보존, npm ci 건너뜀) |
| Memory | 91.5M cold, peak 91.8M |
| Smoke | `https://patrol.ai.kr/login` HTTP 200 / 385ms |
| DB | external (외부 DB, docker postgres 미사용). 마이그레이션 = `npx prisma db execute --file ...` |
| DB cleanup | `\n[AI]` memo suffix 정리 + admin → 청소관리자 rename 적용 |

---

## 5. 검증 체크리스트 (production 16동 시나리오)

`https://patrol.ai.kr/login` 접속 →

- [ ] **로그인** — 안전관리자/안전담당 + 청소관리자/청소담당 2장 카드
- [ ] **새 batch 업로드** — AI 판단근거 펼침에 "→ 위치 정보(좌표)로 주소 자동 보강" 한 줄 추가, 메모는 description 만
- [ ] **분류 인라인** — "가로" 입력 → "→ 가로등" 칩 클릭 즉시 적용
- [ ] **현황탭 선택 행** — 전체선택 emerald 외곽선 chip 맨앞 + 1건 삭제 (SAFETY 본인 entry)
- [ ] **구역 탭** — 첫 진입 = 전체 지도 + 기간 chip (오늘 default, 일주일/한달 토글)

§3.8 (추천 라벨 제거) 는 다음 배포에서 반영.

---

## 6. 잔여 트랙

### 6.1 Phase 4 — 사진 이동/통합 (다음 세션 예상)

vigil 5 commit 포팅 (`ecea6d1 + b3e65ee + f9c9bc4 + 47986ad + 9984d0f`). anon-patterns 의존 부분 (Phase B/D 시드 + reject 엔드포인트) 제거 필수.

상세: 어제 핸드오프 §3.

### 6.2 의존성 (별도 트랙, 어제 핸드오프 §7)

- `anthropic-ai/sdk` 0.82 → 0.96 (major migration)
- `next` + `postcss` moderate 3건
- ⚠️ `npm audit fix --force` 영구 금지 (Next.js 9.3.3 다운그레이드 함정)

### 6.3 §3.8 추천 라벨 제거

이 문서 작성 후 uncommitted. 다음 push 시 함께.

---

## 7. 메모리 갱신 후보

- production host = `patrol.ai.kr / 133.186.218.27` (`vigil-dev` 와 별개), key = `patrol-key/patrol-key.pem`
- production DB = 외부 (docker postgres 없음). 마이그레이션은 `npx prisma db execute --file ...`
- production gh CLI 인증은 `smartGovAuto` 계정이라 `choiminguk-dev/patrol-platform` PR 생성 불가 — 웹 PR 또는 로컬 머지 우회 필요
