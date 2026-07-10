/**
 * X (Twitter) OAuth 2.0 Authorization Code + PKCE.
 * Stores user access/refresh tokens in Redis after Connect.
 * @see https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
 */
import { createHash, randomBytes } from "crypto";
import {
  getSiteUrl,
  getXCallbackUrl,
  getXClientId,
  getXClientSecret,
} from "./config";
import { createRedisClient } from "./redis";
import { parseRedisValue } from "./redis-json";

const TOKEN_KEY = "x:oauth:tokens";
const PKCE_KEY = "x:oauth:pkce";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"].join(
  " ",
);

export interface XOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
  username?: string;
  userId?: string;
}

function getRedis() {
  return createRedisClient();
}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function hasXOAuthAppConfig(): boolean {
  return Boolean(getXClientId() && getXClientSecret());
}

export async function getStoredXTokens(): Promise<XOAuthTokens | null> {
  try {
    const raw = await getRedis().get(TOKEN_KEY);
    if (!raw) return null;
    return parseRedisValue<XOAuthTokens>(raw);
  } catch {
    return null;
  }
}

export async function saveXTokens(tokens: XOAuthTokens): Promise<void> {
  await getRedis().set(TOKEN_KEY, JSON.stringify(tokens));
}

export async function clearXTokens(): Promise<void> {
  await getRedis().del(TOKEN_KEY);
}

export async function getXConnectionStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  username?: string;
  expiresAt?: number;
  callbackUrl: string;
}> {
  const tokens = await getStoredXTokens();
  return {
    configured: hasXOAuthAppConfig(),
    connected: Boolean(tokens?.accessToken || tokens?.refreshToken),
    username: tokens?.username,
    expiresAt: tokens?.expiresAt,
    callbackUrl: getXCallbackUrl(),
  };
}

/** Start OAuth — returns authorize URL. */
export async function beginXOauth(): Promise<{ url: string; state: string }> {
  const clientId = getXClientId();
  if (!clientId) throw new Error("X_CLIENT_ID not configured");

  const state = base64Url(randomBytes(16));
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());

  await getRedis().set(
    PKCE_KEY,
    JSON.stringify({ state, verifier, createdAt: Date.now() }),
    { ex: 600 },
  );

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: getXCallbackUrl(),
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return {
    url: `https://twitter.com/i/oauth2/authorize?${params.toString()}`,
    state,
  };
}

async function loadPkce(): Promise<{ state: string; verifier: string } | null> {
  try {
    const raw = await getRedis().get(PKCE_KEY);
    if (!raw) return null;
    return parseRedisValue<{ state: string; verifier: string }>(raw);
  } catch {
    return null;
  }
}

function basicAuthHeader(): string {
  const id = getXClientId();
  const secret = getXClientSecret();
  if (!id || !secret) throw new Error("X_CLIENT_ID/SECRET missing");
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function exchangeToken(
  body: URLSearchParams,
): Promise<XOAuthTokens> {
  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: body.toString(),
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ||
        json.error ||
        `token_exchange_${res.status}`,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000 - 60_000,
    scope: json.scope,
    tokenType: json.token_type,
  };
}

export async function finishXOauth(params: {
  code: string;
  state: string;
}): Promise<XOAuthTokens> {
  const pkce = await loadPkce();
  if (!pkce || pkce.state !== params.state) {
    throw new Error("invalid_oauth_state");
  }

  const tokens = await exchangeToken(
    new URLSearchParams({
      code: params.code,
      grant_type: "authorization_code",
      client_id: getXClientId()!,
      redirect_uri: getXCallbackUrl(),
      code_verifier: pkce.verifier,
    }),
  );

  // Resolve @handle
  try {
    const me = await fetch("https://api.x.com/2/users/me", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (me.ok) {
      const data = (await me.json()) as {
        data?: { id?: string; username?: string };
      };
      tokens.userId = data.data?.id;
      tokens.username = data.data?.username;
    }
  } catch {
    /* optional */
  }

  await saveXTokens(tokens);
  await getRedis().del(PKCE_KEY);
  return tokens;
}

/** Valid user access token (refresh if needed). */
export async function getValidXUserAccessToken(): Promise<string | null> {
  let tokens = await getStoredXTokens();
  if (!tokens?.accessToken && !tokens?.refreshToken) return null;

  if (
    tokens.accessToken &&
    tokens.expiresAt > Date.now() + 30_000
  ) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken || !hasXOAuthAppConfig()) {
    return tokens.accessToken || null;
  }

  try {
    tokens = {
      ...tokens,
      ...(await exchangeToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: getXClientId()!,
        }),
      )),
      username: tokens.username,
      userId: tokens.userId,
    };
    await saveXTokens(tokens);
    return tokens.accessToken;
  } catch (error) {
    console.error("[x-auth] refresh failed:", error);
    return null;
  }
}

export function getXAuthorizeHint(): string {
  return `Add callback URL in X Developer Portal → User authentication: ${getXCallbackUrl()} (also allow ${getSiteUrl()})`;
}
