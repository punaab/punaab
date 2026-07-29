import { redirect } from "next/navigation";

export const metadata = {
  title: "Review · Punaab",
};

/** Legacy path — moderation lives at `/admin`. */
export default function WorldReviewPage() {
  redirect("/admin");
}
