/**
 * Multi-provider LLM layer — Anthropic direct + Aii Cloud / Aii Server / OpenRouter
 * (OpenAI-compatible). Inspired by https://aiiware.com/agent.md and Aii Cloud.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  getAiiApiKey,
  getAiiApiUrl,
  getAiiModel,
  getAnthropicApiKey,
  getAnthropicModel,
  getLlmProvider,
  getOpenRouterApiKey,
  getOpenRouterModel,
} from "./config";

export type LlmProviderId = "anthropic" | "aii" | "openrouter";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LlmCompletionResult {
  text: string;
  provider: LlmProviderId;
  model: string;
}

export interface LlmStatus {
  configured: LlmProviderId[];
  primary: LlmProviderId | "none";
  mode: string;
  aiiUrl?: string;
}

function isCreditError(message: string): boolean {
  return /credit balance is too low|insufficient.*quota|billing|payment required|credits?\s+exhausted|out of credits/i.test(
    message,
  );
}

function isRetryableError(message: string): boolean {
  return (
    isCreditError(message) ||
    /rate limit|429|overloaded|503|502|504|timeout|ECONNRESET|fetch failed|network/i.test(
      message,
    )
  );
}

/** Prefer cheap/working providers when Anthropic is often out of credits. */
const PROVIDER_ORDER: Record<string, LlmProviderId[]> = {
  anthropic: ["anthropic", "openrouter", "aii"],
  aii: ["aii", "openrouter", "anthropic"],
  openrouter: ["openrouter", "aii", "anthropic"],
  // OpenRouter before Anthropic so empty Anthropic credits don't block the brain
  auto: ["openrouter", "aii", "anthropic"],
};

async function completeAnthropic(
  system: string,
  messages: ChatTurn[],
  maxTokens: number,
): Promise<LlmCompletionResult> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) throw new Error("missing_anthropic_api_key");

  const model = getAnthropicModel();
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const block = response.content.find((b) => b.type === "text");
  const text = block && block.type === "text" ? block.text.trim() : "";
  if (!text) throw new Error("empty_anthropic_reply");
  return { text, provider: "anthropic", model };
}

async function completeOpenAiCompatible(
  provider: "aii" | "openrouter",
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  messages: ChatTurn[],
  maxTokens: number,
): Promise<LlmCompletionResult> {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    temperature: 0.7,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(provider === "openrouter"
        ? {
            "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://punaab.vercel.app",
            "X-Title": "Punaab",
          }
        : {}),
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let payload: unknown = {};
  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`${provider}_non_json_response`);
    }
  }

  if (!response.ok) {
    const err =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error
        ? String((payload.error as { message: unknown }).message)
        : raw.slice(0, 200) || `HTTP ${response.status}`;
    throw new Error(`${provider}_error:${err}`);
  }

  const record = payload as {
    choices?: { message?: { content?: string } }[];
  };
  const text = record.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error(`empty_${provider}_reply`);
  return { text, provider, model };
}

async function completeAii(
  system: string,
  messages: ChatTurn[],
  maxTokens: number,
): Promise<LlmCompletionResult> {
  const apiKey = getAiiApiKey();
  if (!apiKey) throw new Error("missing_aii_api_key");
  return completeOpenAiCompatible(
    "aii",
    getAiiApiUrl(),
    apiKey,
    getAiiModel(),
    system,
    messages,
    maxTokens,
  );
}

async function completeOpenRouter(
  system: string,
  messages: ChatTurn[],
  maxTokens: number,
): Promise<LlmCompletionResult> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) throw new Error("missing_openrouter_api_key");
  return completeOpenAiCompatible(
    "openrouter",
    "https://openrouter.ai/api/v1",
    apiKey,
    getOpenRouterModel(),
    system,
    messages,
    maxTokens,
  );
}

function providersForMode(): LlmProviderId[] {
  return PROVIDER_ORDER[getLlmProvider()] ?? PROVIDER_ORDER.auto;
}

function isProviderConfigured(id: LlmProviderId): boolean {
  switch (id) {
    case "anthropic":
      return Boolean(getAnthropicApiKey());
    case "aii":
      return Boolean(getAiiApiKey());
    case "openrouter":
      return Boolean(getOpenRouterApiKey());
    default:
      return false;
  }
}

async function completeWithProvider(
  id: LlmProviderId,
  system: string,
  messages: ChatTurn[],
  maxTokens: number,
): Promise<LlmCompletionResult> {
  switch (id) {
    case "anthropic":
      return completeAnthropic(system, messages, maxTokens);
    case "aii":
      return completeAii(system, messages, maxTokens);
    case "openrouter":
      return completeOpenRouter(system, messages, maxTokens);
    default:
      throw new Error(`unknown_provider:${id}`);
  }
}

/** Completion with automatic fallback across configured providers. */
export async function completeChat(
  system: string,
  messages: ChatTurn[],
  maxTokens = 800,
): Promise<LlmCompletionResult> {
  const chain = providersForMode().filter(isProviderConfigured);
  if (chain.length === 0) {
    throw new Error("no_llm_provider_configured");
  }

  const errors: string[] = [];
  for (const provider of chain) {
    try {
      const result = await completeWithProvider(
        provider,
        system,
        messages,
        maxTokens,
      );
      if (errors.length > 0) {
        console.info(
          `[aii-llm] recovered via ${provider} after: ${errors.join(" | ")}`,
        );
      }
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${provider}:${msg}`);
      console.warn(`[aii-llm] ${provider} failed:`, msg);
      // Always try the next configured provider — never stop the brain on one dead key
      continue;
    }
  }

  throw new Error(errors.join(" | ") || "all_llm_providers_failed");
}

/** Single user turn (heartbeat brain). */
export async function completeText(
  system: string,
  user: string,
  maxTokens = 800,
): Promise<LlmCompletionResult> {
  return completeChat(system, [{ role: "user", content: user }], maxTokens);
}

export function getLlmStatus(): LlmStatus {
  const configured: LlmProviderId[] = [];
  if (getAnthropicApiKey()) configured.push("anthropic");
  if (getAiiApiKey()) configured.push("aii");
  if (getOpenRouterApiKey()) configured.push("openrouter");

  const mode = getLlmProvider();
  const chain = providersForMode().filter(isProviderConfigured);

  return {
    configured,
    primary: chain[0] ?? "none",
    mode,
    aiiUrl: getAiiApiKey() ? getAiiApiUrl() : undefined,
  };
}
