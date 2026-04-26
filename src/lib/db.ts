import { Pool, types } from "pg";

// DATE(1082), TIMESTAMP(1114), TIMESTAMPTZ(1184)를 문자열로 반환 — 시간대 변환 방지
types.setTypeParser(1082, (val) => val);            // DATE → 'YYYY-MM-DD'
types.setTypeParser(1114, (val) => val);             // TIMESTAMP → 원본 문자열
types.setTypeParser(1184, (val) => val);             // TIMESTAMPTZ → 원본 문자열

// 타입 정의 (schema.prisma 기반)
export interface User {
  id: string;
  name: string;
  role: string;
  pool: string | null;
  pinHash: string | null;
  isActive: boolean;
  tenantId: string;
  createdAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface PatrolEntry {
  id: string;
  userId: string;
  category: string;
  evalItem: string | null;
  evalPoints: number | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  addressText: string | null;
  memo: string | null;
  quantity: number;
  unit: string;
  photoUrls: string[];
  photoCount: number;
  inputTrack: string;
  batchId: string | null;
  originalPhotoTime: Date | null;
  entryDate: Date;
  createdAt: Date;
  tenantId: string;
}

export interface Complaint {
  id: string;
  title: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  assignedTo: string | null;
  status: string;
  entryId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  tenantId: string;
}

export interface RecyclingRecord {
  id: string;
  type: string;
  quantity: number;
  unit: string;
  certPhotoUrl: string | null;
  entryId: string | null;
  recordMonth: Date;
  createdAt: Date;
  tenantId: string;
}

export interface GeneratedDoc {
  id: string;
  docType: string;
  title: string;
  content: string | null;
  fileUrl: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  tenantId: string;
}

const globalForDb = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Docker PostgreSQL은 UTC — 한국 시간으로 세션 설정
    options: "-c timezone=Asia/Seoul",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}

/** 단일 행 조회 */
export async function queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
  const { rows } = await pool.query(sql, params);
  return (rows[0] as T) ?? null;
}

/** 다중 행 조회 */
export async function queryMany<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

/** INSERT/UPDATE/DELETE — 영향받은 행 수 반환 */
export async function execute(sql: string, params?: unknown[]): Promise<number> {
  const { rowCount } = await pool.query(sql, params);
  return rowCount ?? 0;
}
