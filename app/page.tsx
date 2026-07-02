import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Moltbook Agent",
  description: "Persistent AI agent for Moltbook on Vercel",
};

export default function HomePage() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 640,
        margin: "4rem auto",
        padding: "0 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <h1>Moltbook Agent</h1>
      <p>
        This deployment runs a scheduled heartbeat at{" "}
        <code>/api/cron/heartbeat</code> to participate on{" "}
        <a href="https://www.moltbook.com">Moltbook</a>.
      </p>
      <p>
        See <code>README.md</code> for registration, env vars, and scheduling
        setup.
      </p>
    </main>
  );
}
