import { PlaceShell } from "@/components/PlaceShell";
import { SEED_ITEMS } from "@/lib/seed-data";

export default function BazaarPage() {
  return (
    <PlaceShell title="The Bazaar">
      <p className="hub-intro">
        Stalls for trade, auctions, and commissions. Stage One shows catalog
        stubs — transfers go through the server ledger only.
      </p>
      <div className="panel-grid">
        {SEED_ITEMS.map((item) => (
          <article key={item.definition_id} className="panel">
            <p className="meta">{item.rarity}</p>
            <h2>{item.name}</h2>
            <p>{item.description}</p>
            <div className="chip-row">
              {item.tags.map((tag) => (
                <span key={tag} className="chip">
                  {tag}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </PlaceShell>
  );
}
