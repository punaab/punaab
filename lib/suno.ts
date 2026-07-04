import { getSunoApiKey } from "./config";

const SUNO_BASE = "https://api.sunoapi.org";

export type SunoModel = "V4" | "V4_5" | "V4_5PLUS" | "V4_5ALL" | "V5" | "V5_5";

export interface SunoGenerateRequest {
  prompt: string;
  style: string;
  title: string;
  customMode?: boolean;
  instrumental?: boolean;
  model?: SunoModel;
  callBackUrl: string;
  negativeTags?: string;
  vocalGender?: "m" | "f";
}

export interface SunoTrack {
  id: string;
  audio_url?: string;
  source_audio_url?: string;
  stream_audio_url?: string;
  image_url?: string;
  source_image_url?: string;
  prompt?: string;
  title?: string;
  tags?: string;
  duration?: number;
}

export interface SunoApiEnvelope<T> {
  code: number;
  msg: string;
  data?: T;
}

export class SunoApiError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "SunoApiError";
    this.code = code;
  }
}

function requireSunoKey(): string {
  const key = getSunoApiKey();
  if (!key) {
    throw new SunoApiError(401, "SUNO_API_KEY is not configured");
  }
  return key;
}

async function sunoFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<SunoApiEnvelope<T>> {
  const key = requireSunoKey();
  const url = `${SUNO_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload: SunoApiEnvelope<T>;
  try {
    payload = JSON.parse(text) as SunoApiEnvelope<T>;
  } catch {
    throw new SunoApiError(response.status, `Suno returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!response.ok || (payload.code !== undefined && payload.code !== 200)) {
    throw new SunoApiError(
      payload.code ?? response.status,
      payload.msg ?? `Suno HTTP ${response.status}`,
    );
  }

  return payload;
}

/** Start music generation — returns taskId for polling or callback. */
export async function generateMusic(
  req: SunoGenerateRequest,
): Promise<{ taskId: string }> {
  const body = {
    customMode: req.customMode ?? true,
    instrumental: req.instrumental ?? false,
    model: req.model ?? "V4_5ALL",
    prompt: req.prompt,
    style: req.style,
    title: req.title,
    callBackUrl: req.callBackUrl,
    ...(req.negativeTags ? { negativeTags: req.negativeTags } : {}),
    ...(req.vocalGender ? { vocalGender: req.vocalGender } : {}),
  };

  const result = await sunoFetch<{ taskId: string }>("/api/v1/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const taskId = result.data?.taskId;
  if (!taskId) {
    throw new SunoApiError(500, "Suno generate response missing taskId");
  }
  return { taskId };
}

/** Poll generation status when callback is delayed. */
export async function getGenerationDetails(taskId: string): Promise<{
  status?: string;
  tracks: SunoTrack[];
}> {
  const result = await sunoFetch<{
    status?: string;
    response?: { data?: SunoTrack[] };
    data?: SunoTrack[];
  }>(`/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`);

  const raw = result.data;
  const tracks =
    raw?.response?.data ??
    raw?.data ??
    (Array.isArray(raw) ? (raw as unknown as SunoTrack[]) : []);

  return {
    status: raw?.status,
    tracks: Array.isArray(tracks) ? tracks : [],
  };
}

/** Account credit balance. */
export async function getRemainingCredits(): Promise<number | null> {
  try {
    const result = await sunoFetch<{ credits?: number; remaining?: number }>(
      "/api/v1/get-credits",
    );
    const credits = result.data?.credits ?? result.data?.remaining;
    return typeof credits === "number" ? credits : null;
  } catch {
    return null;
  }
}
