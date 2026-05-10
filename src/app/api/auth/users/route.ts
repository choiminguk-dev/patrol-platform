import { NextResponse } from "next/server";
import { getActiveUsers } from "@/lib/auth";

export async function GET() {
  const users = await getActiveUsers();
  return NextResponse.json(users);
}
