import { currentUser } from "@clerk/nextjs/server";

/**
 * Sole site admin — Archive approvals, `/admin`, and review APIs.
 * Matched against any verified Clerk email on the signed-in account.
 */
export const SITE_ADMIN_EMAIL = "notbitcoinceo@gmail.com";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isSiteAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return normalizeEmail(email) === SITE_ADMIN_EMAIL;
}

/**
 * True when the signed-in Clerk user owns the admin email.
 * Ignores Clerk user id lists — access is email-only.
 */
export async function isLoreAdmin(
  _clerkUserId?: string | null
): Promise<boolean> {
  const user = await currentUser();
  if (!user) return false;

  const emails = [
    user.primaryEmailAddress?.emailAddress,
    ...user.emailAddresses.map((entry) => entry.emailAddress),
  ];

  return emails.some(isSiteAdminEmail);
}
