/**
 * Lore hall moderators — Clerk user IDs from LORE_ADMIN_CLERK_IDS
 * (comma-separated).
 */
export function getLoreAdminIds(): string[] {
  const raw = process.env.LORE_ADMIN_CLERK_IDS || "";
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isLoreAdmin(clerkUserId: string | null | undefined): boolean {
  if (!clerkUserId) return false;
  return getLoreAdminIds().includes(clerkUserId);
}
