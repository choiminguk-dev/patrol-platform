import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const token = request.cookies.get("patrol-session")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // /admin 하위만 인증 체크
    "/admin/:path*",
    // API 중 auth 제외
    "/api/((?!auth).*)",
  ],
};
