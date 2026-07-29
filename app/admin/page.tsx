import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { AdminPanel } from "@/components/admin/AdminPanel";
import { isLoreAdmin } from "@/lib/lore-admin";

export const metadata = {
  title: "Admin · Punaab",
  description: "Approve Archive submissions and staged edits.",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId || !(await isLoreAdmin(userId))) notFound();

  return (
    <MarketingShell>
      <AdminPanel />
    </MarketingShell>
  );
}
