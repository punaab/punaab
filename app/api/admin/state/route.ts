import { getOwnerDashboard } from "@/lib/owner-dashboard";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const dashboard = await getOwnerDashboard();
  return NextResponse.json(dashboard);
}
