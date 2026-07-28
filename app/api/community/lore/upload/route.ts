import { put } from "@vercel/blob";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSupabaseUrl } from "@/lib/supabase/env";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const BUCKET = "lore-art";

async function uploadToSupabase(
  userId: string,
  file: File
): Promise<{ url: string } | { error: string; status: number }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { error: "Database unavailable for image uploads.", status: 503 };
  }

  // Public art bucket — create once if a fresh project has none yet.
  await supabase.storage.createBucket(BUCKET, { public: true }).then(
    () => undefined,
    () => undefined
  );

  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const path = `${userId}/${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    return { error: error.message || "Upload failed.", status: 500 };
  }

  const base = getSupabaseUrl().replace(/\/$/, "");
  const url = `${base}/storage/v1/object/public/${BUCKET}/${path}`;
  return { url };
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to upload art." }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing image file." }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Use JPEG, PNG, WebP, or GIF." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image must be 4MB or smaller." },
      { status: 400 }
    );
  }

  // Prefer Vercel Blob when configured; otherwise land in Supabase Storage so
  // art submissions are not blocked on a missing BLOB token.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const ext = file.type.split("/")[1] || "png";
    const pathname = `lore-art/${userId}/${Date.now()}.${ext}`;
    try {
      const blob = await put(pathname, file, {
        access: "public",
        contentType: file.type,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      return NextResponse.json({ url: blob.url });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Blob upload failed.";
      // Fall through to Supabase rather than failing the whole submission.
      console.warn("Blob upload failed, trying Supabase Storage:", message);
    }
  }

  const result = await uploadToSupabase(userId, file);
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }
  return NextResponse.json({ url: result.url });
}
