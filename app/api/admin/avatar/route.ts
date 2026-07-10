import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { isAdminAuthenticatedFromCookies } from "@/lib/admin-auth";
import { getMoltbookApiKey, getMoltbookBaseUrl } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Upload public/punaab-avatar.png to Moltbook as u/punaab's avatar. */
export async function POST() {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = getMoltbookApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "MOLTBOOK_API_KEY missing" }, { status: 500 });
  }

  const filePath = join(process.cwd(), "public", "punaab-avatar.png");
  const bytes = readFileSync(filePath);
  if (bytes.length > 500 * 1024) {
    return NextResponse.json(
      { error: `Avatar too large (${bytes.length} bytes). Max 500KB.` },
      { status: 400 },
    );
  }

  // File may be JPEG bytes saved as .png — sniff magic
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const mime = isJpeg ? "image/jpeg" : "image/png";
  const filename = isJpeg ? "punaab-avatar.jpg" : "punaab-avatar.png";

  const base = getMoltbookBaseUrl().replace(/\/$/, "");
  const endpoints = ["/agents/me/avatar", "/agents/avatar"];
  const errors: string[] = [];

  for (const path of endpoints) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), filename);

    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; PunaabBot/1.0; +https://www.punaab.com)",
        },
        body: form,
      });
      const text = await res.text();
      if (res.ok) {
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        return NextResponse.json({
          ok: true,
          endpoint: path,
          response: parsed,
          bytes: bytes.length,
          publicUrl: "https://www.punaab.com/punaab-avatar.png",
        });
      }
      errors.push(`${path}: ${res.status} ${text.slice(0, 200)}`);
    } catch (error) {
      errors.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: "Moltbook avatar upload failed",
      errors,
      hint: "If CloudFront returns 403, open https://www.moltbook.com/login as owner and upload the avatar manually from public/punaab-avatar.png",
      publicUrl: "https://www.punaab.com/punaab-avatar.png",
      bytes: bytes.length,
    },
    { status: 502 },
  );
}
