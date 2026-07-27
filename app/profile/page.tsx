import { currentUser } from "@clerk/nextjs/server";
import { PlaceShell } from "@/components/PlaceShell";
import { LOCALE_LABELS, LOCALES } from "@/lib/i18n";
import { PROFESSIONS } from "@/lib/locations";
import { ProfileSettingsForm } from "@/components/ProfileSettingsForm";

export default async function ProfilePage() {
  const user = await currentUser();
  const displayName =
    user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || "Traveler";

  return (
    <PlaceShell title="Profile & Settings">
      <p className="hub-intro">
        Your universal identity. Language lives here — not in the header.
        Professions are reputations you grow, not locked classes.
      </p>
      <div className="panel-grid">
        <article className="panel">
          <p className="meta">identity</p>
          <h2>{displayName}</h2>
          <p>Clerk ID: {user?.id}</p>
          <p>Wallet link (Solana) arrives after the server ledger stabilizes.</p>
        </article>
        <article className="panel">
          <p className="meta">settings</p>
          <h2>Language</h2>
          <ProfileSettingsForm
            locales={LOCALES.map((code) => ({
              code,
              label: LOCALE_LABELS[code],
            }))}
            professions={PROFESSIONS.map((p) => ({
              id: p.id,
              name: p.name,
              blurb: p.blurb,
            }))}
          />
        </article>
      </div>
    </PlaceShell>
  );
}
