/**
 * OpenSolve HTTP client — https://open-solve.com/skill.md
 * Base: https://api.open-solve.com
 */
import {
  getOpenSolveApiBase,
  getOpenSolveAgentKey,
  getOpenSolveSiteBase,
} from "../config";

export type OpenSolveRole = "RESEARCHER" | "AUDITOR" | "SYNTHESIZER";

export interface OpenSolveRegisterResult {
  claim_token: string;
  temp_api_key: string;
  claim_url: string;
  message?: string;
}

export interface OpenSolveManifest {
  system?: string;
  agent_id: string;
  assigned_role: OpenSolveRole | string;
  capabilities?: string[];
  stages?: string[];
  endpoints?: Record<string, string>;
  available_sources?: string[];
}

export interface OpenSolvePaper {
  paper_id?: string;
  source?: string;
  title?: string;
  abstract?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  pdf_url?: string;
  arxiv_id?: string;
}

function apiBase(): string {
  return getOpenSolveApiBase().replace(/\/$/, "");
}

function siteBase(): string {
  return getOpenSolveSiteBase().replace(/\/$/, "");
}

async function osFetch<T>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    auth?: boolean;
    siteHost?: boolean;
  },
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const base = options?.siteHost ? siteBase() : apiBase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (options?.auth !== false) {
    const key = getOpenSolveAgentKey();
    if (!key) return { ok: false, status: 0, error: "missing_opensolve_key" };
    headers["X-Agent-Key"] = key;
  }

  try {
    const res = await fetch(`${base}${path}`, {
      method: options?.method ?? (options?.body ? "POST" : "GET"),
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let data: T | undefined;
    try {
      data = text ? (JSON.parse(text) as T) : undefined;
    } catch {
      return {
        ok: false,
        status: res.status,
        error: text.slice(0, 240) || `http_${res.status}`,
      };
    }
    if (!res.ok) {
      const errObj = data as { detail?: unknown; message?: string; error?: string } | undefined;
      const detail =
        typeof errObj?.detail === "string"
          ? errObj.detail
          : errObj?.message ?? errObj?.error ?? `http_${res.status}`;
      return { ok: false, status: res.status, data, error: String(detail) };
    }
    return { ok: true, status: res.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function registerOpenSolveAgent(params: {
  role: OpenSolveRole;
  name?: string;
}): Promise<OpenSolveRegisterResult & { error?: string }> {
  const result = await osFetch<OpenSolveRegisterResult>("/api/v1/agents/register", {
    method: "POST",
    body: { role: params.role, name: params.name },
    auth: false,
  });
  if (!result.ok || !result.data?.temp_api_key) {
    return {
      claim_token: "",
      temp_api_key: "",
      claim_url: "",
      error: result.error ?? "register_failed",
    };
  }
  return result.data;
}

export async function getOpenSolveManifest(): Promise<{
  ok: boolean;
  manifest?: OpenSolveManifest;
  error?: string;
  status?: number;
}> {
  const result = await osFetch<OpenSolveManifest>("/connect/manifest", {
    siteHost: true,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }
  return { ok: true, manifest: result.data };
}

export async function syncWork(body: Record<string, unknown>) {
  return osFetch<Record<string, unknown>>("/v1/work/sync", {
    method: "POST",
    body,
  });
}

export async function submitWork(body: Record<string, unknown>) {
  return osFetch<Record<string, unknown>>("/v1/work/submit", {
    method: "POST",
    body,
  });
}

export async function searchPapers(params: {
  query: string;
  sources?: string[];
  max_results?: number;
}) {
  return osFetch<{ papers?: OpenSolvePaper[]; total?: number }>(
    "/api/v1/search/papers",
    {
      method: "POST",
      body: {
        query: params.query,
        sources: params.sources ?? ["openalex", "pubmed", "pmc", "arxiv"],
        max_results: params.max_results ?? 8,
      },
    },
  );
}

export async function listLabBoardPosts(limit = 20) {
  return osFetch<{ posts?: Array<Record<string, unknown>> }>(
    `/api/v1/lab-board/posts?limit=${limit}`,
    { auth: false },
  );
}
