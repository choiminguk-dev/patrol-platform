# Changelog

이 저장소의 주요 변경사항을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)을 따릅니다.

## [Unreleased]

### Added
- 일괄 입력(Track B) 등록 시각을 사진 EXIF `DateTimeOriginal` 기준으로 반영 (8bf17a6)
- `docs/FREEZE_CHECKLIST.md`: v1.0 태그 당일 체크리스트 + Core 기능 인벤토리
- `CHANGELOG.md`: 변경 이력 문서

### Changed
- 보고서 4종 참여인원 표기를 "동장 이하 직원"으로 통일 (8bf17a6, 04e9c20)
- `docs/STRATEGY.md` 범위 축소: 공개 가능한 포지셔닝·보안·배포 방식만 유지
- 그룹핑 리뷰 화면에서 블러 처리된 사진을 표시 (32f55ff)
- AI 그룹핑 CHUNK_SIZE 10 복원 — 최적 분할 정확도 (4cb82a5)
- 연속 주소판 병합 시 마지막 주소판 우선 (e827620)
- 얼굴 블러 강도 상향 — 등록 전 preview와 저장본 동일 (9ad35db)

### Fixed
- 업로드 무반응 버그 — `FileList` 클리어 레이스 수정 (65ece91)
- `face-api` import 제거 — CDN 로드로 인한 업로드 hang 근본 원인 제거 (007a53e)
- 압축·썸네일 생성에 15~20초 타임아웃 추가 (987e46d)
- 그룹핑 후처리: 크로스-청크 병합 제거로 다른 방문이 합쳐지던 오류 해결 (6353032)
- 3번째 청크 에러 방어 + 인접 같은 zone 병합 (bb3b00f)

## 태그 정책

- `v1.0.0` 이후 main 브랜치는 버그 수정·보안 패치만 수용합니다.
- 신규 기능은 별도 메이저 버전으로 논의합니다.
- 자세한 내용: [`docs/FREEZE_CHECKLIST.md`](docs/FREEZE_CHECKLIST.md)

[Unreleased]: https://github.com/choiminguk-dev/patrol-platform/compare/main...HEAD
