import { z } from "zod";
import { createRedisClient } from "./redis";
import { parseRedisValue } from "./redis-json";

const APPS_INDEX_KEY = "moltbook:apps:index";
const appKey = (slug: string) => `moltbook:app:${slug}`;

export const MAX_APPS = 20;

export const botAppSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  kind: z.enum(["markdown", "html", "json-dashboard"]),
  content: z.string().max(100_000),
  public: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BotApp = z.infer<typeof botAppSchema>;

export type BotAppInput = Omit<BotApp, "createdAt" | "updatedAt">;

let redis: ReturnType<typeof createRedisClient> | null = null;
function getRedis() {
  if (!redis) redis = createRedisClient();
  return redis;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || `app-${Date.now()}`;
}

export async function listApps(): Promise<BotApp[]> {
  try {
    const slugs = await getRedis().smembers(APPS_INDEX_KEY);
    const list = Array.isArray(slugs) ? slugs.map(String) : [];
    const apps: BotApp[] = [];
    for (const slug of list) {
      const app = await getApp(slug);
      if (app) apps.push(app);
    }
    return apps.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  } catch (error) {
    console.error("[apps] listApps failed:", error);
    return [];
  }
}

export async function getApp(slug: string): Promise<BotApp | null> {
  try {
    const raw = await getRedis().get(appKey(slug));
    if (!raw) return null;
    const parsed = botAppSchema.safeParse(parseRedisValue(raw));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    console.error("[apps] getApp failed:", error);
    return null;
  }
}

export async function saveApp(input: BotAppInput): Promise<BotApp> {
  const r = getRedis();
  const existing = await getApp(input.slug);
  const now = new Date().toISOString();

  if (!existing) {
    const count = await r.scard(APPS_INDEX_KEY);
    if (count >= MAX_APPS) {
      throw new Error(`Maximum ${MAX_APPS} apps reached`);
    }
  }

  const app: BotApp = {
    ...input,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const validated = botAppSchema.parse(app);
  await r.set(appKey(validated.slug), validated);
  await r.sadd(APPS_INDEX_KEY, validated.slug);
  return validated;
}

export async function getPublicApp(slug: string): Promise<BotApp | null> {
  const app = await getApp(slug);
  if (!app || !app.public) return null;
  return app;
}
