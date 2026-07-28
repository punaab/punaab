import { PunaabEmbed } from "@/components/embed/PunaabEmbed";

/**
 * The page that loads inside a customer's iframe.
 *
 * Deliberately bare: no site header, no footer, no marketing. It is rendered
 * inside someone else's design and must not bring its own.
 */

export const metadata = {
  title: "Punaab",
  // This page only ever appears in an iframe on someone else's site; it should
  // never turn up in search results in its own right.
  robots: { index: false, follow: false },
};

export default async function EmbedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="punaab-embed-root">
      <PunaabEmbed token={token} surface="web" />
    </div>
  );
}
