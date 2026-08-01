/**
 * Post to X (Twitter) as @notbitcoinceo.
 * Prefers OAuth 2.0 user token (Connect flow); falls back to OAuth 1.0a env tokens.
 */
import { createHmac, randomBytes } from "crypto";
import {
  getPublicShareUrl,
  getXAccessToken,
  getXAccessTokenSecret,
  getXApiKey,
  getXApiSecret,
  isXCrossPostEnabled,
  isXEngageEnabled,
} from "./config";
import { getValidXUserAccessToken, getXConnectionStatus } from "./x-auth";

/**
 * Tweets must never send people to the agent host (punaab.vercel.app).
 * Rewrite any Vercel / agent URLs to the public marketing site.
 */
export function sanitizeTweetPublicUrls(text: string): string {
  const share = getPublicShareUrl();
  return text
    .replace(/https?:\/\/(?:www\.)?punaab\.vercel\.app/gi, share)
    .replace(
      /https?:\/\/punaab[a-z0-9-]*\.vercel\.app/gi,
      share,
    )
    .replace(/\b(?:www\.)?punaab\.vercel\.app\b/gi, share.replace(/^https?:\/\//, ""))
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface XPostResult {
  ok: boolean;
  id?: string;
  text?: string;
  error?: string;
  skipped?: boolean;
}

function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** OAuth 1.0a signing for POST /2/tweets when user access tokens are in env. */
function oauth1Header(params: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: params.consumerKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: params.token,
    oauth_version: "1.0",
  };

  const baseParams = Object.keys(oauth)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauth[k]!)}`)
    .join("&");

  const baseString = [
    params.method.toUpperCase(),
    percentEncode(params.url),
    percentEncode(baseParams),
  ].join("&");

  const signingKey = `${percentEncode(params.consumerSecret)}&${percentEncode(params.tokenSecret)}`;
  oauth.oauth_signature = createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  return `OAuth ${Object.keys(oauth)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k]!)}"`)
    .join(", ")}`;
}

/** Strip markdown-ish noise and fit in 280 chars with optional link. */
export function formatMoltbookForX(params: {
  title?: string;
  content?: string;
  url?: string;
  kind?: "post" | "comment";
}): string {
  const title = (params.title ?? "").replace(/\s+/g, " ").trim();
  const body = (params.content ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const prefix =
    params.kind === "comment" ? "" : title ? `${title}\n\n` : "";
  let text = `${prefix}${body}`.trim();
  const url = params.url?.trim();
  const reserve = url ? url.length + 2 : 0;
  const max = 280 - reserve;
  if (text.length > max) {
    text = `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  }
  if (url) {
    text = text ? `${text}\n${url}` : url;
  }
  return text.slice(0, 280);
}

export type CreateXPostOptions = {
  /** When set, posts as a reply to this tweet id. */
  replyToTweetId?: string;
  /** Bypass crosspost kill-switch (used by engage/reply path). */
  force?: boolean;
};

function tweetBody(text: string, replyToTweetId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = { text };
  if (replyToTweetId) {
    body.reply = { in_reply_to_tweet_id: replyToTweetId };
  }
  return body;
}

async function postTweetOAuth2(
  text: string,
  accessToken: string,
  replyToTweetId?: string,
): Promise<XPostResult> {
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tweetBody(text, replyToTweetId)),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { id?: string; text?: string };
    detail?: string;
    title?: string;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok) {
    return {
      ok: false,
      error:
        json.detail ||
        json.title ||
        json.errors?.[0]?.message ||
        `x_post_${res.status}`,
    };
  }
  return { ok: true, id: json.data?.id, text: json.data?.text ?? text };
}

async function postTweetOAuth1(
  text: string,
  replyToTweetId?: string,
): Promise<XPostResult> {
  const consumerKey = getXApiKey();
  const consumerSecret = getXApiSecret();
  const token = getXAccessToken();
  const tokenSecret = getXAccessTokenSecret();
  if (!consumerKey || !consumerSecret || !token || !tokenSecret) {
    return { ok: false, error: "oauth1_tokens_missing", skipped: true };
  }

  const url = "https://api.x.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: oauth1Header({
        method: "POST",
        url,
        consumerKey,
        consumerSecret,
        token,
        tokenSecret,
      }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tweetBody(text, replyToTweetId)),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { id?: string; text?: string };
    detail?: string;
    title?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: json.detail || json.title || `x_post_${res.status}`,
    };
  }
  return { ok: true, id: json.data?.id, text: json.data?.text ?? text };
}

export async function createXPost(
  text: string,
  options: CreateXPostOptions = {},
): Promise<XPostResult> {
  if (!options.force && !isXCrossPostEnabled()) {
    return { ok: false, skipped: true, error: "x_crosspost_disabled" };
  }
  const trimmed = sanitizeTweetPublicUrls(text.trim());
  if (!trimmed) {
    return { ok: false, skipped: true, error: "empty_text" };
  }

  const oauth2 = await getValidXUserAccessToken();
  if (oauth2) {
    return postTweetOAuth2(trimmed, oauth2, options.replyToTweetId);
  }

  if (getXAccessToken() && getXAccessTokenSecret()) {
    return postTweetOAuth1(trimmed, options.replyToTweetId);
  }

  return {
    ok: false,
    skipped: true,
    error:
      "x_not_connected — open /admin and click Connect X (OAuth), or set X_ACCESS_TOKEN + X_ACCESS_TOKEN_SECRET",
  };
}

/** Authenticated GET against api.x.com (OAuth 2 user token preferred). */
export async function xApiGet(
  pathWithQuery: string,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const oauth2 = await getValidXUserAccessToken();
  if (!oauth2) {
    return { ok: false, status: 401, json: { error: "no_user_token" } };
  }
  const res = await fetch(`https://api.x.com${pathWithQuery}`, {
    headers: { Authorization: `Bearer ${oauth2}` },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export async function crossPostMoltbookActivity(params: {
  action: string;
  title?: string;
  content?: string;
  targetUrl?: string;
}): Promise<XPostResult> {
  const kind =
    params.action === "comment" || params.action.includes("comment")
      ? "comment"
      : "post";

  const text = formatMoltbookForX({
    title: params.title,
    content: params.content,
    url: params.targetUrl,
    kind,
  });

  const result = await createXPost(text);
  if (result.ok) {
    console.log(`[x-crosspost] tweeted ${result.id} for ${params.action}`);
  } else if (!result.skipped) {
    console.warn(`[x-crosspost] failed: ${result.error}`);
  }
  return result;
}

export async function canPostToX(options?: {
  /** Allow posting when engage is on even if crosspost is off. */
  allowEngageOnly?: boolean;
}): Promise<{
  ok: boolean;
  reason?: string;
  username?: string;
}> {
  const postingAllowed =
    isXCrossPostEnabled() ||
    (options?.allowEngageOnly === true && isXEngageEnabled());
  if (!postingAllowed) {
    return { ok: false, reason: "disabled" };
  }
  const status = await getXConnectionStatus();
  if (status.connected) {
    return { ok: true, username: status.username };
  }
  if (getXAccessToken() && getXAccessTokenSecret() && getXApiKey()) {
    return { ok: true, username: "env_oauth1" };
  }
  return {
    ok: false,
    reason: status.configured
      ? "not_connected"
      : "missing_X_CLIENT_ID_SECRET",
  };
}
