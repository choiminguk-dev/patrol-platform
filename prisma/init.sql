-- patrol-platform 초기 스키마 (Prisma schema.prisma 기반)

CREATE TABLE IF NOT EXISTS "users" (
  "id"        TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "role"      TEXT NOT NULL,
  "pool"      TEXT,
  "pinHash"   TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "tenantId"  TEXT NOT NULL DEFAULT 'huam',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "patrol_entries" (
  "id"                TEXT PRIMARY KEY,
  "userId"            TEXT NOT NULL REFERENCES "users"("id"),
  "category"          TEXT NOT NULL,
  "evalItem"          TEXT,
  "evalPoints"        INTEGER,
  "latitude"          DOUBLE PRECISION,
  "longitude"         DOUBLE PRECISION,
  "address"           TEXT,
  "addressText"       TEXT,
  "memo"              TEXT,
  "quantity"          DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unit"              TEXT NOT NULL DEFAULT '건',
  "photoUrls"         TEXT[] DEFAULT '{}',
  "photoCount"        INTEGER NOT NULL DEFAULT 0,
  "inputTrack"        TEXT NOT NULL DEFAULT 'realtime',
  "batchId"           TEXT,
  "originalPhotoTime" TIMESTAMP(3),
  "entryDate"         DATE NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"          TEXT NOT NULL DEFAULT 'huam'
);

CREATE INDEX IF NOT EXISTS "patrol_entries_entryDate_idx" ON "patrol_entries"("entryDate");
CREATE INDEX IF NOT EXISTS "patrol_entries_userId_idx" ON "patrol_entries"("userId");
CREATE INDEX IF NOT EXISTS "patrol_entries_category_idx" ON "patrol_entries"("category");
CREATE INDEX IF NOT EXISTS "patrol_entries_tenantId_idx" ON "patrol_entries"("tenantId");

CREATE TABLE IF NOT EXISTS "complaints" (
  "id"          TEXT PRIMARY KEY,
  "title"       TEXT NOT NULL,
  "address"     TEXT,
  "latitude"    DOUBLE PRECISION,
  "longitude"   DOUBLE PRECISION,
  "assignedTo"  TEXT REFERENCES "users"("id"),
  "status"      TEXT NOT NULL DEFAULT 'pending',
  "entryId"     TEXT UNIQUE REFERENCES "patrol_entries"("id"),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "tenantId"    TEXT NOT NULL DEFAULT 'huam'
);

CREATE INDEX IF NOT EXISTS "complaints_status_idx" ON "complaints"("status");

CREATE TABLE IF NOT EXISTS "recycling_records" (
  "id"            TEXT PRIMARY KEY,
  "type"          TEXT NOT NULL,
  "quantity"      DOUBLE PRECISION NOT NULL,
  "unit"          TEXT NOT NULL,
  "certPhotoUrl"  TEXT,
  "entryId"       TEXT UNIQUE REFERENCES "patrol_entries"("id"),
  "recordMonth"   DATE NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"      TEXT NOT NULL DEFAULT 'huam'
);

CREATE TABLE IF NOT EXISTS "generated_docs" (
  "id"          TEXT PRIMARY KEY,
  "docType"     TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "content"     TEXT,
  "fileUrl"     TEXT,
  "periodStart" DATE,
  "periodEnd"   DATE,
  "metadata"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"    TEXT NOT NULL DEFAULT 'huam'
);

CREATE TABLE IF NOT EXISTS "sessions" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL REFERENCES "users"("id"),
  "token"     TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "sessions_token_idx" ON "sessions"("token");

-- ===== 상습지역 구역 (Phase A) =====
CREATE TABLE IF NOT EXISTS "patrol_zones" (
  "id"                 TEXT PRIMARY KEY,
  "tenantId"           TEXT NOT NULL DEFAULT 'huam',
  "seqNo"              INTEGER NOT NULL,        -- 담당자 부여 연번 (1, 2, 3...)
  "address"            TEXT NOT NULL,           -- 도로명 주소 (예: "두텁바위로47길 9-1")
  "landmark"           TEXT NOT NULL,           -- 장소 특징 (예: "드림캐슬무단투기민원건")
  "notes"              TEXT,                    -- 추가 설명 (AI 매칭 힌트)
  "referencePhotoUrls" TEXT[] DEFAULT '{}',     -- 학습 데이터 (피드백 누적)
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "patrol_zones_tenantId_idx" ON "patrol_zones"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "patrol_zones_tenantId_seqNo_key" ON "patrol_zones"("tenantId", "seqNo");

-- patrol_entries에 zoneId 컬럼 추가 (이미 있으면 무시)
ALTER TABLE "patrol_entries"
  ADD COLUMN IF NOT EXISTS "zoneId" TEXT REFERENCES "patrol_zones"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "patrol_entries_zoneId_idx" ON "patrol_entries"("zoneId");

-- ===== 카테고리별 zone 분리 (이면도로 청소 등) =====
ALTER TABLE "patrol_zones"
  ADD COLUMN IF NOT EXISTS "category" TEXT;
-- NULL = 모든 카테고리 (기존 6개 그대로 유지)
-- 'road_clean' = 이면도로 청소 전용
-- 'patrol_check' = 상습지역 순찰 전용

ALTER TABLE "patrol_zones"
  ADD COLUMN IF NOT EXISTS "discoveredFrom" TEXT;
-- 'manual' (기본) | 'auto' (자체 학습으로 발견된 zone)

CREATE INDEX IF NOT EXISTS "patrol_zones_category_idx" ON "patrol_zones"("category");

-- ===== 카테고리별 주소 빈도 자동 추적 (자체 학습 zone 발견용) =====
CREATE TABLE IF NOT EXISTS "category_address_stats" (
  "id"                 TEXT PRIMARY KEY,
  "tenantId"           TEXT NOT NULL DEFAULT 'huam',
  "category"           TEXT NOT NULL,           -- 'road_clean', 'patrol_check' 등
  "normalizedAddress"  TEXT NOT NULL,           -- 공백/특수문자 제거
  "displayAddress"     TEXT NOT NULL,           -- 표시용 원본 주소
  "frequency"          INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "promotedZoneId"     TEXT REFERENCES "patrol_zones"("id") ON DELETE SET NULL,
  "isDismissed"        BOOLEAN NOT NULL DEFAULT FALSE
);

-- 기존 DB 마이그레이션 (컬럼 누락 시 자동 추가)
ALTER TABLE "category_address_stats"
  ADD COLUMN IF NOT EXISTS "isDismissed" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS "category_address_stats_unique"
  ON "category_address_stats"("tenantId", "category", "normalizedAddress");
CREATE INDEX IF NOT EXISTS "category_address_stats_freq_idx"
  ON "category_address_stats"("tenantId", "category", "frequency" DESC);

-- ===== AI 주소 정정 학습 (사용자 수정 → 다음 분석 자동 반영) =====
CREATE TABLE IF NOT EXISTS "address_corrections" (
  "id"                TEXT PRIMARY KEY,
  "tenantId"          TEXT NOT NULL DEFAULT 'huam',
  "originalAddress"   TEXT NOT NULL,           -- AI 첫 제안
  "correctedAddress"  TEXT NOT NULL,           -- 사용자 정정 결과
  "frequency"         INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "address_corrections_unique"
  ON "address_corrections"("tenantId", "originalAddress", "correctedAddress");
CREATE INDEX IF NOT EXISTS "address_corrections_freq_idx"
  ON "address_corrections"("tenantId", "frequency" DESC);

-- ===== 수동 평가 실적 (과태료, 분리배출, 특수사업 등) =====
CREATE TABLE IF NOT EXISTS "manual_evals" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"    TEXT NOT NULL DEFAULT 'huam',
  "evalItem"    TEXT NOT NULL,           -- '과태료', '분리배출', '특수사업'
  "halfYear"    TEXT NOT NULL,           -- '2026-H1', '2026-H2'
  "manualCount" INTEGER NOT NULL DEFAULT 0,
  "note"        TEXT,                    -- 비고 (예: "계량증명서 1,500kg")
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "manual_evals_unique"
  ON "manual_evals"("tenantId", "evalItem", "halfYear");
