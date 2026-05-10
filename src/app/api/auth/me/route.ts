import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  return NextResponse.json({ id: user.id, name: user.name, role: user.role, pool: user.pool });
}
