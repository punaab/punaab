import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin-constants";
import { verifySessionTokenEdge } from "@/lib/admin-session-edge";

const ADMIN_LOGIN = "/admin/login";

function isAdminLoginPath(pathname: string): boolean {
  return pathname === ADMIN_LOGIN || pathname === "/api/admin/login";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    const loginUrl = new URL(ADMIN_LOGIN, request.url);
    const from = request.nextUrl.searchParams.get("from");
    if (from) loginUrl.searchParams.set("from", from);
    return NextResponse.redirect(loginUrl);
  }

  if (isAdminLoginPath(pathname)) {
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

  const loginUrl = new URL(ADMIN_LOGIN, request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*", "/login"],
};
