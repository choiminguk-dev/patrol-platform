import { cookies } from "next/headers";
import { compareSync } from "bcryptjs";
import { queryOne, queryMany, execute, type User, type Session } from "./db";

const SESSION_COOKIE = "patrol-session";
const SESSION_EXPIRY_DAYS = 7;

/** PIN 검증 후 세션 생성, 쿠키에 토큰 저장 */
export async function login(userId: string, pin: string): Promise<User | null> {
  const user = await queryOne<User>(
    'SELECT * FROM users WHERE id = $1 AND "isActive" = true',
    [userId]
  );
  if (!user || !user.pinHash) return null;
  if (!compareSync(pin, user.pinHash)) return null;

  // 세션 생성
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await execute(
    `INSERT INTO sessions (id, "userId", token, "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [crypto.randomUUID(), userId, token, expiresAt]
  );

  // HttpOnly 쿠키 설정
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return user;
}

/** 현재 세션에서 사용자 조회 */
export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<Session & User>(
    `SELECT u.*, s."expiresAt" as "sessionExpires"
     FROM sessions s
     JOIN users u ON u.id = s."userId"
     WHERE s.token = $1 AND s."expiresAt" > NOW()`,
    [token]
  );

  return row ?? null;
}

/** 세션 토큰으로 사용자 조회 (proxy용 — cookies() 사용 불가) */
export async function getUserByToken(token: string): Promise<User | null> {
  return queryOne<User>(
    `SELECT u.*
     FROM sessions s
     JOIN users u ON u.id = s."userId"
     WHERE s.token = $1 AND s."expiresAt" > NOW()`,
    [token]
  );
}

/** 로그아웃 — 세션 삭제 + 쿠키 제거 */
export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await execute("DELETE FROM sessions WHERE token = $1", [token]);
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** 사용자 목록 (로그인 화면용) */
export async function getActiveUsers(): Promise<Pick<User, "id" | "name" | "role" | "pool">[]> {
  return queryMany(
    'SELECT id, name, role, pool FROM users WHERE "isActive" = true ORDER BY id'
  );
}
