import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isLoreAdmin } from "@/lib/lore-admin";

export async function GET() {
  const { userId } = await auth();
  return NextResponse.json({ isAdmin: isLoreAdmin(userId) });
}
