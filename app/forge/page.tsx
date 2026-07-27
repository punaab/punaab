import { PlaceShell } from "@/components/PlaceShell";
import { CraftButton } from "@/components/CraftButton";
import { SEED_ITEMS } from "@/lib/seed-data";

export default function ForgePage() {
  const recipe = SEED_ITEMS.find((i) => i.definition_id === "tool_quill_001");

  return (
    <PlaceShell title="The Forge">
      <p className="hub-intro">
        Heat, metal, and intention. Craft known recipes or submit new item
        designs for review.
      </p>
      <div className="panel-grid">
        <article className="panel">
          <p className="meta">craftable stub</p>
          <h2>{recipe?.name ?? "Chronicler's Quill"}</h2>
          <p>
            Requires Ember Iron and focus. Crafting posts an idempotent ledger
            event and mints an item instance you own.
          </p>
          <CraftButton definitionId="tool_quill_001" />
        </article>
        <article className="panel">
          <p className="meta">design desk</p>
          <h2>Submit an item design</h2>
          <p>
            Coming next: proposal form for new definitions with tags, assets,
            and suggested stats. Canon status starts at community.
          </p>
        </article>
      </div>
    </PlaceShell>
  );
}
