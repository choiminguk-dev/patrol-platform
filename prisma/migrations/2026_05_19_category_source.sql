-- 2026-05-19 — categoryConfidence + categorySource 추가
-- B안: AI 자동 분류는 suggested 로 INSERT → 사용자 1클릭 확정(confirmed) 또는 인라인 편집(manual)
-- 16동 운영 정정 의지 60% 핵심 분기.
--
-- 적용 방법:
--   psql $DATABASE_URL -f prisma/migrations/2026_05_19_category_source.sql
-- 또는 init.sql 재실행 (idempotent — ALTER TABLE ... ADD COLUMN IF NOT EXISTS)

ALTER TABLE "patrol_entries"
  ADD COLUMN IF NOT EXISTS "categoryConfidence" DOUBLE PRECISION;

ALTER TABLE "patrol_entries"
  ADD COLUMN IF NOT EXISTS "categorySource" TEXT DEFAULT 'suggested';

CREATE INDEX IF NOT EXISTS "patrol_entries_categorySource_idx"
  ON "patrol_entries"("categorySource");

-- 기존 entry 는 source 미정 — 인라인 편집 시 'manual' 또는 'confirmed' 로 갱신됨.
-- 백필 NULL → 'confirmed' (사용자가 이미 확인한 것으로 간주) 권장:
-- UPDATE "patrol_entries" SET "categorySource" = 'confirmed' WHERE "categorySource" IS NULL;
