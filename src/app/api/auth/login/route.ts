import { NextResponse } from "next/server";
import { login } from "@/lib/auth";

export async function POST(request: Request) {
  const { userId, pin } = await request.json();

  if (!userId || !pin) {
    return NextResponse.json({ error: "사용자와 PIN을 입력하세요" }, { status: 400 });
  }

  const user = await login(userId, pin);
  if (!user) {
    return NextResponse.json({ error: "PIN이 올바르지 않습니다" }, { status: 401 });
  }

  return NextResponse.json({
    id: user.id,
    name: user.name,
    role: user.role,
    pool: user.pool,
  });
}
