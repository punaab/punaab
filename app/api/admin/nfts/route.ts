import { isAdminAuthenticatedFromCookies } from "@/lib/admin-auth";
import {
  catNftApiUrl,
  catNftGalleryUrl,
  getCatNftCatalog,
  getCatNftShopStats,
  mintCatNft,
} from "@/lib/punaab-cat-nfts";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [catalog, stats] = await Promise.all([getCatNftCatalog(), getCatNftShopStats()]);
  return NextResponse.json({
    gallery: catNftGalleryUrl(),
    api: catNftApiUrl(),
    stats,
    catalog: catalog.slice(0, 24),
  });
}

export async function POST() {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const nft = await mintCatNft({ listImmediately: true });
  return NextResponse.json({ ok: true, nft, gallery: catNftGalleryUrl() });
}
