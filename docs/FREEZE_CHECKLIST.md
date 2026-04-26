# v1.0 Freeze Checklist

> 이 저장소(`patrol-platform`)를 v1.0으로 고정할 때 사용하는 체크리스트.
> 고정 시점은 **보안성 검토 완료 후**. 이후 main 브랜치 정책은 **버그 수정·보안 패치만** 수용.

---

## 1. v1.0 Core 기능 인벤토리

v1.0에 포함되는 기능 목록. 이후 변경은 버그 수정·보안 패치만 허용.

### 사진 처리
- 사진 일괄 업로드 + Canvas 압축 (`src/lib/image-utils.ts`)
- EXIF 추출 (`extractExif`)
- 얼굴 감지·온디바이스 블러 + 서버 합성 (`src/lib/face-detect-client.ts`, `src/app/api/uploads/route.ts`)
- 청크 업로드 (10장 단위, `uploadPreparedPhotos`/`uploadPhotosChunked`)

### AI
- 주소판 OCR + 사진 그룹핑 (`src/app/api/analyze-batch/route.ts`)
- 카테고리 자동 분류 (`src/app/api/classify/route.ts`)
- 주소 추출·정정 (`src/app/api/extract-address/route.ts`, `src/lib/address-sign-detect.ts`)
- GPS 역지오코딩 (`src/app/api/geocode/route.ts`, `src/lib/geocode.ts`)

### 자체 학습 (Phase C)
- 구역별 참고사진 누적 (`patrol_zones.referencePhotoUrls`)
- 카테고리-주소 빈도 누적 (`category_address_stats`)
- 사용자 주소 정정 학습 (`address_corrections`)

### 입력·리뷰
- Track A 실시간 촬영·등록 (`src/app/admin/entry/track-a.tsx`)
- Track B 일괄 업로드·그룹 리뷰 (`src/app/admin/entry/track-b.tsx`)
- 블러 미리보기 + 사용자 확인 (`preparePhotos`)
- 그룹 병합/분할/구역 분배 (`redistribute-modal.tsx`, `split-group-modal.tsx`)

### 대시보드·관리
- 단일 동 대시보드 (`src/app/admin/dashboard/page.tsx`) — 순찰 내역·반기 평가 진척도 탭 전환
- 일자별 입력 조회·이동·삭제 (`src/app/api/entries/by-date/`, `bulk-delete/`)
- 평가 진척도 100점 + 수동 입력 (`src/app/api/stats/`, `eval-manual/`)
- 민원 관리 (`src/app/api/complaints/`, `src/app/admin/complaints/`)
- 지도 히트맵 (`src/app/admin/map/`, `src/app/api/map-data/`)
- 구역 관리 (`src/app/admin/zones/`, `src/app/api/zones/`)
  - 카테고리별 탭(전체·상습지역·이면도로·기타 관리 허브)
  - 구역/후보 상세 모달 — 참고 사진 그리드·등록 이력 확인
  - 참고 사진 개별 삭제·추가 (동 단위 자가 QC)
  - 자체 학습 후보 구역 발견·승격·무시 (`category_address_stats`)

### 문서 생성
- 4종 공문 자동 생성 (`src/lib/doc-generator.ts`): 동 현장 점검 일지 / 일일 순찰일지 / 주간 순찰보고 / 실적 종합보고
- 구조화 다운로드 (일지용 ZIP, `src/app/api/entries/download-photos/`)
- CSV 내보내기 (`src/app/api/entries/csv/`)

### 인프라
- PIN + HttpOnly 쿠키 세션 (`src/lib/auth.ts`)
- NHN Cloud CSAP 배포 (`Dockerfile`, `docker-compose.yml`)
- Caddy HTTPS reverse proxy
- PWA manifest (`src/app/manifest.ts`)

---

## 2. v1.0 태그 당일 체크리스트

- [ ] 보안성 검토 문서 접수 확인
- [ ] `main` 브랜치 CI 통과 (lint / `npx tsc --noEmit` / `npm run build`)
- [ ] `CHANGELOG.md` `[1.0.0]` 항목 확정 (Unreleased에서 이동)
- [ ] `package.json` version `1.0.0`
- [ ] `docs/NHN_DEPLOY_PROGRESS.md`에 freeze 시점·커밋 해시 기록
- [ ] `git tag -a v1.0.0 -m "v1.0 — 보안성 검토 완료 후 Core 확정"`
- [ ] `git push origin v1.0.0`
- [ ] GitHub Release 노트 작성 (CHANGELOG 내용 복사)
- [ ] 서버 재배포: `cd ~/patrol-platform && git pull origin main && npm run build && sudo systemctl restart patrol`

---

## 3. v1.0 Core에 포함하지 않는 기능

아래 기능들은 단일 동 자가 운영에 필수적이지 않거나, 운영 데이터가 충분히 누적된 뒤에 설계·구현이 가능한 항목입니다. 본 저장소 v1.0에는 포함하지 않습니다.

- 여러 동의 데이터를 합쳐 관측하는 통합 대시보드
- 입력 데이터 이상치 자동 탐지·알림
- 변경 감사 로그 (누가 언제 무엇을 수정했는지)
- 일괄 작업 도구 (여러 구역을 한 번에 처리)
- 월간 정합성 리포트 자동 생성
- 역할 세분화 (읽기·쓰기·감사 권한 분리)
- 외부 시스템 연동 및 서비스 가용성 모니터링
- 카메라앱 네이티브 연동

**Core 설계 원칙**
- 단일 동 자가 완결 기능에 집중
- MIT 오픈소스 공개 유지

---

## 4. Freeze 이후 main 정책

**허용**
- 보안 취약점 패치
- 버그 수정 (기존 기능의 오동작)
- 의존성 업데이트 (보안/호환성 이유)
- 문서 업데이트

**금지**
- 신규 기능 추가 (→ 다음 메이저 버전 논의)
- 기존 기능의 동작 변경 (버그 수정 범위 초과)
- 스키마 breaking change

핫픽스 발생 시 `v1.0.x` 패치 태그 추가.
