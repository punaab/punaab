import { redirect } from "next/navigation";

export default async function CommunityEntryRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/archive/${id}`);
}
