import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin-constants";
import { verifySessionTokenEdge } from "@/lib/admin-session-edge";

const PUBLIC_PATHS = [
  "/login",
  "/apps",
  "/api/agent",
  "/api/admin/login",
  "/api/cron",
  "/api/telegram",
  "/api/webhooks",
  "/punaab-avatar.png",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  const valid = await verifySessionTokenEdge(
    token,
    process.env.ADMIN_SESSION_SECRET,
  );

  if (valid) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/", "/api/admin/:path*"],
};
