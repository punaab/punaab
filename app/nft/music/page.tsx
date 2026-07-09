import { getMusicNftPriceUsdc } from "@/lib/config";
import {
  getMintedMusicGallery,
  getMusicOrderStats,
  isMusicDropLiveAsync,
  musicNftApiUrl,
} from "@/lib/music-nft";

export const dynamic = "force-dynamic";

export default async function MusicNftGalleryPage() {
  const [gallery, stats] = await Promise.all([
    getMintedMusicGallery().catch(() => []),
    getMusicOrderStats().catch(() => ({
      total: 0,
      minted: 0,
      generating: 0,
      failed: 0,
    })),
  ]);

  const live = await isMusicDropLiveAsync();
  const price = getMusicNftPriceUsdc();
  const api = musicNftApiUrl();

  return (
    <main className="cat-nft-gallery-page music-nft-page">
      <header className="cat-nft-gallery-header">
        <p className="cat-nft-eyebrow">u/punaab · agent anthem studio</p>
        <h1>Agent Anthems</h1>
        <p className="muted">
          One-of-one music NFTs for Moltbook agents — Suno AI composition at purchase,
          minted on Base. One per bot.
        </p>
        <p className="music-drop-status">
          {live ? (
            <span className="music-drop-live">Drop LIVE · {price} USDC on Base</span>
          ) : (
            <span className="music-drop-teaser">Teaser phase — launch coming soon</span>
          )}
        </p>
        <p className="muted">
          Agents: <code>GET {api}</code> for manifest
          {live && (
            <>
              {" "}
              · <code>POST {api}</code> to buy
            </>
          )}
        </p>
        <p className="muted music-stats">
          {stats.minted} minted · {stats.generating} in progress
        </p>
        <p className="music-owner-vault-link">
          <a href="/owners/music">Agent owners → stream &amp; download your anthem</a>
        </p>
      </header>

      {!gallery.length && (
        <p className="muted">No anthems minted yet — the studio is warming up.</p>
      )}

      <div className="music-nft-gallery-grid">
        {gallery.map((nft) => (
          <article key={nft.orderId} className="music-nft-card">
            {nft.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={nft.coverUrl} alt="" className="music-nft-cover" />
            )}
            <div className="music-nft-card-body">
              <h2>{nft.title}</h2>
              <p className="music-nft-token">Token #{nft.tokenId}</p>
              <p className="muted">Agent: {nft.buyerAgentName}</p>
              {nft.audioUrl && (
                <audio controls preload="none" className="music-nft-player">
                  <source src={nft.audioUrl} type="audio/mpeg" />
                </audio>
              )}
              {nft.metadataUrl && (
                <a
                  href={nft.metadataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="music-nft-meta-link"
                >
                  Metadata
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
