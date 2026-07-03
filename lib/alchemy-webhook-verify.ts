import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify Alchemy Notify webhook signature (X-Alchemy-Signature).
 * @see https://www.alchemy.com/docs/reference/notify-api-quickstart
 */
export function isValidAlchemyWebhookSignature(
  rawBody: string,
  signature: string | null,
  signingKey: string,
): boolean {
  if (!signature || !signingKey) return false;
  const digest = createHmac("sha256", signingKey).update(rawBody, "utf8").digest("hex");
  try {
    const a = Buffer.from(digest, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return digest === signature;
  }
}
