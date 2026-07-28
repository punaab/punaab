import { NextResponse } from "next/server";
import { existsSync } from "fs";
import path from "path";
import { getShareAppUrl } from "@/lib/app-url";

export async function GET() {
  const zipPath = path.join(
    process.cwd(),
    "public",
    "downloads",
    "punaab-godot-0.1.0.zip"
  );

  if (!existsSync(zipPath)) {
    return NextResponse.json(
      {
        error: "Plugin zip not built yet. Run: node scripts/pack-godot-plugin.js",
        version: "0.1.0",
        engine: "godot",
      },
      { status: 404 }
    );
  }

  // Prefer static file for browsers
  return NextResponse.redirect(
    new URL("/downloads/punaab-godot-0.1.0.zip", getShareAppUrl())
  );
}
