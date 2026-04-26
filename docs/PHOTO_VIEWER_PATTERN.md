# 사진 크게보기 (PhotoViewer) — 성공 패턴 기록

> **작성일**: 2026-04-07
> **배경**: 동일 기능을 과거 1회 시도 → 그룹핑이 깨져 롤백한 적 있음
> **이번 결과**: TrackB 그룹 리뷰 + 현황탭 상세 모달 양쪽 정상 동작
> **커밋**: `1d09dd0` (롤백 시 `git revert 1d09dd0`)

---

## 과거 실패 원인 (추정)

| 추정 원인 | 증상 |
|----------|------|
| 기존 썸네일 `<div>`에 직접 onClick 핸들러 추가 | 이벤트 버블링 → 부모 그룹 카드 재렌더링 |
| 뷰어 state를 `groups`/`uploadedFiles`와 결합 | 상태 업데이트 충돌 → photoIndices 손상 |
| 그룹핑 로직(analyze-batch) 동시 수정 | 분석 결과 매핑 깨짐 |
| 모달 z-index 충돌 | 뷰어가 다른 오버레이에 가려짐 |

---

## 이번 성공 패턴

### 1. 독립 컴포넌트 (격리)
- **위치**: `src/components/photo-viewer.tsx` (기존 어떤 디렉토리에도 안 들어감)
- **장점**: 한 파일 = 한 책임. 문제 시 `git revert` 단일 커밋으로 즉시 제거
- **재사용**: TrackB와 Dashboard에서 동일 컴포넌트 사용

### 2. State 격리
```typescript
// TrackB
const [viewer, setViewer] = useState<{ groupIdx: number; photoIdx: number } | null>(null);

// Dashboard
const [viewerIdx, setViewerIdx] = useState<number | null>(null);
```
- `groups`, `uploadedFiles`, `photoIndices` 와 **독립**
- 뷰어 state 변경 → 그룹 데이터에 영향 0
- 그룹 데이터 변경 → 뷰어 자동 동기화 (props로만 전달)

### 3. 그룹핑 로직 미수정
- `analyze-batch/route.ts` 일체 손대지 않음
- 클라이언트 그룹핑 보정 로직 일체 손대지 않음
- 새 기능 추가 = 새 파일 생성 + 기존 파일에 **렌더링 호출만 추가**

### 4. 이벤트 버블링 차단
```tsx
<button onClick={() => setViewer({...})}>
  <img className="pointer-events-none" />
</button>
```
- `<button>`이 클릭 받음 → 명확한 단일 트리거
- 안쪽 `<img>`는 `pointer-events-none`으로 클릭 불가 → 이중 발화 방지

### 5. 컨트롤드 콜백 (단방향 데이터)
```typescript
addressInput={{
  value: groups[viewer.groupIdx].address,         // 읽기
  onChange: (v) => {                              // 쓰기 콜백
    const updated = [...groups];
    updated[viewer.groupIdx] = { ...updated[viewer.groupIdx], address: v };
    setGroups(updated);
  },
}}
```
- 뷰어는 **부모의 state를 직접 변경하지 않음**
- 부모가 콜백을 통해 자기 state를 갱신
- React 단방향 흐름 준수

### 6. Z-index 규율
- 다른 오버레이: `z-50`
- PhotoViewer: `z-[60]` (항상 위)
- 충돌 없음

### 7. 키보드 이벤트 정리
```typescript
useEffect(() => {
  function handleKey(e: KeyboardEvent) { /* ... */ }
  window.addEventListener("keydown", handleKey);
  return () => window.removeEventListener("keydown", handleKey);  // ★ 필수
}, [photos.length, onClose]);
```
- 컴포넌트 unmount 시 리스너 자동 제거 → 메모리/이벤트 누수 차단

### 8. 동적 photos 배열 (sync 자동)
```typescript
photos={groups[viewer.groupIdx].photoIndices
  .map((idx) => uploadedFiles[idx - 1]?.url)
  .filter(Boolean) as string[]}
```
- 매 렌더링마다 그룹의 현재 photoIndices에서 URL 추출
- 그룹이 변경되면(주소 수정 등) 자동으로 최신 사진 목록 반영
- 별도 동기화 코드 불필요

### 9. 조건부 렌더링 (좀비 방지)
```tsx
{viewer && groups[viewer.groupIdx] && (
  <PhotoViewer ... />
)}
```
- state 없으면 렌더링 자체 안 됨
- 이중 안전장치: `viewer` + `groups[viewer.groupIdx]` 둘 다 체크

### 10. 단일 커밋 원칙
- 새 컴포넌트 생성 + 호출 부위 추가 = **1 커밋**
- 1 커밋 안에 기존 로직 변경 0
- 롤백 시 `git revert <커밋>` 한 줄로 깔끔히 원복

---

## 적용 위치

| 위치 | 목적 | 추가 기능 |
|------|------|----------|
| **TrackB 그룹 리뷰** | 주소 정확성 확인 | 인라인 주소 편집 (caption + addressInput) |
| **현황탭 상세 모달** | 등록 사진 확대 보기 | caption만 (읽기 전용) |

---

## 향후 추가 시 체크리스트

1. ☐ 새 컴포넌트로 추가하는가? (기존 파일 수정 X)
2. ☐ State가 기존 데이터(groups/uploadedFiles 등)와 격리되어 있는가?
3. ☐ 그룹핑/분석 로직을 같이 수정하지 않는가?
4. ☐ 이벤트 버블링 차단 패턴(`<button>` + `pointer-events-none`)을 사용하는가?
5. ☐ 부모 state 변경은 콜백으로만 하는가?
6. ☐ z-index 충돌 가능성 검토했는가?
7. ☐ useEffect cleanup 작성했는가?
8. ☐ 단일 커밋으로 분리되어 있는가? (롤백 가능)
