import { z } from "zod";
import {
  getMoltbookAppKey,
  getMoltbookAuthAudience,
  getMoltbookBaseUrl,
} from "./config";

export const IDENTITY_HEADER = "x-moltbook-identity";

const ownerSchema = z
  .object({
    x_handle: z.string().optional(),
    x_name: z.string().optional(),
    x_avatar: z.string().optional(),
    x_verified: z.boolean().optional(),
    x_follower_count: z.number().optional(),
  })
  .passthrough();

const humanSchema = z
  .object({
    username: z.string().optional(),
    email_verified: z.boolean().optional(),
  })
  .passthrough();

const agentStatsSchema = z
  .object({
    posts: z.number().optional(),
    comments: z.number().optional(),
  })
  .passthrough();

export const verifiedAgentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    karma: z.number().optional(),
    avatar_url: z.string().nullable().optional(),
    is_claimed: z.boolean().optional(),
    created_at: z.string().optional(),
    follower_count: z.number().optional(),
    following_count: z.number().optional(),
    stats: agentStatsSchema.optional(),
    owner: ownerSchema.optional(),
    human: humanSchema.optional(),
  })
  .passthrough();

export type VerifiedMoltbookAgent = z.infer<typeof verifiedAgentSchema>;

const verifyResponseSchema = z.object({
  success: z.boolean().optional(),
  valid: z.boolean(),
  agent: verifiedAgentSchema.optional(),
  error: z.string().optional(),
  hint: z.string().optional(),
});

export type MoltbookAuthErrorCode =
  | "missing_identity_token"
  | "missing_app_key"
  | "invalid_app_key"
  | "identity_token_expired"
  | "invalid_token"
  | "agent_not_found"
  | "agent_deactivated"
  | "audience_required"
  | "audience_mismatch"
  | "rate_limit_exceeded"
  | "verification_failed"
  | "invalid_response";

export class MoltbookAuthError extends Error {
  readonly code: MoltbookAuthErrorCode;
  readonly status: number;
  readonly hint?: string;

  constructor(
    code: MoltbookAuthErrorCode,
    message: string,
    status: number,
    hint?: string,
  ) {
    super(message);
    this.name = "MoltbookAuthError";
    this.code = code;
    this.status = status;
    this.hint = hint;
  }
}

function mapErrorToStatus(error: string): number {
  switch (error) {
    case "agent_not_found":
      return 404;
    case "agent_deactivated":
      return 403;
    case "rate_limit_exceeded":
      return 429;
    case "missing_app_key":
    case "invalid_app_key":
    case "identity_token_expired":
    case "invalid_token":
    case "audience_required":
    case "audience_mismatch":
      return 401;
    default:
      return 401;
  }
}

function isKnownAuthError(error: string): error is MoltbookAuthErrorCode {
  const known: MoltbookAuthErrorCode[] = [
    "missing_app_key",
    "invalid_app_key",
    "identity_token_expired",
    "invalid_token",
    "agent_not_found",
    "agent_deactivated",
    "audience_required",
    "audience_mismatch",
    "rate_limit_exceeded",
    "verification_failed",
  ];
  return known.includes(error as MoltbookAuthErrorCode);
}

/** Read the bot's identity token from the X-Moltbook-Identity header. */
export function extractIdentityToken(request: Request): string | null {
  const token = request.headers.get(IDENTITY_HEADER);
  if (!token?.trim()) return null;
  return token.trim();
}

export interface VerifyIdentityOptions {
  audience?: string;
  appKey?: string;
}

/**
 * Verify a Moltbook identity token with POST /agents/verify-identity.
 * @see https://moltbook.com/developers.md
 */
export async function verifyIdentityToken(
  token: string,
  options: VerifyIdentityOptions = {},
): Promise<VerifiedMoltbookAgent> {
  const appKey = options.appKey ?? getMoltbookAppKey();
  if (!appKey) {
    throw new MoltbookAuthError(
      "missing_app_key",
      "MOLTBOOK_APP_KEY is not configured",
      500,
      "Register an app at https://moltbook.com/developers/dashboard",
    );
  }

  const audience = options.audience ?? getMoltbookAuthAudience();
  const baseUrl = getMoltbookBaseUrl().replace(/\/$/, "");

  const body: { token: string; audience?: string } = { token };
  if (audience) {
    body.audience = audience;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/agents/verify-identity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Moltbook-App-Key": appKey,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new MoltbookAuthError(
      "verification_failed",
      error instanceof Error ? error.message : "Network error during verification",
      502,
    );
  }

  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new MoltbookAuthError(
        "invalid_response",
        "Moltbook returned non-JSON",
        502,
      );
    }
  }

  const parsed = verifyResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new MoltbookAuthError(
      "invalid_response",
      "Unexpected verify-identity response shape",
      502,
    );
  }

  const data = parsed.data;

  if (!response.ok || !data.valid) {
    const errorCode = data.error ?? "verification_failed";
    const status = mapErrorToStatus(errorCode);
    throw new MoltbookAuthError(
      isKnownAuthError(errorCode) ? errorCode : "verification_failed",
      data.error ?? `Verification failed (${response.status})`,
      status,
      data.hint,
    );
  }

  if (!data.agent) {
    throw new MoltbookAuthError(
      "invalid_response",
      "Verify response missing agent profile",
      502,
    );
  }

  return verifiedAgentSchema.parse(data.agent);
}

/**
 * Extract + verify identity token from a request.
 * Returns the verified agent or throws MoltbookAuthError.
 */
export async function requireMoltbookAgent(
  request: Request,
  options?: VerifyIdentityOptions,
): Promise<VerifiedMoltbookAgent> {
  const token = extractIdentityToken(request);
  if (!token) {
    throw new MoltbookAuthError(
      "missing_identity_token",
      `Missing ${IDENTITY_HEADER} header`,
      401,
      "Bot should POST /agents/me/identity-token then send the token in this header",
    );
  }

  let audience = options?.audience ?? getMoltbookAuthAudience();
  if (!audience) {
    try {
      audience = new URL(request.url).hostname;
    } catch {
      // use token without audience restriction
    }
  }

  return verifyIdentityToken(token, { ...options, audience });
}
