import { z } from "zod";
import { getMoltbookApiKey, getMoltbookBaseUrl } from "./config";

export class MoltbookError extends Error {
  readonly status: number;
  readonly hint?: string;
  readonly rateLimit?: RateLimitInfo;

  constructor(
    message: string,
    status: number,
    options?: { hint?: string; rateLimit?: RateLimitInfo },
  ) {
    super(message);
    this.name = "MoltbookError";
    this.status = status;
    this.hint = options?.hint;
    this.rateLimit = options?.rateLimit;
  }
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  reset?: number;
  retryAfter?: number;
}

const authorSchema = z
  .object({
    name: z.string().optional(),
    id: z.string().optional(),
  })
  .passthrough();

const submoltSchema = z
  .object({
    name: z.string().optional(),
    display_name: z.string().optional(),
  })
  .passthrough();

export const postSchema = z
  .object({
    id: z.string().optional(),
    post_id: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    content_preview: z.string().optional(),
    submolt_name: z.string().optional(),
    author_name: z.string().optional(),
    author: authorSchema.optional(),
    submolt: submoltSchema.optional(),
    upvotes: z.number().optional(),
    comment_count: z.number().optional(),
    created_at: z.string().optional(),
  })
  .passthrough()
  .transform((post) => ({
    ...post,
    id: post.id ?? post.post_id ?? "",
    content: post.content ?? post.content_preview,
    submolt_name:
      post.submolt_name ?? post.submolt?.name ?? undefined,
    author_name: post.author_name ?? post.author?.name ?? undefined,
  }));

export type MoltbookPost = z.infer<typeof postSchema>;

const notificationSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    message: z.string().optional(),
    preview: z.string().optional(),
    post_id: z.string().optional(),
    comment_id: z.string().optional(),
    created_at: z.string().optional(),
    read: z.boolean().optional(),
  })
  .passthrough();

export type MoltbookNotification = z.infer<typeof notificationSchema>;

const apiEnvelopeSchema = z.object({
  success: z.boolean().optional(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  hint: z.string().optional(),
  message: z.string().optional(),
});

const registerResponseSchema = z.union([
  z.object({
    api_key: z.string(),
    claim_url: z.string(),
    verification_code: z.string().optional(),
  }),
  z.object({
    agent: z.object({
      api_key: z.string(),
      claim_url: z.string(),
      verification_code: z.string().optional(),
    }),
    important: z.string().optional(),
  }),
]);

export interface RegisterResult {
  api_key: string;
  claim_url: string;
  verification_code?: string;
}

export interface GetFeedOptions {
  sort?: "hot" | "new" | "top" | "rising";
  limit?: number;
  cursor?: string;
  filter?: "all" | "following";
}

export interface GetFeedResult {
  posts: MoltbookPost[];
  has_more?: boolean;
  next_cursor?: string;
  rateLimit?: RateLimitInfo;
}

export interface GetNotificationsOptions {
  limit?: number;
  cursor?: string;
}

export interface GetNotificationsResult {
  notifications: MoltbookNotification[];
  unread_count?: number;
  has_more?: boolean;
  next_cursor?: string;
  rateLimit?: RateLimitInfo;
}

export interface CreatePostInput {
  submolt_name: string;
  title: string;
  content?: string;
  url?: string;
  type?: "text" | "link" | "image";
}

export interface CommentInput {
  content: string;
  parent_id?: string;
}

function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const limit = headers.get("X-RateLimit-Limit");
  const remaining = headers.get("X-RateLimit-Remaining");
  const reset = headers.get("X-RateLimit-Reset");
  const retryAfter = headers.get("Retry-After");

  return {
    limit: limit ? Number(limit) : undefined,
    remaining: remaining ? Number(remaining) : undefined,
    reset: reset ? Number(reset) : undefined,
    retryAfter: retryAfter ? Number(retryAfter) : undefined,
  };
}

function unwrapData(payload: unknown): unknown {
  const envelope = apiEnvelopeSchema.safeParse(payload);
  if (!envelope.success) return payload;
  if (envelope.data.success === false) {
    throw new MoltbookError(
      envelope.data.error ?? "Moltbook API error",
      400,
      { hint: envelope.data.hint },
    );
  }
  if (envelope.data.data !== undefined) return envelope.data.data;
  return payload;
}

function extractPosts(data: unknown): MoltbookPost[] {
  if (Array.isArray(data)) {
    return data.map((item) => postSchema.parse(item));
  }

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const candidates = [
      record.posts,
      record.items,
      record.results,
      record.feed,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.map((item) => postSchema.parse(item));
      }
    }
  }

  return [];
}

function extractNotifications(data: unknown): MoltbookNotification[] {
  if (Array.isArray(data)) {
    return data.map((item) => notificationSchema.parse(item));
  }

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const candidates = [record.notifications, record.items, record.results];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.map((item) => notificationSchema.parse(item));
      }
    }
  }

  return [];
}

export class MoltbookClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options?: { baseUrl?: string; apiKey?: string }) {
    this.baseUrl = (options?.baseUrl ?? getMoltbookBaseUrl()).replace(/\/$/, "");
    this.apiKey = options?.apiKey ?? getMoltbookApiKey();
  }

  private headers(includeAuth: boolean, json = false): HeadersInit {
    const headers: Record<string, string> = {};
    if (json) headers["Content-Type"] = "application/json";
    if (includeAuth) {
      if (!this.apiKey) {
        throw new MoltbookError("MOLTBOOK_API_KEY is not set", 401);
      }
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { auth?: boolean; retryOn5xx?: boolean } = {},
  ): Promise<{ data: T; rateLimit: RateLimitInfo; status: number }> {
    const { auth = true, retryOn5xx = true, ...fetchInit } = init;
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    const doFetch = async (): Promise<Response> => {
      return fetch(url, {
        ...fetchInit,
        headers: {
          ...this.headers(auth, fetchInit.method !== "GET" && fetchInit.method !== "DELETE"),
          ...(fetchInit.headers ?? {}),
        },
      });
    };

    let response = await doFetch();
    if (retryOn5xx && response.status >= 500 && response.status < 600) {
      console.warn(`[moltbook] ${response.status} on ${path}, retrying once`);
      await sleep(500);
      response = await doFetch();
    }

    const rateLimit = parseRateLimitHeaders(response.headers);
    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = { error: text };
      }
    }

    if (response.status === 429) {
      const body =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : {};
      throw new MoltbookError(
        String(body.message ?? "Rate limit exceeded"),
        429,
        {
          hint:
            typeof body.retry_after_seconds === "number"
              ? `Retry after ${body.retry_after_seconds}s`
              : undefined,
          rateLimit,
        },
      );
    }

    if (!response.ok) {
      const envelope = apiEnvelopeSchema.safeParse(payload);
      const message =
        envelope.success && envelope.data.error
          ? envelope.data.error
          : `HTTP ${response.status}`;
      throw new MoltbookError(message, response.status, {
        hint: envelope.success ? envelope.data.hint : undefined,
        rateLimit,
      });
    }

    return {
      data: unwrapData(payload) as T,
      rateLimit,
      status: response.status,
    };
  }

  async register(name: string, description: string): Promise<RegisterResult> {
    const { data } = await this.request<unknown>("/agents/register", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ name, description }),
    });

    const parsed = registerResponseSchema.parse(data);
    if ("agent" in parsed) {
      return parsed.agent;
    }
    return parsed;
  }

  async getFeed(options: GetFeedOptions = {}): Promise<GetFeedResult> {
    const params = new URLSearchParams();
    if (options.sort) params.set("sort", options.sort);
    if (options.limit) params.set("limit", String(options.limit));
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.filter) params.set("filter", options.filter);

    const query = params.toString();
    const { data, rateLimit } = await this.request<Record<string, unknown>>(
      `/feed${query ? `?${query}` : ""}`,
    );

    return {
      posts: extractPosts(data),
      has_more: typeof data.has_more === "boolean" ? data.has_more : undefined,
      next_cursor:
        typeof data.next_cursor === "string" ? data.next_cursor : undefined,
      rateLimit,
    };
  }

  async getNotifications(
    options: GetNotificationsOptions = {},
  ): Promise<GetNotificationsResult> {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.cursor) params.set("cursor", options.cursor);

    const query = params.toString();
    const { data, rateLimit } = await this.request<Record<string, unknown>>(
      `/notifications${query ? `?${query}` : ""}`,
    );

    return {
      notifications: extractNotifications(data),
      unread_count:
        typeof data.unread_count === "number" ? data.unread_count : undefined,
      has_more: typeof data.has_more === "boolean" ? data.has_more : undefined,
      next_cursor:
        typeof data.next_cursor === "string" ? data.next_cursor : undefined,
      rateLimit,
    };
  }

  async createPost(input: CreatePostInput): Promise<{
    post: MoltbookPost;
    rateLimit?: RateLimitInfo;
  }> {
    const { data, rateLimit } = await this.request<unknown>("/posts", {
      method: "POST",
      body: JSON.stringify(input),
    });

    const post =
      data && typeof data === "object" && "post" in data
        ? postSchema.parse((data as { post: unknown }).post)
        : postSchema.parse(data);

    return { post, rateLimit };
  }

  async comment(
    postId: string,
    input: CommentInput,
  ): Promise<{ comment: Record<string, unknown>; rateLimit?: RateLimitInfo }> {
    const { data, rateLimit } = await this.request<Record<string, unknown>>(
      `/posts/${encodeURIComponent(postId)}/comments`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );

    const comment =
      data && typeof data.comment === "object" && data.comment
        ? (data.comment as Record<string, unknown>)
        : data;

    return { comment, rateLimit };
  }

  async upvote(
    targetId: string,
    targetType: "post" | "comment" = "post",
  ): Promise<{ message?: string; rateLimit?: RateLimitInfo }> {
    const path =
      targetType === "comment"
        ? `/comments/${encodeURIComponent(targetId)}/upvote`
        : `/posts/${encodeURIComponent(targetId)}/upvote`;

    const { data, rateLimit } = await this.request<Record<string, unknown>>(path, {
      method: "POST",
    });

    return {
      message: typeof data.message === "string" ? data.message : undefined,
      rateLimit,
    };
  }

  /** Subscribe to a submolt (join community). */
  async joinSubmolt(submoltName: string): Promise<{
    message?: string;
    rateLimit?: RateLimitInfo;
  }> {
    const { data, rateLimit } = await this.request<Record<string, unknown>>(
      `/submolts/${encodeURIComponent(submoltName)}/subscribe`,
      { method: "POST" },
    );

    return {
      message: typeof data.message === "string" ? data.message : undefined,
      rateLimit,
    };
  }

  async markNotificationsReadByPost(postId: string): Promise<void> {
    await this.request(`/notifications/read-by-post/${encodeURIComponent(postId)}`, {
      method: "POST",
    });
  }

  /** Send owner login setup email to your human. */
  async setupOwnerEmail(email: string): Promise<{
    message?: string;
    rateLimit?: RateLimitInfo;
  }> {
    const { data, rateLimit } = await this.request<Record<string, unknown>>(
      "/agents/me/setup-owner-email",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
    );

    return {
      message: typeof data.message === "string" ? data.message : undefined,
      rateLimit,
    };
  }

  /** Authenticated profile for the current agent. */
  async getMe(): Promise<{
    profile: Record<string, unknown>;
    rateLimit?: RateLimitInfo;
  }> {
    const { data, rateLimit } = await this.request<Record<string, unknown>>(
      "/agents/me",
    );
    const profile =
      data && typeof data === "object" && "agent" in data
        ? (data.agent as Record<string, unknown>)
        : data;
    return { profile, rateLimit };
  }

  /** Public profile for any agent by handle. */
  async getAgentProfile(name: string): Promise<{
    profile: Record<string, unknown>;
    recentPosts: MoltbookPost[];
    recentComments: Record<string, unknown>[];
    rateLimit?: RateLimitInfo;
  }> {
    const { data, rateLimit } = await this.request<Record<string, unknown>>(
      `/agents/profile?name=${encodeURIComponent(name)}`,
      { auth: false },
    );

    const record = data && typeof data === "object" ? data : {};
    const agent =
      "agent" in record && record.agent && typeof record.agent === "object"
        ? (record.agent as Record<string, unknown>)
        : (record as Record<string, unknown>);

    const recentPosts = Array.isArray(record.recentPosts)
      ? record.recentPosts.map((p) => postSchema.parse(p))
      : Array.isArray(agent.recentPosts)
        ? (agent.recentPosts as unknown[]).map((p) => postSchema.parse(p))
        : [];

    const recentComments = Array.isArray(record.recentComments)
      ? (record.recentComments as Record<string, unknown>[])
      : Array.isArray(agent.recentComments)
        ? (agent.recentComments as Record<string, unknown>[])
        : [];

    return { profile: agent, recentPosts, recentComments, rateLimit };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const moltbook = new MoltbookClient();
