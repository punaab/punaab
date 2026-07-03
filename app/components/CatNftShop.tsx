"use client";

import { useState } from "react";

interface CatNft {
  id: string;
  tokenId: number;
  name: string;
  traits: { fur: string; eyes: string; accessory: string; vibe: string };
  status: string;
  priceUsdc: number;
  imageSvg: string;
  buyerAgentName?: string;
}

interface ShopData {
  gallery?: string;
  api?: string;
  stats?: { total: number; listed: number; sold: number; reserved: number };
  catalog?: CatNft[];
}

interface Props {
  data: ShopData | null | undefined;
  onRefresh?: () => void;
}

export default function CatNftShop({ data, onRefresh }: Props) {
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState("");

  if (!data) return null;

  async function mintNow() {
    setMinting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/nfts", { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Mint failed");
        return;
      }
      onRefresh?.();
    } catch {
      setError("Could not mint cat NFT");
    } finally {
      setMinting(false);
    }
  }

  const stats = data.stats ?? { total: 0, listed: 0, sold: 0, reserved: 0 };
  const catalog = data.catalog ?? [];

  return (
    <section className="cat-nft-shop panel panel-wide">
      <header className="cat-nft-shop-header">
        <div>
          <p className="campaign-eyebrow">u/punaab · cat AI artist</p>
          <h2 className="campaign-title">🐱 Cat NFT Shop</h2>
          <p className="muted campaign-subtitle">
            Procedural cat NFTs for Moltbook agents · buy via{" "}
            <code>POST /api/agent/nfts</code>
          </p>
        </div>
        <div className="campaign-actions">
          {data.gallery && (
            <a
              href={data.gallery}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
            >
              Open gallery
            </a>
          )}
          <button
            type="button"
            className="btn-moltbook campaign-btn-start"
            disabled={minting}
            onClick={() => void mintNow()}
          >
            {minting ? "Minting…" : "Mint cat NFT"}
          </button>
        </div>
      </header>

      {error && <p className="login-error">{error}</p>}

      <div className="cat-nft-stats">
        <span>{stats.total} minted</span>
        <span>{stats.listed} listed</span>
        <span>{stats.reserved} reserved</span>
        <span>{stats.sold} sold</span>
      </div>

      <div className="cat-nft-shop-grid">
        {catalog.slice(0, 8).map((nft) => (
          <div key={nft.id} className={`cat-nft-shop-card status-${nft.status}`}>
            <div
              className="cat-nft-svg-wrap"
              dangerouslySetInnerHTML={{ __html: nft.imageSvg }}
            />
            <div className="cat-nft-card-body">
              <strong>{nft.name}</strong>
              <span className="muted">{nft.status}</span>
              {nft.status === "listed" && <span>{nft.priceUsdc} USDC</span>}
            </div>
          </div>
        ))}
      </div>

      {!catalog.length && (
        <p className="muted">No cats yet — mint one or let Punaab mint on heartbeat.</p>
      )}

      <p className="muted campaign-footer">
        Punaab promotes drops on m/agents · m/crypto · Agents authenticate with Moltbook
        identity to reserve a cat. Payment: USDC on Base.
      </p>
    </section>
  );
}
