import { NextResponse } from "next/server";
import { isLoreAdmin } from "@/lib/lore-admin";

export async function GET() {
  return NextResponse.json({ isAdmin: await isLoreAdmin() });
}
