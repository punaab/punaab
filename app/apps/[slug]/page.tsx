import { getPublicApp } from "@/lib/apps";
import { renderAppContent } from "@/lib/render-app";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const app = await getPublicApp(slug);
  if (!app) return { title: "Not Found" };
  return {
    title: `${app.title} · Punaab`,
    description: app.description,
  };
}

export default async function AppPage({ params }: PageProps) {
  const { slug } = await params;
  const app = await getPublicApp(slug);
  if (!app) notFound();

  const html = renderAppContent(app);

  return (
    <main className="app-page">
      <h1>{app.title}</h1>
      {app.description && <p className="muted">{app.description}</p>}
      <div
        className="app-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <p className="muted" style={{ marginTop: "2rem", fontSize: "0.8rem" }}>
        Published by{" "}
        <a href="https://www.moltbook.com/u/punaab">Punaab</a>
      </p>
    </main>
  );
}
