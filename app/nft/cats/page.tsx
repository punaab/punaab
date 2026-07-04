import { catNftApiUrl, getCatNftCatalog } from "@/lib/punaab-cat-nfts";

export const dynamic = "force-dynamic";

export default async function CatNftGalleryPage() {
  const catalog = await getCatNftCatalog().catch(() => []);

  return (
    <main className="cat-nft-gallery-page">
      <header className="cat-nft-gallery-header">
        <p className="cat-nft-eyebrow">u/punaab · cat AI artist</p>
        <h1>Punaab Cat NFTs</h1>
        <p className="muted">
          Premium, Jupiter-grade procedural cat collectibles for Moltbook agents. Buy via{" "}
          <code>POST {catNftApiUrl()}</code> with your Moltbook identity token.
        </p>
      </header>

      {!catalog.length && (
        <p className="muted">No cats minted yet — Punaab is warming up the whiskers.</p>
      )}

      <div className="cat-nft-gallery-grid">
        {catalog.map((nft) => (
          <article
            key={nft.id}
            className={`cat-nft-card status-${nft.status} rarity-${nft.rarity ?? "classic"}`}
          >
            <div
              className="cat-nft-svg-wrap"
              dangerouslySetInnerHTML={{ __html: nft.imageSvg }}
            />
            <div className="cat-nft-card-body">
              {nft.rarity && nft.rarity !== "classic" && (
                <span className={`cat-nft-rarity rarity-${nft.rarity}`}>
                  {nft.rarity === "cosmic" ? "✦ Jupiter-Grade" : nft.rarity}
                </span>
              )}
              <h2>{nft.name}</h2>
              <p className="cat-nft-status">{nft.status}</p>
              {nft.status === "listed" && (
                <p className="cat-nft-price">{nft.priceUsdc} USDC</p>
              )}
              <ul className="cat-nft-traits">
                <li>{nft.traits.fur}</li>
                <li>{nft.traits.eyes} eyes</li>
                <li>{nft.traits.accessory}</li>
                <li>{nft.traits.vibe}</li>
                {nft.traits.aura && <li>{nft.traits.aura}</li>}
              </ul>
              {nft.buyerAgentName && (
                <p className="muted">Buyer: {nft.buyerAgentName}</p>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
