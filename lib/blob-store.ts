import { getBlobReadWriteToken } from "./config";

export class BlobStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobStoreError";
  }
}

function requireBlobToken(): string {
  const token = getBlobReadWriteToken();
  if (!token) {
    throw new BlobStoreError("BLOB_READ_WRITE_TOKEN is not configured");
  }
  return token;
}

/** Download a remote file and upload to Vercel Blob for permanent hosting. */
export async function uploadFromUrl(
  sourceUrl: string,
  pathname: string,
): Promise<{ url: string; pathname: string }> {
  const token = requireBlobToken();
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new BlobStoreError(
      `Failed to fetch ${sourceUrl}: HTTP ${response.status}`,
    );
  }

  const contentType =
    response.headers.get("content-type") ??
    (pathname.endsWith(".mp3") ? "audio/mpeg" : "application/octet-stream");
  const buffer = Buffer.from(await response.arrayBuffer());

  const { put } = await import("@vercel/blob");
  const blob = await put(pathname, buffer, {
    access: "public",
    token,
    contentType,
    addRandomSuffix: false,
  });

  return { url: blob.url, pathname: blob.pathname };
}

/** Upload raw bytes to Vercel Blob. */
export async function uploadBuffer(
  buffer: Buffer,
  pathname: string,
  contentType: string,
): Promise<{ url: string; pathname: string }> {
  const token = requireBlobToken();
  const { put } = await import("@vercel/blob");
  const blob = await put(pathname, buffer, {
    access: "public",
    token,
    contentType,
    addRandomSuffix: false,
  });
  return { url: blob.url, pathname: blob.pathname };
}
