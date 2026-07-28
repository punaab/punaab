/**
 * Canonical public origin for share links (referrals, embeds, downloads).
 * Never emit localhost here — invites should open the live site.
 */
export function getShareAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || "";
  if (raw && !isLocalHost(raw)) return raw;

  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim().replace(/\/$/, "") || "";
  if (vercel) {
    return vercel.startsWith("http") ? vercel : `https://${vercel}`;
  }

  return "https://punaab.com";
}

/** App origin for server redirects (Stripe, etc.). May be localhost in dev. */
export function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || "";
  if (raw) return raw;

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000";
  }

  return "https://punaab.com";
}

function isLocalHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return /localhost|127\.0\.0\.1/.test(url);
  }
}
