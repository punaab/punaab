import { redirect } from "next/navigation";

/** Legacy login URL — owner dashboard moved to /admin */
export default function LegacyLoginRedirect() {
  redirect("/admin/login");
}
